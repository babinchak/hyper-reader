"use client";

import { useEffect, useState } from "react";

// Phones in landscape can exceed width breakpoints. Prefer capability-based detection
// so touch-first devices keep "mobile" behavior regardless of orientation.
export const DEFAULT_MOBILE_QUERY =
  "(hover: none) and (pointer: coarse), (any-hover: none) and (any-pointer: coarse), (max-width: 767px)";

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    // Ensure we sync immediately on mount (prevents 1-frame "desktop" flashes on mobile).
    setMatches(mql.matches);
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    // Safari <14
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);

  return matches;
}

export function useIsMobile(): boolean {
  return useMediaQuery(DEFAULT_MOBILE_QUERY);
}
