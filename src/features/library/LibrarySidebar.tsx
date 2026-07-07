import {
  Archive,
  Books,
  CaretUpDown,
  Check,
  ClockCounterClockwise,
  Folders,
  GearSix,
  Heart,
  Plus,
  Question,
} from "@phosphor-icons/react";
import { memo, useCallback } from "react";

import { IconButton } from "../../components/IconButton";
import type { KnownArchive } from "../../types/archive";
import type { Folder } from "../../types/folder";
import { useDismissibleDetails } from "../../utils/useDismissibleDetails";
import { FolderTree } from "../folders/FolderTree";
import type { LibraryLocation } from "./libraryFilters";

type LibrarySidebarProps = {
  activeArchive: KnownArchive;
  archives: KnownArchive[];
  bookCount: number;
  favoriteCount: number;
  continueCount: number;
  folders: Folder[];
  location: LibraryLocation;
  canManageFolders?: boolean;
  onCreateFolder: () => void;
  onDeleteFolder: (folder: Folder) => void;
  onManageArchives: () => void;
  onMoveFolder: (folder: Folder) => void;
  onLocationChange: (location: LibraryLocation) => void;
  onOpenAbout: () => void;
  onOpenSettings: () => void;
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
  continueCount,
  folders,
  location,
  canManageFolders = true,
  onCreateFolder,
  onDeleteFolder,
  onManageArchives,
  onMoveFolder,
  onLocationChange,
  onOpenAbout,
  onOpenSettings,
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
          aria-current={location.type === "continue" ? "page" : undefined}
          className={`nav-item ${location.type === "continue" ? "active" : ""}`}
          type="button"
          onClick={() => onLocationChange({ type: "continue" })}
        >
          <ClockCounterClockwise
            aria-hidden="true"
            size={19}
            weight="regular"
          />
          <span>Continue</span>
          <span className="nav-item__count">{continueCount}</span>
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

      <div className="sidebar__section">
        <div className="sidebar__section-heading">
          <div className="section-label">Folders</div>
          {canManageFolders ? (
            <IconButton label="Create folder" onClick={onCreateFolder}>
              <Plus aria-hidden="true" size={17} weight="regular" />
            </IconButton>
          ) : null}
        </div>
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
            onSelect={(folder) =>
              onLocationChange({ type: "folder", folderId: folder.id })
            }
          />
        ) : (
          <p className="folder-placeholder">No folders found</p>
        )}
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
            <button
              className="archive-switcher__manage"
              onClick={manageArchives}
              type="button"
            >
              <Archive aria-hidden="true" size={16} weight="regular" />
              <span>Manage archives</span>
            </button>
          </div>
        </details>
        <IconButton label="About Archeion" onClick={onOpenAbout}>
          <Question aria-hidden="true" size={17} weight="bold" />
        </IconButton>
        <IconButton label="Settings" onClick={onOpenSettings}>
          <GearSix aria-hidden="true" size={18} />
        </IconButton>
      </div>
    </aside>
  );
});
