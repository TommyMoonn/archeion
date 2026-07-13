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
import { memo, useCallback, useId, useState } from "react";

import { IconButton } from "../../components/IconButton";
import { MenuItem } from "../../components/MenuItem";
import type { KnownArchive } from "../../types/archive";
import type { Folder } from "../../types/folder";
import type { LibraryLocation, LibrarySmartView } from "../../types/library";
import { useDismissibleDetails } from "../../utils/useDismissibleDetails";
import { FolderTree } from "../folders/FolderTree";
import { ARCHIVE_ROOT_DESTINATION } from "../filesystem/archiveImport";
import { librarySmartViewLabel, type LibrarySmartViewCounts } from "./libraryFilters";

const smartViews: Array<{ icon: Icon; view: LibrarySmartView }> = [
  { view: "unread", icon: BookOpenText },
  { view: "in-progress", icon: ClockCounterClockwise },
  { view: "completed", icon: CheckCircle },
  { view: "needs-metadata", icon: NotePencil },
  { view: "needs-cover", icon: ImageBroken },
];

function activeSmartViewForLocation(location: LibraryLocation): LibrarySmartView | null {
  if (location.type === "continue") return "in-progress";
  return location.type === "smart-view" ? location.smartView : null;
}

type LibrarySidebarProps = {
  activeArchive: KnownArchive;
  archives: KnownArchive[];
  bookCount: number;
  favoriteCount: number;
  folders: Folder[];
  location: LibraryLocation;
  seriesCount: number;
  smartViewCounts: LibrarySmartViewCounts;
  canManageFolders?: boolean;
  onCreateFolder: () => void;
  onDeleteFolder: (folder: Folder) => void;
  onManageArchives: () => void;
  onMoveFolder: (folder: Folder) => void;
  onLocationChange: (location: LibraryLocation) => void;
  onOpenAbout: () => void;
  onOpenSettings: () => void;
  onPreloadAbout?: () => void;
  onPreloadSettings?: () => void;
  onRenameFolder: (folder: Folder) => void;
  onRevealFolder?: (folder: Folder) => void;
  onSwitchArchive: (archive: KnownArchive) => void;
  canRevealFolders?: boolean;
  activeImportDropTargetId?: string | null;
};

export const LibrarySidebar = memo(function LibrarySidebar({
  activeArchive,
  archives,
  bookCount,
  favoriteCount,
  folders,
  location,
  seriesCount,
  smartViewCounts,
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
  canRevealFolders = false,
  activeImportDropTargetId,
}: LibrarySidebarProps) {
  const { closeDetails: closeArchiveSwitcher, detailsRef: archiveSwitcherRef } =
    useDismissibleDetails();
  const [smartViewsExpanded, setSmartViewsExpanded] = useState(false);
  const smartViewsContentId = useId();
  const activeSmartView = activeSmartViewForLocation(location);

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
    <aside className="sidebar">
      <nav className="sidebar__nav" aria-label="Library navigation">
        <button
          aria-current={location.type === "library" ? "page" : undefined}
          className={`nav-item ${location.type === "library" ? "active" : ""}`}
          data-import-drop-active={activeImportDropTargetId === "sidebar-library-root" || undefined}
          data-import-drop-destination={ARCHIVE_ROOT_DESTINATION}
          data-import-drop-id="sidebar-library-root"
          data-import-drop-target="true"
          type="button"
          onClick={() => onLocationChange({ type: "library" })}
        >
          <Books aria-hidden="true" size={19} weight="regular" />
          <span>Library</span>
          <span className="nav-item__count">{bookCount}</span>
        </button>
        <button
          aria-current={
            location.type === "series" || location.type === "series-detail" ? "page" : undefined
          }
          className={`nav-item ${location.type === "series" || location.type === "series-detail" ? "active" : ""}`}
          type="button"
          onClick={() => onLocationChange({ type: "series" })}
        >
          <Stack aria-hidden="true" size={19} weight="regular" />
          <span>Series</span>
          <span className="nav-item__count">{seriesCount}</span>
        </button>
        <button
          aria-current={location.type === "favorites" ? "page" : undefined}
          className={`nav-item ${location.type === "favorites" ? "active" : ""}`}
          type="button"
          onClick={() => onLocationChange({ type: "favorites" })}
        >
          <Heart
            aria-hidden="true"
            size={19}
            weight={location.type === "favorites" ? "fill" : "regular"}
          />
          <span>Favorites</span>
          <span className="nav-item__count">{favoriteCount}</span>
        </button>
        <button
          aria-current={location.type === "folders" ? "page" : undefined}
          className={`nav-item ${location.type === "folders" ? "active" : ""}`}
          type="button"
          onClick={() => onLocationChange({ type: "folders" })}
        >
          <Folders aria-hidden="true" size={19} weight="regular" />
          <span>Folders</span>
          <span className="nav-item__count">{folders.length}</span>
        </button>
      </nav>

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
          {smartViews.map(({ view, icon: SmartViewIcon }) => {
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
                <span className="nav-item__count">{smartViewCounts[view]}</span>
              </button>
            );
          })}
        </div>
      </div>

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

      <div className="sidebar-footer">
        <details className="archive-switcher" ref={archiveSwitcherRef}>
          <summary
            aria-label={`Current archive: ${activeArchive.displayName}`}
            className="menu-trigger menu-trigger--disclosure"
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
