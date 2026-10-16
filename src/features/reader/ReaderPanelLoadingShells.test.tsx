// @vitest-environment happy-dom

import { act, useLayoutEffect, useRef, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReaderPanelFrame } from "./ReaderPanelLoadingShells";
import { useReaderPanelFocus } from "./useReaderPanelFocus";
import { registerTransientSurface } from "../../utils/transientSurfaceOwnership";

function ReadyInput() {
  const input = useRef<HTMLInputElement>(null);
  const focusInitialTarget = useReaderPanelFocus();
  useLayoutEffect(() => {
    focusInitialTarget(input.current);
  }, [focusInitialTarget]);
  return <input ref={input} aria-label="Ready search" />;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function render(node: ReactNode) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(node));
  return container;
}

describe("Reader panel loading shells", () => {
  it.each(["automatic", "header", "toolbar", "higher-surface"] as const)(
    "hands loading focus to ready content only while automatic focus is owned: %s",
    (action) => {
      const onClose = vi.fn();
      const view = render(
        <ReaderPanelFrame kind="search" onClose={onClose} readiness="module-loading" />,
      );
      const panel = view.querySelector("aside")!;
      expect(document.activeElement).toBe(panel);
      let newerTarget: HTMLElement = panel;
      let unregister: () => void = () => undefined;
      const outside = document.body.appendChild(document.createElement("button"));
      if (action === "header") newerTarget = view.querySelector("button")!;
      if (action === "toolbar" || action === "higher-surface") newerTarget = outside;
      if (action !== "automatic") act(() => newerTarget.focus());
      if (action === "higher-surface")
        unregister = registerTransientSurface({
          element: outside,
          kind: "popover",
          onDismiss: vi.fn(),
        });
      try {
        act(() =>
          root?.render(
            <ReaderPanelFrame kind="search" onClose={onClose} readiness="idle">
              <ReadyInput />
            </ReaderPanelFrame>,
          ),
        );
        expect(document.activeElement).toBe(
          action === "automatic" ? view.querySelector("input") : newerTarget,
        );
      } finally {
        unregister();
        outside.remove();
      }
    },
  );
  it("preserves the pending book navigation structure and close operation", () => {
    const onClose = vi.fn();
    const view = render(
      <ReaderPanelFrame kind="navigation" onClose={onClose} readiness="module-loading" />,
    );
    const panel = view.querySelector<HTMLElement>("#reader-publication-navigation");

    expect(view.querySelectorAll(".reader-side-panel")).toHaveLength(1);
    expect(panel?.getAttribute("aria-label")).toBe("Book navigation");
    expect(view.querySelector(".reader-panel-content")?.getAttribute("aria-busy")).toBe("true");
    expect(panel?.tabIndex).toBe(-1);
    expect(view.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe(
      "Loading book navigation",
    );

    act(() =>
      view.querySelector<HTMLButtonElement>('button[aria-label="Close book navigation"]')?.click(),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("preserves the active pending Annotations structure and close operation", () => {
    const onClose = vi.fn();
    const view = render(
      <ReaderPanelFrame kind="annotations" onClose={onClose} readiness="module-loading" />,
    );
    const panel = view.querySelector<HTMLElement>("#reader-annotations");

    expect(view.querySelectorAll(".reader-side-panel")).toHaveLength(1);
    expect(panel?.getAttribute("aria-label")).toBe("Annotations");
    expect(view.querySelector(".reader-panel-content")?.getAttribute("aria-busy")).toBe("true");
    expect(panel?.tabIndex).toBe(-1);
    expect(view.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe(
      "Loading annotations",
    );

    act(() =>
      view.querySelector<HTMLButtonElement>('button[aria-label="Close annotations"]')?.click(),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("retires the Annotations ID and focus target while the note editor owns the drawer", () => {
    const onClose = vi.fn();
    const view = render(
      <ReaderPanelFrame
        kind="annotations"
        active={false}
        onClose={onClose}
        readiness="module-loading"
      />,
    );
    const panel = view.querySelector<HTMLElement>('aside[aria-label="Annotations"]');

    expect(panel?.hidden).toBe(true);
    expect(panel?.hasAttribute("id")).toBe(false);
    expect(panel?.hasAttribute("tabindex")).toBe(false);
    expect(view.querySelector('button[aria-label="Close annotations"]')).toBeNull();
    expect(view.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe(
      "Loading annotations",
    );
  });
});
