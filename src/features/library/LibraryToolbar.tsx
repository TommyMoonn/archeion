import {
  ArrowDown,
  GridFour,
  List,
  MagnifyingGlass,
} from "@phosphor-icons/react";

import { IconButton } from "../../components/IconButton";
import { Input } from "../../components/Input";
import { ImportButton } from "../import/ImportButton";

type LibraryToolbarProps = {
  isImporting: boolean;
  onFiles: (files: File[]) => void;
};

export function LibraryToolbar({
  isImporting,
  onFiles,
}: LibraryToolbarProps) {
  return (
    <header className="library-header">
      <div className="library-header__title">
        <p className="eyebrow">Your collection</p>
        <h1>Library</h1>
      </div>

      <div className="library-header__actions">
        <Input
          disabled
          icon={<MagnifyingGlass aria-hidden="true" size={18} weight="regular" />}
          label="Search library"
          placeholder="Search books"
          title="Search is not available yet."
          type="search"
        />
        <ImportButton disabled={isImporting} onFiles={onFiles} />
      </div>

      <div className="library-controls">
        <button
          className="sort-control"
          type="button"
          disabled
          title="Sorting is not available yet."
        >
          <span>Recently added</span>
          <ArrowDown aria-hidden="true" size={14} weight="bold" />
        </button>
        <div className="view-toggle" aria-label="Library view">
          <IconButton label="Grid view" aria-pressed="true">
            <GridFour aria-hidden="true" size={17} weight="fill" />
          </IconButton>
          <IconButton
            label="List view"
            disabled
            title="List view is not available yet."
          >
            <List aria-hidden="true" size={18} weight="regular" />
          </IconButton>
        </div>
      </div>
    </header>
  );
}
