export interface PdfSelectionPosition {
  start: string;
  end: string;
}

interface PdfSpanInfo {
  pageNumber: number;
  itemIndex: number;
  charOffset: number;
}

const SPAN_SELECTOR = "[data-item-index][data-page-number]";

function formatPdfPosition(info: PdfSpanInfo): string {
  return `${info.pageNumber}:${info.itemIndex}:${info.charOffset}`;
}

function getSpanInfo(container: Node, offset: number): PdfSpanInfo | null {
  const element = container.nodeType === Node.TEXT_NODE
    ? container.parentElement
    : (container as Element | null);
  const span = element?.closest(SPAN_SELECTOR) as HTMLSpanElement | null;
  if (!span) return null;

  const pageNumber = Number(span.dataset.pageNumber);
  const itemIndex = Number(span.dataset.itemIndex);
  if (Number.isNaN(pageNumber) || Number.isNaN(itemIndex)) return null;

  let charOffset = offset;
  if (container.nodeType !== Node.TEXT_NODE) {
    charOffset = getCharOffsetWithinSpan(span, container, offset);
  }

  const spanTextLength = span.textContent?.length ?? 0;
  charOffset = Math.min(Math.max(charOffset, 0), spanTextLength);

  return { pageNumber, itemIndex, charOffset };
}

function getCharOffsetWithinSpan(span: HTMLSpanElement, container: Node, offset: number): number {
  if (container.nodeType === Node.TEXT_NODE) {
    return offset;
  }

  if (container.nodeType !== Node.ELEMENT_NODE) {
    return 0;
  }

  const element = container as Element;
  if (element !== span) {
    return 0;
  }

  let charOffset = 0;
  const childNodes = Array.from(element.childNodes);
  for (let i = 0; i < Math.min(offset, childNodes.length); i++) {
    charOffset += childNodes[i]?.textContent?.length ?? 0;
  }

  return charOffset;
}

export function getCurrentPdfSelectionPosition(): PdfSelectionPosition | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  if (selection.toString().trim().length === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const startInfo = getSpanInfo(range.startContainer, range.startOffset);
  const endInfo = getSpanInfo(range.endContainer, range.endOffset);

  if (!startInfo || !endInfo) {
    return null;
  }

  return {
    start: formatPdfPosition(startInfo),
    end: formatPdfPosition(endInfo),
  };
}
