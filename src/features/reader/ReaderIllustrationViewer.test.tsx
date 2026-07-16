// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ResolvedEpubIllustration } from "./epubIllustrationResolver";
import { ReaderIllustrationViewer } from "./ReaderIllustrationViewer";

const resource: ResolvedEpubIllustration = Object.freeze({
  byteLength: 2048,
  height: 1200,
  href: "Images/plate.jpg",
  mediaType: "image/jpeg",
  release: vi.fn(),
  url: "blob:illustration",
  width: 1600,
});

describe("ReaderIllustrationViewer", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function renderViewer(onClose = vi.fn()) {
    act(() => {
      root.render(
        <ReaderIllustrationViewer loading={false} onClose={onClose} resource={resource} />,
      );
    });
    return onClose;
  }

  it("uses one native modal, presents metadata, and focuses an in-modal close control", () => {
    renderViewer();

    const dialog = container.querySelector("dialog")!;
    const close = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Close illustration"]',
    )!;
    expect(dialog.open).toBe(true);
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(close);
    expect(container.textContent).toContain("1600 × 1200 · JPEG");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:illustration");
  });

  it("supports fit, actual size, button zoom, and bounded keyboard zoom", () => {
    renderViewer();
    const dialog = container.querySelector("dialog")!;
    const actual = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Actual size"),
    )!;

    act(() => actual.click());
    expect(container.querySelector("output")?.textContent).toBe("100%");
    expect(container.querySelector<HTMLImageElement>("img")?.style.width).toBe("1600px");

    act(() => {
      for (let index = 0; index < 20; index += 1) {
        dialog.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "+" }));
      }
    });
    expect(container.querySelector("output")?.textContent).toBe("400%");

    act(() => dialog.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "0" })));
    expect(container.querySelector("output")?.textContent).toBe("Fit");
  });

  it("pans with arrow keys and pointer drag without leaking reader shortcuts", () => {
    renderViewer();
    const dialog = container.querySelector("dialog")!;
    const viewport = container.querySelector<HTMLDivElement>(
      ".reader-illustration-viewer__viewport",
    )!;
    const scrollBy = vi.spyOn(viewport, "scrollBy");
    const actual = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Actual size"),
    )!;
    act(() => actual.click());

    const arrow = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowRight",
    });
    act(() => dialog.dispatchEvent(arrow));
    expect(arrow.defaultPrevented).toBe(true);
    expect(scrollBy).toHaveBeenCalledWith({ behavior: "auto", left: 56, top: 0 });

    Object.defineProperties(viewport, {
      scrollLeft: { configurable: true, value: 80, writable: true },
      scrollTop: { configurable: true, value: 60, writable: true },
    });
    act(() => {
      viewport.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 100,
          clientY: 100,
          pointerId: 1,
        }),
      );
      viewport.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 70,
          clientY: 75,
          pointerId: 1,
        }),
      );
    });
    expect(viewport.scrollLeft).toBe(110);
    expect(viewport.scrollTop).toBe(85);
  });

  it("gives native Escape cancellation priority", () => {
    const onClose = renderViewer();
    const cancel = new Event("cancel", { cancelable: true });

    act(() => container.querySelector("dialog")?.dispatchEvent(cancel));

    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("clamps zoom to the supported range", () => {
    renderViewer();
    const dialog = container.querySelector("dialog")!;
    const actual = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Actual size"),
    )!;
    act(() => actual.click());

    act(() => {
      for (let index = 0; index < 20; index += 1) {
        dialog.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "-" }));
      }
    });

    expect(container.querySelector("output")?.textContent).toBe("25%");
  });
});
