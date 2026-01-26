"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { X, Send, Bot } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  getCurrentSelectionPosition,
  querySummariesForPosition,
  getSelectedText,
  restoreLastSelection,
} from "@/lib/book-position-utils";
import { getCurrentPdfSelectionPosition } from "@/lib/pdf-position/selection-position";
import { queryPdfSummariesForPosition } from "@/lib/pdf-position/summaries";

interface AIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

interface AIAgentPaneProps {
  isOpen: boolean;
  onClose: () => void;
  selectedText?: string;
  bookId?: string;
  rawManifest?: { readingOrder?: Array<{ href?: string }> };
  bookType?: "epub" | "pdf";
}

interface SummaryContext {
  toc_title: string;
  chapter_path: string;
  summary_text: string | null;
}

export function AIAgentPane({
  isOpen,
  onClose,
  selectedText,
  bookId,
  rawManifest,
  bookType = "epub",
}: AIAgentPaneProps) {
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
  const handleStreamingResponse = async (
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
  };

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
      const messagesForAPI = [
        ...messages.map((msg) => ({
          role: msg.role,
          content: msg.content,
        })),
        { role: "user" as const, content: userInput },
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
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputFocus = () => {
    setTimeout(() => {
      restoreLastSelection();
    }, 0);
  };

  const handlePaneMouseDown = () => {
    setTimeout(() => {
      restoreLastSelection();
    }, 0);
  };

  const handleExplainSelection = async () => {
    if (!bookId || isLoading) return;

    const isPdf = bookType === "pdf";
    if (!rawManifest && !isPdf) return;

    // Get current selection text directly (don't rely on prop which might be stale)
    const currentSelectedText = getSelectedText();

    if (!currentSelectedText) {
      return;
    }

    // Get current selection position
    setIsLoading(true);

    let summaries: SummaryContext[] = [];
    if (isPdf) {
      const position = getCurrentPdfSelectionPosition();
      if (!position) {
        setIsLoading(false);
        return;
      }
      summaries = (await queryPdfSummariesForPosition(bookId, position.start, position.end)).map(
        ({ toc_title, chapter_path, summary_text }) => ({
          toc_title,
          chapter_path,
          summary_text,
        })
      );
    } else {
      const readingOrder = rawManifest?.readingOrder || [];
      const position = getCurrentSelectionPosition(readingOrder, null);
      if (!position) {
        setIsLoading(false);
        return;
      }
      summaries = (await querySummariesForPosition(bookId, position.start, position.end)).map(
        ({ toc_title, chapter_path, summary_text }) => ({
          toc_title,
          chapter_path,
          summary_text,
        })
      );
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

    // Add chapter summaries (if any)
    if (summaries.length > 0) {
      prompt += "Chapter Summaries:\n";
      summaries.forEach((summary) => {
        const chapterTitle = summary.toc_title || "Untitled";
        const chapterPath = summary.chapter_path || "Unknown";
        prompt += `\n${chapterPath} - ${chapterTitle}:\n`;
        if (summary.summary_text) {
          prompt += `${summary.summary_text}\n`;
        } else {
          prompt += `(No summary text available)\n`;
        }
      });
      prompt += "\n";
    }

    // Add the selected text and instruction
    prompt += `Please explain the following selected text from the book:\n\n"${currentSelectedText}"\n\nProvide a clear and helpful explanation of this text in the context of the book.`;


    // Add user message (just "Explain text" for display)
    const userMessage: AIMessage = {
      id: Date.now().toString(),
      role: "user",
      content: "Explain text",
      timestamp: new Date(),
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
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed right-0 top-0 h-full w-96 bg-background border-l border-border shadow-lg flex flex-col z-50"
      onMouseDown={handlePaneMouseDown}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <div className="flex items-center gap-2">
          <Bot className="h-5 w-5 text-primary" />
          <h2 className="font-semibold text-lg">AI Assistant</h2>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Selected Text Banner */}
      {selectedText && (
        <div className="p-3 bg-muted border-b border-border">
          <p className="text-sm text-muted-foreground mb-1">Selected text:</p>
          <p className="text-sm italic line-clamp-2">{selectedText}</p>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <Card
              className={`max-w-[80%] p-3 ${
                message.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted"
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{message.content}</p>
              <p className="text-xs opacity-70 mt-1">
                {message.timestamp.toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </p>
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

      {/* Input */}
      <div className="p-4 border-t border-border">
        {/* Explain Selection Button */}
        {selectedText && bookId && (rawManifest || bookType === "pdf") && (
          <Button
            onClick={handleExplainSelection}
            disabled={isLoading || !selectedText.trim()}
            className="w-full mb-2"
            variant="outline"
          >
            Explain selection
          </Button>
        )}
        <div className="flex gap-2">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            onFocus={handleInputFocus}
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
      </div>
    </div>
  );
}