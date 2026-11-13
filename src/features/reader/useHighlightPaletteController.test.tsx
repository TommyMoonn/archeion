// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"enableIframePageLoading":true}}

import { act, useLayoutEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerTransientSurface,
  resetTransientSurfaceOwnershipForTests,
} from "../../utils/transientSurfaceOwnership";
import { ReaderHighlightPalette } from "./ReaderHighlightPalette";
import type { HighlightPaletteAnchor } from "./readerHighlightPaletteAnchor";
import { ReaderContentDocumentRegistry } from "./readerContentDocumentRegistry";
import {
  useHighlightPaletteController,
  type HighlightPaletteController,
} from "./useHighlightPaletteController";

type HarnessProps = {
  onController: (controller: HighlightPaletteController) => void;
  onDismiss: () => void;
  registry: ReaderContentDocumentRegistry;
  viewer: HTMLDivElement;
};

function Harness({ onController, onDismiss, registry, viewer }: HarnessProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const paletteRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef(viewer);
  const controller = useHighlightPaletteController({
    containerRef,
    onDismiss,
    paletteRef,
    registry,
    viewerRef,
  });
  useLayoutEffect(() => onController(controller), [controller, onController]);

  return (
    <div ref={containerRef}>
      {controller.menu ? (
        <ReaderHighlightPalette
          ref={paletteRef}
          anchorRect={controller.menu.anchorRect}
          busy={false}
          noteActionLabel="Add note"
          onChoose={vi.fn()}
          onDismiss={controller.dismiss}
          onNote={vi.fn()}
          viewportRect={controller.paletteViewport}
        />
      ) : null}
    </div>
  );
}

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  resetTransientSurfaceOwnershipForTests();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function renderController(onDismiss: () => void) {
  const host = document.body.appendChild(document.createElement("div"));
  const viewer = document.body.appendChild(document.createElement("div"));
  Object.defineProperty(viewer, "getBoundingClientRect", {
    value: () => ({ bottom: 600, height: 600, left: 0, right: 800, top: 0, width: 800 }),
  });
  const registry = new ReaderContentDocumentRegistry();
  let latest!: HighlightPaletteController;
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(
      <Harness
        onController={(controller) => {
          latest = controller;
        }}
        onDismiss={onDismiss}
        registry={registry}
        viewer={viewer}
      />,
    );
  });
  return { latest: () => latest };
}

function paletteAnchor(focusTarget: HTMLButtonElement): HighlightPaletteAnchor {
  return {
    document: focusTarget.ownerDocument,
    focusTarget,
    resolveRect: () => ({ bottom: 140, height: 20, left: 100, right: 180, top: 120, width: 80 }),
  };
}

function embeddedPaletteTarget(): {
  document: Document;
  frame: HTMLIFrameElement;
  target: HTMLButtonElement;
} {
  const frame = document.body.appendChild(document.createElement("iframe"));
  Object.defineProperty(frame.contentWindow, "frameElement", {
    configurable: true,
    value: frame,
  });
  const ownerDocument = frame.contentDocument!;
  const target = ownerDocument.body.appendChild(ownerDocument.createElement("button"));
  return { document: ownerDocument, frame, target };
}

describe("useHighlightPaletteController", () => {
  it("batches geometry events, preserves unchanged menu identity, and cancels work when its document is removed", () => {
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.set(++nextFrame, callback);
      return nextFrame;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frame) => {
      frames.delete(frame);
    });
    const flushFrame = () =>
      act(() => {
        const callbacks = [...frames.values()];
        frames.clear();
        callbacks.forEach((callback) => callback(0));
      });
    const onDismiss = vi.fn();
    const harness = renderController(onDismiss);
    const { document: chapter, target } = embeddedPaletteTarget();
    const anchor = paletteAnchor(target);
    const resolveRect = vi.spyOn(anchor, "resolveRect");
    const anchorRect = anchor.resolveRect();
    if (!anchorRect) throw new Error("Expected an anchor rectangle");
    act(() =>
      harness.latest().open({
        source: "selection",
        anchor,
        anchorRect,
        selection: { cfiRange: "epubcfi(/6/2)", selectedText: "Selection" },
      }),
    );
    flushFrame();
    resolveRect.mockClear();
    const original = harness.latest().menu;
    act(() => {
      chapter.dispatchEvent(new Event("scroll"));
      window.dispatchEvent(new Event("resize"));
      chapter.dispatchEvent(new Event("scroll"));
    });
    expect(resolveRect).not.toHaveBeenCalled();
    flushFrame();
    expect(resolveRect).toHaveBeenCalledOnce();
    expect(harness.latest().menu).toBe(original);

    const moved = { ...anchorRect, top: anchorRect.top + 5 };
    resolveRect.mockReturnValue(moved);
    act(() => chapter.dispatchEvent(new Event("scroll")));
    flushFrame();
    expect(harness.latest().menu?.anchorRect).toEqual(moved);

    act(() => chapter.dispatchEvent(new Event("scroll")));
    act(() => harness.latest().handleDocumentRemoved(chapter));
    expect(harness.latest().menu).toBeNull();
    flushFrame();
    expect(resolveRect).toHaveBeenCalledTimes(2);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it.each(["highlight", "selection"] as const)(
    "keeps collapse dismissal specific to a %s action owner",
    (source) => {
      const dismiss = vi.fn();
      const harness = renderController(dismiss);
      const { document: chapter, target } = embeddedPaletteTarget();
      act(() =>
        harness.latest().open({
          source,
          anchor: paletteAnchor(target),
          anchorRect: { bottom: 140, height: 20, left: 100, right: 180, top: 120, width: 80 },
          selection: { cfiRange: "epubcfi(/6/2)", selectedText: "Selection" },
        }),
      );
      act(() => harness.latest().handleSelectionCollapsed(chapter));
      expect(harness.latest().menu !== null).toBe(source === "highlight");
      if (source === "highlight") act(() => harness.latest().handleDocumentRemoved(chapter));
      expect(harness.latest().menu).toBeNull();
      expect(dismiss).toHaveBeenCalledOnce();
    },
  );
  it("uses only the shared parent-document dismissal owner", () => {
    const onDismiss = vi.fn();
    const harness = renderController(onDismiss);
    const trigger = document.body.appendChild(document.createElement("button"));
    const addListener = vi.spyOn(document, "addEventListener");

    act(() => {
      harness.latest().open({
        source: "selection",
        anchor: paletteAnchor(trigger),
        anchorRect: { bottom: 140, height: 20, left: 100, right: 180, top: 120, width: 80 },
        selection: { cfiRange: "epubcfi(/6/2)", selectedText: "Selection" },
      });
    });

    expect(
      addListener.mock.calls.filter(
        ([type, , options]) => (type === "pointerdown" || type === "keydown") && options === true,
      ),
    ).toHaveLength(0);

    act(() => document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true })));

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(harness.latest().menu).toBeNull();
  });

  it("retains the EPUB bridge callbacks without double dismissal", () => {
    const onDismiss = vi.fn();
    const harness = renderController(onDismiss);
    const trigger = document.body.appendChild(document.createElement("button"));

    act(() => {
      harness.latest().open({
        source: "selection",
        anchor: paletteAnchor(trigger),
        anchorRect: { bottom: 140, height: 20, left: 100, right: 180, top: 120, width: 80 },
        selection: { cfiRange: "epubcfi(/6/2)", selectedText: "Selection" },
      });
      harness.latest().handlePointerDown();
    });

    expect(onDismiss).toHaveBeenCalledOnce();
    expect(harness.latest().menu).toBeNull();
  });

  it("uses the shared parent Escape owner exactly once", () => {
    const onDismiss = vi.fn();
    const harness = renderController(onDismiss);
    const trigger = document.body.appendChild(document.createElement("button"));

    act(() => {
      harness.latest().open({
        source: "selection",
        anchor: paletteAnchor(trigger),
        anchorRect: { bottom: 140, height: 20, left: 100, right: 180, top: 120, width: 80 },
        selection: { cfiRange: "epubcfi(/6/2)", selectedText: "Selection" },
      });
    });
    const event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key: "Escape",
    });
    act(() => document.body.dispatchEvent(event));

    expect(event.defaultPrevented).toBe(true);
    expect(onDismiss).toHaveBeenCalledOnce();
    expect(harness.latest().menu).toBeNull();
  });

  it("retains newer persistent parent focus after one restoration attempt", () => {
    const frames: FrameRequestCallback[] = [];
    const requestFrame = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((callback) => {
        frames.push(callback);
        return frames.length;
      });
    const onDismiss = vi.fn();
    const harness = renderController(onDismiss);
    const { target } = embeddedPaletteTarget();
    const focus = vi.spyOn(target, "focus");

    act(() => {
      harness.latest().open({
        source: "selection",
        anchor: paletteAnchor(target),
        anchorRect: { bottom: 140, height: 20, left: 100, right: 180, top: 120, width: 80 },
        selection: { cfiRange: "epubcfi(/6/2)", selectedText: "Selection" },
      });
    });
    act(() => frames.splice(0).forEach((frame) => frame(0)));
    requestFrame.mockClear();

    act(() => harness.latest().dismiss());
    const toolbarButton = document.body.appendChild(document.createElement("button"));
    toolbarButton.focus();

    expect(requestFrame).toHaveBeenCalledOnce();
    act(() => frames.splice(0).forEach((frame) => frame(0)));
    expect(document.activeElement).toBe(toolbarButton);
    expect(focus).not.toHaveBeenCalled();
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("restores a highlight palette origin when parent focus is unowned", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const onDismiss = vi.fn();
    const harness = renderController(onDismiss);
    const { document: chapter, target } = embeddedPaletteTarget();

    act(() => {
      harness.latest().open({
        source: "selection",
        anchor: paletteAnchor(target),
        anchorRect: { bottom: 140, height: 20, left: 100, right: 180, top: 120, width: 80 },
        selection: { cfiRange: "epubcfi(/6/2)", selectedText: "Selection" },
      });
    });
    act(() => frames.splice(0).forEach((frame) => frame(0)));
    act(() => harness.latest().dismiss());
    act(() => frames.splice(0).forEach((frame) => frame(0)));

    expect(chapter.activeElement).toBe(target);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("does not restore an EPUB origin behind a newer parent modal", () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const onDismiss = vi.fn();
    const harness = renderController(onDismiss);
    const { target } = embeddedPaletteTarget();

    act(() => {
      harness.latest().open({
        source: "selection",
        anchor: paletteAnchor(target),
        anchorRect: { bottom: 140, height: 20, left: 100, right: 180, top: 120, width: 80 },
        selection: { cfiRange: "epubcfi(/6/2)", selectedText: "Selection" },
      });
    });
    act(() => frames.splice(0).forEach((frame) => frame(0)));
    act(() => harness.latest().dismiss());

    const modal = document.body.appendChild(document.createElement("dialog"));
    modal.open = true;
    const modalButton = modal.appendChild(document.createElement("button"));
    modalButton.focus();
    const unregister = registerTransientSurface({
      element: modal,
      kind: "app-dialog",
      modal: true,
      onDismiss: vi.fn(),
    });
    act(() => frames.splice(0).forEach((frame) => frame(0)));

    expect(document.activeElement).toBe(modalButton);
    expect(onDismiss).toHaveBeenCalledOnce();
    unregister();
  });
});
