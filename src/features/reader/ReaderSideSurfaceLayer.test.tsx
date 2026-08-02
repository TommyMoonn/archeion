// @vitest-environment happy-dom

import { act, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  registerTransientSurface,
  resetTransientSurfaceOwnershipForTests,
} from "../../utils/transientSurfaceOwnership";
import { useReaderSideSurfaceDismiss } from "./readerSideSurfaceDismissal";
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

describe("ReaderSideSurfaceLayer", () => {
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
