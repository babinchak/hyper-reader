"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { X, Send, Bot } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { createClient } from "@/lib/supabase/client";
import {
  getCurrentSelectionPosition,
  querySummariesForPosition,
  getSelectedText,
} from "@/lib/book-position-utils";
import { getCurrentPdfSelectionPosition } from "@/lib/pdf-position/selection-position";
import { getCurrentPdfPageContext } from "@/lib/pdf-position/page-context";
import { queryPdfSummariesForPosition } from "@/lib/pdf-position/summaries";
import { getPdfLocalContextAroundCurrentSelection } from "@/lib/pdf-position/local-context";
import { getEpubVisibleContext } from "@/lib/epub-visible-context";

const DEFAULT_MAX_EXPLAIN_SELECTION_CHARS = 4000;
const MAX_EXPLAIN_SELECTION_CHARS = (() => {
  const raw = process.env.NEXT_PUBLIC_MAX_EXPLAIN_SELECTION_CHARS;
  if (!raw) return DEFAULT_MAX_EXPLAIN_SELECTION_CHARS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_MAX_EXPLAIN_SELECTION_CHARS;
  return Math.max(0, parsed);
})();

interface AIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  selectionPositionLabel?: string;
  selectionPositionTitle?: string;
}

export interface AIAgentPanelProps {
  selectedText?: string;
  bookId?: string;
  rawManifest?: { readingOrder?: Array<{ href?: string }> };
  bookType?: "epub" | "pdf";
  autoRun?: { nonce: number; action: "page" | "selection" } | null;
  /**
   * If true, hide the free-form chat input until after the first assistant response completes.
   * Useful when opening via an “explain” affordance so the assistant feels like a reading tool first.
   */
  hideInputUntilFirstResponse?: boolean;
  /**
   * If true, when sending a typed question we will include the currently selected text as context.
   * Intended for mobile quick-action UX.
   */
  includeSelectionContextOnSend?: boolean;
  /**
   * UI visibility controls for embedding the panel in compact shells (e.g. mobile quick state).
   */
  showHeader?: boolean;
  showMessages?: boolean;
  showSelectedTextBanner?: boolean;
  showExplainAction?: boolean;
  showSelectionChip?: boolean;
  /**
   * Notified when a user-triggered action starts (send/explain).
   * Useful for shells (e.g. mobile quick state) to expand UI to show the response.
   */
  onActionStart?: () => void;
  /**
   * Notified when the assistant finishes responding (success or error).
   */
  onActionComplete?: () => void;
  /**
   * Container class for layout shell (docked/overlay/bottom sheet).
   */
  className?: string;
  /**
   * If provided, show a close button in the header.
   */
  onClose?: () => void;
}

interface SummaryContext {
  summary_type?: "book" | "chapter" | "subchapter";
  toc_title: string;
  chapter_path: string;
  summary_text: string | null;
}

function formatSelectionPositionLabel(
  start: string,
  end: string
): { label: string; title: string } {
  const parseThreePart = (pos: string): { a: number; b: number; c: number } | null => {
    const parts = pos.split(/[/:]/).map((p) => parseInt(p, 10));
    if (parts.length < 3 || parts.some((v) => Number.isNaN(v))) return null;
    return { a: parts[0], b: parts[1], c: parts[2] };
  };

  // PDF positions look like: page/itemIndex/charOffset (we display page:itemIndex).
  const start3 = parseThreePart(start);
  const end3 = parseThreePart(end);
  if (start3 && end3) {
    const label = `(${start3.a}:${start3.b}-${end3.a}:${end3.b})`;
    const title = `start=${start} end=${end}`;
    return { label, title };
  }

  // EPUB positions look like: readingOrderIndex/path/charOffset (we keep it, but make it compact-ish).
  const compact = (pos: string) => pos.replaceAll("/", ":");
  const label = `(${compact(start)}-${compact(end)})`;
  const title = `start=${start} end=${end}`;
  return { label, title };
}

export function AIAgentPanel({
  selectedText,
  bookId,
  rawManifest,
  bookType = "epub",
  autoRun = null,
  hideInputUntilFirstResponse = false,
  includeSelectionContextOnSend = false,
  showHeader = true,
  showMessages = true,
  showSelectedTextBanner = true,
  showExplainAction = true,
  showSelectionChip = false,
  onActionStart,
  onActionComplete,
  className,
  onClose,
}: AIAgentPanelProps) {
  const [showInput, setShowInput] = useState(!hideInputUntilFirstResponse);
  const lastAutoRunNonceRef = useRef<number | null>(null);

  const normalizedSelectedText = selectedText ?? "";
  const trimmedSelectedText = normalizedSelectedText.trim();
  const selectedCharCount = trimmedSelectedText ? normalizedSelectedText.length : 0;
  const isPdfExplainPage = bookType === "pdf" && trimmedSelectedText.length === 0;
  const isExplainSelection = !isPdfExplainPage;
  const isSelectionTooLong =
    isExplainSelection &&
    trimmedSelectedText.length > 0 &&
    selectedCharCount > MAX_EXPLAIN_SELECTION_CHARS;
  const overLimitBy = Math.max(0, selectedCharCount - MAX_EXPLAIN_SELECTION_CHARS);

  const [messages, setMessages] = useState<AIMessage[]>([
    {
      id: "1",
      role: "assistant",
      content: "Hello! I'm your reading assistant. I can help you understand the book, answer questions, summarize sections, and more. What would you like to know?",
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [bookTitle, setBookTitle] = useState<string>("");
  const [bookAuthor, setBookAuthor] = useState<string>("");
  const supabase = createClient();

  // Helper function to handle streaming response
  const handleStreamingResponse = useCallback(async (
    response: Response,
    assistantMessageId: string
  ) => {
    if (!response.ok) {
      throw new Error(`API error: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") {
            setIsLoading(false);
            setShowInput(true);
            onActionComplete?.();
            return;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed.content) {
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMessageId
                    ? { ...msg, content: msg.content + parsed.content }
                    : msg
                )
              );
            }
            } catch {
              // Ignore JSON parse errors for incomplete chunks
            }
        }
      }
    }

    setIsLoading(false);
    setShowInput(true);
    onActionComplete?.();
  }, [onActionComplete]);

  // Fetch book metadata when bookId is available
  useEffect(() => {
    if (bookId) {
      const fetchBookMetadata = async () => {
        const { data, error } = await supabase
          .from("books")
          .select("title, author")
          .eq("id", bookId)
          .single();
        
        if (!error && data) {
          setBookTitle(data.title || "");
          setBookAuthor(data.author || "");
        }
      };
      
      fetchBookMetadata();
    }
  }, [bookId, supabase]);

  const handleSend = async () => {
    if (!input.trim() || isLoading) return;
    onActionStart?.();

    const userMessage: AIMessage = {
      id: Date.now().toString(),
      role: "user",
      content: input,
      timestamp: new Date(),
    };

    const userInput = input;
    setMessages((prev) => [...prev, userMessage]);
    setInput("");
    setIsLoading(true);

    // Create assistant message placeholder
    const assistantMessageId = (Date.now() + 1).toString();
    const assistantMessage: AIMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      // Prepare messages for API (exclude the empty assistant message we just added)
      const selectionForSend =
        includeSelectionContextOnSend && getSelectedText()
          ? getSelectedText()
          : "";
      const messagesForAPI = [
        ...messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        {
          role: "user" as const,
          content:
            selectionForSend && selectionForSend.trim().length > 0
              ? `User question:\n${userInput}\n\nSelected text (use as context):\n"${selectionForSend}"`
              : userInput,
        },
      ];

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: messagesForAPI }),
      });

      await handleStreamingResponse(response, assistantMessageId);
    } catch (error) {
      console.error("Error calling chat API:", error);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                content:
                  "Sorry, I encountered an error. Please make sure the OpenAI API key is configured correctly.",
              }
            : msg
        )
      );
      setIsLoading(false);
      setShowInput(true);
      onActionComplete?.();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleExplain = useCallback(async (action: "page" | "selection") => {
    if (!bookId || isLoading) return;
    onActionStart?.();

    const isPdf = bookType === "pdf";
    if (!rawManifest && !isPdf) return;

    // Get current selection text directly (don't rely on prop which might be stale)
    const currentSelectedText = getSelectedText();
    if (
      currentSelectedText &&
      currentSelectedText.trim().length > 0 &&
      currentSelectedText.length > MAX_EXPLAIN_SELECTION_CHARS
    ) {
      return;
    }

    const selectionExists = Boolean(currentSelectedText && currentSelectedText.trim().length > 0);
    const isExplainPage = action === "page";
    const isExplainSelectionNow = action === "selection";
    if (isExplainSelectionNow && !selectionExists) {
      return;
    }

    // If action says "page", but we are in an EPUB, we do a best-effort visible-context extraction.
    // For PDF we use the existing page-context logic.

    // Get current selection position
    setIsLoading(true);
    if (hideInputUntilFirstResponse) setShowInput(false);

    let summaries: SummaryContext[] = [];
    let selectionPositionLabel: string | undefined;
    let selectionPositionTitle: string | undefined;
    const explainUserMessage = isExplainPage ? "Explain page" : "Explain selection";
    let explainBodyText = currentSelectedText;
    if (isPdf) {
      if (isExplainPage) {
        const page = getCurrentPdfPageContext({ maxChars: 30000 });
        if (!page || !page.text) {
          setIsLoading(false);
          onActionComplete?.();
          return;
        }
        explainBodyText = page.text;
        selectionPositionLabel = `(Page ${page.pageNumber})`;
        selectionPositionTitle = `start=${page.startPosition} end=${page.endPosition}`;
        summaries = (
          await queryPdfSummariesForPosition(
            bookId,
            page.startPosition,
            page.endPosition
          )
        ).map(({ summary_type, toc_title, chapter_path, summary_text }) => ({
          summary_type,
          toc_title,
          chapter_path,
          summary_text,
        }));
      } else {
        const position = getCurrentPdfSelectionPosition();
        if (!position) {
          setIsLoading(false);
          onActionComplete?.();
          return;
        }
        const formatted = formatSelectionPositionLabel(
          position.start,
          position.end
        );
        selectionPositionLabel = formatted.label;
        selectionPositionTitle = formatted.title;
        summaries = (
          await queryPdfSummariesForPosition(
            bookId,
            position.start,
            position.end
          )
        ).map(({ summary_type, toc_title, chapter_path, summary_text }) => ({
          summary_type,
          toc_title,
          chapter_path,
          summary_text,
        }));
      }
    } else {
      if (isExplainPage) {
        const visible = getEpubVisibleContext({ maxChars: 30000 });
        if (!visible?.text) {
          setIsLoading(false);
          setShowInput(true);
          onActionComplete?.();
          return;
        }
        explainBodyText = visible.text;
        selectionPositionLabel = `(View)`;
        selectionPositionTitle = "EPUB visible context";
        // No reliable position → we skip summary lookup here (best-effort).
        summaries = [];
      } else {
        const readingOrder = rawManifest?.readingOrder || [];
        const position = getCurrentSelectionPosition(readingOrder, null);
        if (!position) {
          setIsLoading(false);
          onActionComplete?.();
          return;
        }
        const formatted = formatSelectionPositionLabel(position.start, position.end);
        selectionPositionLabel = formatted.label;
        selectionPositionTitle = formatted.title;
        summaries = (await querySummariesForPosition(bookId, position.start, position.end)).map(
          ({ toc_title, chapter_path, summary_text }) => ({
            summary_type: "chapter",
            toc_title,
            chapter_path,
            summary_text,
          })
        );
      }
    }

    // Build the prompt with context
    let prompt = "";
    
    // Add book context
    if (bookTitle) {
      prompt += `Book: ${bookTitle}\n`;
    }
    if (bookAuthor) {
      prompt += `Author: ${bookAuthor}\n`;
    }
    if (bookTitle || bookAuthor) {
      prompt += "\n";
    }

    const bookSummaries = summaries.filter((summary) => summary.summary_type === "book");
    const broadSummaries = summaries.filter((summary) => summary.summary_type === "chapter");
    const narrowSummaries = summaries.filter((summary) => summary.summary_type === "subchapter");

    const appendSummaries = (label: string, items: SummaryContext[]) => {
      if (items.length === 0) return;
      prompt += `${label}:\n`;
      items.forEach((summary) => {
        if (summary.summary_text) {
          prompt += `- ${summary.summary_text}\n`;
        } else {
          prompt += `- (No summary text available)\n`;
        }
      });
      prompt += "\n";
    };

    // Note: we intentionally avoid chapter numbers/titles/paths here.
    // They can be wrong/noisy and confuse the model.
    appendSummaries("Book-level summary (highest-level context)", bookSummaries);
    appendSummaries("Broader summary (wide context)", broadSummaries);
    appendSummaries("More specific summary (narrow context)", narrowSummaries);

    // Add local PDF context window around selection (best-effort)
    if (isPdf && !isExplainPage) {
      const local = getPdfLocalContextAroundCurrentSelection({
        beforeChars: 800,
        afterChars: 800,
        maxTotalChars: 2400,
      });
      if (local && (local.beforeText || local.afterText)) {
        prompt += "Local context around the selection (PDF text near where it appears on the page):\n\n";
        if (local.beforeText) {
          prompt += `Before:\n"${local.beforeText}"\n\n`;
        }
        prompt += `Selected:\n"${local.selectedText}"\n\n`;
        if (local.afterText) {
          prompt += `After:\n"${local.afterText}"\n\n`;
        }
      }
    }

    // Add the selected text and instruction
    prompt += `Please explain the following ${
      isExplainPage ? "page" : "selected text"
    } from the book:\n\n"${explainBodyText}"\n\nProvide a clear and helpful explanation in the context of the book.`;


    // Add user message (just "Explain text" for display)
    const userMessage: AIMessage = {
      id: Date.now().toString(),
      role: "user",
      content: explainUserMessage,
      timestamp: new Date(),
      selectionPositionLabel,
      selectionPositionTitle,
    };
    setMessages((prev) => [...prev, userMessage]);

    // Create assistant message placeholder
    const assistantMessageId = (Date.now() + 1).toString();
    const assistantMessage: AIMessage = {
      id: assistantMessageId,
      role: "assistant",
      content: "",
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, assistantMessage]);

    try {
      // Prepare messages for API - include the full prompt as the user message
      const messagesForAPI = [
        ...messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        { role: "user" as const, content: prompt },
      ];

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ messages: messagesForAPI }),
      });

      await handleStreamingResponse(response, assistantMessageId);
    } catch (error) {
      console.error("Error calling chat API:", error);
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === assistantMessageId
            ? {
                ...msg,
                content:
                  "Sorry, I encountered an error. Please make sure the OpenAI API key is configured correctly.",
              }
            : msg
        )
      );
      setIsLoading(false);
      setShowInput(true);
      onActionComplete?.();
    }
  }, [
    bookAuthor,
    bookId,
    bookTitle,
    bookType,
    handleStreamingResponse,
    hideInputUntilFirstResponse,
    isLoading,
    messages,
    rawManifest,
    onActionComplete,
    onActionStart,
  ]);

  useEffect(() => {
    if (!autoRun) return;
    if (autoRun.nonce === lastAutoRunNonceRef.current) return;
    lastAutoRunNonceRef.current = autoRun.nonce;
    handleExplain(autoRun.action).catch(() => {
      // best-effort
    });
  }, [autoRun, handleExplain]);

  return (
    <div
      data-ai-pane="true"
      className={
        (className ??
          "bg-background border-l border-border shadow-lg flex flex-col select-text") +
        " min-h-0"
      }
    >
      {/* Header */}
      {showHeader && (
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="h-8 w-8"
              aria-label="Close AI assistant"
            >
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>
      )}

      {/* Selected Text Banner */}
      {showSelectedTextBanner && selectedText && (
        <div className="p-3 bg-muted border-b border-border">
          <p className="text-sm text-muted-foreground mb-1">Selected text:</p>
          <p className="text-sm italic text-foreground line-clamp-2">
            {selectedText}
          </p>
        </div>
      )}

      {/* Messages */}
      {showMessages && (
        <div
          className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0 overscroll-contain"
          style={{ WebkitOverflowScrolling: "touch" }}
        >
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <Card
                className={`max-w-[80%] p-3 ${
                  message.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-foreground select-text"
                }`}
              >
                {message.role === "assistant" ? (
                  <Markdown content={message.content} />
                ) : (
                  <p className="text-sm whitespace-pre-wrap break-words">
                    {message.content}
                  </p>
                )}
                {message.selectionPositionLabel && (
                  <div className="mt-2">
                    <span
                      title={message.selectionPositionTitle}
                      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${
                        message.role === "user"
                          ? "text-primary-foreground/80"
                          : "text-foreground/80"
                      } border-blue-500/40 bg-blue-500/10 dark:border-blue-400/40 dark:bg-blue-400/10`}
                    >
                      {message.selectionPositionLabel}
                    </span>
                  </div>
                )}
              </Card>
            </div>
          ))}
          {isLoading && (
            <div className="flex justify-start">
              <Card className="bg-muted p-3">
                <div className="flex gap-1">
                  <div className="h-2 w-2 bg-foreground rounded-full animate-bounce" />
                  <div className="h-2 w-2 bg-foreground rounded-full animate-bounce [animation-delay:0.2s]" />
                  <div className="h-2 w-2 bg-foreground rounded-full animate-bounce [animation-delay:0.4s]" />
                </div>
              </Card>
            </div>
          )}
        </div>
      )}

      {/* Input */}
      <div className="p-4 border-t border-border">
        {/* Explain Selection Button */}
        {showExplainAction && bookId && (rawManifest || bookType === "pdf") && (
          <div className="mb-2">
            <Button
              onClick={() => handleExplain(trimmedSelectedText.length === 0 ? "page" : "selection")}
              disabled={
                isLoading ||
                isSelectionTooLong ||
                (bookType !== "pdf" && trimmedSelectedText.length === 0)
              }
              className="w-full text-foreground"
              variant="outline"
              title={
                isSelectionTooLong
                  ? `Selection too long: ${selectedCharCount.toLocaleString()} / ${MAX_EXPLAIN_SELECTION_CHARS.toLocaleString()} characters`
                  : undefined
              }
            >
              {trimmedSelectedText.length === 0 ? "Explain page" : "Explain selection"}
            </Button>
            {isSelectionTooLong && (
              <div className="mt-2 rounded-md border border-border bg-muted px-3 py-2 text-xs text-foreground">
                <p className="font-medium">Selection is too long.</p>
                <p className="text-muted-foreground">
                  {selectedCharCount.toLocaleString()} /{" "}
                  {MAX_EXPLAIN_SELECTION_CHARS.toLocaleString()} characters selected
                  {overLimitBy > 0 ? ` (${overLimitBy.toLocaleString()} over)` : ""}.
                </p>
              </div>
            )}
          </div>
        )}
        {showSelectionChip && (
          <div className="mb-2">
            <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground">
              Using selected text
            </span>
          </div>
        )}
        {showInput && (
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask a question about the book..."
              disabled={isLoading}
              className="flex-1"
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              size="icon"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

interface AIAgentPaneProps extends AIAgentPanelProps {
  isOpen: boolean;
}

export function AIAgentPane({ isOpen, ...rest }: AIAgentPaneProps) {
  if (!isOpen) return null;
  return (
    <AIAgentPanel
      {...rest}
      className="fixed right-0 top-0 h-full w-96 bg-background border-l border-border shadow-lg flex flex-col z-50 select-text"
    />
  );
}