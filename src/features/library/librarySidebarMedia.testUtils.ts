import { vi } from "vitest";

import { LIBRARY_SIDEBAR_TOP_LAYOUT_QUERY } from "./useLibrarySidebarState";

export function installLibrarySidebarMedia(initialMatches: boolean) {
  const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
  let matches = initialMatches;
  const listeners = new Set<() => void>();
  const topLayoutQuery = {
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    get matches() {
      return matches;
    },
    media: LIBRARY_SIDEBAR_TOP_LAYOUT_QUERY,
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
  } as unknown as MediaQueryList;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn((query: string) =>
      query === LIBRARY_SIDEBAR_TOP_LAYOUT_QUERY
        ? topLayoutQuery
        : ({
            addEventListener: vi.fn(),
            matches: false,
            media: query,
            removeEventListener: vi.fn(),
          } as unknown as MediaQueryList),
    ),
  });

  return {
    listeners,
    restore() {
      if (originalMatchMedia) {
        Object.defineProperty(window, "matchMedia", originalMatchMedia);
      } else {
        Reflect.deleteProperty(window, "matchMedia");
      }
    },
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      listeners.forEach((listener) => listener());
    },
  };
}
