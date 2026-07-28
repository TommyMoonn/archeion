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
        <button type="button" onClick={() => state.setCollapsed(false)}>
          Expand
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
    window.sessionStorage.clear();
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

  it("retains the requested state when returning from an unmounted Reader route", () => {
    const installedMedia = installLibrarySidebarMedia(false);
    media = installedMedia;
    const first = renderHarness();

    act(() => first.querySelector<HTMLButtonElement>("button")?.click());
    expect(first.querySelector<HTMLElement>("[data-collapsed]")?.dataset.collapsed).toBe("true");
    expect(window.sessionStorage.getItem("archeion:library-sidebar-collapsed")).toBe("true");
    expect(installedMedia.listeners.size).toBe(1);

    act(() => roots.shift()?.unmount());

    expect(installedMedia.listeners.size).toBe(0);

    const second = renderHarness();

    expect(second.querySelector<HTMLElement>("[data-collapsed]")?.dataset.collapsed).toBe("true");
  });

  it("restores a collapsed request from the current window session after reload", () => {
    media = installLibrarySidebarMedia(false);
    window.sessionStorage.setItem("archeion:library-sidebar-collapsed", "true");

    const container = renderHarness();

    expect(container.querySelector<HTMLElement>("[data-collapsed]")?.dataset.collapsed).toBe(
      "true",
    );
  });

  it("clears the session request when the sidebar is expanded", () => {
    media = installLibrarySidebarMedia(false);
    const first = renderHarness();
    const buttons = first.querySelectorAll<HTMLButtonElement>("button");

    act(() => buttons[0]?.click());
    act(() => buttons[1]?.click());

    expect(first.querySelector<HTMLElement>("[data-collapsed]")?.dataset.collapsed).toBe("false");
    expect(window.sessionStorage.getItem("archeion:library-sidebar-collapsed")).toBeNull();

    act(() => roots.shift()?.unmount());
    const second = renderHarness();
    expect(second.querySelector<HTMLElement>("[data-collapsed]")?.dataset.collapsed).toBe("false");
  });
});
