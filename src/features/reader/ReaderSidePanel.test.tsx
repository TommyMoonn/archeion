// @vitest-environment happy-dom

import { act, createRef, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReaderSidePanel } from "./ReaderSidePanel";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function renderPanel(overrides: Partial<ComponentProps<typeof ReaderSidePanel>> = {}) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const onClose = vi.fn();

  act(() => {
    root?.render(
      <ReaderSidePanel
        accessibleLabel="Test panel"
        className="reader-test-panel"
        closeLabel="Close test panel"
        eyebrow="Reading"
        onClose={onClose}
        title="Test title"
        {...overrides}
      >
        <div data-testid="domain-content">Domain content</div>
      </ReaderSidePanel>,
    );
  });

  return { container, onClose };
}

describe("ReaderSidePanel", () => {
  it("owns the shared frame and header while leaving content domain-specific", () => {
    const panelRef = createRef<HTMLElement>();
    const { container, onClose } = renderPanel({
      headerActions: <button type="button">Domain action</button>,
      headerLeading: <button type="button">Domain back</button>,
      ref: panelRef,
    });
    const panel = container.querySelector<HTMLElement>('aside[aria-label="Test panel"]')!;
    const header = panel.querySelector<HTMLElement>(".reader-side-panel__header")!;

    expect(panelRef.current).toBe(panel);
    expect(panel.classList.contains("reader-side-panel")).toBe(true);
    expect(panel.classList.contains("reader-test-panel")).toBe(true);
    expect(header.querySelector("p")?.textContent).toBe("Reading");
    expect(header.querySelector("h2")?.textContent).toBe("Test title");
    expect(header.textContent).toContain("Domain back");
    expect(header.textContent).toContain("Domain action");
    expect(panel.querySelector('[data-testid="domain-content"]')?.textContent).toBe(
      "Domain content",
    );

    act(() =>
      panel.querySelector<HTMLButtonElement>('button[aria-label="Close test panel"]')?.click(),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("preserves loading, hidden, focus, and event-containment semantics", () => {
    const { container } = renderPanel({
      ariaBusy: true,
      hidden: true,
      ignoreReaderShortcuts: true,
      tabIndex: -1,
    });
    const panel = container.querySelector<HTMLElement>('aside[aria-label="Test panel"]')!;
    const outsideClick = vi.fn();
    const outsidePointerDown = vi.fn();
    document.addEventListener("click", outsideClick);
    document.addEventListener("pointerdown", outsidePointerDown);

    expect(panel.hidden).toBe(true);
    expect(panel.tabIndex).toBe(-1);
    expect(panel.getAttribute("aria-busy")).toBe("true");
    expect(panel.hasAttribute("data-reader-ignore-shortcuts")).toBe(true);

    act(() => {
      panel.dispatchEvent(new Event("pointerdown", { bubbles: true }));
      panel.click();
    });
    expect(outsidePointerDown).not.toHaveBeenCalled();
    expect(outsideClick).not.toHaveBeenCalled();
    document.removeEventListener("click", outsideClick);
    document.removeEventListener("pointerdown", outsidePointerDown);
  });
});
