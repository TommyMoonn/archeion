import {
  ArrowDown,
  GridFour,
  List,
  MagnifyingGlass,
  Plus,
} from "@phosphor-icons/react";

import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { Input } from "../../components/Input";

export function LibraryToolbar() {
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
          title="Search will be available when books can be imported."
          type="search"
        />
        <Button
          disabled
          icon={<Plus aria-hidden="true" size={17} weight="bold" />}
          title="Importing will be available in the next phase."
        >
          Import books
        </Button>
      </div>

      <div className="library-controls">
        <button className="sort-control" type="button" disabled>
          <span>Recently added</span>
          <ArrowDown aria-hidden="true" size={14} weight="bold" />
        </button>
        <div className="view-toggle" aria-label="Library view">
          <IconButton label="Grid view" aria-pressed="true">
            <GridFour aria-hidden="true" size={17} weight="fill" />
          </IconButton>
          <IconButton label="List view" disabled>
            <List aria-hidden="true" size={18} weight="regular" />
          </IconButton>
        </div>
      </div>
    </header>
  );
}
