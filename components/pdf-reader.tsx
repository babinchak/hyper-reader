"use client";

import { useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { Bot } from "lucide-react";

const workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
GlobalWorkerOptions.workerSrc = workerSrc;

interface PdfReaderProps {
  pdfUrl: string;
  fileName?: string | null;
}

interface PdfPageProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale?: number;
}

function PdfPage({ pdf, pageNumber, scale = 1.25 }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel?: () => void } | null = null;

    const render = async () => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled || !canvasRef.current) return;

      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) return;

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      renderTask = page.render({ canvasContext: context, viewport });
      await renderTask.promise;
    };

    render().catch(() => {
      // noop: error handled by parent
    });

    return () => {
      cancelled = true;
      if (renderTask?.cancel) renderTask.cancel();
    };
  }, [pdf, pageNumber, scale]);

  return (
    <div className="w-full flex justify-center">
      <canvas ref={canvasRef} className="shadow-sm border bg-white" />
    </div>
  );
}

export function PdfReader({ pdfUrl, fileName }: PdfReaderProps) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const loadingTask = getDocument({ url: pdfUrl });
    loadingTask.promise
      .then((pdf) => {
        if (cancelled) return;
        setPdfDoc(pdf);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err?.message || "Failed to load PDF");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      loadingTask.destroy();
    };
  }, [pdfUrl]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Loading PDF...</p>
        </div>
      </div>
    );
  }

  if (error || !pdfDoc) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-2">PDF Load Error</h1>
          <p className="text-muted-foreground">{error || "Unable to load PDF."}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background">
        <div className="min-w-0">
          <h1 className="font-semibold truncate">{fileName || "PDF Document"}</h1>
          <p className="text-xs text-muted-foreground">{pdfDoc.numPages} pages</p>
        </div>
        <Button className="opacity-50 cursor-not-allowed" size="icon" disabled>
          <Bot className="h-5 w-5" />
        </Button>
      </div>
      <div className="flex-1 overflow-auto bg-muted/20">
        <div className="max-w-4xl mx-auto py-6 space-y-6">
          {Array.from({ length: pdfDoc.numPages }, (_, idx) => (
            <PdfPage key={idx + 1} pdf={pdfDoc} pageNumber={idx + 1} />
          ))}
        </div>
      </div>
    </div>
  );
}
