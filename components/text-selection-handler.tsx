"use client";

import { useStore } from "react-redux";
import { Button } from "@/components/ui/button";

interface TextSelectionHandlerProps {
  rawManifest: any;
}

interface SelectionPosition {
  start: string;
  end: string;
}

export function TextSelectionHandler({ rawManifest }: TextSelectionHandlerProps) {
  // Get readingOrder from manifest
  const readingOrder = rawManifest?.readingOrder || [];
  const store = useStore();

  const handleButtonClick = () => {
    // Try to get selection from the main document first
    let selection: Selection | null = window.getSelection();
    let range: Range | null = null;
    let targetDoc: Document = document;
    
    // Check if selection is valid in main document
    if (selection && selection.rangeCount > 0 && selection.toString().trim() !== "") {
      range = selection.getRangeAt(0);
    } else {
      // Look for iframe that might contain the reader content
      const iframes = document.querySelectorAll("iframe");
      for (const iframe of iframes) {
        try {
          const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
          if (iframeDoc) {
            const iframeSelection = iframeDoc.getSelection();
            if (iframeSelection && iframeSelection.rangeCount > 0 && iframeSelection.toString().trim() !== "") {
              selection = iframeSelection;
              range = iframeSelection.getRangeAt(0);
              targetDoc = iframeDoc;
              break;
            }
          }
        } catch (e) {
          // Cross-origin iframe, skip
          continue;
        }
      }
    }

    if (!selection || !range || selection.toString().trim() === "") {
      return;
    }

    // Try to get readingOrder index from Redux store
    let readingOrderIndexFromStore = -1;
    try {
      const state = store.getState();
      
      // Deep inspect the state to find current link
      const readerState = (state as any).reader;
      const publicationState = (state as any).publication;
      
      // Try to find current link in various places
      let currentLink: any = null;
      let currentIndex: number = -1;
      
      // Check reader state
      if (readerState) {
        currentLink = readerState.currentLink || readerState.link || readerState.href || 
                     readerState.location?.href || readerState.location?.link ||
                     readerState.navigator?.currentLink || readerState.navigator?.link;
        currentIndex = readerState.readingOrderIndex ?? readerState.index ?? 
                      readerState.location?.index ?? readerState.navigator?.index ?? -1;
      }
      
      // Check publication state
      if (!currentLink && publicationState) {
        currentLink = publicationState.currentLink || publicationState.link || 
                      publicationState.href || publicationState.location?.href ||
                      publicationState.navigator?.currentLink || publicationState.navigator?.link ||
                      publicationState.readingOrder?.[publicationState.currentIndex]?.href;
        currentIndex = publicationState.readingOrderIndex ?? publicationState.index ??
                      publicationState.location?.index ?? publicationState.navigator?.index ??
                      publicationState.currentIndex ?? -1;
      }
      
      // Check if there's a navigator state
      const navigatorState = (state as any).navigator;
      if (!currentLink && navigatorState) {
        currentLink = navigatorState.currentLink || navigatorState.link || navigatorState.href;
        currentIndex = navigatorState.index ?? navigatorState.readingOrderIndex ?? -1;
      }
      
      // Deep search in state for any link-related properties
      if (!currentLink) {
        const deepSearch = (obj: any, depth = 0): any => {
          if (depth > 3) return null; // Limit depth
          if (!obj || typeof obj !== 'object') return null;
          
          // Check for common link property names
          if (obj.href || obj.link || obj.currentLink) {
            return obj.href || obj.link || obj.currentLink;
          }
          
          // Check for index
          if (typeof obj.index === 'number' && obj.index >= 0) {
            currentIndex = obj.index;
          }
          
          // Recursively search
          for (const key in obj) {
            if (key.toLowerCase().includes('link') || key.toLowerCase().includes('href') || 
                key.toLowerCase().includes('location') || key.toLowerCase().includes('current')) {
              const result = deepSearch(obj[key], depth + 1);
              if (result) return result;
            }
          }
          return null;
        };
        
        currentLink = deepSearch(readerState) || deepSearch(publicationState);
      }
      
      if (typeof currentIndex === 'number' && currentIndex >= 0 && currentIndex < readingOrder.length) {
        readingOrderIndexFromStore = currentIndex;
      } else if (currentLink) {
        // Find index by matching the current link
        const linkHref = typeof currentLink === 'string' ? currentLink : (currentLink.href || currentLink);
        
        for (let i = 0; i < readingOrder.length; i++) {
          const itemHref = readingOrder[i].href || "";
          // Try various matching strategies
          if (
            itemHref === linkHref ||
            itemHref.endsWith(linkHref) ||
            linkHref.endsWith(itemHref) ||
            itemHref.includes(linkHref) ||
            linkHref.includes(itemHref) ||
            // Match by filename
            itemHref.split("/").pop() === linkHref.split("/").pop() ||
            itemHref.split("/").pop() === linkHref
          ) {
            readingOrderIndexFromStore = i;
            break;
          }
        }
      }
    } catch (e) {
      // Could not access Redux store
    }

    // If still couldn't find from store, try to match by inspecting the iframe document
    if (readingOrderIndexFromStore === -1) {
      try {
        // Try to find the iframe and check its document
        const iframes = document.querySelectorAll("iframe");
        for (const iframe of iframes) {
          try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (iframeDoc && iframeDoc !== document) {
              // Check if there are any script tags or data attributes that might indicate the current link
              const scripts = iframeDoc.querySelectorAll("script");
              const body = iframeDoc.body;
              
              // Try to find any data attributes or meta tags
              const metaTags = iframeDoc.querySelectorAll("meta");
              for (const meta of metaTags) {
                const content = meta.getAttribute("content");
                if (content) {
                  for (let i = 0; i < readingOrder.length; i++) {
                    if (content.includes(readingOrder[i].href) || readingOrder[i].href.includes(content)) {
                      readingOrderIndexFromStore = i;
                      break;
                    }
                  }
                  if (readingOrderIndexFromStore !== -1) break;
                }
              }
              
              // Check base tag
              const baseTag = iframeDoc.querySelector("base");
              if (baseTag && baseTag.href) {
                for (let i = 0; i < readingOrder.length; i++) {
                  if (readingOrder[i].href.includes(baseTag.href) || baseTag.href.includes(readingOrder[i].href)) {
                    readingOrderIndexFromStore = i;
                    break;
                  }
                }
              }
            }
          } catch (e) {
            // Cross-origin, can't access
          }
        }
      } catch (e) {
        // Error inspecting iframe
      }
    }

    // Calculate positions
    const positions = calculatePositions(range, readingOrder, targetDoc, readingOrderIndexFromStore);
    console.log("Start position:", positions.start);
    console.log("End position:", positions.end);
  };

  return (
    <Button
      onClick={handleButtonClick}
      className="fixed bottom-4 right-4 z-50 shadow-lg"
      variant="default"
    >
      Log Position
    </Button>
  );
}

function calculatePositions(range: Range, readingOrder: any[], targetDoc: Document, readingOrderIndexFromStore: number = -1): SelectionPosition {
  const startContainer = range.startContainer;
  const endContainer = range.endContainer;
  const startOffset = range.startOffset;
  const endOffset = range.endOffset;

  // Use the provided targetDoc (which might be from an iframe)
  const startDoc = targetDoc;
  const endDoc = targetDoc;

  // Get the current document URL to find readingOrder index
  let currentUrl = "";
  
  // Try multiple ways to get the URL
  try {
    currentUrl = startDoc.URL || startDoc.defaultView?.location.href || "";
  } catch (e) {
    // Can't access location
  }
  
  // Try baseURI as fallback
  if (!currentUrl) {
    try {
      currentUrl = startDoc.baseURI || "";
    } catch (e) {
      // Can't access baseURI
    }
  }
  
  // Try document location
  if (!currentUrl && startDoc.defaultView) {
    try {
      currentUrl = startDoc.defaultView.location.href;
    } catch (e) {
      // Cross-origin, can't access
    }
  }
  
  // Normalize URL: remove query params, fragments, and decode
  const normalizeUrl = (url: string): string => {
    try {
      // Remove query params and fragments
      const urlObj = new URL(url);
      return urlObj.pathname;
    } catch (e) {
      // If URL parsing fails, try manual cleanup
      return url.split("?")[0].split("#")[0];
    }
  };
  
  const normalizedCurrentUrl = normalizeUrl(currentUrl);
  
  // Use readingOrder index from store if available
  let readingOrderIndex = readingOrderIndexFromStore;
  
  // If not found in store, try to find by matching URL
  if (readingOrderIndex === -1) {
    // Extract filename from URL
    const urlParts = normalizedCurrentUrl.split("/");
    const currentFilename = urlParts[urlParts.length - 1] || "";
    
    for (let i = 0; i < readingOrder.length; i++) {
      const item = readingOrder[i];
      const itemHref = item.href || "";
      
      // Normalize the item href
      let normalizedItemHref = itemHref;
      try {
        // If itemHref is relative, we need to resolve it
        if (!itemHref.startsWith("http") && !itemHref.startsWith("/")) {
          // It's a relative path, use as-is
          normalizedItemHref = itemHref;
        } else {
          normalizedItemHref = normalizeUrl(itemHref);
        }
      } catch (e) {
        // Keep original if normalization fails
        normalizedItemHref = itemHref;
      }
      
      // Extract filename from item href
      const itemParts = normalizedItemHref.split("/");
      const itemFilename = itemParts[itemParts.length - 1] || "";
      
      // Try multiple matching strategies
      const matches = 
        // Exact filename match
        currentFilename === itemFilename ||
        // URL contains item href or vice versa
        normalizedCurrentUrl.includes(normalizedItemHref) ||
        normalizedItemHref.includes(normalizedCurrentUrl) ||
        // Filename contains item filename or vice versa
        currentFilename.includes(itemFilename) ||
        itemFilename.includes(currentFilename) ||
        // Ends with match
        normalizedCurrentUrl.endsWith(normalizedItemHref) ||
        normalizedItemHref.endsWith(currentFilename) ||
        // Original URL matching (before normalization)
        currentUrl.includes(itemHref) ||
        itemHref.includes(currentUrl);
      
      if (matches) {
        readingOrderIndex = i;
        break;
      }
    }

    // If still not found, try to find by checking iframe src or other methods
    if (readingOrderIndex === -1) {
      // Look for iframe that might have the src
      const iframes = document.querySelectorAll("iframe");
      for (const iframe of iframes) {
        try {
          const iframeSrc = iframe.src || "";
          const normalizedIframeSrc = normalizeUrl(iframeSrc);
          const iframeFilename = normalizedIframeSrc.split("/").pop() || "";
          
          for (let i = 0; i < readingOrder.length; i++) {
            const item = readingOrder[i];
            const itemHref = item.href || "";
            const itemFilename = itemHref.split("/").pop() || "";
            
            if (
              normalizedIframeSrc.includes(itemHref) ||
              itemHref.includes(iframeFilename) ||
              iframeFilename === itemFilename ||
              iframeFilename.includes(itemFilename) ||
              itemFilename.includes(iframeFilename)
            ) {
              readingOrderIndex = i;
              break;
            }
          }
          if (readingOrderIndex !== -1) break;
        } catch (e) {
          // Can't access iframe src
        }
      }
    }

    // If still not found, default to 0
    if (readingOrderIndex === -1) {
      readingOrderIndex = 0;
    }
  }

  // Calculate start position
  const startPath = getElementPath(startContainer, startOffset);
  const startPosition = `${readingOrderIndex}/${startPath}`;

  // Calculate end position
  const endPath = getElementPath(endContainer, endOffset);
  const endPosition = `${readingOrderIndex}/${endPath}`;

  return {
    start: startPosition,
    end: endPosition,
  };
}

function getElementPath(container: Node, offset: number): string {
  // If container is a text node, get its parent element
  let element: Element | null = null;
  let charOffset = offset;
  const doc = container.ownerDocument || document;

  if (container.nodeType === Node.TEXT_NODE) {
    element = container.parentElement;
    // Calculate character offset from the start of the element
    // We need to count all text content before this text node within the element
    if (element) {
      charOffset = getTextOffsetBeforeNode(element, container as Text, doc) + offset;
    }
  } else if (container.nodeType === Node.ELEMENT_NODE) {
    element = container as Element;
    // For element nodes, offset refers to child index
    // We need to find the text node and calculate character offset
    if (element.childNodes[offset]) {
      const childNode = element.childNodes[offset];
      if (childNode.nodeType === Node.TEXT_NODE) {
        charOffset = getTextOffsetBeforeNode(element, childNode as Text, doc);
      } else {
        // Find first text node in this element
        const firstTextNode = getFirstTextNode(element);
        if (firstTextNode) {
          charOffset = getTextOffsetBeforeNode(element, firstTextNode, doc);
        } else {
          charOffset = 0;
        }
      }
    } else {
      // Offset is beyond children, use total text length
      charOffset = getElementTextLength(element, doc);
    }
  }

  if (!element) {
    return "unknown/0";
  }

  // Build path from body to element
  const path: string[] = [];
  let current: Element | null = element;
  const body = current.ownerDocument?.body;

  // Traverse up to body
  while (current && current !== body) {
    const parent = current.parentElement;
    if (!parent) break;

    // Get index of current element among ALL siblings (not filtered by tag name)
    const siblings = Array.from(parent.children);
    const index = siblings.indexOf(current);

    // Use just the index, not the tag name
    path.unshift(index.toString());
    current = parent;
  }

  // Don't add "body" - it's always implied since Readium always displays the body
  // If we didn't reach body, something went wrong, but still return the path we built

  const elementPath = path.join("/");
  return `${elementPath}/${charOffset}`;
}

function getTextOffsetBeforeNode(element: Element, targetNode: Text, doc: Document): number {
  let offset = 0;
  const walker = doc.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null
  );

  let node;
  while ((node = walker.nextNode())) {
    if (node === targetNode) {
      break;
    }
    offset += node.textContent?.length || 0;
  }

  return offset;
}

function getElementTextLength(element: Element, doc: Document): number {
  let length = 0;
  const walker = doc.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    null
  );

  let node;
  while ((node = walker.nextNode())) {
    length += node.textContent?.length || 0;
  }

  return length;
}

function getFirstTextNode(element: Element): Text | null {
  for (const node of element.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      return node as Text;
    }
    if (node.nodeType === Node.ELEMENT_NODE) {
      const textNode = getFirstTextNode(node as Element);
      if (textNode) return textNode;
    }
  }
  return null;
}
