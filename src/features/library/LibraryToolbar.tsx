import type { ReactNode } from "react";

import {
  GridFour,
  List,
  MagnifyingGlass,
  X,
} from "@phosphor-icons/react";

import { AppSelect } from "../../components/AppSelect";
import { IconButton } from "../../components/IconButton";
import { Input } from "../../components/Input";
import { SegmentedControl } from "../../components/SegmentedControl";
import { ImportButton } from "../import/ImportButton";
import { RescanVaultButton } from "../vault/RescanVaultButton";
import type { LibrarySort } from "./libraryFilters";

export type LibraryView = "grid" | "list";

type LibraryToolbarProps = {
  isImporting: boolean;
  onFiles: (files: File[]) => void;
  onQueryChange: (query: string) => void;
  onRescanError: () => void;
  onSortChange: (sort: LibrarySort) => void;
  onViewChange: (view: LibraryView) => void;
  query: string;
  sort: LibrarySort;
  title: string;
  view: LibraryView;
  storageSource: "indexeddb" | "vault";
};

const sortOptions: Array<{ label: string; value: LibrarySort }> = [
  { label: "Recently discovered", value: "recently-added" },
  { label: "Recently opened", value: "recently-opened" },
  { label: "Title", value: "title" },
  { label: "Author", value: "author" },
  { label: "Folder path", value: "folder" },
];

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
  isImporting,
  onFiles,
  onQueryChange,
  onRescanError,
  onSortChange,
  onViewChange,
  query,
  sort,
  title,
  view,
  storageSource,
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
            icon={
              <MagnifyingGlass
                aria-hidden="true"
                size={18}
                weight="regular"
              />
            }
            label="Search library"
            placeholder="Search books"
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            type="search"
          />
          {query ? (
            <IconButton
              className="library-search__clear"
              label="Clear search"
              onClick={() => onQueryChange("")}
            >
              <X aria-hidden="true" size={14} weight="bold" />
            </IconButton>
          ) : null}
        </div>
        {storageSource === "vault" ? (
          <RescanVaultButton onError={onRescanError} />
        ) : (
          <ImportButton disabled={isImporting} onFiles={onFiles} />
        )}
      </div>

      <div className="library-controls">
        <AppSelect
          ariaLabel="Sort library"
          className="library-sort-select"
          onChange={onSortChange}
          options={sortOptions}
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
    </header>
  );
}
