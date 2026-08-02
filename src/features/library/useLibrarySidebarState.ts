import { useCallback, useState, useSyncExternalStore } from "react";

export const LIBRARY_SIDEBAR_TOP_LAYOUT_QUERY = "(max-width: 560px)";
const LIBRARY_SIDEBAR_COLLAPSED_SESSION_KEY = "archeion:library-sidebar-collapsed";

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
} {
  const [requestedCollapsed, setRequestedCollapsed] = useState(readRequestedCollapsed);
  const topLayout = useSyncExternalStore(subscribeToTopLayout, topLayoutMatches, () => false);
  const setCollapsed = useCallback((collapsed: boolean) => {
    writeRequestedCollapsed(collapsed);
    setRequestedCollapsed(collapsed);
  }, []);

  return {
    collapseAvailable: !topLayout,
    collapsed: requestedCollapsed && !topLayout,
    setCollapsed,
  };
}
