import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore } from "react";

export const LIBRARY_SIDEBAR_TOP_LAYOUT_QUERY = "(max-width: 560px)";
const LIBRARY_SIDEBAR_COLLAPSED_SESSION_KEY = "archeion:library-sidebar-collapsed";
const LIBRARY_SIDEBAR_WIDTH_STORAGE_KEY = "archeion:library-sidebar-width";
export const LIBRARY_SIDEBAR_MIN_WIDTH = 200;
export const LIBRARY_SIDEBAR_DEFAULT_WIDTH = 248;
export const LIBRARY_SIDEBAR_MAX_WIDTH = 360;

function clampSidebarWidth(width: number): number {
  return Math.round(
    Math.min(LIBRARY_SIDEBAR_MAX_WIDTH, Math.max(LIBRARY_SIDEBAR_MIN_WIDTH, width)),
  );
}

function defaultSidebarWidth(): number {
  return typeof window !== "undefined" && window.innerWidth <= 820
    ? 220
    : LIBRARY_SIDEBAR_DEFAULT_WIDTH;
}

function readRequestedWidth(): number {
  const fallback = defaultSidebarWidth();
  if (typeof window === "undefined") return fallback;
  try {
    const stored = window.localStorage.getItem(LIBRARY_SIDEBAR_WIDTH_STORAGE_KEY);
    if (stored === null) return fallback;
    const parsed = Number(stored);
    return Number.isFinite(parsed) ? clampSidebarWidth(parsed) : fallback;
  } catch {
    return fallback;
  }
}

function writeRequestedWidth(width: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      LIBRARY_SIDEBAR_WIDTH_STORAGE_KEY,
      String(clampSidebarWidth(width)),
    );
  } catch {
    // The in-memory width remains usable when WebView storage is unavailable.
  }
}

export function librarySidebarToggleLabel(collapsed: boolean): string {
  return collapsed ? "Expand sidebar" : "Collapse sidebar";
}

function readRequestedCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.sessionStorage.getItem(LIBRARY_SIDEBAR_COLLAPSED_SESSION_KEY) === "true";
  } catch {
    return false;
  }
}

function writeRequestedCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (collapsed) {
      window.sessionStorage.setItem(LIBRARY_SIDEBAR_COLLAPSED_SESSION_KEY, "true");
    } else {
      window.sessionStorage.removeItem(LIBRARY_SIDEBAR_COLLAPSED_SESSION_KEY);
    }
  } catch {
    // The in-memory state remains usable when WebView storage is unavailable.
  }
}

function subscribeToTopLayout(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return () => undefined;
  }

  const mediaQuery = window.matchMedia(LIBRARY_SIDEBAR_TOP_LAYOUT_QUERY);
  mediaQuery.addEventListener("change", onChange);
  return () => mediaQuery.removeEventListener("change", onChange);
}

function topLayoutMatches(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(LIBRARY_SIDEBAR_TOP_LAYOUT_QUERY).matches
  );
}

export function useLibrarySidebarState(): {
  collapseAvailable: boolean;
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  width: number;
  setWidth: (width: number) => void;
  commitWidth: (width: number) => void;
} {
  const [requestedCollapsed, setRequestedCollapsed] = useState(readRequestedCollapsed);
  const [width, setRequestedWidth] = useState(readRequestedWidth);
  useLayoutEffect(() => {
    document.documentElement.style.setProperty("--library-sidebar-expanded-width", `${width}px`);
  }, [width]);
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      document.documentElement.dataset.librarySidebarWidthReady = "true";
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  const topLayout = useSyncExternalStore(subscribeToTopLayout, topLayoutMatches, () => false);
  const setCollapsed = useCallback((collapsed: boolean) => {
    writeRequestedCollapsed(collapsed);
    setRequestedCollapsed(collapsed);
  }, []);
  const setWidth = useCallback((nextWidth: number) => {
    setRequestedWidth(clampSidebarWidth(nextWidth));
  }, []);
  const commitWidth = useCallback((nextWidth: number) => {
    writeRequestedWidth(nextWidth);
  }, []);

  return {
    collapseAvailable: !topLayout,
    collapsed: requestedCollapsed && !topLayout,
    setCollapsed,
    width,
    setWidth,
    commitWidth,
  };
}
