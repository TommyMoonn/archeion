// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installLibrarySidebarMedia } from "./librarySidebarMedia.testUtils";
import { librarySidebarToggleLabel, useLibrarySidebarState } from "./useLibrarySidebarState";

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
        data-width={String(state.width)}
      >
        <button type="button" onClick={() => state.setCollapsed(true)}>
          Collapse
        </button>
        <button type="button" onClick={() => state.setCollapsed(false)}>
          Expand
        </button>
        <button type="button" onClick={() => state.setWidth(state.width - 100)}>
          Shrink
        </button>
        <button
          type="button"
          onClick={() => {
            state.setWidth(state.width + 100);
            state.commitWidth(state.width + 100);
          }}
        >
          Grow
        </button>
      </div>
    );
  }

  act(() => root.render(<Harness />));
  return container;
}

describe("useLibrarySidebarState", () => {
  it("owns the shared state-aware toggle label", () => {
    expect(librarySidebarToggleLabel(false)).toBe("Collapse sidebar");
    expect(librarySidebarToggleLabel(true)).toBe("Expand sidebar");
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.sessionStorage.clear();
    window.localStorage.clear();
    document.documentElement.style.removeProperty("--library-sidebar-expanded-width");
    delete document.documentElement.dataset.librarySidebarWidthReady;
  });

  afterEach(() => {
    act(() => {
      roots.splice(0).forEach((root) => root.unmount());
    });
    document.body.innerHTML = "";
    document.documentElement.style.removeProperty("--library-sidebar-expanded-width");
    delete document.documentElement.dataset.librarySidebarWidthReady;
    media?.restore();
    media = null;
    vi.restoreAllMocks();
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

  it("does not animate a restored collapsed sidebar when the Library route remounts", () => {
    const installedMedia = installLibrarySidebarMedia(false);
    media = installedMedia;
    window.sessionStorage.setItem("archeion:library-sidebar-collapsed", "true");

    let scheduledFrame: FrameRequestCallback | undefined;
    let nextFrameId = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      scheduledFrame = callback;
      nextFrameId += 1;
      return nextFrameId;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);

    // Simulate the readiness marker left behind by the previous Library mount.
    document.documentElement.dataset.librarySidebarWidthReady = "true";

    const first = renderHarness();

    expect(first.querySelector<HTMLElement>("[data-collapsed]")?.dataset.collapsed).toBe("true");
    expect(document.documentElement.dataset.librarySidebarWidthReady).toBeUndefined();

    act(() => scheduledFrame?.(0));
    expect(document.documentElement.dataset.librarySidebarWidthReady).toBe("true");

    act(() => roots.shift()?.unmount());
    expect(document.documentElement.dataset.librarySidebarWidthReady).toBeUndefined();

    const returned = renderHarness();

    expect(returned.querySelector<HTMLElement>("[data-collapsed]")?.dataset.collapsed).toBe("true");
    expect(document.documentElement.dataset.librarySidebarWidthReady).toBeUndefined();
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

it("clamps and persists the expanded width without coupling it to collapse state", () => {
  media = installLibrarySidebarMedia(false);
  const container = renderHarness();
  const state = () => container.querySelector<HTMLElement>("[data-width]");

  expect(state()?.dataset.width).toBe("248");

  act(() =>
    Array.from(container.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "Shrink")
      ?.click(),
  );
  expect(state()?.dataset.width).toBe("200");
  expect(window.localStorage.getItem("archeion:library-sidebar-width")).toBeNull();

  act(() => {
    container.querySelectorAll<HTMLButtonElement>("button")[3]?.click();
  });
  expect(state()?.dataset.width).toBe("300");
  expect(window.localStorage.getItem("archeion:library-sidebar-width")).toBe("300");
});

it("restores and clamps a previously saved sidebar width", () => {
  media = installLibrarySidebarMedia(false);
  window.localStorage.setItem("archeion:library-sidebar-width", "999");

  const container = renderHarness();

  expect(container.querySelector<HTMLElement>("[data-width]")?.dataset.width).toBe("360");
});

it("falls back to the default width for invalid persisted values", () => {
  media = installLibrarySidebarMedia(false);
  window.localStorage.setItem("archeion:library-sidebar-width", "not-a-width");

  const container = renderHarness();

  expect(container.querySelector<HTMLElement>("[data-width]")?.dataset.width).toBe("248");
});
