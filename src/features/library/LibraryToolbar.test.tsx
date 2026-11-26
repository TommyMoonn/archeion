// @vitest-environment happy-dom

import { activateSelectOption } from "../../test/activateSelectOption";

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { focusPresentationRuntime } from "../../app/inputModality";
import { createDefaultLibraryFilters, type LibraryFilterState } from "../../types/library";
import { LibraryToolbar } from "./LibraryToolbar";
import type { LibrarySelectionBarProps } from "./LibrarySelectionBar";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../archive/RescanArchiveButton", () => ({
  RescanArchiveButton: () => <button aria-label="Rescan archive" type="button" />,
}));

function createSelectionBarProps(): LibrarySelectionBarProps {
  return {
    onAction: vi.fn(),
    onClear: vi.fn(),
    onDeselectVisible: vi.fn(),
    onExit: vi.fn(),
    onSelectVisible: vi.fn(),
    selectedCount: 0,
    visibleCount: 0,
    visibleSelectedCount: 0,
  };
}

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
      selectionBarProps={null}
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
  selectionBarProps = null,
  selectionMode = false,
}: {
  filters?: LibraryFilterState;
  onClearFilters?: () => void;
  onClearSearch?: () => void;
  onFilterChange?: (filters: LibraryFilterState) => void;
  onQueryChange?: (query: string) => void;
  onToggleSelectionMode?: () => void;
  selectionBarProps?: LibrarySelectionBarProps | null;
  selectionMode?: boolean;
} = {}) {
  const container = document.createElement("div");
  document.body.append(container);
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
        selectionBarProps={selectionBarProps}
        selectionMode={selectionMode}
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
  it("morphs the title and primary actions while keeping collection controls available", () => {
    const session = renderInteractiveToolbar({
      selectionBarProps: createSelectionBarProps(),
      selectionMode: true,
    });
    activeRoot = session.root;

    const header = session.container.querySelector<HTMLElement>(".library-header");
    expect(header?.dataset.selectionMode).toBe("true");
    expect(header?.querySelector(".library-header__title")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(header?.querySelector(".library-header__title h1")?.textContent).toBe("Library");
    const primaryRow = header?.querySelector(".library-header__primary-row");
    expect(primaryRow?.querySelector(".library-header__title")).not.toBeNull();
    expect(primaryRow?.querySelector(".library-header__actions")).not.toBeNull();
    expect(
      primaryRow?.querySelector(".library-header__selection-row .library-selection-bar"),
    ).not.toBeNull();
    expect(header?.querySelector(".library-header__control-group")?.parentElement).toBe(header);
    expect(header?.querySelector(".library-header__actions")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
    expect(
      header?.querySelector(".library-header__control-group")?.hasAttribute("aria-hidden"),
    ).toBe(false);
    expect(header?.querySelector(".library-controls__filters")).not.toBeNull();
    expect(header?.querySelector(".library-controls__display")).not.toBeNull();
    expect(header?.querySelector('button[aria-label="Sort library"]')).not.toBeNull();
    expect(header?.querySelector('input[name="archeion-library-search"]')).not.toBeNull();
  });

  it("keeps the selection entry control available before selection mode starts", () => {
    const onToggleSelectionMode = vi.fn();
    const session = renderInteractiveToolbar({ onToggleSelectionMode });
    activeRoot = session.root;
    const toggle = session.container.querySelector<HTMLButtonElement>(
      '[aria-label="Select books"]',
    );

    expect(toggle?.getAttribute("aria-pressed")).toBe("false");
    act(() => toggle?.click());
    expect(onToggleSelectionMode).toHaveBeenCalledOnce();
  });
  afterEach(() => {
    if (activeRoot) {
      act(() => activeRoot?.unmount());
      activeRoot = null;
      document.body.replaceChildren();
    }
  });

  it("uses the shared accessible icon-only collection view control", () => {
    const markup = renderToolbar();

    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain('aria-label="Library view"');
    expect(markup).toContain('aria-label="Grid"');
    expect(markup).toContain('aria-label="List"');
    expect(markup).not.toContain("library-view-toggle");
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
    expect(markup).toContain('aria-label="Library search"');
    expect(markup).toContain('role="search"');
  });

  it("keeps pointer-focused Library Search calm until keyboard navigation begins", () => {
    const stopFocusPresentation = focusPresentationRuntime.start(document);
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
      expect(document.documentElement.dataset.focusPresentation).toBe("pointer");

      act(() => {
        search.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: "Tab",
          }),
        );
      });
      expect(document.documentElement.dataset.focusPresentation).toBe("keyboard-navigation");
    } finally {
      stopFocusPresentation();
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

    act(() =>
      session.container.querySelector<HTMLButtonElement>('[aria-label="Filter library"]')?.click(),
    );
    const seriesSelect = session.container.querySelector<HTMLButtonElement>(
      'button[role="combobox"][aria-label="Add series filter"]',
    );

    expect(seriesSelect).not.toBeNull();
    expect(session.container.querySelector("select")).toBeNull();
    act(() => seriesSelect?.click());

    const seriesOption = Array.from(
      session.container.querySelectorAll<HTMLElement>('[role="option"]'),
    ).find((option) => option.textContent?.trim() === "Star Saga");
    act(() => seriesOption && activateSelectOption(seriesOption));

    expect(onFilterChange).toHaveBeenCalledWith({
      ...createDefaultLibraryFilters(),
      series: ["Star Saga"],
    });
  });

  it("disables metadata selectors when no unused values remain", () => {
    const session = renderInteractiveToolbar({
      filters: {
        ...createDefaultLibraryFilters(),
        series: ["Star Saga"],
      },
    });
    activeRoot = session.root;

    act(() =>
      session.container.querySelector<HTMLButtonElement>('[aria-label="Filter library"]')?.click(),
    );
    const seriesSelect = session.container.querySelector<HTMLButtonElement>(
      'button[role="combobox"][aria-label="Add series filter"]',
    );

    expect(seriesSelect?.disabled).toBe(true);
    expect(seriesSelect?.textContent).toContain("No more options");
    expect(seriesSelect?.getAttribute("aria-expanded")).toBe("false");
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

    expect(
      session.container
        .querySelector('[role="group"][aria-label="Active filters"]')
        ?.querySelectorAll("button"),
    ).toHaveLength(2);

    expect(session.container.querySelector('[aria-label="Active filters"]')?.textContent).toContain(
      "Series: Star Saga",
    );
    expect(session.container.querySelector('[aria-label="Active filters"]')?.textContent).toContain(
      "In progress",
    );
    expect(
      session.container.querySelector('button[aria-label="Filter library"]')?.textContent,
    ).toBe("Filters2");

    const removeSeries = session.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Remove Series: Star Saga filter"]',
    );
    act(() => removeSeries?.click());
    expect(onFilterChange).toHaveBeenCalledWith({ ...filters, series: [] });

    act(() =>
      session.container.querySelector<HTMLButtonElement>('[aria-label="Filter library"]')?.click(),
    );
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
    expect(
      session.container.querySelector('button[aria-label="Filter library"]')?.textContent,
    ).toBe("Filters");
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
