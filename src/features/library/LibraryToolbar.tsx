import type { ReactNode, Ref } from "react";

import { CheckSquare, GridFour, List, Plus, MagnifyingGlass, X } from "@phosphor-icons/react";

import { AppSelect } from "../../components/AppSelect";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { Input } from "../../components/Input";
import { SegmentedControl } from "../../components/SegmentedControl";
import { RescanArchiveButton } from "../archive/RescanArchiveButton";
import type { LibraryFilterState, LibrarySort, LibraryView } from "../../types/library";
import { LibraryFilterPopover, LibraryFilterTokens } from "./LibraryFilterPopover";
import type { LibraryFilterOptions } from "./libraryFilters";
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
    icon: <GridFour aria-hidden="true" weight="regular" />,
    label: "Grid",
    value: "grid",
  },
  {
    icon: <List aria-hidden="true" weight="regular" />,
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
  selectionMode,
  sort,
  title,
  view,
}: LibraryToolbarProps) {
  return (
    <header className="library-header">
      <div className="library-header__title">
        <p className="eyebrow">Your collection</p>
        <h1>{title}</h1>
      </div>

      <div className="library-header__actions">
        <div className="library-search">
          <Input
            aria-keyshortcuts={searchAriaKeyShortcuts}
            icon={<MagnifyingGlass aria-hidden="true" weight="regular" />}
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
              <X aria-hidden="true" weight="bold" />
            </IconButton>
          ) : null}
        </div>
        <div className="library-header__utilities" aria-label="Library utilities" role="group">
          <IconButton
            aria-pressed={selectionMode}
            className="library-select-button"
            label={selectionMode ? "Finish selecting books" : "Select books"}
            onClick={onToggleSelectionMode}
            tooltip={selectionMode ? "Finish selecting books" : "Select books"}
            tooltipPlacement="bottom"
          >
            <CheckSquare aria-hidden="true" weight={selectionMode ? "fill" : "regular"} />
          </IconButton>
          <RescanArchiveButton isRescanning={isRescanning} onRescan={onRescan} />
        </div>
        <span aria-hidden="true" className="library-header__action-divider" />
        <Button
          busy={isImporting}
          className="library-add-button"
          disabled={isImporting}
          icon={<Plus aria-hidden="true" weight="bold" />}
          onClick={onOpenAddEpub}
          size="standard"
        >
          Add EPUB
        </Button>
      </div>

      <div className="library-controls">
        <div className="library-controls__filters">
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
            className="library-sort-select"
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
    </header>
  );
}
