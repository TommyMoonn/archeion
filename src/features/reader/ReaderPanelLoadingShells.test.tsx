// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReaderAnnotationsLoadingShell, ReaderTocLoadingShell } from "./ReaderPanelLoadingShells";

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
  it("preserves the pending Contents panel structure and close operation", () => {
    const onClose = vi.fn();
    const view = render(<ReaderTocLoadingShell onClose={onClose} />);
    const panel = view.querySelector<HTMLElement>("#reader-table-of-contents");

    expect(view.querySelectorAll(".reader-side-panel")).toHaveLength(1);
    expect(panel?.getAttribute("aria-label")).toBe("Table of contents");
    expect(panel?.getAttribute("aria-busy")).toBe("true");
    expect(panel?.tabIndex).toBe(-1);
    expect(view.querySelector('[role="status"]')?.getAttribute("aria-label")).toBe(
      "Loading table of contents",
    );

    act(() =>
      view
        .querySelector<HTMLButtonElement>('button[aria-label="Close table of contents"]')
        ?.click(),
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
