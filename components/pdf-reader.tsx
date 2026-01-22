"use client";

import { useEffect, useRef, useState } from "react";
import {
  GlobalWorkerOptions,
  PixelsPerInch,
  getDocument,
  setLayerDimensions,
  type PDFDocumentProxy,
} from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { Bot, ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { getCurrentPdfSelectionPosition } from "@/lib/pdf-position/selection-position";

const workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
GlobalWorkerOptions.workerSrc = workerSrc;

interface PdfReaderProps {
  pdfUrl: string;
  fileName?: string | null;
}

export function PdfReader({ pdfUrl, fileName }: PdfReaderProps) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDebugPanelOpen, setIsDebugPanelOpen] = useState(false);
  const router = useRouter();

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
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background text-white">
        <div className="min-w-0">
          <Button
            variant="ghost"
            size="sm"
            className="mb-2 -ml-2 text-white hover:text-white"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
          <h1 className="font-semibold truncate">{fileName || "PDF Document"}</h1>
          <p className="text-xs text-white/70">{pdfDoc.numPages} pages</p>
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
      <div className="bg-background border-t border-border shadow-lg">
        <button
          onClick={() => setIsDebugPanelOpen(!isDebugPanelOpen)}
          className="w-full flex items-center justify-between px-4 py-2 hover:bg-muted/50 transition-colors"
        >
          <span className="text-sm font-medium">Debug</span>
          <span className="text-xs text-muted-foreground">
            {isDebugPanelOpen ? "Hide" : "Show"}
          </span>
        </button>
        <div
          className={`overflow-hidden transition-all duration-300 ${
            isDebugPanelOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
          }`}
        >
          <div className="px-4 py-3">
            <Button
              onClick={() => {
                const positions = getCurrentPdfSelectionPosition();
                if (!positions) return;
                console.log("Selection start position:", positions.start);
                console.log("Selection end position:", positions.end);
                console.log("Selected text:", window.getSelection()?.toString().trim() || "");
              }}
              variant="default"
              className="w-full"
            >
              Log Position
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface PdfPageProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale?: number;
}

function PdfPage({ pdf, pageNumber, scale = 1.25 }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerHostRef = useRef<HTMLDivElement | null>(null);
  const pageContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel?: () => void } | null = null;
    let textLayerBuilder: { cancel?: () => void } | null = null;

    const render = async () => {
      const page = await pdf.getPage(pageNumber);
      if (
        cancelled ||
        !canvasRef.current ||
        !textLayerHostRef.current ||
        !pageContainerRef.current
      ) {
        return;
      }

      const viewport = page.getViewport({ scale: scale * PixelsPerInch.PDF_TO_CSS_UNITS });
      const outputScale = window.devicePixelRatio || 1;

      pageContainerRef.current.style.setProperty("--scale-factor", viewport.scale.toString());
      setLayerDimensions(pageContainerRef.current, viewport);

      const canvas = canvasRef.current;
      const context = canvas.getContext("2d");
      if (!context) return;

      canvas.width = Math.floor(viewport.width * outputScale);
      canvas.height = Math.floor(viewport.height * outputScale);
      canvas.style.width = `${viewport.width}px`;
      canvas.style.height = `${viewport.height}px`;

      const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;
      renderTask = page.render({ canvasContext: context, viewport, transform });
      await renderTask.promise;

      const { TextLayerBuilder } = await import("pdfjs-dist/web/pdf_viewer.mjs");
      if (cancelled) return;

      const textLayerHost = textLayerHostRef.current;
      textLayerHost.innerHTML = "";
      textLayerHost.style.setProperty("--scale-factor", viewport.scale.toString());
      setLayerDimensions(textLayerHost, viewport);

      textLayerBuilder = new TextLayerBuilder({
        pdfPage: page,
        onAppend: (div: HTMLDivElement) => {
          const textNodes = Array.from(div.querySelectorAll("span"));
          textNodes.forEach((node, index) => {
            node.dataset.itemIndex = index.toString();
            node.dataset.pageNumber = pageNumber.toString();
          });
          textLayerHost.appendChild(div);
        },
      });

      await textLayerBuilder.render(viewport);
    };

    render().catch(() => {
      // noop: error handled by parent
    });

    return () => {
      cancelled = true;
      if (renderTask?.cancel) renderTask.cancel();
      textLayerBuilder?.cancel?.();
    };
  }, [pdf, pageNumber, scale]);

  return (
    <div className="w-full flex justify-center">
      <div ref={pageContainerRef} className="relative shadow-sm border bg-white">
        <canvas ref={canvasRef} className="pointer-events-none block" />
        <div ref={textLayerHostRef} className="absolute inset-0" />
      </div>
    </div>
  );
}
