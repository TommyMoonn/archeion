import {
  Archive,
  LibraryBig,
  ChevronsUpDown,
  Check,
  Folders,
  FolderOpen,
  Settings,
  Heart,
  Plus,
  CircleQuestionMark,
  ArrowUpDown,
  Layers,
} from "lucide-react";
import {
  memo,
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";

import { flushSync } from "react-dom";

import { LibraryPanelResizeHandle } from "./LibraryPanelResizeHandle";
import { AppSelect } from "../../components/AppSelect";
import { IconButton } from "../../components/IconButton";
import { PrimitiveMenuItem } from "../../components/MenuItem";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../../components/ui/dropdown-menu";
import { focusElementIfUsable } from "../../utils/focusRestoration";
import { registerTransientSurface } from "../../utils/transientSurfaceOwnership";
import { Tooltip } from "../../components/Tooltip";
import type { KnownArchive } from "../../types/archive";
import type { ReadonlyFolder } from "../../types/folder";
import type { FolderSort, LibraryLocation } from "../../types/library";
import { FolderTree } from "../folders/FolderTree";
import {
  sortFolderBrowserEntries,
  type FolderBrowserEntry,
} from "../folders/folderBrowserReadModel";
import { folderSortOptions } from "../folders/folderSortOptions";
import { ARCHIVE_ROOT_DESTINATION } from "../filesystem/archiveImport";
import {
  LIBRARY_SIDEBAR_DEFAULT_WIDTH,
  LIBRARY_SIDEBAR_MAX_WIDTH,
  LIBRARY_SIDEBAR_MIN_WIDTH,
} from "./useLibrarySidebarState";

const navigationClassName =
  "nav-item group grid sidebar-nav-columns sidebar-nav-width max-w-full min-w-0 items-center gap-input-gap min-h-control-standard sidebar-nav-padding border-0 rounded-control text-muted bg-transparent text-body font-normal text-start no-underline cursor-pointer transition-colors hover:not-disabled:text-text hover:not-disabled:bg-surface-shell-hover aria-[current=page]:text-text-strong aria-[current=page]:bg-surface-shell-active data-import-drop-active:text-text-strong data-import-drop-active:bg-accent-soft data-import-drop-active:shadow-sidebar-drop page-compact:min-h-field-standard group-data-collapsed/sidebar:sidebar-nav-collapsed-columns group-data-collapsed/sidebar:justify-self-start group-data-collapsed/sidebar:justify-start group-data-collapsed/sidebar:gap-0 group-data-collapsed/sidebar:px-0 page-mobile:sidebar-nav-mobile-flex page-mobile:w-auto page-mobile:max-w-none";

function CollapsedSidebarTooltip({
  children,
  collapsed,
  content,
}: {
  children: ReactElement;
  collapsed: boolean;
  content: string;
}) {
  return (
    <Tooltip content={collapsed ? content : ""} placement="right">
      {children}
    </Tooltip>
  );
}

type LibrarySidebarProps = {
  activeArchive: KnownArchive;
  archives: KnownArchive[];
  collapsed: boolean;
  expandedContentRef: RefObject<HTMLDivElement | null>;
  navigationRef?: RefObject<HTMLElement | null>;
  folderEntries: readonly FolderBrowserEntry[];
  location: LibraryLocation;
  canManageFolders?: boolean;
  onCreateFolder: () => void;
  onDeleteFolder: (folder: ReadonlyFolder) => void;
  onManageArchives: () => void;
  onRevealArchive: () => void;
  revealArchiveDisabledReason?: string;
  onMoveFolder: (folder: ReadonlyFolder) => void;
  onLocationChange: (location: LibraryLocation) => void;
  onOpenAbout: () => void;
  onOpenSettings: () => void;
  onRenameFolder: (folder: ReadonlyFolder) => void;
  onRevealFolder?: (folder: ReadonlyFolder) => void;
  folderSort: FolderSort;
  onFolderSortChange: (sort: FolderSort) => void;
  onSwitchArchive: (archive: KnownArchive) => void;
  settingsAriaKeyShortcuts?: string;
  canRevealFolders?: boolean;
  activeImportDropTargetId?: string | null;
  resizable?: boolean;
  width?: number;
  onWidthChange?: (width: number) => void;
  onWidthCommit?: (width: number) => void;
};

export const LibrarySidebar = memo(function LibrarySidebar({
  activeArchive,
  archives,
  collapsed,
  expandedContentRef,
  navigationRef,
  folderEntries,
  location,
  canManageFolders = true,
  onCreateFolder,
  onDeleteFolder,
  onManageArchives,
  onRevealArchive,
  revealArchiveDisabledReason,
  onMoveFolder,
  onLocationChange,
  onOpenAbout,
  onOpenSettings,
  onRenameFolder,
  onRevealFolder,
  folderSort,
  onFolderSortChange,
  onSwitchArchive,
  settingsAriaKeyShortcuts,
  canRevealFolders = false,
  activeImportDropTargetId,
  resizable = false,
  width = LIBRARY_SIDEBAR_DEFAULT_WIDTH,
  onWidthChange,
  onWidthCommit,
}: LibrarySidebarProps) {
  const isCollapsed = collapsed;
  const sortedFolderEntries = useMemo(
    () => sortFolderBrowserEntries(folderEntries, folderSort),
    [folderEntries, folderSort],
  );
  const sortedFolders = useMemo(
    () => sortedFolderEntries.map((entry) => entry.folder),
    [sortedFolderEntries],
  );
  const folderOrder = useMemo(
    () => new Map(sortedFolderEntries.map((entry, index) => [entry.folder.id, index])),
    [sortedFolderEntries],
  );

  return (
    <aside
      aria-label="Library sidebar"
      className="sidebar group/sidebar relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden py-sidebar-inset px-sidebar-collapsed-inset border-0 border-e border-solid border-line-subtle has-[.sidebar\_\_resize-handle:hover]:border-e-line has-[.sidebar\_\_resize-handle[data-resizing=true]]:border-e-line has-[.sidebar\_\_resize-handle:focus-visible]:border-e-focus! [&_:is(button,a,summary):focus-visible]:-outline-offset-2! bg-surface-sidebar transition-colors duration-fast page-compact:py-field-standard-inline page-short:pt-sidebar-inset page-short:pb-field-standard-inline page-compact:page-short:pt-field-standard-inline data-collapsed:overflow-visible page-mobile:static page-mobile:grid page-mobile:sidebar-mobile-columns page-mobile:auto-rows-max page-mobile:items-center page-mobile:w-full page-mobile:h-auto page-mobile:max-h-sidebar-mobile page-mobile:overflow-y-auto page-mobile:py-field-inline page-mobile:px-collection-compact page-mobile:border-e-0 page-mobile:border-b"
      data-collapsed={isCollapsed || undefined}
    >
      <nav
        className="sidebar__nav grid gap-control-inset min-w-0 overflow-hidden page-narrow:w-full page-mobile:flex page-mobile:flex-wrap page-mobile:col-span-full page-mobile:w-auto"
        aria-label="Library navigation"
        ref={navigationRef}
      >
        <CollapsedSidebarTooltip collapsed={isCollapsed} content="Library">
          <button
            aria-label="Library"
            aria-current={location.type === "library" ? "page" : undefined}
            className={navigationClassName}
            data-import-drop-active={
              activeImportDropTargetId === "sidebar-library-root" || undefined
            }
            data-import-drop-destination={ARCHIVE_ROOT_DESTINATION}
            data-import-drop-id="sidebar-library-root"
            data-import-drop-target="true"
            type="button"
            onClick={() => onLocationChange({ type: "library" })}
          >
            <LibraryBig
              aria-hidden="true"
              className="block size-icon-glyph-standard justify-self-center group-aria-[current=page]:text-accent"
            />
            <span className="w-max whitespace-nowrap">Library</span>
          </button>
        </CollapsedSidebarTooltip>
        <CollapsedSidebarTooltip collapsed={isCollapsed} content="Series">
          <button
            aria-label="Series"
            aria-current={
              location.type === "series" || location.type === "series-detail" ? "page" : undefined
            }
            className={navigationClassName}
            type="button"
            onClick={() => onLocationChange({ type: "series" })}
          >
            <Layers
              aria-hidden="true"
              className="block size-icon-glyph-standard justify-self-center group-aria-[current=page]:text-accent"
            />
            <span className="w-max whitespace-nowrap">Series</span>
          </button>
        </CollapsedSidebarTooltip>
        <CollapsedSidebarTooltip collapsed={isCollapsed} content="Favorites">
          <button
            aria-label="Favorites"
            aria-current={location.type === "favorites" ? "page" : undefined}
            className={navigationClassName}
            type="button"
            onClick={() => onLocationChange({ type: "favorites" })}
          >
            <Heart
              aria-hidden="true"
              className="block size-icon-glyph-standard justify-self-center group-aria-[current=page]:text-accent"
              fill={location.type === "favorites" ? "currentColor" : "none"}
            />
            <span className="w-max whitespace-nowrap">Favorites</span>
          </button>
        </CollapsedSidebarTooltip>
        <CollapsedSidebarTooltip collapsed={isCollapsed} content="Folders">
          <button
            aria-label="Folders"
            aria-current={location.type === "folders" ? "page" : undefined}
            className={navigationClassName}
            data-library-folder-collection-entry
            type="button"
            onClick={() => onLocationChange({ type: "folders" })}
          >
            <Folders
              aria-hidden="true"
              className="block size-icon-glyph-standard justify-self-center group-aria-[current=page]:text-accent"
            />
            <span className="w-max whitespace-nowrap">Folders</span>
          </button>
        </CollapsedSidebarTooltip>
      </nav>

      <div
        className="sidebar__expanded-content flex flex-1 flex-col min-h-0 overflow-hidden page-mobile:contents"
        ref={expandedContentRef}
        inert={isCollapsed}
        aria-hidden={isCollapsed || undefined}
      >
        <div className="sidebar__section flex flex-1 flex-col min-h-0 overflow-hidden mt-sidebar-section pe-field-required page-short:mt-field-standard-inline page-mobile:block page-mobile:col-span-full page-mobile:w-full page-mobile:mt-field-standard-inline">
          <div className="sidebar__section-heading group flex flex-none items-center justify-between min-h-control-compact ps-field-standard-inline">
            <div className="inline-flex items-center gap-control-gap-compact p-0 border-0 text-muted text-meta leading-inherit font-semibold tracking-sidebar-label uppercase">
              Folders
            </div>
            <div className="sidebar__section-heading-actions flex items-center gap-segment-inset opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto">
              <AppSelect
                appearance="icon-only"
                ariaLabel="Sort sidebar folders"
                className="sidebar__folder-sort [&_.app-select\_\_trigger-icon]:sidebar-sort-icon [&_.app-select\_\_trigger]:border-transparent [&_.app-select\_\_trigger]:bg-transparent [&_.app-select\_\_trigger:hover]:border-transparent [&_.app-select\_\_trigger:hover]:text-text-strong [&_.app-select\_\_trigger:hover]:bg-surface-raised [&_.app-select\_\_trigger[aria-expanded=true]]:border-transparent [&_.app-select\_\_trigger[aria-expanded=true]]:text-text-strong [&_.app-select\_\_trigger[aria-expanded=true]]:bg-surface-raised"
                onChange={onFolderSortChange}
                options={folderSortOptions}
                size="compact"
                triggerIcon={<ArrowUpDown />}
                value={folderSort}
              />
              {canManageFolders ? (
                <IconButton
                  label="Create folder"
                  className="size-control-compact control-enabled:cursor-pointer"
                  onClick={onCreateFolder}
                >
                  <Plus aria-hidden="true" />
                </IconButton>
              ) : null}
            </div>
          </div>
          <div className="sidebar__folder-scroll flex-1 min-h-0 overflow-auto overscroll-contain scrollbar-gutter-stable pe-field-required -me-field-required">
            {sortedFolderEntries.length > 0 ? (
              <FolderTree
                folderOrder={folderOrder}
                folders={sortedFolders}
                location={location}
                activeImportDropTargetId={activeImportDropTargetId}
                onDelete={onDeleteFolder}
                onMove={onMoveFolder}
                onRename={onRenameFolder}
                onReveal={onRevealFolder}
                showActions={canManageFolders}
                showReveal={canRevealFolders}
                onSelect={(folder) => onLocationChange({ type: "folder", folderId: folder.id })}
              />
            ) : (
              <p className="mt-input-gap px-field-inline text-muted text-body">No folders found</p>
            )}
          </div>
        </div>
      </div>

      <div className="sidebar-footer flex-none grid sidebar-footer-columns items-center gap-segment-inset pt-field-standard-inline pe-control-gap mt-auto border-0 border-t border-solid border-line-subtle group-data-collapsed/sidebar:grid-cols-1 group-data-collapsed/sidebar:justify-items-center group-data-collapsed/sidebar:w-full group-data-collapsed/sidebar:pe-0 page-mobile:col-span-full page-mobile:mt-field-standard-inline">
        <ArchiveSwitcher
          activeArchive={activeArchive}
          archives={archives}
          collapsed={isCollapsed}
          onManageArchives={onManageArchives}
          onRevealArchive={onRevealArchive}
          onSwitchArchive={onSwitchArchive}
          revealArchiveDisabledReason={revealArchiveDisabledReason}
        />
        <IconButton
          label="About Archeion"
          className="control-enabled:cursor-pointer"
          onClick={onOpenAbout}
          tooltip="About Archeion"
          tooltipPlacement="top"
        >
          <CircleQuestionMark aria-hidden="true" />
        </IconButton>
        <IconButton
          aria-keyshortcuts={settingsAriaKeyShortcuts}
          label="Settings"
          className="control-enabled:cursor-pointer"
          onClick={onOpenSettings}
          tooltip="Settings"
          tooltipPlacement="top"
        >
          <Settings aria-hidden="true" />
        </IconButton>
      </div>
      {resizable && !isCollapsed ? (
        <LibraryPanelResizeHandle
          label="Resize sidebar"
          tooltip="Drag to resize sidebar"
          className="sidebar__resize-handle end-0 page-mobile:hidden"
          edge="end"
          minWidth={LIBRARY_SIDEBAR_MIN_WIDTH}
          maxWidth={LIBRARY_SIDEBAR_MAX_WIDTH}
          width={width}
          onWidthChange={onWidthChange}
          onWidthCommit={onWidthCommit}
        />
      ) : null}
    </aside>
  );
});

function ArchiveSwitcher({
  activeArchive,
  archives,
  collapsed,
  onManageArchives,
  onRevealArchive,
  onSwitchArchive,
  revealArchiveDisabledReason,
}: Pick<
  LibrarySidebarProps,
  | "activeArchive"
  | "archives"
  | "collapsed"
  | "onManageArchives"
  | "onRevealArchive"
  | "onSwitchArchive"
  | "revealArchiveDisabledReason"
>) {
  const [open, setOpen] = useState(false);
  const [popup, setPopup] = useState<HTMLDivElement | null>(null);
  const [portalContainer, setPortalContainer] = useState<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback((restoreFocus = false) => {
    if (restoreFocus) {
      flushSync(() => setOpen(false));
      focusElementIfUsable(triggerRef.current);
    } else {
      setOpen(false);
    }
  }, []);

  useLayoutEffect(() => {
    if (!open || !popup) return;
    return registerTransientSurface({
      element: popup,
      trigger: triggerRef.current,
      kind: "popover",
      closeOnModalOpen: true,
      dismissOnOutsidePointer: true,
      onDismiss: (reason) => close(reason === "escape"),
    });
  }, [open, popup, close]);

  return (
    <div className="archive-switcher relative min-w-0 group-data-collapsed/sidebar:w-control-standard">
      <DropdownMenu
        open={open}
        modal={false}
        onOpenChange={(next, details) => {
          if (details.reason === "outside-press" || details.reason === "escape-key") {
            // The application transient owner handles these events, including nested surfaces.
            if (popup) {
              details.cancel();
              return;
            }
          }
          if (next) {
            setPortalContainer(triggerRef.current?.closest<HTMLElement>(".window-app") ?? null);
          }
          setOpen(next);
        }}
      >
        <CollapsedSidebarTooltip
          collapsed={collapsed}
          content={`Current archive: ${activeArchive.displayName}`}
        >
          <DropdownMenuTrigger
            aria-label={`Current archive: ${activeArchive.displayName}`}
            ref={triggerRef}
            className="archive-switcher__trigger flex w-full min-w-0 min-h-control-standard items-center justify-start gap-field-label px-control-gap py-0 border-standard border-solid border-transparent rounded-control text-text bg-transparent text-meta leading-inherit font-medium text-start cursor-pointer transition-select hover:border-line-strong hover:text-text-strong hover:bg-surface-shell-hover aria-expanded:border-line-strong aria-expanded:text-text-strong aria-expanded:bg-surface-shell-hover group-data-collapsed/sidebar:justify-center group-data-collapsed/sidebar:p-0"
          >
            <span aria-hidden="true" className="icon-slot icon-slot--compact">
              <ChevronsUpDown />
            </span>
            <span className="archive-switcher__trigger-label flex-1 min-w-0 wrap-anywhere whitespace-normal group-data-collapsed/sidebar:hidden">
              {activeArchive.displayName}
            </span>
          </DropdownMenuTrigger>
        </CollapsedSidebarTooltip>
        {open ? (
          <DropdownMenuContent
            aria-label="Archives"
            ref={setPopup}
            container={portalContainer ?? undefined}
            side={collapsed ? "inline-end" : "top"}
            align={collapsed ? "end" : "start"}
            sideOffset={7}
            className="archive-switcher__menu"
          >
            <DropdownMenuItem
              disabled
              aria-current="true"
              className="archive-switcher__current menu-item grid select-option-columns items-center gap-control-gap w-full min-h-control-compact px-input-gap py-menu-item-block rounded-small text-text-strong bg-surface-hover text-meta font-medium text-start cursor-default opacity-100"
            >
              <span className="menu-item__label min-w-0 wrap-anywhere whitespace-normal">
                {activeArchive.displayName}
              </span>
              <span aria-hidden="true" className="icon-slot icon-slot--compact text-accent">
                <Check strokeWidth={2.25} />
              </span>
            </DropdownMenuItem>
            {archives
              .filter((archive) => archive.id !== activeArchive.id)
              .slice(0, 5)
              .map((archive) => (
                <PrimitiveMenuItem
                  point={false}
                  className="archive-switcher__archive"
                  key={archive.id}
                  onClick={() => {
                    close();
                    onSwitchArchive(archive);
                  }}
                >
                  {archive.displayName}
                </PrimitiveMenuItem>
              ))}
            <div role="separator" className="h-px my-menu-padding mx-segment-inset bg-line" />
            <PrimitiveMenuItem
              point={false}
              disabled={Boolean(revealArchiveDisabledReason)}
              disabledReason={revealArchiveDisabledReason}
              icon={<FolderOpen aria-hidden="true" />}
              onClick={() => {
                close(true);
                onRevealArchive();
              }}
            >
              Reveal archive folder
            </PrimitiveMenuItem>
            <PrimitiveMenuItem
              point={false}
              className="archive-switcher__manage"
              icon={<Archive aria-hidden="true" />}
              onClick={() => {
                close(true);
                onManageArchives();
              }}
            >
              Manage archives
            </PrimitiveMenuItem>
          </DropdownMenuContent>
        ) : null}
      </DropdownMenu>
    </div>
  );
}
