// @vitest-environment happy-dom

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
  const controller = useHighlightPaletteController({
    containerRef,
    onDismiss,
    paletteRef,
    registry,
    viewerRef: { current: viewer },
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
  it("uses only the shared parent-document dismissal owner", () => {
    const onDismiss = vi.fn();
    const harness = renderController(onDismiss);
    const trigger = document.body.appendChild(document.createElement("button"));
    const addListener = vi.spyOn(document, "addEventListener");

    act(() => {
      harness.latest().open({
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
