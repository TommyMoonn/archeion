import {
  Folder as FolderIcon,
  FolderPlus,
  GridFour,
  List,
  MagnifyingGlass,
  PencilSimple,
  X,
} from "@phosphor-icons/react";
import {
  memo,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type Ref,
} from "react";

import { AppSelect } from "../../components/AppSelect";
import {
  openContextMenuFromKeyboard,
  openContextMenuFromPointer,
  useContextMenuController,
} from "../../components/contextMenuController";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { IconButton } from "../../components/IconButton";
import { Input } from "../../components/Input";
import { SegmentedControl } from "../../components/SegmentedControl";
import type { ReadonlyFolder } from "../../types/folder";
import type { CollectionCardSize, FolderBrowserView, FolderSort } from "../../types/library";
import { FolderActionsMenu } from "./FolderActionsMenu";
import { folderMutationOwnerAttributes } from "./folderMutationFocus";
import {
  filterFolderBrowserEntries,
  sortFolderBrowserEntries,
  type FolderBrowserEntry,
} from "./folderBrowserReadModel";
import { folderSortOptions } from "./folderSortOptions";
import { formatFolderBookCount } from "./folderTreeUtils";

type FolderBrowserProps = {
  cardSize: CollectionCardSize;
  canManageFolders?: boolean;
  canRevealFolders?: boolean;
  entries: readonly FolderBrowserEntry[];
  isLoading: boolean;
  onCreate?: () => void;
  onDelete?: (folder: ReadonlyFolder) => void;
  onMove?: (folder: ReadonlyFolder) => void;
  onOpen: (folder: ReadonlyFolder) => void;
  onRename?: (folder: ReadonlyFolder) => void;
  onReveal?: (folder: ReadonlyFolder) => void;
  onSortChange: (sort: FolderSort) => void;
  onViewChange: (view: FolderBrowserView) => void;
  activeImportDropTargetId?: string | null;
  sort: FolderSort;
  view: FolderBrowserView;
  searchAriaKeyShortcuts?: string;
  searchInputRef?: Ref<HTMLInputElement>;
};

type FolderBrowserItemProps = {
  activeImportDropTargetId?: string | null;
  canRevealFolders: boolean;
  entry: FolderBrowserEntry;
  onDelete?: (folder: ReadonlyFolder) => void;
  onMove?: (folder: ReadonlyFolder) => void;
  onOpen: (folder: ReadonlyFolder) => void;
  onRename?: (folder: ReadonlyFolder) => void;
  onReveal?: (folder: ReadonlyFolder) => void;
  showFolderActions: boolean;
  view: FolderBrowserView;
};

const FolderBrowserItem = memo(function FolderBrowserItem({
  activeImportDropTargetId,
  canRevealFolders,
  entry: { bookCount, displayPath, folder },
  onDelete,
  onMove,
  onOpen,
  onRename,
  onReveal,
  showFolderActions,
  view,
}: FolderBrowserItemProps) {
  const contextMenu = useContextMenuController();
  const primaryActionRef = useRef<HTMLButtonElement>(null);

  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    if (!showFolderActions) return;
    openContextMenuFromPointer(contextMenu, event, primaryActionRef.current);
  }

  function handlePrimaryKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!showFolderActions) return;
    openContextMenuFromKeyboard(contextMenu, event);
  }

  return (
    <article
      className="folder-browser__item"
      {...folderMutationOwnerAttributes(folder, "browser")}
      data-import-drop-active={
        activeImportDropTargetId === `folder-browser:${folder.id}` || undefined
      }
      data-import-drop-destination={folder.relativePath}
      data-import-drop-id={`folder-browser:${folder.id}`}
      data-context-menu-open={contextMenu.isOpen || undefined}
      data-import-drop-target={folder.relativePath ? "true" : undefined}
      onContextMenu={handleContextMenu}
    >
      <button
        className="folder-browser__open"
        data-library-folder-primary-action
        onClick={() => onOpen(folder)}
        onKeyDown={handlePrimaryKeyDown}
        ref={primaryActionRef}
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
            controller={contextMenu}
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
});

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

export const FolderBrowser = memo(function FolderBrowser({
  cardSize,
  canManageFolders = false,
  canRevealFolders = false,
  entries,
  isLoading,
  onCreate,
  onDelete,
  onMove,
  onOpen,
  onRename,
  onReveal,
  onSortChange,
  onViewChange,
  activeImportDropTargetId,
  sort,
  view,
  searchAriaKeyShortcuts,
  searchInputRef,
}: FolderBrowserProps) {
  const [query, setQuery] = useState("");
  const visibleEntries = useMemo(
    () => sortFolderBrowserEntries(filterFolderBrowserEntries(entries, query), sort),
    [entries, query, sort],
  );
  const showFolderActions = Boolean(canManageFolders && onDelete && onMove && onRename);
  const surfaceState =
    visibleEntries.length > 0
      ? "results"
      : isLoading && entries.length === 0
        ? "loading"
        : query
          ? "search-empty"
          : "empty";
  const surfaceKey = `${view}:${sort}:${cardSize}:${surfaceState}`;

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
              aria-keyshortcuts={searchAriaKeyShortcuts}
              autoCapitalize="none"
              autoComplete="off"
              autoCorrect="off"
              label="Search folders"
              name="archeion-folder-search"
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search folders"
              ref={searchInputRef}
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
                Add folder
              </Button>
            </>
          ) : null}
        </div>

        <div className="library-controls folder-browser__controls">
          <span
            aria-label={`${visibleEntries.length} ${visibleEntries.length === 1 ? "folder" : "folders"} shown`}
            aria-live="polite"
            className="library-result-count"
          >
            {visibleEntries.length} {visibleEntries.length === 1 ? "folder" : "folders"}
          </span>
          <div className="library-controls__display">
            <AppSelect
              ariaLabel="Sort folders"
              className="folder-sort-select"
              onChange={onSortChange}
              options={folderSortOptions}
              value={sort}
            />
            <SegmentedControl
              appearance="icon-only"
              label="Folder view"
              onChange={onViewChange}
              options={folderViewOptions}
              value={view}
            />
          </div>
        </div>
      </header>

      <div
        aria-busy={surfaceState === "loading" || undefined}
        className="collection-content folder-browser__content"
        data-surface-state={surfaceState}
        key={surfaceKey}
      >
        {surfaceState === "loading" ? (
          <div className="collection-content__loading library-loading" role="status">
            Loading folders
          </div>
        ) : visibleEntries.length === 0 ? (
          <EmptyState
            action={
              query ? (
                <Button variant="secondary" onClick={() => setQuery("")}>
                  Clear search
                </Button>
              ) : canManageFolders && onCreate ? (
                <Button icon={<FolderPlus aria-hidden="true" weight="bold" />} onClick={onCreate}>
                  Add folder
                </Button>
              ) : undefined
            }
            description={
              query
                ? "No folder matches that search."
                : "Folders from this library will appear here."
            }
            icon={<FolderIcon size={40} weight="thin" />}
            title={query ? "No folders found" : "No folders yet"}
          />
        ) : (
          <div
            className={`folder-browser__items folder-browser__items--${view}`}
            data-folder-card-size={cardSize}
          >
            {visibleEntries.map((entry) => (
              <FolderBrowserItem
                activeImportDropTargetId={activeImportDropTargetId}
                canRevealFolders={canRevealFolders}
                entry={entry}
                key={entry.folder.id}
                onDelete={onDelete}
                onMove={onMove}
                onOpen={onOpen}
                onRename={onRename}
                onReveal={onReveal}
                showFolderActions={showFolderActions}
                view={view}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
});
