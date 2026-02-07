import { useEffect, useState } from "react";
import { captureSelection, isCurrentSelectionInAIPane } from "@/lib/book-position-utils";

export function useSelectedText(): string {
  const [selectedText, setSelectedText] = useState("");

  useEffect(() => {
    const handleSelection = () => {
      // Don't let the reader-selection tracking interfere with selecting/copying AI output.
      if (isCurrentSelectionInAIPane()) return;
      setSelectedText(captureSelection());
    };

    document.addEventListener("selectionchange", handleSelection);
    return () => {
      document.removeEventListener("selectionchange", handleSelection);
    };
  }, []);

  return selectedText;
}
