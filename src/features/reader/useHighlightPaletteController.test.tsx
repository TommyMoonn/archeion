// @vitest-environment happy-dom

import { act, useLayoutEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetTransientSurfaceOwnershipForTests } from "../../utils/transientSurfaceOwnership";
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
    document,
    focusTarget,
    resolveRect: () => ({ bottom: 140, height: 20, left: 100, right: 180, top: 120, width: 80 }),
  };
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
});
