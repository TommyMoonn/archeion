import type { ReactNode, Ref } from "react";

import { CheckSquare, GridFour, List, Plus, MagnifyingGlass, X } from "@phosphor-icons/react";

import { AppSelect } from "../../components/AppSelect";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { Input } from "../../components/Input";
import { SegmentedControl } from "../../components/SegmentedControl";
import { RescanArchiveButton } from "../archive/RescanArchiveButton";
import type { LibraryFilterState } from "../../types/library";
import { LibraryFilterPopover, LibraryFilterTokens } from "./LibraryFilterPopover";
import type { LibraryFilterOptions } from "./libraryFilters";
import type { LibrarySort } from "./libraryFilters";
import { librarySortOptions } from "./librarySortOptions";

export type LibraryView = "grid" | "list";

type LibraryToolbarProps = {
  filters: LibraryFilterState;
  filterOptions: LibraryFilterOptions;
  isImporting: boolean;
  onClearFilters: () => void;
  onClearSearch: () => void;
  onFilterChange: (filters: LibraryFilterState) => void;
  onOpenAddEpub: () => void;
  onQueryChange: (query: string) => void;
  onRescanError: () => void;
  onRescanSuccess: () => void;
  onSortChange: (sort: LibrarySort) => void;
  onToggleSelectionMode: () => void;
  onViewChange: (view: LibraryView) => void;
  query: string;
  resultCount: number;
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
    icon: <GridFour aria-hidden="true" size={17} weight="regular" />,
    label: "Grid",
    value: "grid",
  },
  {
    icon: <List aria-hidden="true" size={18} weight="regular" />,
    label: "List",
    value: "list",
  },
];

export function LibraryToolbar({
  filters,
  filterOptions,
  isImporting,
  onClearFilters,
  onClearSearch,
  onFilterChange,
  onOpenAddEpub,
  onQueryChange,
  onRescanError,
  onRescanSuccess,
  onSortChange,
  onToggleSelectionMode,
  onViewChange,
  query,
  resultCount,
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
            icon={<MagnifyingGlass aria-hidden="true" size={18} weight="regular" />}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            label="Search library"
            name="archeion-library-search"
            placeholder="Search books"
            ref={searchInputRef}
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
              <X aria-hidden="true" size={14} weight="bold" />
            </IconButton>
          ) : null}
        </div>
        <IconButton
          aria-pressed={selectionMode}
          className="library-select-button"
          label={selectionMode ? "Finish selecting books" : "Select books"}
          onClick={onToggleSelectionMode}
        >
          <CheckSquare aria-hidden="true" size={17} weight={selectionMode ? "fill" : "regular"} />
        </IconButton>
        <RescanArchiveButton onError={onRescanError} onSuccess={onRescanSuccess} />
        <Button
          className="library-add-button"
          disabled={isImporting}
          icon={<Plus aria-hidden="true" size={17} weight="bold" />}
          onClick={onOpenAddEpub}
        >
          {isImporting ? "Adding" : "Add EPUB"}
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
          >
            {resultCount}
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
            className="library-view-toggle"
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
