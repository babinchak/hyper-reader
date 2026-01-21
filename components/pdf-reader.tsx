"use client";

import { useEffect, useRef, useState } from "react";
import { GlobalWorkerOptions, getDocument, type PDFDocumentProxy } from "pdfjs-dist";
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

interface PdfPageProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale?: number;
}

type PdfTextItem = {
  str?: string;
  transform?: number[];
  width?: number;
};

function multiplyTransforms(m1: number[], m2: number[]) {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

function renderTextLayer(
  container: HTMLDivElement,
  textItems: PdfTextItem[],
  viewport: { width: number; height: number; transform: number[]; scale: number },
  pageNumber: number
) {
  container.innerHTML = "";
  container.style.width = `${viewport.width}px`;
  container.style.height = `${viewport.height}px`;
  container.style.position = "absolute";
  container.style.inset = "0";
  container.style.zIndex = "2";
  container.style.pointerEvents = "auto";
  container.style.userSelect = "text";
  container.style.cursor = "text";
  container.style.color = "";
  container.style.whiteSpace = "pre";

  textItems.forEach((item, index) => {
    if (!item.str || !item.transform) return;

    const span = document.createElement("span");
    span.textContent = item.str;
    span.dataset.itemIndex = index.toString();
    span.dataset.pageNumber = pageNumber.toString();
    span.style.position = "absolute";
    span.style.transformOrigin = "0% 0%";
    span.style.whiteSpace = "pre";
    span.style.cursor = "text";
    span.style.pointerEvents = "auto";
    span.style.userSelect = "text";
    span.style.lineHeight = "1";

    const transform = multiplyTransforms(viewport.transform, item.transform);
    const angle = Math.atan2(transform[1], transform[0]);
    const fontHeight = Math.hypot(transform[2], transform[3]);
    const x = transform[4];
    const y = transform[5];

    span.style.fontSize = `${fontHeight}px`;
    span.style.transform = `translate(${x}px, ${y - fontHeight}px) rotate(${angle}rad)`;

    if (item.width && item.str.length > 0) {
      const scaledWidth = item.width * viewport.scale;
      span.style.width = `${scaledWidth}px`;
      span.style.display = "inline-block";
    }

    container.appendChild(span);
  });
}

function PdfPage({ pdf, pageNumber, scale = 1.25 }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel?: () => void } | null = null;

    const render = async () => {
      const page = await pdf.getPage(pageNumber);
      if (cancelled || !canvasRef.current || !textLayerRef.current) return;

      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      const textLayer = textLayerRef.current;
      const context = canvas.getContext("2d");
      if (!context) return;

      canvas.width = viewport.width;
      canvas.height = viewport.height;

      renderTask = page.render({ canvasContext: context, viewport });
      await renderTask.promise;

      const textContent = await page.getTextContent();
      if (cancelled) return;
      renderTextLayer(
        textLayer,
        textContent.items as PdfTextItem[],
        {
          width: viewport.width,
          height: viewport.height,
          transform: viewport.transform,
          scale: viewport.scale,
        },
        pageNumber
      );
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
      <div className="relative shadow-sm border bg-white">
        <canvas ref={canvasRef} className="pointer-events-none block" />
        <div ref={textLayerRef} className="absolute inset-0 select-text cursor-text pdf-text-layer" />
      </div>
    </div>
  );
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
