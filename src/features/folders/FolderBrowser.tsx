import {
  Folder as FolderIcon,
  FolderPlus,
  GridFour,
  List,
  MagnifyingGlass,
  PencilSimple,
  X,
} from "@phosphor-icons/react";
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { IconButton } from "../../components/IconButton";
import { Input } from "../../components/Input";
import { SegmentedControl } from "../../components/SegmentedControl";
import type { Folder } from "../../types/folder";
import { FolderActionsMenu } from "./FolderActionsMenu";
import { searchFolders } from "./folderSearch";
import {
  formatFolderBookCount,
  getFolderDisplayPath,
} from "./folderTreeUtils";

type FolderBrowserView = "list" | "cards";

type FolderBrowserProps = {
  bookCounts: Map<string, number>;
  canManageFolders?: boolean;
  canRevealFolders?: boolean;
  folders: Folder[];
  onCreate?: () => void;
  onDelete?: (folder: Folder) => void;
  onMove?: (folder: Folder) => void;
  onOpen: (folder: Folder) => void;
  onRename?: (folder: Folder) => void;
  onReveal?: (folder: Folder) => void;
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
  canManageFolders = false,
  canRevealFolders = false,
  folders,
  onCreate,
  onDelete,
  onMove,
  onOpen,
  onRename,
  onReveal,
}: FolderBrowserProps) {
  const [query, setQuery] = useState("");
  const [view, setView] = useState<FolderBrowserView>("list");
  const visibleFolders = useMemo(
    () => searchFolders(folders, query),
    [folders, query],
  );
  const showFolderActions = Boolean(
    canManageFolders && onDelete && onMove && onRename,
  );

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
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              label="Search folders"
              name="archeion-folder-search"
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search folders"
              spellCheck={false}
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
          {canManageFolders && onCreate ? (
            <Button
              icon={<FolderPlus aria-hidden="true" size={17} weight="bold" />}
              onClick={onCreate}
            >
              New folder
            </Button>
          ) : null}
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
            ) : canManageFolders && onCreate ? (
              <Button
                icon={<FolderPlus aria-hidden="true" size={17} weight="bold" />}
                onClick={onCreate}
              >
                New folder
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
              <article className="folder-browser__item" key={folder.id}>
                <button
                  className="folder-browser__open"
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
                {showFolderActions && onDelete && onMove && onRename ? (
                  <span className="folder-browser__item-actions">
                    <IconButton
                      className="folder-browser__rename"
                      label={`Rename ${folder.name}`}
                      onClick={() => onRename(folder)}
                    >
                      <PencilSimple aria-hidden="true" size={16} />
                    </IconButton>
                    <FolderActionsMenu
                      folder={folder}
                      onDelete={onDelete}
                      onMove={onMove}
                      onReveal={onReveal}
                      showRename={false}
                      showReveal={canRevealFolders}
                    />
                  </span>
                ) : null}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
