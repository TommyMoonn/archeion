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
import type { FolderBrowserView } from "../../types/library";
import { FolderActionsMenu } from "./FolderActionsMenu";
import { folderMutationOwnerAttributes } from "./folderMutationFocus";
import { searchFolders } from "./folderSearch";
import { formatFolderBookCount, getFolderDisplayPath } from "./folderTreeUtils";

type FolderBrowserProps = {
  bookCounts: ReadonlyMap<string, number>;
  canManageFolders?: boolean;
  canRevealFolders?: boolean;
  folders: Folder[];
  onCreate?: () => void;
  onDelete?: (folder: Folder) => void;
  onMove?: (folder: Folder) => void;
  onOpen: (folder: Folder) => void;
  onRename?: (folder: Folder) => void;
  onReveal?: (folder: Folder) => void;
  onViewChange?: (view: FolderBrowserView) => void;
  activeImportDropTargetId?: string | null;
  view?: FolderBrowserView;
};

const folderViewOptions: Array<{
  icon: ReactNode;
  label: string;
  value: FolderBrowserView;
}> = [
  {
    icon: <GridFour aria-hidden="true" weight="regular" />,
    label: "Cards",
    value: "cards",
  },
  {
    icon: <List aria-hidden="true" weight="regular" />,
    label: "List",
    value: "list",
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
  onViewChange,
  activeImportDropTargetId,
  view: controlledView,
}: FolderBrowserProps) {
  const [query, setQuery] = useState("");
  const [localView, setLocalView] = useState<FolderBrowserView>("list");
  const view = controlledView ?? localView;
  const changeView = onViewChange ?? setLocalView;
  const visibleFolders = useMemo(() => searchFolders(folders, query), [folders, query]);
  const showFolderActions = Boolean(canManageFolders && onDelete && onMove && onRename);
  const surfaceState = visibleFolders.length > 0 ? "results" : query ? "search-empty" : "empty";
  const surfaceKey = `${view}:${surfaceState}`;

  return (
    <section className="folder-browser">
      <header className="library-header folder-browser__header">
        <div className="library-header__title folder-browser__title">
          <p className="eyebrow">Library folders</p>
          <h2>Folders</h2>
        </div>

        <div className="library-header__actions library-header__actions--primary-only folder-browser__actions">
          <div className="library-search folder-browser__search">
            <Input
              icon={<MagnifyingGlass aria-hidden="true" />}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              label="Search folders"
              name="archeion-folder-search"
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search folders"
              size="standard"
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
                <X aria-hidden="true" weight="bold" />
              </IconButton>
            ) : null}
          </div>
          {canManageFolders && onCreate ? (
            <>
              <span aria-hidden="true" className="library-header__action-divider" />
              <Button
                className="folder-browser__add-button"
                icon={<FolderPlus aria-hidden="true" weight="bold" />}
                onClick={onCreate}
                size="standard"
              >
                Add Folder
              </Button>
            </>
          ) : null}
        </div>

        <div className="library-controls folder-browser__controls">
          <span
            aria-label={`${visibleFolders.length} ${visibleFolders.length === 1 ? "folder" : "folders"} shown`}
            aria-live="polite"
            className="library-result-count"
          >
            {visibleFolders.length} {visibleFolders.length === 1 ? "folder" : "folders"}
          </span>
          <div className="library-controls__display">
            <SegmentedControl
              appearance="icon-only"
              label="Folder view"
              onChange={changeView}
              options={folderViewOptions}
              value={view}
            />
          </div>
        </div>
      </header>

      {visibleFolders.length === 0 ? (
        <EmptyState
          key={surfaceKey}
          action={
            query ? (
              <Button variant="secondary" onClick={() => setQuery("")}>
                Clear search
              </Button>
            ) : canManageFolders && onCreate ? (
              <Button icon={<FolderPlus aria-hidden="true" weight="bold" />} onClick={onCreate}>
                Add Folder
              </Button>
            ) : undefined
          }
          description={
            query ? "No folder matches that search." : "Folders from this library will appear here."
          }
          icon={<FolderIcon size={40} weight="thin" />}
          title={query ? "No folders found" : "No folders"}
        />
      ) : (
        <div
          className={`folder-browser__items folder-browser__items--${view}`}
          data-surface-state={surfaceState}
          key={surfaceKey}
        >
          {visibleFolders.map((folder) => {
            const displayPath = getFolderDisplayPath(folder);
            const bookCount = bookCounts.get(folder.id) ?? 0;

            return (
              <article
                className="folder-browser__item"
                {...folderMutationOwnerAttributes(folder, "browser")}
                data-import-drop-active={
                  activeImportDropTargetId === `folder-browser:${folder.id}` || undefined
                }
                data-import-drop-destination={folder.relativePath}
                data-import-drop-id={`folder-browser:${folder.id}`}
                data-import-drop-target={folder.relativePath ? "true" : undefined}
                key={folder.id}
              >
                <button
                  className="folder-browser__open"
                  data-library-folder-primary-action
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
                  <span className="folder-browser__count">{formatFolderBookCount(bookCount)}</span>
                </button>
                {showFolderActions && onDelete && onMove && onRename ? (
                  <span className="folder-browser__item-actions">
                    <IconButton
                      className="folder-browser__rename"
                      label={`Rename ${folder.name}`}
                      onClick={() => onRename(folder)}
                    >
                      <PencilSimple aria-hidden="true" />
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
