// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { resetTransientSurfaceOwnershipForTests } from "../../utils/transientSurfaceOwnership";
import type { ResolvedEpubIllustration } from "./epubIllustrationResolver";
import { ReaderIllustrationViewer } from "./ReaderIllustrationViewer";
import type { ReaderIllustrationExportState } from "./useReaderIllustrationExport";

const resource: ResolvedEpubIllustration = Object.freeze({
  blob: new Blob([new Uint8Array(2048)], { type: "image/jpeg" }),
  byteLength: 2048,
  height: 1200,
  href: "Images/plate.jpg",
  mediaType: "image/jpeg",
  release: vi.fn(),
  url: "blob:illustration",
  width: 1600,
});

const replacementResource: ResolvedEpubIllustration = Object.freeze({
  ...resource,
  href: "Images/replacement.jpg",
  url: "blob:replacement",
});

describe("ReaderIllustrationViewer", () => {
  let container: HTMLDivElement;
  let root: Root;
  let viewportHeight: number;
  let viewportWidth: number;
  let resize: () => void;

  beforeEach(() => {
    viewportHeight = 600;
    viewportWidth = 800;
    let resizeCallback: ResizeObserverCallback = () => undefined;
    class TestResizeObserver {
      constructor(callback: ResizeObserverCallback) {
        resizeCallback = callback;
      }
      disconnect() {}
      observe() {}
      unobserve() {}
    }
    vi.stubGlobal("ResizeObserver", TestResizeObserver);
    resize = () => resizeCallback([], {} as ResizeObserver);
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("reader-illustration-viewer__viewport") ? viewportWidth : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("reader-illustration-viewer__viewport") ? viewportHeight : 0;
    });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("reader-illustration-viewer__viewport")
        ? ({
            bottom: 650,
            height: viewportHeight,
            left: 100,
            right: 100 + viewportWidth,
            top: 50,
            width: viewportWidth,
          } as DOMRect)
        : ({} as DOMRect);
    });
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
    resetTransientSurfaceOwnershipForTests();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function renderViewer(
    props: Readonly<{
      error?: string;
      loading?: boolean;
      onClose?: () => void;
      onSaveImage?: () => void;
      resource?: ResolvedEpubIllustration;
      saveState?: ReaderIllustrationExportState;
    }> = {},
  ) {
    const onClose = props.onClose ?? vi.fn();
    act(() => {
      root.render(
        <ReaderIllustrationViewer
          error={props.error}
          loading={props.loading ?? false}
          onClose={onClose}
          onSaveImage={props.onSaveImage}
          resource={"resource" in props ? props.resource : resource}
          saveState={props.saveState}
        />,
      );
    });
    return onClose;
  }

  function viewport() {
    return container.querySelector<HTMLDivElement>(".reader-illustration-viewer__viewport")!;
  }

  function installScrollState(target = viewport()) {
    Object.defineProperties(target, {
      scrollLeft: { configurable: true, value: 0, writable: true },
      scrollTop: { configurable: true, value: 0, writable: true },
    });
    return vi.spyOn(target, "scrollTo");
  }

  function buttonWithText(text: string) {
    return Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes(text),
    )!;
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
    expect(container.querySelector("output")?.textContent).toBe("Fit · 47%");
  });

  it("shows Save image only for a resolved resource and delegates operation state", () => {
    const onSaveImage = vi.fn();
    renderViewer({ onSaveImage });
    const save = buttonWithText("Save image");
    act(() => save.click());
    expect(onSaveImage).toHaveBeenCalledOnce();

    renderViewer({ onSaveImage, saveState: { status: "saving" } });
    expect(buttonWithText("Saving…").disabled).toBe(true);

    renderViewer({
      onSaveImage,
      saveState: { message: "Image saved.", status: "saved" },
    });
    expect(container.querySelector('[role="status"]')?.textContent).toBe("Image saved.");

    renderViewer({
      onSaveImage,
      saveState: { message: "Image could not be saved.", status: "error" },
    });
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Image could not be saved.",
    );

    renderViewer({ loading: true, onSaveImage, resource: undefined });
    expect(buttonWithText("Save image")).toBeUndefined();
  });

  it("owns wheel input through one active native listener across rerenders and replacement", () => {
    const addEventListener = vi.spyOn(HTMLDialogElement.prototype, "addEventListener");
    const removeEventListener = vi.spyOn(HTMLDialogElement.prototype, "removeEventListener");

    renderViewer();
    const firstWheelRegistration = addEventListener.mock.calls.filter(([type]) => type === "wheel");
    expect(firstWheelRegistration).toHaveLength(1);
    expect(firstWheelRegistration[0]?.[2]).toEqual({ capture: true, passive: false });

    act(() => buttonWithText("Actual size").click());
    renderViewer();
    expect(addEventListener.mock.calls.filter(([type]) => type === "wheel")).toHaveLength(1);

    renderViewer({ resource: replacementResource });
    const wheelRegistrations = addEventListener.mock.calls.filter(([type]) => type === "wheel");
    const wheelRemovals = removeEventListener.mock.calls.filter(([type]) => type === "wheel");
    expect(wheelRegistrations).toHaveLength(2);
    expect(wheelRegistrations[1]?.[2]).toEqual({ capture: true, passive: false });
    expect(wheelRemovals).toContainEqual([
      "wheel",
      firstWheelRegistration[0]?.[1],
      { capture: true, passive: false },
    ]);

    act(() => root.render(null));
    expect(removeEventListener.mock.calls.filter(([type]) => type === "wheel")).toHaveLength(2);
  });

  it("keeps Fit responsive, preserves explicit scale on resize, and resets coherently", () => {
    renderViewer();
    const scrollTo = installScrollState();
    expect(container.querySelector("output")?.textContent).toBe("Fit · 47%");

    viewportWidth = 400;
    viewportHeight = 300;
    act(() => resize());
    expect(container.querySelector("output")?.textContent).toBe("Fit · 22%");

    act(() => buttonWithText("Actual size").click());
    expect(container.querySelector("output")?.textContent).toBe("100%");
    viewportWidth = 500;
    viewportHeight = 400;
    act(() => resize());
    expect(container.querySelector("output")?.textContent).toBe("100%");

    act(() => buttonWithText("Reset").click());
    expect(container.querySelector("output")?.textContent).toBe("Fit · 29%");
    expect(scrollTo).toHaveBeenLastCalledWith({ behavior: "auto", left: 0, top: 0 });
  });

  it("uses the computed Fit scale for the first wheel, toolbar, and keyboard step", () => {
    renderViewer();
    installScrollState();
    const dialog = container.querySelector("dialog")!;
    const firstWheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: 300,
      clientY: 250,
      deltaY: -48,
    });

    act(() => viewport().dispatchEvent(firstWheel));
    expect(firstWheel.defaultPrevented).toBe(true);
    expect(container.querySelector("output")?.textContent).toBe("59%");

    act(() => buttonWithText("Fit to viewport").click());
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Zoom in"]')?.click());
    expect(container.querySelector("output")?.textContent).toBe("59%");

    act(() => buttonWithText("Fit to viewport").click());
    act(() => dialog.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "+" })));
    expect(container.querySelector("output")?.textContent).toBe("59%");

    act(() => buttonWithText("Fit to viewport").click());
    for (let index = 0; index < 2; index += 1) {
      act(() =>
        viewport().dispatchEvent(
          new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -16 }),
        ),
      );
      expect(container.querySelector("output")?.textContent).toBe("Fit · 47%");
    }
    act(() =>
      viewport().dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -16 }),
      ),
    );
    expect(container.querySelector("output")?.textContent).toBe("59%");
  });

  it("consumes modal wheel input in loading, error, chrome, and clamped states", () => {
    const leakedWheel = vi.fn();
    container.addEventListener("wheel", leakedWheel);
    renderViewer({ loading: true, resource: undefined });

    for (const target of [
      container.querySelector("header")!,
      container.querySelector("footer")!,
      viewport(),
    ]) {
      const event = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: 80 });
      act(() => target.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
    }
    expect(leakedWheel).not.toHaveBeenCalled();

    renderViewer({ error: "Unavailable", resource: undefined });
    const errorWheel = new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -80 });
    act(() => viewport().dispatchEvent(errorWheel));
    expect(errorWheel.defaultPrevented).toBe(true);

    renderViewer();
    installScrollState();
    for (const target of [container.querySelector("header")!, container.querySelector("footer")!]) {
      const chromeWheel = new WheelEvent("wheel", {
        bubbles: true,
        cancelable: true,
        deltaY: -80,
      });
      act(() => target.dispatchEvent(chromeWheel));
      expect(chromeWheel.defaultPrevented).toBe(true);
      expect(container.querySelector("output")?.textContent).toBe("Fit · 47%");
    }
    act(() => buttonWithText("Actual size").click());
    const dialog = container.querySelector("dialog")!;
    act(() => {
      for (let index = 0; index < 12; index += 1) {
        dialog.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "+" }));
      }
    });
    expect(container.querySelector("output")?.textContent).toBe("400%");
    const boundaryWheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -80,
    });
    act(() => viewport().dispatchEvent(boundaryWheel));
    expect(boundaryWheel.defaultPrevented).toBe(true);
    expect(container.querySelector("output")?.textContent).toBe("400%");

    act(() => {
      for (let index = 0; index < 30; index += 1) {
        dialog.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "-" }));
      }
    });
    expect(container.querySelector("output")?.textContent).toBe("25%");
    const minimumWheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 80,
    });
    act(() => viewport().dispatchEvent(minimumWheel));
    expect(minimumWheel.defaultPrevented).toBe(true);
    expect(container.querySelector("output")?.textContent).toBe("25%");
    expect(leakedWheel).not.toHaveBeenCalled();
  });

  it("pans within bounds using keyboard and primary pointer capture", () => {
    renderViewer();
    const target = viewport();
    const scrollTo = installScrollState(target);
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.defineProperties(target, {
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: releasePointerCapture },
      setPointerCapture: { configurable: true, value: setPointerCapture },
    });
    act(() => buttonWithText("Actual size").click());
    const leftBeforeKeyboardPan = target.scrollLeft;
    const topBeforeKeyboardPan = target.scrollTop;
    expect(target.hasAttribute("data-pannable")).toBe(true);
    expect(target.getAttribute("aria-label")).toContain("Drag or use arrow keys");

    const arrow = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "ArrowRight",
    });
    act(() => container.querySelector("dialog")?.dispatchEvent(arrow));
    expect(arrow.defaultPrevented).toBe(true);
    expect(scrollTo).toHaveBeenLastCalledWith({
      behavior: "auto",
      left: leftBeforeKeyboardPan + 56,
      top: topBeforeKeyboardPan,
    });

    target.scrollLeft = 80;
    target.scrollTop = 60;
    act(() => {
      target.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          clientX: 100,
          clientY: 100,
          isPrimary: true,
          pointerId: 1,
        }),
      );
      target.dispatchEvent(
        new PointerEvent("pointermove", {
          bubbles: true,
          clientX: 70,
          clientY: 75,
          isPrimary: true,
          pointerId: 1,
        }),
      );
    });
    expect(setPointerCapture).toHaveBeenCalledWith(1);
    expect(target.hasAttribute("data-panning")).toBe(true);
    expect(target.scrollLeft).toBe(110);
    expect(target.scrollTop).toBe(85);

    act(() =>
      target.dispatchEvent(
        new PointerEvent("pointercancel", { bubbles: true, isPrimary: true, pointerId: 1 }),
      ),
    );
    expect(target.hasAttribute("data-panning")).toBe(false);

    act(() => {
      target.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          isPrimary: true,
          pointerId: 5,
        }),
      );
      target.dispatchEvent(
        new PointerEvent("lostpointercapture", {
          bubbles: true,
          isPrimary: true,
          pointerId: 5,
        }),
      );
    });
    expect(target.hasAttribute("data-panning")).toBe(false);

    act(() =>
      target.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          isPrimary: true,
          pointerId: 6,
        }),
      ),
    );
    act(() => root.render(null));
    expect(releasePointerCapture).toHaveBeenCalledWith(6);
  });

  it("does not begin drag pan from controls or non-primary pointer input", () => {
    renderViewer();
    const target = viewport();
    installScrollState(target);
    const setPointerCapture = vi.fn();
    Object.defineProperty(target, "setPointerCapture", {
      configurable: true,
      value: setPointerCapture,
    });
    act(() => buttonWithText("Actual size").click());

    act(() =>
      buttonWithText("Reset").dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          isPrimary: true,
          pointerId: 2,
        }),
      ),
    );
    act(() =>
      target.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          isPrimary: false,
          pointerId: 3,
        }),
      ),
    );
    expect(setPointerCapture).not.toHaveBeenCalled();
  });

  it("clears pointer capture when the resource is replaced", () => {
    renderViewer();
    const target = viewport();
    installScrollState(target);
    const releasePointerCapture = vi.fn();
    Object.defineProperties(target, {
      hasPointerCapture: { configurable: true, value: vi.fn(() => true) },
      releasePointerCapture: { configurable: true, value: releasePointerCapture },
      setPointerCapture: { configurable: true, value: vi.fn() },
    });
    for (let index = 0; index < 2; index += 1) {
      act(() =>
        target.dispatchEvent(
          new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -16 }),
        ),
      );
    }
    expect(container.querySelector("output")?.textContent).toBe("Fit · 47%");
    act(() => buttonWithText("Actual size").click());
    act(() =>
      target.dispatchEvent(
        new PointerEvent("pointerdown", {
          bubbles: true,
          button: 0,
          isPrimary: true,
          pointerId: 4,
        }),
      ),
    );

    renderViewer({ resource: replacementResource });

    expect(releasePointerCapture).toHaveBeenCalledWith(4);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:replacement");
    expect(container.querySelector("output")?.textContent).toBe("Fit · 47%");
    act(() =>
      viewport().dispatchEvent(
        new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -16 }),
      ),
    );
    expect(container.querySelector("output")?.textContent).toBe("Fit · 47%");
  });

  it("gives native Escape cancellation priority", () => {
    const onClose = renderViewer();
    const cancel = new Event("cancel", { cancelable: true });

    act(() => container.querySelector("dialog")?.dispatchEvent(cancel));

    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("dismisses safely through the global Escape fallback without a Reader controller", () => {
    const onClose = renderViewer();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, key: "Escape" }));
    });

    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith(true);
  });
});
