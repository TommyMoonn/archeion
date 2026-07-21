// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LibrarySelectionBar } from "./LibrarySelectionBar";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function renderSelectionBar({
  onAction = vi.fn(),
  selectedCount = 2,
  visibleCount = 4,
  visibleSelectedCount = 2,
}: {
  onAction?: Parameters<typeof LibrarySelectionBar>[0]["onAction"];
  selectedCount?: number;
  visibleCount?: number;
  visibleSelectedCount?: number;
} = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <LibrarySelectionBar
        onAction={onAction}
        onClear={vi.fn()}
        onDeselectVisible={vi.fn()}
        onExit={vi.fn()}
        onSelectVisible={vi.fn()}
        selectedCount={selectedCount}
        visibleCount={visibleCount}
        visibleSelectedCount={visibleSelectedCount}
      />,
    );
  });

  return { container, root };
}

let activeRoot: Root | null = null;

describe("LibrarySelectionBar", () => {
  afterEach(() => {
    if (activeRoot) {
      act(() => activeRoot?.unmount());
      activeRoot = null;
    }
    document.body.innerHTML = "";
  });

  it("groups ghost bulk actions beside the status and moves Select all beside Clear", () => {
    const session = renderSelectionBar();
    activeRoot = session.root;

    const primary = session.container.querySelector(".library-selection-bar__primary");
    const trailingActions = session.container.querySelector(".library-selection-bar__actions");
    const trailingLabels = Array.from(
      trailingActions?.querySelectorAll<HTMLButtonElement>("button") ?? [],
      (button) => button.textContent,
    );

    expect(primary?.textContent).not.toContain("Select all");
    expect(trailingLabels).toEqual(["Select all", "Clear", "Done"]);
    expect(
      primary
        ?.querySelector<HTMLButtonElement>('button[aria-label="Add selected books to favorites"]')
        ?.classList.contains("library-selection-bar__icon-action"),
    ).toBe(true);
    expect(
      primary
        ?.querySelector<HTMLButtonElement>('button[aria-label="Move selected books"]')
        ?.classList.contains("library-selection-bar__icon-action"),
    ).toBe(true);
    expect(
      primary
        ?.querySelector('summary[aria-label="More bulk actions"]')
        ?.classList.contains("library-selection-bar__icon-action"),
    ).toBe(true);
  });

  it("uses a larger strong selection icon and exposes tooltips for icon actions", () => {
    const session = renderSelectionBar();
    activeRoot = session.root;

    const statusIcon = session.container.querySelector<SVGElement>(
      ".library-selection-bar__status-icon",
    );
    const favorite = session.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Add selected books to favorites"]',
    );
    const move = session.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Move selected books"]',
    );
    const more = session.container.querySelector<HTMLElement>(
      'summary[aria-label="More bulk actions"]',
    );

    expect(statusIcon?.getAttribute("width")).toBe("20");
    expect(statusIcon?.getAttribute("height")).toBe("20");
    expect(favorite?.title).toBe("Add selected books to favorites");
    expect(move?.title).toBe("Move selected books");
    expect(more?.title).toBe("More bulk actions");
  });

  it("uses concise annotation export labels while preserving full hover tooltips", () => {
    const onAction = vi.fn();
    const session = renderSelectionBar({ onAction });
    activeRoot = session.root;

    const markdown = Array.from(
      session.container.querySelectorAll<HTMLButtonElement>(".menu-item"),
    ).find((button) => button.textContent === "Annotations (Markdown)");
    const json = Array.from(
      session.container.querySelectorAll<HTMLButtonElement>(".menu-item"),
    ).find((button) => button.textContent === "Annotations (JSON)");

    expect(markdown?.title).toBe("Export annotations as Markdown");
    expect(json?.title).toBe("Export annotations as JSON");

    act(() => json?.click());
    expect(onAction).toHaveBeenCalledWith("annotations-json");
  });

  it("uses the search-like surface treatment and ghost hover tokens", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles/features/library.css"), "utf8");

    expect(styles).toMatch(
      /\.library-selection-bar\s*\{[^}]*border:\s*var\(--border-width\) solid var\(--line\);[^}]*background:\s*var\(--surface\);/s,
    );
    expect(styles).toMatch(
      /\.library-selection-bar \.library-selection-bar__icon-action\s*\{[^}]*border-color:\s*transparent;[^}]*background:\s*transparent;/s,
    );
    expect(styles).toMatch(
      /\.library-selection-actions-menu\[open\] > summary,[^{]*\{[^}]*background:\s*var\(--surface-hover\);/s,
    );
    expect(styles).not.toMatch(
      /\.library-selection-bar__icon-action\s*\{[^}]*border-color:\s*var\(--line-strong\);/s,
    );
  });
});
