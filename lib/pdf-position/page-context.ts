export interface PdfPageContext {
  pageNumber: number;
  text: string;
  startPosition: string;
  endPosition: string;
}

const PAGE_SELECTOR = ".pdfViewer .page";
const SPAN_SELECTOR = "[data-item-index][data-page-number]";

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function getMostRelevantPageElement(): HTMLElement | null {
  const pages = Array.from(
    document.querySelectorAll<HTMLElement>(PAGE_SELECTOR)
  );
  if (pages.length === 0) return null;

  const centerY = window.innerHeight / 2;
  const centerX = window.innerWidth / 2;

  // Prefer the page under the viewport center.
  let best: { el: HTMLElement; dist: number } | null = null;
  for (const el of pages) {
    const rect = el.getBoundingClientRect();
    const intersectsCenter = rect.top <= centerY && rect.bottom >= centerY;
    const dist = intersectsCenter ? 0 : Math.min(Math.abs(rect.top - centerY), Math.abs(rect.bottom - centerY));

    if (!best || dist < best.dist) {
      best = { el, dist };
      if (dist === 0) break;
    }
  }

  // If pdf is in a side pane, the center might fall outside; try hit-testing too.
  if (best?.el) return best.el;

  const hit = document.elementFromPoint(centerX, centerY) as Element | null;
  const hitPage = hit?.closest?.(PAGE_SELECTOR) as HTMLElement | null;
  return hitPage;
}

export function getCurrentPdfPageContext(options?: {
  maxChars?: number;
}): PdfPageContext | null {
  const pageEl = getMostRelevantPageElement();
  if (!pageEl) return null;

  const spans = Array.from(
    pageEl.querySelectorAll<HTMLSpanElement>(SPAN_SELECTOR)
  );
  if (spans.length === 0) return null;

  const first = spans[0];
  const last = spans[spans.length - 1];

  const pageNumber = Number(first.dataset.pageNumber);
  if (Number.isNaN(pageNumber)) return null;

  // itemIndex is assigned sequentially per-page (see PdfReader).
  const lastItemIndex = Number(last.dataset.itemIndex);
  const endCharOffset = last.textContent?.length ?? 0;

  let raw = "";
  for (const span of spans) {
    raw += span.textContent ?? "";
  }

  let text = normalizeWhitespace(raw);
  const maxChars = Math.max(0, options?.maxChars ?? 30000);
  if (maxChars > 0 && text.length > maxChars) {
    text = text.slice(0, maxChars).trim();
  }

  return {
    pageNumber,
    text,
    startPosition: `${pageNumber}/0/0`,
    endPosition: `${pageNumber}/${Number.isNaN(lastItemIndex) ? spans.length - 1 : lastItemIndex}/${endCharOffset}`,
  };
}

