import {
  Archive,
  Books,
  CaretRight,
  CaretUpDown,
  Check,
  ClockCounterClockwise,
  BookOpenText,
  CheckCircle,
  ImageBroken,
  NotePencil,
  Folders,
  GearSix,
  Heart,
  Plus,
  Question,
  Stack,
} from "@phosphor-icons/react";
import type { Icon } from "@phosphor-icons/react";
import { memo, useCallback, useId, useState, type RefObject } from "react";

import { IconButton } from "../../components/IconButton";
import { MenuItem } from "../../components/MenuItem";
import type { KnownArchive } from "../../types/archive";
import type { ReadonlyFolder } from "../../types/folder";
import type {
  LibraryLocation,
  LibrarySmartView,
  LibrarySmartViewPreferences,
} from "../../types/library";
import {
  librarySmartViewLabel,
  visibleLibrarySmartViewDefinitions,
} from "../../types/librarySmartViews";
import { useDismissibleDetails } from "../../utils/useDismissibleDetails";
import { FolderTree } from "../folders/FolderTree";
import { ARCHIVE_ROOT_DESTINATION } from "../filesystem/archiveImport";

const smartViewIcons: Record<LibrarySmartView, Icon> = {
  unread: BookOpenText,
  "in-progress": ClockCounterClockwise,
  completed: CheckCircle,
  "needs-metadata": NotePencil,
  "needs-cover": ImageBroken,
};

function activeSmartViewForLocation(location: LibraryLocation): LibrarySmartView | null {
  if (location.type === "continue") return "in-progress";
  return location.type === "smart-view" ? location.smartView : null;
}

type LibrarySidebarProps = {
  activeArchive: KnownArchive;
  archives: KnownArchive[];
  collapsed: boolean;
  expandedContentRef: RefObject<HTMLDivElement | null>;
  folders: readonly ReadonlyFolder[];
  location: LibraryLocation;
  smartViewPreferences: LibrarySmartViewPreferences;
  canManageFolders?: boolean;
  onCreateFolder: () => void;
  onDeleteFolder: (folder: ReadonlyFolder) => void;
  onManageArchives: () => void;
  onMoveFolder: (folder: ReadonlyFolder) => void;
  onLocationChange: (location: LibraryLocation) => void;
  onOpenAbout: () => void;
  onOpenSettings: () => void;
  onPreloadAbout?: () => void;
  onPreloadSettings?: () => void;
  onRenameFolder: (folder: ReadonlyFolder) => void;
  onRevealFolder?: (folder: ReadonlyFolder) => void;
  onSwitchArchive: (archive: KnownArchive) => void;
  settingsAriaKeyShortcuts?: string;
  canRevealFolders?: boolean;
  activeImportDropTargetId?: string | null;
};

export const LibrarySidebar = memo(function LibrarySidebar({
  activeArchive,
  archives,
  collapsed,
  expandedContentRef,
  folders,
  location,
  smartViewPreferences,
  canManageFolders = true,
  onCreateFolder,
  onDeleteFolder,
  onManageArchives,
  onMoveFolder,
  onLocationChange,
  onOpenAbout,
  onOpenSettings,
  onPreloadAbout,
  onPreloadSettings,
  onRenameFolder,
  onRevealFolder,
  onSwitchArchive,
  settingsAriaKeyShortcuts,
  canRevealFolders = false,
  activeImportDropTargetId,
}: LibrarySidebarProps) {
  const { closeDetails: closeArchiveSwitcher, detailsRef: archiveSwitcherRef } =
    useDismissibleDetails();
  const [smartViewsExpanded, setSmartViewsExpanded] = useState(false);
  const smartViewsContentId = useId();
  const activeSmartView = activeSmartViewForLocation(location);
  const visibleSmartViews = visibleLibrarySmartViewDefinitions(smartViewPreferences);
  const isCollapsed = collapsed;

  const manageArchives = useCallback(() => {
    closeArchiveSwitcher();
    onManageArchives();
  }, [closeArchiveSwitcher, onManageArchives]);

  const switchArchive = useCallback(
    (archive: KnownArchive) => {
      closeArchiveSwitcher();
      onSwitchArchive(archive);
    },
    [closeArchiveSwitcher, onSwitchArchive],
  );

  return (
    <aside className="sidebar" data-collapsed={isCollapsed || undefined}>
      <nav className="sidebar__nav" aria-label="Library navigation">
        <button
          aria-label="Library"
          aria-current={location.type === "library" ? "page" : undefined}
          className={`nav-item ${location.type === "library" ? "active" : ""}`}
          data-import-drop-active={activeImportDropTargetId === "sidebar-library-root" || undefined}
          data-import-drop-destination={ARCHIVE_ROOT_DESTINATION}
          data-import-drop-id="sidebar-library-root"
          data-import-drop-target="true"
          title="Library"
          type="button"
          onClick={() => onLocationChange({ type: "library" })}
        >
          <Books aria-hidden="true" size={19} weight="regular" />
          <span>Library</span>
        </button>
        <button
          aria-label="Series"
          aria-current={
            location.type === "series" || location.type === "series-detail" ? "page" : undefined
          }
          className={`nav-item ${location.type === "series" || location.type === "series-detail" ? "active" : ""}`}
          title="Series"
          type="button"
          onClick={() => onLocationChange({ type: "series" })}
        >
          <Stack aria-hidden="true" size={19} weight="regular" />
          <span>Series</span>
        </button>
        <button
          aria-label="Favorites"
          aria-current={location.type === "favorites" ? "page" : undefined}
          className={`nav-item ${location.type === "favorites" ? "active" : ""}`}
          title="Favorites"
          type="button"
          onClick={() => onLocationChange({ type: "favorites" })}
        >
          <Heart
            aria-hidden="true"
            size={19}
            weight={location.type === "favorites" ? "fill" : "regular"}
          />
          <span>Favorites</span>
        </button>
        <button
          aria-label="Folders"
          aria-current={location.type === "folders" ? "page" : undefined}
          className={`nav-item ${location.type === "folders" ? "active" : ""}`}
          data-library-folder-collection-entry
          title="Folders"
          type="button"
          onClick={() => onLocationChange({ type: "folders" })}
        >
          <Folders aria-hidden="true" size={19} weight="regular" />
          <span>Folders</span>
        </button>
      </nav>

      {!isCollapsed ? (
        <div className="sidebar__expanded-content" ref={expandedContentRef}>
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
                <CaretRight
                  aria-hidden="true"
                  className="sidebar__smart-views-chevron"
                  data-expanded={smartViewsExpanded ? "true" : "false"}
                  size={13}
                  weight="bold"
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
                      title={view === "needs-metadata" ? "Missing title or author" : undefined}
                      type="button"
                      onClick={() =>
                        onLocationChange(
                          view === "in-progress"
                            ? { type: "continue" }
                            : { type: "smart-view", smartView: view },
                        )
                      }
                    >
                      <SmartViewIcon aria-hidden="true" size={18} weight="regular" />
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
              {canManageFolders ? (
                <IconButton label="Create folder" onClick={onCreateFolder}>
                  <Plus aria-hidden="true" weight="regular" />
                </IconButton>
              ) : null}
            </div>
            <div className="sidebar__folder-scroll">
              {folders.length > 0 ? (
                <FolderTree
                  folders={folders}
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
      ) : null}

      <div className="sidebar-footer">
        <details className="archive-switcher" ref={archiveSwitcherRef}>
          <summary
            aria-label={`Current archive: ${activeArchive.displayName}`}
            className="menu-trigger menu-trigger--disclosure"
            title={`Current archive: ${activeArchive.displayName}`}
          >
            <span aria-hidden="true" className="icon-slot icon-slot--compact">
              <CaretUpDown weight="bold" />
            </span>
            <span className="archive-switcher__trigger-label">{activeArchive.displayName}</span>
          </summary>
          <div className="archive-switcher__menu menu-popover" role="menu">
            <div
              aria-current="true"
              aria-disabled="true"
              className="archive-switcher__current menu-item menu-item--trailing-icon"
              role="menuitem"
            >
              <span className="menu-item__label">{activeArchive.displayName}</span>
              <span aria-hidden="true" className="icon-slot icon-slot--compact">
                <Check weight="bold" />
              </span>
            </div>
            {archives
              .filter((archive) => archive.id !== activeArchive.id)
              .slice(0, 5)
              .map((archive) => (
                <MenuItem
                  className="archive-switcher__archive"
                  key={archive.id}
                  onClick={() => switchArchive(archive)}
                >
                  {archive.displayName}
                </MenuItem>
              ))}
            <div className="archive-switcher__divider" role="separator" />
            <MenuItem
              className="archive-switcher__manage"
              icon={<Archive aria-hidden="true" weight="regular" />}
              onClick={manageArchives}
            >
              Manage archives
            </MenuItem>
          </div>
        </details>
        <IconButton
          label="About Archeion"
          onClick={onOpenAbout}
          onFocus={onPreloadAbout}
          onPointerEnter={onPreloadAbout}
        >
          <Question aria-hidden="true" weight="bold" />
        </IconButton>
        <IconButton
          aria-keyshortcuts={settingsAriaKeyShortcuts}
          label="Settings"
          onClick={onOpenSettings}
          onFocus={onPreloadSettings}
          onPointerEnter={onPreloadSettings}
        >
          <GearSix aria-hidden="true" />
        </IconButton>
      </div>
    </aside>
  );
});
