import {
  Archive,
  Books,
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
import { memo, useCallback } from "react";

import { IconButton } from "../../components/IconButton";
import type { KnownArchive } from "../../types/archive";
import type { Folder } from "../../types/folder";
import type { LibrarySmartView } from "../../types/library";
import { useDismissibleDetails } from "../../utils/useDismissibleDetails";
import { FolderTree } from "../folders/FolderTree";
import {
  librarySmartViewLabel,
  type LibraryLocation,
  type LibrarySmartViewCounts,
} from "./libraryFilters";

const smartViews: Array<{ icon: Icon; view: LibrarySmartView }> = [
  { view: "unread", icon: BookOpenText },
  { view: "in-progress", icon: ClockCounterClockwise },
  { view: "completed", icon: CheckCircle },
  { view: "needs-metadata", icon: NotePencil },
  { view: "needs-cover", icon: ImageBroken },
];

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
}: LibrarySidebarProps) {
  const { closeDetails: closeArchiveSwitcher, detailsRef: archiveSwitcherRef } =
    useDismissibleDetails();

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
        <div className="section-label">Smart views</div>
        {smartViews.map(({ view, icon: SmartViewIcon }) => {
          const isActive =
            view === "in-progress"
              ? location.type === "continue" ||
                (location.type === "smart-view" && location.smartView === view)
              : location.type === "smart-view" && location.smartView === view;
          return (
            <button
              aria-current={isActive ? "page" : undefined}
              className={`nav-item ${isActive ? "active" : ""}`}
              key={view}
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

      <div className="sidebar__section">
        <div className="sidebar__section-heading">
          <div className="section-label">Folders</div>
          {canManageFolders ? (
            <IconButton label="Create folder" onClick={onCreateFolder}>
              <Plus aria-hidden="true" size={17} weight="regular" />
            </IconButton>
          ) : null}
        </div>
        <div className="sidebar__folder-scroll">
          {folders.length > 0 ? (
            <FolderTree
              folders={folders}
              location={location}
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
          <summary aria-label={`Current archive: ${activeArchive.displayName}`}>
            <CaretUpDown aria-hidden="true" size={14} weight="bold" />
            <span>{activeArchive.displayName}</span>
          </summary>
          <div className="archive-switcher__menu">
            <div className="archive-switcher__current">
              <span>{activeArchive.displayName}</span>
              <Check aria-hidden="true" size={15} weight="bold" />
            </div>
            {archives
              .filter((archive) => archive.id !== activeArchive.id)
              .slice(0, 5)
              .map((archive) => (
                <button
                  className="archive-switcher__archive"
                  key={archive.id}
                  onClick={() => switchArchive(archive)}
                  type="button"
                >
                  <span>{archive.displayName}</span>
                </button>
              ))}
            <div className="archive-switcher__divider" role="separator" />
            <button className="archive-switcher__manage" onClick={manageArchives} type="button">
              <Archive aria-hidden="true" size={16} weight="regular" />
              <span>Manage archives</span>
            </button>
          </div>
        </details>
        <IconButton
          label="About Archeion"
          onClick={onOpenAbout}
          onFocus={onPreloadAbout}
          onPointerEnter={onPreloadAbout}
        >
          <Question aria-hidden="true" size={17} weight="bold" />
        </IconButton>
        <IconButton
          label="Settings"
          onClick={onOpenSettings}
          onFocus={onPreloadSettings}
          onPointerEnter={onPreloadSettings}
        >
          <GearSix aria-hidden="true" size={18} />
        </IconButton>
      </div>
    </aside>
  );
});
