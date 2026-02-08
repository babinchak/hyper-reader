"use client";

import { useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { getCurrentPdfSelectionPosition } from "@/lib/pdf-position/selection-position";
import { queryPdfSummariesForPosition } from "@/lib/pdf-position/summaries";
import { AIAssistant } from "@/components/ai-assistant";
import { useSelectedText } from "@/lib/use-selected-text";
import { useMediaQuery } from "@/lib/use-media-query";

type PDFDocumentLoadingTask = {
  promise: Promise<PDFDocumentProxy>;
  destroy: () => void;
};

const PDF_DEBUG_ENABLED =
  process.env.NEXT_PUBLIC_PDF_DEBUG === "1" ||
  process.env.NEXT_PUBLIC_PDF_DEBUG === "true";

interface PdfReaderProps {
  pdfUrl: string;
  fileName?: string | null;
  bookId: string;
}

export function PdfReader({ pdfUrl, fileName, bookId }: PdfReaderProps) {
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isDebugPanelOpen, setIsDebugPanelOpen] = useState(false);
  const selectedText = useSelectedText();
  const selectionExists = Boolean(selectedText && selectedText.trim().length > 0);
  const router = useRouter();
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [chromeVisible, setChromeVisible] = useState(true);
  const tapRef = useRef<{ pointerId: number; x: number; y: number; t: number; moved: boolean } | null>(
    null,
  );

  useEffect(() => {
    // Default to an "immersive" UI on mobile: tap center to reveal chrome.
    setChromeVisible(!isMobile);
    // Keep debug panel closed on mobile unless explicitly opened.
    if (isMobile) setIsDebugPanelOpen(false);
  }, [isMobile]);

  // iOS safe-area can be zero in some contexts; keep a sensible fallback.
  // Lower fallback = slightly higher top bar when `env()` reports 0.
  const mobileSafeTop = "max(env(safe-area-inset-top), 0px)";

  useEffect(() => {
    let cancelled = false;
    let loadingTask: PDFDocumentLoadingTask | null = null;
    setLoading(true);
    setError(null);

    (async () => {
      // IMPORTANT: `pdfjs-dist` must be imported only in the browser.
      // Importing it on the server (SSR) can crash with `DOMMatrix is not defined`.
      const pdfjs = await import("pdfjs-dist");

      const workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url,
      ).toString();
      pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

      const baseParams: Record<string, unknown> = { url: pdfUrl };

      // Some mobile browsers can be flaky with module workers; fall back to main-thread parsing.
      const canUseWorker =
        typeof Worker !== "undefined" &&
        // iOS Safari is the most common trouble spot; be conservative.
        !/iPad|iPhone|iPod/.test(navigator.userAgent);

      const tryLoad = async (params: Record<string, unknown>) => {
        loadingTask = pdfjs.getDocument(params) as unknown as PDFDocumentLoadingTask;
        return await loadingTask.promise;
      };

      let pdf: PDFDocumentProxy;
      try {
        pdf = await tryLoad({ ...baseParams, disableWorker: !canUseWorker });
      } catch (e) {
        // Retry once without worker as a safety net.
        pdf = await tryLoad({ ...baseParams, disableWorker: true });
      }
      if (cancelled) return;
      setPdfDoc(pdf);
      setLoading(false);
    })().catch((err) => {
        if (cancelled) return;
        setError(err?.message || "Failed to load PDF");
        setLoading(false);
      });

    return () => {
      cancelled = true;
      try {
        loadingTask?.destroy?.();
      } catch {
        // ignore
      }
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
    <div className="w-full h-screen flex">
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex flex-col h-full relative">
          {(!isMobile || chromeVisible) && (
            <>
              {isMobile && (
                // Background "sheet" that fills the notch/safe-area region too,
                // while keeping the interactive bar content below it.
                <div
                  className="absolute top-0 left-0 right-0 z-50 border-b/60 bg-background/90 backdrop-blur pointer-events-none"
                  style={{ paddingTop: mobileSafeTop }}
                />
              )}
              <div
                className={[
                  "flex items-center justify-between px-4 border-b bg-background text-white pointer-events-auto",
                  // On mobile, overlay instead of docking (avoid reflow/layout shift).
                  isMobile
                    ? "absolute left-0 right-0 z-50 border-b/60 bg-background/90 backdrop-blur py-2"
                    : "py-2",
                ].join(" ")}
                style={isMobile ? { top: mobileSafeTop } : undefined}
              >
                <div className="min-w-0 flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-ml-2 text-white hover:text-white shrink-0"
                    onClick={() => router.back()}
                    aria-label="Back"
                  >
                    <ArrowLeft className="h-5 w-5" />
                  </Button>
                  <div className="min-w-0">
                    <h1 className="font-semibold truncate leading-tight">
                      {fileName || "PDF Document"}
                    </h1>
                    <p className="text-xs text-white/70 leading-tight">{pdfDoc.numPages} pages</p>
                  </div>
                </div>
              </div>
            </>
          )}
          <div
            className="flex-1 overflow-auto bg-muted/20"
            onPointerDown={(e) => {
              if (!isMobile) return;
              // Only consider single-pointer taps for the center-toggle gesture.
              if (e.isPrimary === false) return;
              tapRef.current = {
                pointerId: e.pointerId,
                x: e.clientX,
                y: e.clientY,
                t: Date.now(),
                moved: false,
              };
            }}
            onPointerMove={(e) => {
              if (!isMobile) return;
              const t = tapRef.current;
              if (!t || t.pointerId !== e.pointerId) return;
              if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10) t.moved = true;
            }}
            onPointerUp={(e) => {
              if (!isMobile) return;
              const t = tapRef.current;
              tapRef.current = null;
              if (!t || t.pointerId !== e.pointerId) return;

              const dt = Date.now() - t.t;
              if (t.moved || dt > 350) return;

              // Ignore taps on obvious interactive elements.
              const target = e.target as HTMLElement | null;
              if (target?.closest("button,a,input,textarea,select,[role='button']")) return;

              // Only toggle when tapping near the center of the viewport.
              const cx0 = window.innerWidth * 0.25;
              const cx1 = window.innerWidth * 0.75;
              const cy0 = window.innerHeight * 0.25;
              const cy1 = window.innerHeight * 0.75;
              if (e.clientX < cx0 || e.clientX > cx1 || e.clientY < cy0 || e.clientY > cy1) return;

              setChromeVisible((v) => !v);
            }}
            onPointerCancel={() => {
              tapRef.current = null;
            }}
          >
            <div className="pdfViewer max-w-4xl mx-auto py-6 space-y-6">
              {Array.from({ length: pdfDoc.numPages }, (_, idx) => (
                <LazyPdfPage key={idx + 1} pdf={pdfDoc} pageNumber={idx + 1} />
              ))}
            </div>
          </div>
          {PDF_DEBUG_ENABLED && (!isMobile || chromeVisible) && (
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
                    onClick={async () => {
                      const positions = getCurrentPdfSelectionPosition();
                      if (!positions) return;
                      console.log("Selection start position:", positions.start);
                      console.log("Selection end position:", positions.end);
                      console.log("Selected text:", window.getSelection()?.toString().trim() || "");

                      const summaries = await queryPdfSummariesForPosition(
                        bookId,
                        positions.start,
                        positions.end,
                      );

                      console.log("Matching summaries:", summaries);
                    }}
                    variant="default"
                    className="w-full"
                  >
                    Log Position
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="relative h-full flex-none">
        {/* Mobile: AI drawer follows the same chrome/menu toggle as the top bar. */}
        {(!isMobile || chromeVisible) && (
          <AIAssistant
            selectedText={selectedText}
            bookId={bookId}
            bookType="pdf"
            mobileDrawerMinMode={selectionExists ? "quick" : "closed"}
          />
        )}
      </div>
    </div>
  );
}

interface PdfPageProps {
  pdf: PDFDocumentProxy;
  pageNumber: number;
  scale?: number;
}

function LazyPdfPage({ pdf, pageNumber, scale }: PdfPageProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [shouldRender, setShouldRender] = useState(pageNumber <= 2);

  useEffect(() => {
    if (shouldRender) return;
    const el = hostRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting) {
          setShouldRender(true);
          obs.disconnect();
        }
      },
      // Start rendering before it scrolls into view.
      { root: null, rootMargin: "1200px 0px", threshold: 0.01 },
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [shouldRender]);

  return (
    <div ref={hostRef}>
      {shouldRender ? (
        <PdfPage pdf={pdf} pageNumber={pageNumber} scale={scale} />
      ) : (
        <div className="w-full flex justify-center">
          <div className="page relative shadow-sm border bg-white w-full max-w-4xl">
            <div className="w-full" style={{ aspectRatio: "1 / 1.4142" }} />
          </div>
        </div>
      )}
    </div>
  );
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function PdfPage({ pdf, pageNumber, scale = 1 }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerHostRef = useRef<HTMLDivElement | null>(null);
  const pageContainerRef = useRef<HTMLDivElement | null>(null);
  const zoomLayerRef = useRef<HTMLDivElement | null>(null);

  const MIN_ZOOM = 0.7; // allow "over-zoom out" while pinching
  const MAX_ZOOM = 4;
  const SNAP_BACK_THRESHOLD = 1.08; // snap back to min zoom on release near 1x

  const [view, setView] = useState<{ scale: number; x: number; y: number }>(() => ({
    scale: 1,
    x: 0,
    y: 0,
  }));
  const [isInteracting, setIsInteracting] = useState(false);

  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const gestureStartRef = useRef<{
    startScale: number;
    startX: number;
    startY: number;
    startDist: number;
  } | null>(null);
  const panRef = useRef<{ pointerId: number; lastX: number; lastY: number } | null>(null);

  const clampToBounds = (next: { scale: number; x: number; y: number }) => {
    const host = pageContainerRef.current;
    if (!host) return next;
    const w = host.clientWidth || 0;
    const h = host.clientHeight || 0;
    if (w <= 0 || h <= 0) return next;

    // When zoomed out below 1x (only allowed during pinch), keep the page centered.
    if (next.scale < 1) {
      const cx = (w - w * next.scale) / 2;
      const cy = (h - h * next.scale) / 2;
      return { scale: next.scale, x: cx, y: cy };
    }

    const minX = w - w * next.scale;
    const minY = h - h * next.scale;
    return {
      scale: next.scale,
      x: clamp(next.x, minX, 0),
      y: clamp(next.y, minY, 0),
    };
  };

  useEffect(() => {
    let cancelled = false;
    let renderTask: { cancel?: () => void; promise: Promise<unknown> } | null =
      null;
    // pdfjs' TextLayerBuilder types vary across versions; keep this loose.
    // Cast at the assignment site to avoid TypeScript variance issues across versions.
    let textLayerBuilder: {
      cancel?: () => void;
      render?: (opts: any) => Promise<any>;
    } | null = null;

    const render = async () => {
      const { PixelsPerInch, setLayerDimensions } = await import("pdfjs-dist");
      const page = await pdf.getPage(pageNumber);
      if (
        cancelled ||
        !canvasRef.current ||
        !textLayerHostRef.current ||
        !pageContainerRef.current
      ) {
        return;
      }

      // Fit-to-width by default on mobile to avoid the "stuck zoomed-in" feeling.
      const containerWidth =
        pageContainerRef.current.parentElement?.clientWidth || pageContainerRef.current.clientWidth;
      const baseViewport = page.getViewport({ scale: PixelsPerInch.PDF_TO_CSS_UNITS });
      const fitFactor = containerWidth
        ? clamp(containerWidth / baseViewport.width, 0.5, 2.5)
        : 1;

      const viewport = page.getViewport({
        scale: scale * fitFactor * PixelsPerInch.PDF_TO_CSS_UNITS,
      });
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
      renderTask = page.render({ canvas, canvasContext: context, viewport, transform });
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
      }) as any;

      await textLayerBuilder?.render?.({ viewport });

      // Reset zoom/pan on (re)render so each page starts "fit to screen".
      setView({ scale: 1, x: 0, y: 0 });
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

  useEffect(() => {
    // iOS Safari emits non-standard gesture events for pinch.
    // Prevent default so pinching the PDF doesn't trigger browser/OS gestures (e.g. tab UI).
    const el = zoomLayerRef.current;
    if (!el) return;

    const prevent = (e: Event) => {
      if (typeof e.cancelable === "boolean" && e.cancelable) e.preventDefault();
    };
    el.addEventListener("gesturestart", prevent as any, { passive: false });
    el.addEventListener("gesturechange", prevent as any, { passive: false });
    el.addEventListener("gestureend", prevent as any, { passive: false });
    return () => {
      el.removeEventListener("gesturestart", prevent as any);
      el.removeEventListener("gesturechange", prevent as any);
      el.removeEventListener("gestureend", prevent as any);
    };
  }, []);

  const toLocal = (clientX: number, clientY: number) => {
    const host = pageContainerRef.current;
    if (!host) return { x: clientX, y: clientY };
    const rect = host.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);

    setIsInteracting(true);

    const p = toLocal(e.clientX, e.clientY);
    pointersRef.current.set(e.pointerId, p);

    if (pointersRef.current.size === 1) {
      panRef.current = { pointerId: e.pointerId, lastX: p.x, lastY: p.y };
    }

    if (pointersRef.current.size === 2) {
      const pts = Array.from(pointersRef.current.values());
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy) || 1;
      gestureStartRef.current = {
        startScale: view.scale,
        startX: view.x,
        startY: view.y,
        startDist: dist,
      };
      panRef.current = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    const p = toLocal(e.clientX, e.clientY);
    pointersRef.current.set(e.pointerId, p);

    // Pinch zoom (two pointers)
    if (pointersRef.current.size === 2 && gestureStartRef.current) {
      const pts = Array.from(pointersRef.current.values());
      const mid = { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      const dx = pts[0].x - pts[1].x;
      const dy = pts[0].y - pts[1].y;
      const dist = Math.hypot(dx, dy) || 1;

      const start = gestureStartRef.current;
      const rawScale = start.startScale * (dist / start.startDist);
      const nextScale = clamp(rawScale, MIN_ZOOM, MAX_ZOOM);

      // Keep the midpoint stable while scaling with transformOrigin 0 0:
      // x1 = m - (m - x0)/s0 * s1
      const nextX = mid.x - ((mid.x - start.startX) / start.startScale) * nextScale;
      const nextY = mid.y - ((mid.y - start.startY) / start.startScale) * nextScale;

      setView((prev) => clampToBounds({ ...prev, scale: nextScale, x: nextX, y: nextY }));
      return;
    }

    // Pan (one pointer) only when zoomed in.
    const pan = panRef.current;
    if (!pan || pan.pointerId !== e.pointerId) return;
    if (view.scale <= 1) return;

    const dx = p.x - pan.lastX;
    const dy = p.y - pan.lastY;
    panRef.current = { ...pan, lastX: p.x, lastY: p.y };

    setView((prev) => clampToBounds({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    pointersRef.current.delete(e.pointerId);
    if (panRef.current?.pointerId === e.pointerId) panRef.current = null;
    if (pointersRef.current.size < 2) gestureStartRef.current = null;
    if (pointersRef.current.size === 1) {
      const remaining = Array.from(pointersRef.current.entries())[0];
      if (remaining) {
        panRef.current = { pointerId: remaining[0], lastX: remaining[1].x, lastY: remaining[1].y };
      }
    }
    setIsInteracting(pointersRef.current.size > 0);

    // Snap back to the minimum zoom (fit) if the user ends near it (or below it).
    setView((prev) =>
      prev.scale < SNAP_BACK_THRESHOLD ? { scale: 1, x: 0, y: 0 } : clampToBounds(prev),
    );
  };

  return (
    <div className="w-full flex justify-center">
      <div ref={pageContainerRef} className="page relative shadow-sm border bg-white overflow-hidden">
        <div
          ref={zoomLayerRef}
          className="absolute inset-0"
          style={{
            transform: `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.scale})`,
            transformOrigin: "0 0",
            transition: isInteracting ? "none" : "transform 160ms ease-out",
            // Allow normal one-finger scroll when not zoomed.
            touchAction: view.scale !== 1 ? "none" : "pan-y",
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => setView({ scale: 1, x: 0, y: 0 })}
        >
          <div className="canvasWrapper">
            <canvas ref={canvasRef} className="pointer-events-none block" />
          </div>
          <div ref={textLayerHostRef} className="absolute inset-0" />
        </div>
      </div>
    </div>
  );
}
