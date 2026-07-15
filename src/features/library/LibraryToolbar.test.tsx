// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

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
      onClearFilters={vi.fn()}
      onClearSearch={vi.fn()}
      onFilterChange={vi.fn()}
      onOpenAddEpub={vi.fn()}
      onQueryChange={vi.fn()}
      onRescanError={vi.fn()}
      onRescanSuccess={vi.fn()}
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
        onClearFilters={onClearFilters}
        onClearSearch={onClearSearch}
        onFilterChange={onFilterChange}
        onOpenAddEpub={vi.fn()}
        onQueryChange={onQueryChange}
        onRescanError={vi.fn()}
        onRescanSuccess={vi.fn()}
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

  it("keeps the view switch aligned to the sort control height", () => {
    const styles = readFileSync(resolve(process.cwd(), "src/styles/features/library.css"), "utf8");

    expect(styles).toMatch(
      /\.library-view-toggle\.segmented-control\s*\{[^}]*height:\s*var\(--control-height-standard\)/s,
    );
    expect(styles).toMatch(
      /\.library-view-toggle \.segmented-control__option\s*\{[^}]*height:\s*100%[^}]*min-height:\s*0/s,
    );
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
