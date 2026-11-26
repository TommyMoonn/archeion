import { cn } from "../../utils/cn";
import { collectionHeader, collectionContent } from "../../components/collectionPresentation";
import { CollectionLoading } from "../../components/CollectionLoading";
import { Folder as FolderIcon, FolderPlus, Grid2x2, List, Search, Pencil, X } from "lucide-react";
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
  cardSize: CollectionCardSize;
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
  cardSize,
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
  const cards = view === "cards";
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
      className={[
        "folder-browser__item group/folder relative min-w-0 text-muted data-[context-menu-open]:z-3",
        !cards && "border-0 border-b border-solid border-line",
      ]
        .filter(Boolean)
        .join(" ")}
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
        className={[
          "folder-browser__open grid items-center gap-folder-grid-gap w-full text-inherit text-start cursor-pointer transition-select hover:text-text hover:bg-surface focus-visible:text-text focus-visible:bg-surface group-data-[import-drop-active=true]/folder:text-text-strong group-data-[import-drop-active=true]/folder:bg-accent-soft group-data-[import-drop-active=true]/folder:border-folder-drop group-data-[import-drop-active=true]/folder:folder-browser-drop-ring group-data-[context-menu-open]/folder:border-line-strong group-data-[context-menu-open]/folder:bg-surface",
          cards
            ? "folder-card-columns content-start pe-folder-card-actions border-standard border-solid border-line rounded-card bg-folder-card hover:border-line-strong focus-visible:border-line-strong"
            : "folder-row-columns border-none bg-transparent min-h-folder-row-height py-0 ps-folder-list-inset pe-folder-row-actions",
          cards &&
            (cardSize === "small"
              ? "min-h-folder-card-small-height py-folder-card-small-inset ps-folder-card-small-inset"
              : cardSize === "large"
                ? "min-h-folder-card-large-height py-folder-card-large-inset ps-folder-card-large-inset"
                : "min-h-folder-card-medium-height py-folder-card-medium-inset ps-folder-card-medium-inset"),
        ]
          .filter(Boolean)
          .join(" ")}
        data-library-folder-primary-action
        onClick={() => onOpen(folder)}
        onKeyDown={handlePrimaryKeyDown}
        ref={primaryActionRef}
        type="button"
      >
        <span
          className="folder-browser__icon grid size-folder-icon-box place-items-center rounded-control text-accent bg-accent-soft"
          aria-hidden="true"
        >
          <FolderIcon className={cards ? "size-folder-card-glyph" : "size-folder-list-glyph"} />
        </span>
        <span className="folder-browser__copy grid min-w-0 gap-folder-copy-gap">
          <strong className="truncate text-text-strong text-body leading-inherit font-semibold">
            {folder.name}
          </strong>
          {displayPath ? (
            <small className="truncate text-muted text-caption leading-inherit">
              {displayPath}
            </small>
          ) : null}
        </span>
        <span
          className={`folder-browser__count text-muted text-meta leading-inherit tabular-nums whitespace-nowrap ${cards ? "col-span-full self-end justify-self-start mt-folder-count-gap" : ""}`}
        >
          {formatFolderBookCount(bookCount)}
        </span>
      </button>
      {showFolderActions && onDelete && onMove && onRename ? (
        <span
          className={`folder-browser__item-actions absolute z-2 flex items-center gap-folder-action-gap ${cards ? "top-folder-inset end-folder-inset" : "top-1/2 end-control-gap -translate-y-1/2"}`}
        >
          <IconButton
            className="folder-browser__rename control-enabled:cursor-pointer"
            label={`Rename ${folder.name}`}
            onClick={() => onRename(folder)}
          >
            <Pencil aria-hidden="true" />
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
    icon: <Grid2x2 aria-hidden="true" />,
    label: "Cards",
    value: "cards",
  },
  {
    icon: <List aria-hidden="true" />,
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
    <section
      aria-labelledby="folder-browser-title"
      className="folder-browser mx-auto w-full min-w-0 max-w-collection-workspace"
    >
      <header className={cn(collectionHeader.root, "folder-browser__header w-full min-w-0")}>
        <div className="library-header__title folder-browser__title">
          <p className={collectionHeader.eyebrow}>Library folders</p>
          <h1 className={collectionHeader.title} id="folder-browser-title">
            Folders
          </h1>
        </div>

        <div
          className={`${collectionHeader.actions} ${collectionHeader.actionsPrimary} folder-browser__actions min-w-0 max-w-full`}
        >
          <div
            aria-label="Folder search"
            className={`${collectionHeader.search} folder-browser__search`}
            role="search"
          >
            <Input
              icon={<Search aria-hidden="true" />}
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
                className={collectionHeader.clear}
                label="Clear folder search"
                onClick={() => setQuery("")}
              >
                <X aria-hidden="true" />
              </IconButton>
            ) : null}
          </div>
          {canManageFolders && onCreate ? (
            <>
              <span aria-hidden="true" className={collectionHeader.divider} />
              <Button
                className="folder-browser__add-button rounded-control control-enabled:cursor-pointer"
                icon={<FolderPlus aria-hidden="true" />}
                onClick={onCreate}
                size="standard"
              >
                Add folder
              </Button>
            </>
          ) : null}
        </div>

        <div
          className={`${collectionHeader.controls} folder-browser__controls box-border w-full min-w-0 max-w-none`}
        >
          <span
            aria-label={`${visibleEntries.length} ${visibleEntries.length === 1 ? "folder" : "folders"} shown`}
            aria-live="polite"
            className={collectionHeader.count}
          >
            {visibleEntries.length} {visibleEntries.length === 1 ? "folder" : "folders"}
          </span>
          <div
            className={`${collectionHeader.display} flex-initial flex-nowrap min-w-0 max-w-full justify-end [&>.segmented-control]:flex-none`}
          >
            <AppSelect
              ariaLabel="Sort folders"
              className="folder-sort-select folder-sort-basis min-w-select-trigger max-w-full"
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
        className={`${collectionContent} folder-browser__content w-full min-w-0`}
        data-surface-state={surfaceState}
        key={surfaceKey}
      >
        {surfaceState === "loading" ? (
          <CollectionLoading message={"Loading folders"} />
        ) : visibleEntries.length === 0 ? (
          <EmptyState
            action={
              query ? (
                <Button
                  className="control-enabled:cursor-pointer"
                  variant="secondary"
                  onClick={() => setQuery("")}
                >
                  Clear search
                </Button>
              ) : undefined
            }
            description={
              query
                ? "No folder matches that search."
                : "Folders from this library will appear here."
            }
            icon={query ? undefined : <FolderIcon strokeWidth={1.5} />}
            title={query ? "No folders found" : "No folders yet"}
          />
        ) : (
          <div
            className={[
              `folder-browser__items folder-browser__items--${view} collection-content__items grid`,
              view === "list" ? "grid-cols-1" : "gap-folder-grid-gap",
              view === "cards" &&
                (cardSize === "small"
                  ? "folder-card-grid-small"
                  : cardSize === "large"
                    ? "folder-card-grid-large"
                    : "folder-card-grid-medium page-narrow:grid-cols-2 page-mobile:grid-cols-1"),
            ]
              .filter(Boolean)
              .join(" ")}
            data-folder-card-size={cardSize}
          >
            {visibleEntries.map((entry) => (
              <FolderBrowserItem
                activeImportDropTargetId={activeImportDropTargetId}
                canRevealFolders={canRevealFolders}
                cardSize={cardSize}
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
