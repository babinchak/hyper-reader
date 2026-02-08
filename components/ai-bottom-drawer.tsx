"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AIAgentPanel, type AIAgentPanelProps } from "@/components/ai-agent-pane";

type MobileDrawerMode = "closed" | "quick" | "half" | "full";

export interface AIBottomDrawerProps
  extends Omit<
    AIAgentPanelProps,
    | "className"
    | "showHeader"
    | "showMessages"
    | "showSelectedTextBanner"
    | "showExplainAction"
    | "showSelectionChip"
    | "onClose"
  > {
  /**
   * Optional initial mode (mostly for debugging).
   */
  initialMode?: MobileDrawerMode;
  /**
   * Prevent the drawer from being fully closed (useful for "peek" UIs).
   * Defaults to "closed".
   */
  minMode?: Extract<MobileDrawerMode, "closed" | "quick">;
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function AIBottomDrawer({
  selectedText,
  initialMode,
  minMode = "closed",
  ...panelProps
}: AIBottomDrawerProps) {
  const selectionExists = Boolean(selectedText && selectedText.trim().length > 0);

  const [mode, setMode] = useState<MobileDrawerMode>(() => {
    if (initialMode) return initialMode;
    if (minMode === "quick") return "quick";
    return selectionExists ? "quick" : "closed";
  });

  // Keep mode in sync with selection for the closed/quick behaviors.
  useEffect(() => {
    setMode((prev) => {
      if (selectionExists && prev === "closed") return "quick";
      if (!selectionExists && prev === "quick") return minMode === "quick" ? "quick" : "closed";
      return prev;
    });
  }, [minMode, selectionExists]);

  const handleHeight = 24;
  const quickHeight = 168;

  const heights = useMemo(() => {
    const vh = typeof window !== "undefined" ? window.innerHeight : 800;
    return {
      closed: handleHeight,
      quick: quickHeight,
      half: Math.round(vh * 0.55),
      full: Math.round(vh * 0.9),
    } satisfies Record<MobileDrawerMode, number>;
  }, []);

  const [heightPx, setHeightPx] = useState<number>(() => {
    if (typeof window === "undefined") return heights.closed;
    return heights[mode];
  });

  // Update height when mode changes or viewport changes.
  useEffect(() => {
    const update = () => {
      const vh = window.innerHeight;
      const newHeights = {
        closed: handleHeight,
        quick: quickHeight,
        half: Math.round(vh * 0.55),
        full: Math.round(vh * 0.9),
      } satisfies Record<MobileDrawerMode, number>;
      setHeightPx(newHeights[mode]);
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [mode]);

  const draggingRef = useRef<{
    startY: number;
    startHeight: number;
    pointerId: number;
  } | null>(null);

  const maxHeight = typeof window !== "undefined" ? Math.round(window.innerHeight * 0.92) : 900;
  const minHeight = handleHeight;

  const snapToMode = (h: number) => {
    const vh = window.innerHeight;
    const half = Math.round(vh * 0.55);
    const full = Math.round(vh * 0.9);

    const candidates: Array<{ mode: MobileDrawerMode; height: number }> = [
      {
        mode: selectionExists || minMode === "quick" ? "quick" : "closed",
        height: selectionExists || minMode === "quick" ? quickHeight : handleHeight,
      },
      { mode: "half", height: half },
      { mode: "full", height: full },
    ];

    let best = candidates[0];
    for (const c of candidates) {
      if (Math.abs(c.height - h) < Math.abs(best.height - h)) best = c;
    }
    setMode(best.mode);
  };

  const onHandlePointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    draggingRef.current = {
      startY: e.clientY,
      startHeight: heightPx,
      pointerId: e.pointerId,
    };
  };

  const onHandlePointerMove = (e: React.PointerEvent) => {
    const drag = draggingRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    const delta = drag.startY - e.clientY; // up = positive
    const next = clamp(drag.startHeight + delta, minHeight, maxHeight);
    setHeightPx(next);
  };

  const onHandlePointerUp = (e: React.PointerEvent) => {
    const drag = draggingRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    draggingRef.current = null;
    snapToMode(heightPx);
  };

  const close = () => setMode(selectionExists || minMode === "quick" ? "quick" : "closed");

  const showBackdrop = mode === "half" || mode === "full";

  const panelVisibility = (() => {
    if (mode === "closed") {
      return { showHeader: false, showMessages: false, showChip: false };
    }
    if (mode === "quick") {
      return { showHeader: false, showMessages: false, showChip: true };
    }
    if (mode === "half") {
      return { showHeader: true, showMessages: true, showChip: selectionExists };
    }
    return { showHeader: true, showMessages: true, showChip: selectionExists };
  })();

  return (
    <>
      {showBackdrop && (
        <button
          type="button"
          aria-label="Close AI assistant"
          onClick={close}
          className="fixed inset-0 z-40 bg-black/30"
        />
      )}

      <div
        className="fixed bottom-0 left-0 right-0 z-50"
        style={{ height: `${heightPx}px` }}
      >
        <div className="h-full w-full rounded-t-2xl border-t border-border bg-background shadow-2xl flex flex-col overflow-hidden">
          {/* Pill / handle */}
          <div
            className="h-6 flex items-center justify-center touch-none"
            onPointerDown={onHandlePointerDown}
            onPointerMove={onHandlePointerMove}
            onPointerUp={onHandlePointerUp}
            onPointerCancel={onHandlePointerUp}
            role="button"
            tabIndex={0}
            aria-label="Drag to open AI assistant"
            onClick={() => {
              // Tap to expand to half.
              if (mode === "closed") setMode(selectionExists ? "quick" : "half");
              else if (mode === "quick") setMode("half");
            }}
          >
            <div className="h-1.5 w-10 rounded-full bg-muted-foreground/30" />
          </div>

          {mode !== "closed" && (
            <AIAgentPanel
              {...panelProps}
              selectedText={selectedText}
              includeSelectionContextOnSend={true}
              showHeader={panelVisibility.showHeader}
              showMessages={panelVisibility.showMessages}
              showSelectedTextBanner={false}
              showExplainAction={true}
              showSelectionChip={panelVisibility.showChip}
              onClose={close}
              onActionStart={() => {
                // If the user runs an action from the quick state, expand so they can see the response.
                if (mode === "quick") setMode("half");
              }}
              className="flex-1 flex flex-col"
            />
          )}
        </div>
      </div>
    </>
  );
}

