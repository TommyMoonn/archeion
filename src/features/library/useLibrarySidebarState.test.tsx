// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LIBRARY_SIDEBAR_TOP_LAYOUT_QUERY, useLibrarySidebarState } from "./useLibrarySidebarState";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");

function installMatchMedia(initialMatches: boolean) {
  let matches = initialMatches;
  const listeners = new Set<() => void>();
  const query = {
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    get matches() {
      return matches;
    },
    media: LIBRARY_SIDEBAR_TOP_LAYOUT_QUERY,
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
  } as unknown as MediaQueryList;

  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn(() => query),
  });

  return {
    listeners,
    setMatches(nextMatches: boolean) {
      matches = nextMatches;
      listeners.forEach((listener) => listener());
    },
  };
}

function renderHarness() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);

  function Harness() {
    const state = useLibrarySidebarState();

    return (
      <div
        data-collapse-available={String(state.collapseAvailable)}
        data-collapsed={String(state.collapsed)}
      >
        <button type="button" onClick={() => state.setCollapsed(true)}>
          Collapse
        </button>
      </div>
    );
  }

  act(() => root.render(<Harness />));
  return container;
}

describe("useLibrarySidebarState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    act(() => {
      roots.splice(0).forEach((root) => root.unmount());
    });
    document.body.innerHTML = "";
    if (originalMatchMedia) {
      Object.defineProperty(window, "matchMedia", originalMatchMedia);
    } else {
      Reflect.deleteProperty(window, "matchMedia");
    }
  });

  it("lets the constrained top layout override a requested desktop rail", () => {
    const media = installMatchMedia(false);
    const container = renderHarness();
    const state = () => container.querySelector<HTMLElement>("[data-collapsed]");

    act(() => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });

    expect(state()?.dataset.collapseAvailable).toBe("true");
    expect(state()?.dataset.collapsed).toBe("true");

    act(() => media.setMatches(true));

    expect(state()?.dataset.collapseAvailable).toBe("false");
    expect(state()?.dataset.collapsed).toBe("false");

    act(() => media.setMatches(false));

    expect(state()?.dataset.collapseAvailable).toBe("true");
    expect(state()?.dataset.collapsed).toBe("true");
  });

  it("unsubscribes on unmount and starts a later Library session expanded", () => {
    const media = installMatchMedia(false);
    const first = renderHarness();

    act(() => first.querySelector<HTMLButtonElement>("button")?.click());
    expect(first.querySelector<HTMLElement>("[data-collapsed]")?.dataset.collapsed).toBe("true");
    expect(media.listeners.size).toBe(1);

    act(() => roots.shift()?.unmount());

    expect(media.listeners.size).toBe(0);

    const second = renderHarness();

    expect(second.querySelector<HTMLElement>("[data-collapsed]")?.dataset.collapsed).toBe("false");
  });
});
