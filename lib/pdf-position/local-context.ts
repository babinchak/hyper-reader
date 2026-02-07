export interface PdfLocalSelectionContext {
  beforeText: string;
  selectedText: string;
  afterText: string;
}

interface PdfSpanInfo {
  pageNumber: number;
  itemIndex: number;
  charOffset: number;
}

const SPAN_SELECTOR = "[data-item-index][data-page-number]";

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function joinWithSpace(left: string, right: string): string {
  if (!left) return right;
  if (!right) return left;
  // If either side already has boundary whitespace, just concat.
  if (/\s$/.test(left) || /^\s/.test(right)) return left + right;
  return `${left} ${right}`;
}

function prependWithSpace(acc: string, fragment: string): string {
  if (!fragment) return acc;
  if (!acc) return fragment;
  if (/\s$/.test(fragment) || /^\s/.test(acc)) return fragment + acc;
  return `${fragment} ${acc}`;
}

function getCharOffsetWithinSpan(
  span: HTMLSpanElement,
  container: Node,
  offset: number
): number {
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

function getSpanInfo(container: Node, offset: number): PdfSpanInfo | null {
  const element =
    container.nodeType === Node.TEXT_NODE
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

function keyForSpanInfo(info: Pick<PdfSpanInfo, "pageNumber" | "itemIndex">): string {
  return `${info.pageNumber}/${info.itemIndex}`;
}

/**
 * Extracts a bounded, local window of text around the CURRENT PDF selection.
 *
 * This is best-effort and intentionally defensive:
 * - If span metadata isn't available, it returns null.
 * - If you're near the start/end, it returns whatever text is available.
 */
export function getPdfLocalContextAroundCurrentSelection(options?: {
  beforeChars?: number;
  afterChars?: number;
  maxTotalChars?: number;
}): PdfLocalSelectionContext | null {
  const beforeChars = Math.max(0, options?.beforeChars ?? 800);
  const afterChars = Math.max(0, options?.afterChars ?? 800);
  const maxTotalChars = Math.max(0, options?.maxTotalChars ?? 2400);

  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;

  const selectedText = selection.toString().trim();
  if (!selectedText) return null;

  const range = selection.getRangeAt(0);
  const startInfo = getSpanInfo(range.startContainer, range.startOffset);
  const endInfo = getSpanInfo(range.endContainer, range.endOffset);
  if (!startInfo || !endInfo) return null;

  const spans = Array.from(
    document.querySelectorAll<HTMLSpanElement>(SPAN_SELECTOR)
  );
  if (spans.length === 0) return null;

  const indexByKey = new Map<string, number>();
  spans.forEach((span, index) => {
    const pageNumber = Number(span.dataset.pageNumber);
    const itemIndex = Number(span.dataset.itemIndex);
    if (!Number.isNaN(pageNumber) && !Number.isNaN(itemIndex)) {
      indexByKey.set(`${pageNumber}/${itemIndex}`, index);
    }
  });

  const startIndex = indexByKey.get(keyForSpanInfo(startInfo));
  const endIndex = indexByKey.get(keyForSpanInfo(endInfo));
  if (startIndex == null || endIndex == null) return null;

  // Build BEFORE context
  let beforeAcc = "";
  {
    const startSpanText = spans[startIndex]?.textContent ?? "";
    const slice = startSpanText.slice(0, startInfo.charOffset);
    beforeAcc = normalizeWhitespace(slice);

    for (let i = startIndex - 1; i >= 0 && beforeAcc.length < beforeChars * 2; i--) {
      const t = normalizeWhitespace(spans[i]?.textContent ?? "");
      beforeAcc = prependWithSpace(beforeAcc, t);
    }

    if (beforeAcc.length > beforeChars) {
      beforeAcc = beforeAcc.slice(beforeAcc.length - beforeChars);
      beforeAcc = beforeAcc.replace(/^\S*\s?/, "").trim(); // avoid starting mid-word when possible
    }
  }

  // Build AFTER context
  let afterAcc = "";
  {
    const endSpanText = spans[endIndex]?.textContent ?? "";
    const slice = endSpanText.slice(endInfo.charOffset);
    afterAcc = normalizeWhitespace(slice);

    for (
      let i = endIndex + 1;
      i < spans.length && afterAcc.length < afterChars * 2;
      i++
    ) {
      const t = normalizeWhitespace(spans[i]?.textContent ?? "");
      afterAcc = joinWithSpace(afterAcc, t);
    }

    if (afterAcc.length > afterChars) {
      afterAcc = afterAcc.slice(0, afterChars);
      afterAcc = afterAcc.replace(/\s?\S*$/, "").trim(); // avoid ending mid-word when possible
    }
  }

  // Enforce overall cap (prefer keeping selection + some context on both sides)
  const normalizedSelected = normalizeWhitespace(selectedText);
  const totalLen =
    beforeAcc.length + normalizedSelected.length + afterAcc.length;
  if (maxTotalChars > 0 && totalLen > maxTotalChars) {
    const budget = Math.max(0, maxTotalChars - normalizedSelected.length);
    const beforeBudget = Math.min(beforeAcc.length, Math.floor(budget / 2));
    const afterBudget = Math.min(afterAcc.length, budget - beforeBudget);

    if (beforeAcc.length > beforeBudget) {
      beforeAcc = beforeAcc.slice(beforeAcc.length - beforeBudget).trim();
      beforeAcc = beforeAcc.replace(/^\S*\s?/, "").trim();
    }
    if (afterAcc.length > afterBudget) {
      afterAcc = afterAcc.slice(0, afterBudget).trim();
      afterAcc = afterAcc.replace(/\s?\S*$/, "").trim();
    }
  }

  return {
    beforeText: beforeAcc,
    selectedText: normalizedSelected,
    afterText: afterAcc,
  };
}

