// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installLibrarySidebarMedia } from "./librarySidebarMedia.testUtils";
import { useLibrarySidebarState } from "./useLibrarySidebarState";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Root[] = [];
let media: ReturnType<typeof installLibrarySidebarMedia> | null = null;

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
    media?.restore();
    media = null;
  });

  it("lets the constrained top layout override a requested desktop rail", () => {
    const installedMedia = installLibrarySidebarMedia(false);
    media = installedMedia;
    const container = renderHarness();
    const state = () => container.querySelector<HTMLElement>("[data-collapsed]");

    act(() => {
      container.querySelector<HTMLButtonElement>("button")?.click();
    });

    expect(state()?.dataset.collapseAvailable).toBe("true");
    expect(state()?.dataset.collapsed).toBe("true");

    act(() => installedMedia.setMatches(true));

    expect(state()?.dataset.collapseAvailable).toBe("false");
    expect(state()?.dataset.collapsed).toBe("false");

    act(() => installedMedia.setMatches(false));

    expect(state()?.dataset.collapseAvailable).toBe("true");
    expect(state()?.dataset.collapsed).toBe("true");
  });

  it("unsubscribes on unmount and starts a later Library session expanded", () => {
    const installedMedia = installLibrarySidebarMedia(false);
    media = installedMedia;
    const first = renderHarness();

    act(() => first.querySelector<HTMLButtonElement>("button")?.click());
    expect(first.querySelector<HTMLElement>("[data-collapsed]")?.dataset.collapsed).toBe("true");
    expect(installedMedia.listeners.size).toBe(1);

    act(() => roots.shift()?.unmount());

    expect(installedMedia.listeners.size).toBe(0);

    const second = renderHarness();

    expect(second.querySelector<HTMLElement>("[data-collapsed]")?.dataset.collapsed).toBe("false");
  });
});
