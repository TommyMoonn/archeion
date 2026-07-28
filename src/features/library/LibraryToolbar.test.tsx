// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { inputModalityRuntime } from "../../app/inputModality";
import { createDefaultLibraryFilters, type LibraryFilterState } from "../../types/library";
import { LibraryToolbar } from "./LibraryToolbar";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../archive/RescanArchiveButton", () => ({
  RescanArchiveButton: () => <button aria-label="Rescan archive" type="button" />,
}));

function renderToolbar() {
  return renderToStaticMarkup(
    <LibraryToolbar
      filters={createDefaultLibraryFilters()}
      filterOptions={{ languages: [], publishers: [], series: [], subjects: [] }}
      isImporting={false}
      isRescanning={false}
      onClearFilters={vi.fn()}
      onClearSearch={vi.fn()}
      onFilterChange={vi.fn()}
      onOpenAddEpub={vi.fn()}
      onQueryChange={vi.fn()}
      onRescan={vi.fn(async () => {})}
      onSortChange={vi.fn()}
      onToggleSelectionMode={vi.fn()}
      onViewChange={vi.fn()}
      query=""
      resultCount={0}
      selectionMode={false}
      sort="title"
      title="Library"
      view="grid"
    />,
  );
}

function renderInteractiveToolbar({
  filters = createDefaultLibraryFilters(),
  onClearFilters = vi.fn(),
  onClearSearch = vi.fn(),
  onFilterChange = vi.fn(),
  onQueryChange = vi.fn(),
  onToggleSelectionMode = vi.fn(),
}: {
  filters?: LibraryFilterState;
  onClearFilters?: () => void;
  onClearSearch?: () => void;
  onFilterChange?: (filters: LibraryFilterState) => void;
  onQueryChange?: (query: string) => void;
  onToggleSelectionMode?: () => void;
} = {}) {
  const container = document.createElement("div");
  const root = createRoot(container);

  act(() => {
    root.render(
      <LibraryToolbar
        filters={filters}
        filterOptions={{
          languages: ["en"],
          publishers: ["North Press"],
          series: ["Star Saga"],
          subjects: ["Space Opera"],
        }}
        isImporting={false}
        isRescanning={false}
        onClearFilters={onClearFilters}
        onClearSearch={onClearSearch}
        onFilterChange={onFilterChange}
        onOpenAddEpub={vi.fn()}
        onQueryChange={onQueryChange}
        onRescan={vi.fn(async () => {})}
        onSortChange={vi.fn()}
        onToggleSelectionMode={onToggleSelectionMode}
        onViewChange={vi.fn()}
        query="Dune"
        resultCount={1}
        selectionMode={false}
        sort="title"
        title="Library"
        view="grid"
      />,
    );
  });

  return { container, root };
}

let activeRoot: Root | null = null;

describe("LibraryToolbar", () => {
  afterEach(() => {
    if (activeRoot) {
      act(() => activeRoot?.unmount());
      activeRoot = null;
    }
  });

  it("uses the shared accessible icon-only collection view control", () => {
    const markup = renderToolbar();

    expect(markup).toContain("segmented-control--icon-only");
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('aria-label="Library view"');
    expect(markup).toContain('aria-label="Grid"');
    expect(markup).toContain('aria-label="List"');
    expect(markup).not.toContain("library-view-toggle");
  });

  it("contains selection and rescan states within one bordered utility group", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles/features/library.css"), "utf8");
    const forcedColorsStyles = readFileSync(
      resolve(process.cwd(), "src/styles/forced-colors.css"),
      "utf8",
    );

    expect(styles).toMatch(
      /\.library-header__utilities\s*\{[^}]*--library-utility-group-inset:\s*var\(--collection-header-utility-inset\);[^}]*--library-utility-child-radius:\s*calc\([^)]*var\(--radius-control\)[^)]*var\(--library-utility-group-inset\)[^)]*var\(--border-width\)[^)]*\);[^}]*min-height:\s*var\(--collection-header-control-height\);[^}]*padding:\s*var\(--library-utility-group-inset\);[^}]*border:\s*var\(--border-width\) solid var\(--line\);[^}]*border-radius:\s*var\(--radius-control\);[^}]*background:\s*var\(--surface\);/s,
    );
    expect(styles).not.toMatch(
      /\.library-header__utilities\s*\{[^}]*(?:box-shadow|overflow:\s*hidden|padding:\s*0\s)/s,
    );
    expect(styles).toMatch(
      /\.library-select-button,\s*\.library-rescan-button\s*\{[^}]*width:\s*var\(--control-height-compact\);[^}]*height:\s*var\(--control-height-compact\);[^}]*border-radius:\s*var\(--library-utility-child-radius\);[^}]*\}/s,
    );
    expect(styles).toMatch(
      /\.library-select-button \.icon-slot,\s*\.library-rescan-button \.icon-slot\s*\{[^}]*--icon-slot-size:\s*18px;[^}]*--icon-glyph-size:\s*18px;/s,
    );
    expect(styles).toMatch(
      /\.library-select-button\[aria-pressed="true"\]\s*\{[^}]*border-color:\s*var\(--line-strong\);[^}]*background:\s*var\(--surface-raised\);/s,
    );
    expect(styles).toMatch(
      /\.library-rescan-button\[aria-expanded="true"\]\s*\{[^}]*border-color:\s*var\(--line-strong\);[^}]*background:\s*var\(--surface-hover\);/s,
    );
    expect(styles).toMatch(
      /:root\[data-input-modality="keyboard"\][^{]*\.library-header__utilities[^{]*\.icon-button:focus-visible\s*\{[^}]*outline-offset:\s*-2px;/s,
    );
    expect(styles).not.toMatch(
      /html\[data-density="compact"\][^{]*(?:library-header__utilities|library-select-button|library-rescan-button)/,
    );
    expect(forcedColorsStyles).toMatch(
      /\.library-header__utilities\s*\{[^}]*border-color:\s*CanvasText;/s,
    );
    expect(styles).not.toMatch(/\.library-select-button\[aria-pressed="true"\][^}]*var\(--accent/s);
  });

  it("shares the utility-group height with collection search and primary actions", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles/features/library.css"), "utf8");
    const folderSource = readFileSync(
      resolve(process.cwd(), "src/features/folders/FolderBrowser.tsx"),
      "utf8",
    );
    const seriesSource = readFileSync(
      resolve(process.cwd(), "src/features/series/SeriesOverview.tsx"),
      "utf8",
    );

    expect(styles).toMatch(
      /\.library-header__actions\s*\{[^}]*--collection-header-utility-inset:\s*1px;[^}]*--collection-header-control-height:\s*var\(--control-height-standard\);/,
    );
    expect(styles).toMatch(
      /\.library-header__actions \.input-shell,\s*\.library-header__actions > \.button\s*\{[^}]*min-height:\s*var\(--collection-header-control-height\);/s,
    );
    expect(folderSource).toContain(
      'className="library-header__actions library-header__actions--primary-only folder-browser__actions"',
    );
    expect(seriesSource).toContain(
      'className="library-header__actions library-header__actions--search-only series-header__actions"',
    );
  });

  it("groups utility actions before a divider and the primary action", () => {
    const session = renderInteractiveToolbar();
    activeRoot = session.root;

    const actions = session.container.querySelector(".library-header__actions");
    const utilities = actions?.querySelector('[role="group"][aria-label="Library utilities"]');
    const divider = actions?.querySelector(".library-header__action-divider");
    const addButton = actions?.querySelector<HTMLButtonElement>(".library-add-button");

    expect(utilities?.querySelectorAll("button")).toHaveLength(2);
    expect(utilities?.nextElementSibling).toBe(divider);
    expect(divider?.nextElementSibling).toBe(addButton);
  });

  it("disables native autofill on the library search field", () => {
    const markup = renderToolbar();

    expect(markup).toContain('type="search"');
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain('autoCorrect="off"');
    expect(markup).toContain('autoCapitalize="none"');
    expect(markup).toContain('name="archeion-library-search"');
    expect(markup).toContain('spellCheck="false"');
  });

  it("keeps pointer-focused Library Search calm until keyboard navigation begins", () => {
    const stopInputModality = inputModalityRuntime.start(document);
    try {
      const session = renderInteractiveToolbar();
      activeRoot = session.root;
      document.body.append(session.container);
      const search = session.container.querySelector<HTMLInputElement>(
        'input[name="archeion-library-search"]',
      )!;

      act(() => {
        search.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        search.focus();
        search.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
      });
      expect(document.activeElement).toBe(search);
      expect(document.documentElement.dataset.inputModality).toBe("pointer");

      act(() => {
        search.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Tab",
          }),
        );
      });
      expect(document.documentElement.dataset.inputModality).toBe("keyboard");
    } finally {
      stopInputModality();
    }
  });

  it("keeps search clearing separate from search typing", () => {
    const onClearSearch = vi.fn();
    const onQueryChange = vi.fn();
    const session = renderInteractiveToolbar({ onClearSearch, onQueryChange });
    activeRoot = session.root;

    const clearButton = session.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Clear search"]',
    );

    expect(clearButton).not.toBeNull();
    act(() => clearButton?.click());

    expect(onClearSearch).toHaveBeenCalledTimes(1);
    expect(onQueryChange).not.toHaveBeenCalled();
  });

  it("adds metadata filters and exposes active filters as removable tokens", () => {
    const onFilterChange = vi.fn();
    const session = renderInteractiveToolbar({ onFilterChange });
    activeRoot = session.root;

    const seriesSelect = session.container.querySelector<HTMLSelectElement>(
      'select[aria-label="Add series filter"]',
    );

    expect(seriesSelect).not.toBeNull();
    act(() => {
      if (seriesSelect) {
        seriesSelect.value = "Star Saga";
        seriesSelect.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    expect(onFilterChange).toHaveBeenCalledWith({
      ...createDefaultLibraryFilters(),
      series: ["Star Saga"],
    });
  });

  it("shows active filter controls only when deliberate filters are active", () => {
    const onClearFilters = vi.fn();
    const onFilterChange = vi.fn();
    const filters: LibraryFilterState = {
      ...createDefaultLibraryFilters(),
      series: ["Star Saga"],
      readingStatuses: ["in-progress"],
    };
    const session = renderInteractiveToolbar({ filters, onClearFilters, onFilterChange });
    activeRoot = session.root;

    expect(session.container.querySelector('[aria-label="Active filters"]')?.textContent).toContain(
      "Series: Star Saga",
    );
    expect(session.container.querySelector('[aria-label="Active filters"]')?.textContent).toContain(
      "In progress",
    );
    expect(session.container.querySelector(".library-filter__count")?.textContent).toBe("2");

    const removeSeries = session.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove Series: Star Saga filter"]',
    );
    act(() => removeSeries?.click());
    expect(onFilterChange).toHaveBeenCalledWith({ ...filters, series: [] });

    const clearAll = [...session.container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Clear all",
    );
    act(() => clearAll?.click());
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("keeps zero-filter UI compact while displaying a numeric result count", () => {
    const session = renderInteractiveToolbar();
    activeRoot = session.root;

    expect(session.container.querySelector('[aria-label="Active filters"]')).toBeNull();
    expect(session.container.querySelector(".library-filter__count")).toBeNull();
    expect(session.container.querySelector('[aria-label="1 book shown"]')?.textContent).toBe(
      "1 book",
    );
  });

  it("enters explicit selection mode without changing the search query", () => {
    const onQueryChange = vi.fn();
    const onToggleSelectionMode = vi.fn();
    const session = renderInteractiveToolbar({ onQueryChange, onToggleSelectionMode });
    activeRoot = session.root;

    const selectButton = session.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Select books"]',
    );
    act(() => selectButton?.click());

    expect(onToggleSelectionMode).toHaveBeenCalledTimes(1);
    expect(onQueryChange).not.toHaveBeenCalled();
  });

  it("orders compact library actions after the expanding search field", () => {
    const session = renderInteractiveToolbar();
    activeRoot = session.root;
    const actions = session.container.querySelector(".library-header__actions");
    const actionLabels = [...(actions?.querySelectorAll<HTMLButtonElement>("button") ?? [])].map(
      (button) => button.getAttribute("aria-label") ?? button.textContent,
    );

    expect(actionLabels).toEqual(["Clear search", "Select books", "Rescan archive", "Add EPUB"]);
  });
});
