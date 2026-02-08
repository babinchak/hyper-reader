"use client";

import { useMemo, useRef, useState } from "react";
import { AIRail } from "@/components/ai-rail";
import { AIBottomDrawer } from "@/components/ai-bottom-drawer";
import { AIAgentPanel } from "@/components/ai-agent-pane";
import { useMediaQuery } from "@/lib/use-media-query";

export interface AIAssistantProps {
  selectedText?: string;
  bookId?: string;
  rawManifest?: { readingOrder?: Array<{ href?: string }> };
  bookType: "epub" | "pdf";
  mobileDrawerMinMode?: "closed" | "quick";
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

export function AIAssistant(props: AIAssistantProps) {
  const isMobile = useMediaQuery("(max-width: 767px)");
  if (isMobile) {
    return (
      <AIBottomDrawer
        selectedText={props.selectedText}
        bookId={props.bookId}
        rawManifest={props.rawManifest}
        bookType={props.bookType}
        minMode={props.mobileDrawerMinMode}
      />
    );
  }
  return <DesktopAIAssistant {...props} />;
}

function DesktopAIAssistant({ selectedText, bookId, rawManifest, bookType }: AIAssistantProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [autoRun, setAutoRun] = useState<{ nonce: number; action: "page" | "selection" } | null>(
    null
  );
  const nonceRef = useRef(0);

  const openAndRun = (action: "page" | "selection") => {
    setIsOpen(true);
    nonceRef.current += 1;
    setAutoRun({ nonce: nonceRef.current, action });
  };

  // PDF: docked + resizable width. EPUB: overlay fixed drawer.
  const isPdf = bookType === "pdf";
  const [dockWidth, setDockWidth] = useState(384); // 24rem
  const resizingRef = useRef<{ startX: number; startW: number; pointerId: number } | null>(null);

  const startResize = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizingRef.current = { startX: e.clientX, startW: dockWidth, pointerId: e.pointerId };
  };

  const moveResize = (e: React.PointerEvent) => {
    const r = resizingRef.current;
    if (!r || r.pointerId !== e.pointerId) return;
    const delta = r.startX - e.clientX; // dragging left increases width
    setDockWidth(clamp(r.startW + delta, 280, 640));
  };

  const endResize = (e: React.PointerEvent) => {
    const r = resizingRef.current;
    if (!r || r.pointerId !== e.pointerId) return;
    resizingRef.current = null;
  };

  const panelProps = useMemo(
    () => ({
      selectedText,
      bookId,
      rawManifest,
      bookType,
      autoRun,
      hideInputUntilFirstResponse: true,
      onClose: () => setIsOpen(false),
    }),
    [autoRun, bookId, bookType, rawManifest, selectedText]
  );

  return (
    <>
      {!isOpen && (
        <AIRail
          selectedText={selectedText}
          onActivate={(action) => openAndRun(action)}
        />
      )}

      {isOpen && isPdf && (
        <div
          className="relative h-full border-l border-border bg-background shadow-lg flex flex-col"
          style={{ width: `${dockWidth}px` }}
        >
          <div
            className="absolute -left-1 top-0 h-full w-2 cursor-col-resize touch-none z-50"
            onPointerDown={startResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            aria-label="Resize AI panel"
            role="separator"
            aria-orientation="vertical"
          />
          <AIAgentPanel {...panelProps} className="h-full w-full flex flex-col" />
        </div>
      )}

      {isOpen && !isPdf && (
        <>
          <button
            type="button"
            aria-label="Close AI assistant"
            className="fixed inset-0 z-40 bg-black/20"
            onClick={() => setIsOpen(false)}
          />
          <AIAgentPanel
            {...panelProps}
            className="fixed right-0 top-0 z-50 h-full w-96 bg-background border-l border-border shadow-lg flex flex-col select-text"
          />
        </>
      )}
    </>
  );
}

