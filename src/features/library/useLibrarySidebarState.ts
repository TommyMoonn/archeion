import { useCallback, useState, useSyncExternalStore } from "react";

export const LIBRARY_SIDEBAR_TOP_LAYOUT_QUERY = "(max-width: 560px)";

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
  const [requestedCollapsed, setRequestedCollapsed] = useState(false);
  const topLayout = useSyncExternalStore(subscribeToTopLayout, topLayoutMatches, () => false);
  const setCollapsed = useCallback((collapsed: boolean) => {
    setRequestedCollapsed(collapsed);
  }, []);

  return {
    collapseAvailable: !topLayout,
    collapsed: requestedCollapsed && !topLayout,
    setCollapsed,
  };
}
