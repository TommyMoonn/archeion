// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ReaderAnnotationsLoadingShell,
  ReaderNavigationLoadingShell,
} from "./ReaderPanelLoadingShells";

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
  it("preserves the pending book navigation structure and close operation", () => {
    const onClose = vi.fn();
    const view = render(<ReaderNavigationLoadingShell onClose={onClose} />);
    const panel = view.querySelector<HTMLElement>("#reader-publication-navigation");

    expect(view.querySelectorAll(".reader-side-panel")).toHaveLength(1);
    expect(panel?.getAttribute("aria-label")).toBe("Book navigation");
    expect(panel?.getAttribute("aria-busy")).toBe("true");
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
    const view = render(<ReaderAnnotationsLoadingShell onClose={onClose} />);
    const panel = view.querySelector<HTMLElement>("#reader-annotations");

    expect(view.querySelectorAll(".reader-side-panel")).toHaveLength(1);
    expect(panel?.getAttribute("aria-label")).toBe("Annotations");
    expect(panel?.getAttribute("aria-busy")).toBe("true");
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
    const view = render(<ReaderAnnotationsLoadingShell active={false} onClose={onClose} />);
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
