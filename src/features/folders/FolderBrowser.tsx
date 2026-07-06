import {
  Folder as FolderIcon,
  GridFour,
  List,
  MagnifyingGlass,
  X,
} from "@phosphor-icons/react";
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { IconButton } from "../../components/IconButton";
import { Input } from "../../components/Input";
import { SegmentedControl } from "../../components/SegmentedControl";
import type { Folder } from "../../types/folder";
import {
  formatFolderBookCount,
  getFolderDisplayPath,
} from "./folderTreeUtils";

type FolderBrowserView = "list" | "cards";

type FolderBrowserProps = {
  bookCounts: Map<string, number>;
  folders: Folder[];
  onOpen: (folder: Folder) => void;
};

const folderViewOptions: Array<{
  icon: ReactNode;
  label: string;
  value: FolderBrowserView;
}> = [
  {
    icon: <List aria-hidden="true" size={18} weight="regular" />,
    label: "List",
    value: "list",
  },
  {
    icon: <GridFour aria-hidden="true" size={17} weight="regular" />,
    label: "Cards",
    value: "cards",
  },
];

export function FolderBrowser({
  bookCounts,
  folders,
  onOpen,
}: FolderBrowserProps) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<FolderBrowserView>("list");
  const visibleFolders = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) {
      return folders;
    }
    return folders.filter((folder) =>
      [folder.name, folder.relativePath].some((value) =>
        value?.toLocaleLowerCase().includes(normalized),
      ),
    );
  }, [folders, query]);

  return (
    <section className="folder-browser">
      <header className="folder-browser__header">
        <div className="folder-browser__title">
          <p className="eyebrow">Library folders</p>
          <h2>Folders</h2>
        </div>

        <div className="folder-browser__actions">
          <div className="library-search folder-browser__search">
            <Input
              icon={<MagnifyingGlass aria-hidden="true" size={17} />}
              label="Search folders"
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search folders"
              type="search"
              value={query}
            />
            {query ? (
              <IconButton
                className="library-search__clear"
                label="Clear folder search"
                onClick={() => setQuery("")}
              >
                <X aria-hidden="true" size={14} weight="bold" />
              </IconButton>
            ) : null}
          </div>
        </div>

        <div className="folder-browser__controls">
          <SegmentedControl
            className="folder-view-toggle"
            label="Folder view"
            onChange={setView}
            options={folderViewOptions}
            value={view}
          />
        </div>
      </header>

      {visibleFolders.length === 0 ? (
        <EmptyState
          action={
            query ? (
              <Button variant="secondary" onClick={() => setQuery("")}>
                Clear search
              </Button>
            ) : undefined
          }
          description={
            query
              ? "No folder matches that search."
              : "Folders from this library will appear here."
          }
          icon={<FolderIcon size={40} weight="thin" />}
          title={query ? "No folders found" : "No folders"}
        />
      ) : (
        <div
          className={`folder-browser__items folder-browser__items--${view}`}
        >
          {visibleFolders.map((folder) => {
            const displayPath = getFolderDisplayPath(folder);
            const bookCount = bookCounts.get(folder.id) ?? 0;

            return (
              <button
                className="folder-browser__item"
                key={folder.id}
                onClick={() => onOpen(folder)}
                type="button"
              >
                <span className="folder-browser__icon" aria-hidden="true">
                  <FolderIcon size={view === "cards" ? 22 : 19} />
                </span>
                <span className="folder-browser__copy">
                  <strong>{folder.name}</strong>
                  {displayPath ? <small>{displayPath}</small> : null}
                </span>
                <span className="folder-browser__count">
                  {formatFolderBookCount(bookCount)}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
