import {
  Archive,
  LibraryBig,
  ChevronRight,
  ChevronsUpDown,
  Check,
  History,
  BookOpenText,
  CircleCheck,
  ImageOff,
  NotebookPen,
  Folders,
  FolderOpen,
  Settings,
  Heart,
  Plus,
  CircleQuestionMark,
  ArrowUpDown,
  Copy,
  FileWarning,
  Layers,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import {
  memo,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
  type RefObject,
} from "react";

import { AppSelect } from "../../components/AppSelect";
import { IconButton } from "../../components/IconButton";
import { ActionListButton } from "../../components/MenuItem";
import { Tooltip } from "../../components/Tooltip";
import type { KnownArchive } from "../../types/archive";
import type { ReadonlyFolder } from "../../types/folder";
import type {
  FolderSort,
  LibraryLocation,
  LibrarySmartView,
  LibrarySmartViewPreferences,
} from "../../types/library";
import {
  libraryLocationForSmartView,
  librarySmartViewForLocation,
  librarySmartViewLabel,
  visibleLibrarySmartViewDefinitions,
} from "../../types/librarySmartViews";
import { useDismissibleDetails } from "../../utils/useDismissibleDetails";
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

const smartViewIcons: Record<LibrarySmartView, LucideIcon> = {
  unread: BookOpenText,
  "in-progress": History,
  completed: CircleCheck,
  "needs-metadata": NotebookPen,
  "needs-cover": ImageOff,
  duplicates: Copy,
  "epub-issues": FileWarning,
};

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
  smartViewPreferences: LibrarySmartViewPreferences;
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
  smartViewPreferences,
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
  const { closeDetails: closeArchiveSwitcher, detailsRef: archiveSwitcherRef } =
    useDismissibleDetails();
  const [smartViewsExpanded, setSmartViewsExpanded] = useState(false);
  const [resizing, setResizing] = useState(false);
  const resizePointerRef = useRef<{
    pointerId: number;
    startClientX: number;
    startWidth: number;
    rtl: boolean;
  } | null>(null);
  const resizeWidthRef = useRef(width);
  const resizeFrameRef = useRef<number | null>(null);
  const pendingResizeWidthRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current);
    },
    [],
  );
  const smartViewsContentId = useId();
  const activeSmartView = librarySmartViewForLocation(location);
  const visibleSmartViews = visibleLibrarySmartViewDefinitions(smartViewPreferences);
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

  const updateResizeWidth = (nextWidth: number) => {
    const clamped = Math.round(
      Math.min(LIBRARY_SIDEBAR_MAX_WIDTH, Math.max(LIBRARY_SIDEBAR_MIN_WIDTH, nextWidth)),
    );
    resizeWidthRef.current = clamped;
    onWidthChange?.(clamped);
  };

  const handleResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !onWidthChange || resizePointerRef.current) return;
    event.preventDefault();
    if (!event.currentTarget.parentElement) return;
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    resizePointerRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startWidth: width,
      rtl,
    };
    resizeWidthRef.current = width;
    setResizing(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handleResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = resizePointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    pendingResizeWidthRef.current =
      pointer.startWidth + (pointer.rtl ? -1 : 1) * (event.clientX - pointer.startClientX);
    if (resizeFrameRef.current !== null) return;
    resizeFrameRef.current = requestAnimationFrame(() => {
      resizeFrameRef.current = null;
      const pendingWidth = pendingResizeWidthRef.current;
      pendingResizeWidthRef.current = null;
      if (pendingWidth !== null) updateResizeWidth(pendingWidth);
    });
  };

  const finishResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pointer = resizePointerRef.current;
    if (!pointer || pointer.pointerId !== event.pointerId) return;
    if (resizeFrameRef.current !== null) {
      cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = null;
    }
    const pendingWidth = pendingResizeWidthRef.current;
    pendingResizeWidthRef.current = null;
    if (pendingWidth !== null) updateResizeWidth(pendingWidth);
    resizePointerRef.current = null;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    onWidthCommit?.(resizeWidthRef.current);
  };

  const handleResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!onWidthChange) return;
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    const step = event.shiftKey ? 24 : 8;
    let nextWidth: number | null = null;
    if (event.key === "Home") nextWidth = LIBRARY_SIDEBAR_MIN_WIDTH;
    else if (event.key === "End") nextWidth = LIBRARY_SIDEBAR_MAX_WIDTH;
    else if (event.key === "ArrowRight") nextWidth = width + (rtl ? -step : step);
    else if (event.key === "ArrowLeft") nextWidth = width + (rtl ? step : -step);
    if (nextWidth === null) return;
    event.preventDefault();
    updateResizeWidth(nextWidth);
    onWidthCommit?.(
      Math.round(
        Math.min(LIBRARY_SIDEBAR_MAX_WIDTH, Math.max(LIBRARY_SIDEBAR_MIN_WIDTH, nextWidth)),
      ),
    );
  };

  const manageArchives = useCallback(() => {
    closeArchiveSwitcher({ restoreFocus: true });
    onManageArchives();
  }, [closeArchiveSwitcher, onManageArchives]);

  const revealArchive = useCallback(() => {
    closeArchiveSwitcher({ restoreFocus: true });
    onRevealArchive();
  }, [closeArchiveSwitcher, onRevealArchive]);

  const switchArchive = useCallback(
    (archive: KnownArchive) => {
      closeArchiveSwitcher();
      onSwitchArchive(archive);
    },
    [closeArchiveSwitcher, onSwitchArchive],
  );

  return (
    <aside
      aria-label="Library sidebar"
      className="sidebar"
      data-collapsed={isCollapsed || undefined}
    >
      <nav className="sidebar__nav" aria-label="Library navigation" ref={navigationRef}>
        <CollapsedSidebarTooltip collapsed={isCollapsed} content="Library">
          <button
            aria-label="Library"
            aria-current={location.type === "library" ? "page" : undefined}
            className={`nav-item ${location.type === "library" ? "active" : ""}`}
            data-import-drop-active={
              activeImportDropTargetId === "sidebar-library-root" || undefined
            }
            data-import-drop-destination={ARCHIVE_ROOT_DESTINATION}
            data-import-drop-id="sidebar-library-root"
            data-import-drop-target="true"
            type="button"
            onClick={() => onLocationChange({ type: "library" })}
          >
            <LibraryBig aria-hidden="true" size={19} />
            <span>Library</span>
          </button>
        </CollapsedSidebarTooltip>
        <CollapsedSidebarTooltip collapsed={isCollapsed} content="Series">
          <button
            aria-label="Series"
            aria-current={
              location.type === "series" || location.type === "series-detail" ? "page" : undefined
            }
            className={`nav-item ${location.type === "series" || location.type === "series-detail" ? "active" : ""}`}
            type="button"
            onClick={() => onLocationChange({ type: "series" })}
          >
            <Layers aria-hidden="true" size={19} />
            <span>Series</span>
          </button>
        </CollapsedSidebarTooltip>
        <CollapsedSidebarTooltip collapsed={isCollapsed} content="Favorites">
          <button
            aria-label="Favorites"
            aria-current={location.type === "favorites" ? "page" : undefined}
            className={`nav-item ${location.type === "favorites" ? "active" : ""}`}
            type="button"
            onClick={() => onLocationChange({ type: "favorites" })}
          >
            <Heart
              aria-hidden="true"
              size={19}
              fill={location.type === "favorites" ? "currentColor" : "none"}
            />
            <span>Favorites</span>
          </button>
        </CollapsedSidebarTooltip>
        <CollapsedSidebarTooltip collapsed={isCollapsed} content="Folders">
          <button
            aria-label="Folders"
            aria-current={location.type === "folders" ? "page" : undefined}
            className={`nav-item ${location.type === "folders" ? "active" : ""}`}
            data-library-folder-collection-entry
            type="button"
            onClick={() => onLocationChange({ type: "folders" })}
          >
            <Folders aria-hidden="true" size={19} />
            <span>Folders</span>
          </button>
        </CollapsedSidebarTooltip>
      </nav>

      <div
        className="sidebar__expanded-content"
        ref={expandedContentRef}
        inert={isCollapsed}
        aria-hidden={isCollapsed || undefined}
      >
        {smartViewPreferences.enabled ? (
          <div className="sidebar__smart-views">
            <button
              aria-controls={smartViewsContentId}
              aria-expanded={smartViewsExpanded}
              className="sidebar__smart-views-disclosure"
              type="button"
              onClick={() => setSmartViewsExpanded((expanded) => !expanded)}
            >
              <span className="sidebar__smart-views-title">
                <span className="section-label">Smart views</span>
                {!smartViewsExpanded && activeSmartView ? (
                  <span className="sidebar__smart-views-active">
                    · {librarySmartViewLabel(activeSmartView)}
                  </span>
                ) : null}
              </span>
              <ChevronRight
                aria-hidden="true"
                className="sidebar__smart-views-chevron"
                data-expanded={smartViewsExpanded ? "true" : "false"}
                size={13}
              />
            </button>
            <div
              className="sidebar__smart-views-list"
              hidden={!smartViewsExpanded}
              id={smartViewsContentId}
            >
              <span className="sr-only" id={`${smartViewsContentId}-needs-metadata-description`}>
                Missing title or author
              </span>
              {visibleSmartViews.map(({ id: view }) => {
                const SmartViewIcon = smartViewIcons[view];
                const isActive = activeSmartView === view;
                return (
                  <button
                    aria-current={isActive ? "page" : undefined}
                    aria-describedby={
                      view === "needs-metadata"
                        ? `${smartViewsContentId}-needs-metadata-description`
                        : undefined
                    }
                    className={`nav-item ${isActive ? "active" : ""}`}
                    key={view}
                    type="button"
                    onClick={() => onLocationChange(libraryLocationForSmartView(view))}
                  >
                    <SmartViewIcon aria-hidden="true" size={18} />
                    <span>{librarySmartViewLabel(view)}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="sidebar__section">
          <div className="sidebar__section-heading">
            <div className="section-label">Folders</div>
            <div className="sidebar__section-heading-actions">
              <AppSelect
                appearance="icon-only"
                ariaLabel="Sort sidebar folders"
                className="sidebar__folder-sort"
                onChange={onFolderSortChange}
                options={folderSortOptions}
                size="compact"
                triggerIcon={<ArrowUpDown />}
                value={folderSort}
              />
              {canManageFolders ? (
                <IconButton label="Create folder" onClick={onCreateFolder}>
                  <Plus aria-hidden="true" />
                </IconButton>
              ) : null}
            </div>
          </div>
          <div className="sidebar__folder-scroll">
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
              <p className="folder-placeholder">No folders found</p>
            )}
          </div>
        </div>
      </div>

      <div className="sidebar-footer">
        <details className="archive-switcher" ref={archiveSwitcherRef}>
          <CollapsedSidebarTooltip
            collapsed={isCollapsed}
            content={`Current archive: ${activeArchive.displayName}`}
          >
            <summary
              aria-label={`Current archive: ${activeArchive.displayName}`}
              className="menu-trigger menu-trigger--disclosure"
            >
              <span aria-hidden="true" className="icon-slot icon-slot--compact">
                <ChevronsUpDown />
              </span>
              <span className="archive-switcher__trigger-label">{activeArchive.displayName}</span>
            </summary>
          </CollapsedSidebarTooltip>
          <div className="archive-switcher__menu menu-popover">
            <div
              aria-current="true"
              className="archive-switcher__current menu-item menu-item--trailing-icon"
            >
              <span className="menu-item__label">{activeArchive.displayName}</span>
              <span aria-hidden="true" className="icon-slot icon-slot--compact">
                <Check strokeWidth={2.25} />
              </span>
            </div>
            {archives
              .filter((archive) => archive.id !== activeArchive.id)
              .slice(0, 5)
              .map((archive) => (
                <ActionListButton
                  className="archive-switcher__archive"
                  key={archive.id}
                  onClick={() => switchArchive(archive)}
                >
                  {archive.displayName}
                </ActionListButton>
              ))}
            <div className="archive-switcher__divider" role="separator" />
            <ActionListButton
              disabled={Boolean(revealArchiveDisabledReason)}
              disabledReason={revealArchiveDisabledReason}
              icon={<FolderOpen aria-hidden="true" />}
              onClick={revealArchive}
            >
              Reveal archive folder
            </ActionListButton>
            <ActionListButton
              className="archive-switcher__manage"
              icon={<Archive aria-hidden="true" />}
              onClick={manageArchives}
            >
              Manage archives
            </ActionListButton>
          </div>
        </details>
        <IconButton
          label="About Archeion"
          onClick={onOpenAbout}
          tooltip="About Archeion"
          tooltipPlacement="top"
        >
          <CircleQuestionMark aria-hidden="true" />
        </IconButton>
        <IconButton
          aria-keyshortcuts={settingsAriaKeyShortcuts}
          label="Settings"
          onClick={onOpenSettings}
          tooltip="Settings"
          tooltipPlacement="top"
        >
          <Settings aria-hidden="true" />
        </IconButton>
      </div>
      {resizable && !isCollapsed ? (
        <Tooltip content="Drag to resize sidebar" placement="right">
          <div
            aria-label="Resize sidebar"
            aria-orientation="vertical"
            aria-valuemax={LIBRARY_SIDEBAR_MAX_WIDTH}
            aria-valuemin={LIBRARY_SIDEBAR_MIN_WIDTH}
            aria-valuenow={width}
            aria-valuetext={`${width} pixels`}
            className="sidebar__resize-handle"
            data-resizing={resizing || undefined}
            role="separator"
            tabIndex={0}
            onKeyDown={handleResizeKeyDown}
            onLostPointerCapture={finishResize}
            onPointerCancel={finishResize}
            onPointerDown={handleResizePointerDown}
            onPointerMove={handleResizePointerMove}
            onPointerUp={finishResize}
          />
        </Tooltip>
      ) : null}
    </aside>
  );
});
