"use client";

import { StatefulReader, StatefulPreferencesProvider, ThStoreProvider, ThI18nProvider } from "@edrlab/thorium-web/epub";
import { useEffect, useState } from "react";
import { TextSelectionHandler } from "@/components/text-selection-handler";
import { AIAgentPane } from "@/components/ai-agent-pane";
import { Button } from "@/components/ui/button";
import { Bot } from "lucide-react";

interface BookReaderProps {
  rawManifest: any;
  selfHref: string;
}

export function BookReader({ rawManifest, selfHref }: BookReaderProps) {
  const [mounted, setMounted] = useState(false);
  const [isAIPaneOpen, setIsAIPaneOpen] = useState(false);
  const [selectedText, setSelectedText] = useState<string>("");

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    // Listen for text selection events
    const handleSelection = () => {
      const selection = window.getSelection();
      if (selection && selection.toString().trim()) {
        setSelectedText(selection.toString().trim());
      } else {
        // Try to get selection from iframe
        const iframes = document.querySelectorAll("iframe");
        for (const iframe of iframes) {
          try {
            const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
            if (iframeDoc) {
              const iframeSelection = iframeDoc.getSelection();
              if (iframeSelection && iframeSelection.toString().trim()) {
                setSelectedText(iframeSelection.toString().trim());
                return;
              }
            }
          } catch (e) {
            // Cross-origin iframe, skip
            continue;
          }
        }
        setSelectedText("");
      }
    };

    document.addEventListener("selectionchange", handleSelection);
    return () => {
      document.removeEventListener("selectionchange", handleSelection);
    };
  }, []);

  if (!mounted) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-muted-foreground">Loading reader...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen flex relative">
      {/* Reader Section */}
      <div className={`h-full transition-all duration-300 ${isAIPaneOpen ? "w-[calc(100%-24rem)]" : "w-full"}`}>
        <ThStoreProvider>
          <StatefulPreferencesProvider>
            <ThI18nProvider>
              <StatefulReader
                rawManifest={rawManifest}
                selfHref={selfHref}
              />
              <TextSelectionHandler rawManifest={rawManifest} />
            </ThI18nProvider>
          </StatefulPreferencesProvider>
        </ThStoreProvider>
      </div>

      {/* AI Agent Pane */}
      <AIAgentPane
        isOpen={isAIPaneOpen}
        onClose={() => setIsAIPaneOpen(false)}
        selectedText={selectedText}
      />

      {/* Toggle Button */}
      {!isAIPaneOpen && (
        <Button
          onClick={() => setIsAIPaneOpen(true)}
          className="fixed top-4 right-4 z-40 shadow-lg"
          size="icon"
        >
          <Bot className="h-5 w-5" />
        </Button>
      )}
    </div>
  );
}
