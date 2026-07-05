import {
  CaretDown,
  GridFour,
  List,
  MagnifyingGlass,
} from "@phosphor-icons/react";

import { IconButton } from "../../components/IconButton";
import { Input } from "../../components/Input";
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
        <Input
          icon={<MagnifyingGlass aria-hidden="true" size={18} weight="regular" />}
          label="Search library"
          placeholder="Search books"
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          type="search"
        />
        {storageSource === "vault" ? (
          <RescanVaultButton onError={onRescanError} />
        ) : (
          <ImportButton disabled={isImporting} onFiles={onFiles} />
        )}
      </div>

      <div className="library-controls">
        <label className="sort-control">
          <span className="sr-only">Sort library</span>
          <select
            value={sort}
            onChange={(event) =>
              onSortChange(event.currentTarget.value as LibrarySort)
            }
          >
            <option value="recently-added">Recently added</option>
            <option value="recently-opened">Recently opened</option>
            <option value="title">Title</option>
            <option value="author">Author</option>
          </select>
          <CaretDown aria-hidden="true" size={13} weight="bold" />
        </label>
        <div className="view-toggle" aria-label="Library view">
          <IconButton
            label="Grid view"
            aria-pressed={view === "grid"}
            onClick={() => onViewChange("grid")}
          >
            <GridFour
              aria-hidden="true"
              size={17}
              weight={view === "grid" ? "fill" : "regular"}
            />
          </IconButton>
          <IconButton
            label="List view"
            aria-pressed={view === "list"}
            onClick={() => onViewChange("list")}
          >
            <List
              aria-hidden="true"
              size={18}
              weight={view === "list" ? "bold" : "regular"}
            />
          </IconButton>
        </div>
      </div>
    </header>
  );
}
