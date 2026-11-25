import type { ReactNode, Ref } from "react";

import { SquareCheckBig, Grid2x2, List, Plus, Search, X } from "lucide-react";

import { AppSelect } from "../../components/AppSelect";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { Input } from "../../components/Input";
import { SegmentedControl } from "../../components/SegmentedControl";
import { RescanArchiveButton } from "../archive/RescanArchiveButton";
import type { LibraryFilterState, LibrarySort, LibraryView } from "../../types/library";
import { LibraryFilterPopover, LibraryFilterTokens } from "./LibraryFilterPopover";
import type { LibraryFilterOptions } from "./libraryFilters";
import { LibrarySelectionBar, type LibrarySelectionBarProps } from "./LibrarySelectionBar";
import { librarySortOptions } from "./librarySortOptions";

type LibraryToolbarProps = {
  filters: LibraryFilterState;
  filterOptions: LibraryFilterOptions;
  isImporting: boolean;
  isRescanning: boolean;
  onClearFilters: () => void;
  onClearSearch: () => void;
  onFilterChange: (filters: LibraryFilterState) => void;
  onOpenAddEpub: () => void;
  onQueryChange: (query: string) => void;
  onRescan: () => Promise<void>;
  onSortChange: (sort: LibrarySort) => void;
  onToggleSelectionMode: () => void;
  onViewChange: (view: LibraryView) => void;
  query: string;
  resultCount: number;
  searchAriaKeyShortcuts?: string;
  searchInputRef?: Ref<HTMLInputElement>;
  selectionBarProps?: LibrarySelectionBarProps | null;
  selectionMode: boolean;
  sort: LibrarySort;
  title: string;
  view: LibraryView;
};

const viewOptions: Array<{
  icon: ReactNode;
  label: string;
  value: LibraryView;
}> = [
  {
    icon: <Grid2x2 aria-hidden="true" />,
    label: "Grid",
    value: "grid",
  },
  {
    icon: <List aria-hidden="true" />,
    label: "List",
    value: "list",
  },
];

export function LibraryToolbar({
  filters,
  filterOptions,
  isImporting,
  isRescanning,
  onClearFilters,
  onClearSearch,
  onFilterChange,
  onOpenAddEpub,
  onQueryChange,
  onRescan,
  onSortChange,
  onToggleSelectionMode,
  onViewChange,
  query,
  resultCount,
  searchAriaKeyShortcuts,
  searchInputRef,
  selectionBarProps,
  selectionMode,
  sort,
  title,
  view,
}: LibraryToolbarProps) {
  return (
    <header
      className={selectionMode ? "library-header relative z-5" : "library-header"}
      data-selection-mode={selectionMode ? "true" : undefined}
    >
      <div className="library-header__primary-row relative grid col-span-full grid-cols-[minmax(180px,1fr)_auto] items-end gap-collection-header-gap min-w-0 collection-viewport-stacked:grid-cols-1 collection-header-stacked:grid-cols-[minmax(0,1fr)]">
        <div
          aria-hidden={selectionMode || undefined}
          className={`library-header__title ${selectionMode ? "invisible pointer-events-none" : ""}`}
        >
          <p className="eyebrow">Your collection</p>
          <h1>{title}</h1>
        </div>

        <div
          aria-hidden={selectionMode || undefined}
          className={`library-header__actions ${selectionMode ? "invisible pointer-events-none" : ""}`}
        >
          <div aria-label="Library search" className="library-search" role="search">
            <Input
              aria-keyshortcuts={searchAriaKeyShortcuts}
              icon={<Search aria-hidden="true" />}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              label="Search library"
              name="archeion-library-search"
              placeholder="Search books"
              ref={searchInputRef}
              size="standard"
              spellCheck={false}
              value={query}
              onChange={(event) => onQueryChange(event.currentTarget.value)}
              type="search"
            />
            {query ? (
              <IconButton
                className="library-search__clear"
                label="Clear search"
                onClick={onClearSearch}
              >
                <X aria-hidden="true" />
              </IconButton>
            ) : null}
          </div>
          <div
            className="library-header__utilities inline-flex items-center gap-[2px] min-h-control-standard p-px border-standard border-solid border-line rounded-control bg-surface [--library-utility-child-radius:calc(var(--radius-control)-1px-var(--border-width))]"
            aria-label="Library utilities"
            role="group"
          >
            <IconButton
              aria-pressed={selectionMode}
              className="library-select-button size-control-compact rounded-[var(--library-utility-child-radius)] aria-pressed:border-line-strong aria-pressed:text-text-strong aria-pressed:bg-surface-raised [&:not(:disabled):not([aria-disabled=true])]:cursor-pointer"
              label="Select books"
              onClick={onToggleSelectionMode}
              tooltip={selectionMode ? "Finish selecting books" : "Select books"}
              tooltipPlacement="bottom"
            >
              <SquareCheckBig aria-hidden="true" />
            </IconButton>
            <RescanArchiveButton isRescanning={isRescanning} onRescan={onRescan} />
          </div>
          <span aria-hidden="true" className="library-header__action-divider" />
          <Button
            busy={isImporting}
            className="library-add-button rounded-control [&:not(:disabled):not([aria-disabled=true])]:cursor-pointer"
            disabled={isImporting}
            icon={<Plus aria-hidden="true" strokeWidth={2.25} />}
            onClick={onOpenAddEpub}
            size="standard"
          >
            Add EPUB
          </Button>
        </div>

        {selectionBarProps ? (
          <div className="library-header__selection-row absolute z-1 inset-0 flex items-center min-w-0">
            <LibrarySelectionBar {...selectionBarProps} />
          </div>
        ) : null}
      </div>

      <div className="library-header__control-group col-span-full grid gap-[10px] collection-viewport-stacked:row-start-2">
        <div className="library-controls">
          <div className="library-controls__filters flex items-center gap-[10px]">
            <LibraryFilterPopover
              filters={filters}
              onChange={onFilterChange}
              onClear={onClearFilters}
              options={filterOptions}
            />
            <span
              className="library-result-count"
              aria-label={`${resultCount} ${resultCount === 1 ? "book" : "books"} shown`}
              aria-live="polite"
            >
              {resultCount} {resultCount === 1 ? "book" : "books"}
            </span>
          </div>
          <div className="library-controls__display">
            <AppSelect
              ariaLabel="Sort library"
              className="library-sort-select min-w-[178px]"
              onChange={onSortChange}
              options={librarySortOptions}
              value={sort}
            />
            <SegmentedControl
              appearance="icon-only"
              label="Library view"
              onChange={onViewChange}
              options={viewOptions}
              value={view}
            />
          </div>
        </div>
        <LibraryFilterTokens filters={filters} onChange={onFilterChange} />
      </div>
    </header>
  );
}
