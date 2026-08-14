// @vitest-environment happy-dom

import { act, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerTransientSurface,
  resetTransientSurfaceOwnershipForTests,
} from "../../utils/transientSurfaceOwnership";
import {
  createReaderSideSurfaceDismissController,
  useReaderSideSurfaceDismiss,
} from "./readerSideSurfaceDismissal";
import { ReaderExternalLinkDialog } from "./ReaderExternalLinkDialog";
import { ReaderHighlightPalette } from "./ReaderHighlightPalette";
import { ReaderIllustrationViewer } from "./ReaderIllustrationViewer";
import { ReaderSideSurfaceLayer } from "./ReaderSideSurfaceLayer";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  document.body.replaceChildren();
  resetTransientSurfaceOwnershipForTests();
  root = null;
  container = null;
});

function renderLayer(children: ReactNode, onDismiss = vi.fn()) {
  container = document.body.appendChild(document.createElement("div"));
  root = createRoot(container);
  act(() => {
    root?.render(<ReaderSideSurfaceLayer onDismiss={onDismiss}>{children}</ReaderSideSurfaceLayer>);
  });
  return {
    layer: container.querySelector<HTMLElement>(".reader-side-surface-layer")!,
    onDismiss,
    rerender(nextChildren: ReactNode) {
      act(() => {
        root?.render(
          <ReaderSideSurfaceLayer onDismiss={onDismiss}>{nextChildren}</ReaderSideSurfaceLayer>,
        );
      });
    },
  };
}

function pointer(target: HTMLElement, type: "pointercancel" | "pointerdown" | "pointerup", id = 1) {
  act(() => {
    target.dispatchEvent(
      new PointerEvent(type, { bubbles: true, button: 0, pointerId: id, pointerType: "mouse" }),
    );
  });
}

function NestedDismissal() {
  const [active, setActive] = useState(true);
  useReaderSideSurfaceDismiss(() => {
    setActive(false);
    return true;
  }, active);
  return <span>{active ? "Nested open" : "Nested closed"}</span>;
}

type PriorityHarnessProps = Readonly<{
  highest?: "external-link" | "illustration";
  onHigherDismiss: (restoreFocus?: boolean) => void;
  onLowerDismiss: (restoreFocus?: boolean) => void;
}>;

function PriorityHarness({ highest, onHigherDismiss, onLowerDismiss }: PriorityHarnessProps) {
  const lowerTriggerRef = useRef<HTMLButtonElement>(null);

  return (
    <>
      <button ref={lowerTriggerRef} type="button">
        Selection anchor
      </button>
      <ReaderHighlightPalette
        anchorRect={{ bottom: 120, height: 20, left: 100, right: 140, top: 100, width: 40 }}
        busy={false}
        noteActionLabel="Add note"
        onChoose={vi.fn()}
        onDismiss={(restoreFocus) => {
          onLowerDismiss(restoreFocus);
          if (restoreFocus) lowerTriggerRef.current?.focus();
        }}
        onNote={vi.fn()}
        viewportRect={{ bottom: 600, height: 600, left: 0, right: 800, top: 0, width: 800 }}
      />
      {highest === "external-link" ? (
        <ReaderExternalLinkDialog
          host="example.com"
          onCancel={onHigherDismiss}
          onConfirm={vi.fn()}
          opening={false}
          url="https://example.com"
        />
      ) : null}
      {highest === "illustration" ? (
        <ReaderIllustrationViewer loading onClose={onHigherDismiss} />
      ) : null}
    </>
  );
}

function escape(): void {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, key: "Escape" }));
  });
}

describe("ReaderSideSurfaceLayer", () => {
  it("dismisses only the highest-priority owned surface", () => {
    const controller = createReaderSideSurfaceDismissController();
    const dismissPalette = vi.fn(() => false);
    const dismissFootnote = vi.fn(() => false);
    const dismissIllustration = vi.fn(() => true);

    controller.register("highlight-palette", dismissPalette);
    controller.register("footnote", dismissFootnote);
    controller.register("illustration", dismissIllustration);
    dismissPalette.mockClear();
    dismissFootnote.mockClear();

    expect(controller.dismissTopmost()).toBe(true);
    expect(dismissIllustration).toHaveBeenLastCalledWith(true);
    expect(dismissFootnote).not.toHaveBeenCalled();
    expect(dismissPalette).not.toHaveBeenCalled();
  });

  it("settles lower-priority surfaces without restoring focus when a higher one opens", () => {
    const controller = createReaderSideSurfaceDismissController();
    const dismissPalette = vi.fn(() => true);
    const dismissFootnote = vi.fn(() => true);

    controller.register("highlight-palette", dismissPalette);
    controller.register("footnote", dismissFootnote);

    expect(dismissPalette).toHaveBeenCalledOnce();
    expect(dismissPalette).toHaveBeenCalledWith(false);
    expect(dismissFootnote).not.toHaveBeenCalled();
  });

  it("replaces the highlight palette with the owned dictionary definition surface", () => {
    const controller = createReaderSideSurfaceDismissController();
    const dismissPalette = vi.fn(() => true);
    const dismissDictionary = vi.fn(() => true);

    controller.register("highlight-palette", dismissPalette);
    controller.register("dictionary-definition", dismissDictionary);

    expect(dismissPalette).toHaveBeenCalledOnce();
    expect(dismissPalette).toHaveBeenCalledWith(false);
    expect(dismissDictionary).not.toHaveBeenCalled();
    expect(controller.dismissTopmost()).toBe(true);
    expect(dismissDictionary).toHaveBeenCalledWith(true);
  });

  it.each(["external-link", "illustration"] as const)(
    "routes global Escape through Reader priority for %s",
    (highest) => {
      const onHigherDismiss = vi.fn();
      const onLowerDismiss = vi.fn();
      const lower = (
        <PriorityHarness onHigherDismiss={onHigherDismiss} onLowerDismiss={onLowerDismiss} />
      );
      const rendered = renderLayer(lower);
      const lowerTrigger = container?.querySelector<HTMLButtonElement>("button");
      act(() => lowerTrigger?.focus());
      const focusLowerTrigger = vi.spyOn(lowerTrigger!, "focus");

      rendered.rerender(
        <PriorityHarness
          highest={highest}
          onHigherDismiss={onHigherDismiss}
          onLowerDismiss={onLowerDismiss}
        />,
      );

      expect(onLowerDismiss).toHaveBeenCalledOnce();
      expect(onLowerDismiss).toHaveBeenLastCalledWith(false);
      expect(focusLowerTrigger).not.toHaveBeenCalled();

      escape();

      expect(onHigherDismiss).toHaveBeenCalledOnce();
      expect(onHigherDismiss).toHaveBeenLastCalledWith(true);
      expect(onLowerDismiss).toHaveBeenCalledOnce();

      rendered.rerender(lower);
      escape();

      expect(onLowerDismiss).toHaveBeenCalledTimes(2);
      expect(onLowerDismiss).toHaveBeenLastCalledWith(true);
    },
  );

  it("keeps a consumed registration active until its owner cleans up", () => {
    const controller = createReaderSideSurfaceDismissController();
    const dismissIllustration = vi.fn(() => true);
    const dismissFallback = vi.fn(() => true);
    controller.setFallback(dismissFallback);
    const unregister = controller.register("illustration", dismissIllustration);

    expect(controller.dismissTopmost()).toBe(true);
    expect(controller.dismissTopmost()).toBe(true);
    expect(dismissIllustration).toHaveBeenCalledTimes(2);
    expect(dismissFallback).not.toHaveBeenCalled();

    unregister();
    expect(controller.dismissTopmost()).toBe(true);
    expect(dismissFallback).toHaveBeenCalledOnce();
  });

  it("dismisses only when the same pointer begins and ends on the backdrop", () => {
    const { layer, onDismiss } = renderLayer(<aside>Panel</aside>);
    const panel = layer.querySelector<HTMLElement>("aside")!;

    pointer(layer, "pointerdown");
    pointer(layer, "pointerup");
    expect(onDismiss).toHaveBeenCalledOnce();

    pointer(panel, "pointerdown", 2);
    pointer(layer, "pointerup", 2);
    pointer(layer, "pointerdown", 3);
    pointer(panel, "pointerup", 3);
    pointer(layer, "pointerdown", 4);
    pointer(layer, "pointercancel", 4);
    pointer(layer, "pointerup", 4);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("does not dismiss for a portalled child interaction", () => {
    const portalHost = document.body.appendChild(document.createElement("div"));
    const { onDismiss } = renderLayer(
      createPortal(<button type="button">Portalled action</button>, portalHost),
    );
    const portalButton = portalHost.querySelector<HTMLButtonElement>("button")!;

    pointer(portalButton, "pointerdown");
    pointer(portalButton, "pointerup");

    expect(onDismiss).not.toHaveBeenCalled();
  });

  it("lets an owned child surface consume an outside gesture before the panel", () => {
    const { layer, onDismiss } = renderLayer(<aside>Panel</aside>);
    const popover = document.body.appendChild(document.createElement("div"));
    const dismissPopover = vi.fn();
    const unregister = registerTransientSurface({
      dismissOnOutsidePointer: true,
      element: popover,
      kind: "popover",
      onDismiss: dismissPopover,
    });

    pointer(layer, "pointerdown");
    pointer(layer, "pointerup");

    expect(dismissPopover).toHaveBeenCalledOnce();
    expect(onDismiss).not.toHaveBeenCalled();
    unregister();
  });

  it("uses the same one-level hierarchy for Escape and outside dismissal", () => {
    const { layer, onDismiss } = renderLayer(<NestedDismissal />);

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, key: "Escape" }));
    });
    expect(layer.textContent).toContain("Nested closed");
    expect(onDismiss).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { cancelable: true, key: "Escape" }));
    });
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
