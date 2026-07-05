import {
  Books,
  CaretUpDown,
  Check,
  ClockCounterClockwise,
  FolderOpen,
  Folders,
  GearSix,
  Heart,
  Plus,
  Question,
} from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

import { IconButton } from "../../components/IconButton";
import { FolderTree } from "../folders/FolderTree";
import type { Folder } from "../../types/folder";
import { archiveName } from "./archiveName";
import type { LibraryLocation } from "./libraryFilters";

type LibrarySidebarProps = {
  bookCount: number;
  bookCountsByFolder: Map<string, number>;
  favoriteCount: number;
  continueCount: number;
  folders: Folder[];
  location: LibraryLocation;
  archivePath: string;
  canManageFolders?: boolean;
  onChangeArchive: () => void;
  onCreateFolder: () => void;
  onDeleteFolder: (folder: Folder) => void;
  onLocationChange: (location: LibraryLocation) => void;
  onOpenAbout: () => void;
  onOpenSettings: () => void;
  onRenameFolder: (folder: Folder) => void;
};

export function LibrarySidebar({
  bookCount,
  bookCountsByFolder,
  favoriteCount,
  continueCount,
  folders,
  location,
  archivePath,
  canManageFolders = true,
  onChangeArchive,
  onCreateFolder,
  onDeleteFolder,
  onLocationChange,
  onOpenAbout,
  onOpenSettings,
  onRenameFolder,
}: LibrarySidebarProps) {
  const archiveSwitcherRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function closeArchiveSwitcher(event: KeyboardEvent | PointerEvent) {
      const switcher = archiveSwitcherRef.current;
      if (!switcher?.open) return;

      if (
        event instanceof PointerEvent &&
        switcher.contains(event.target as Node)
      ) {
        return;
      }

      switcher.removeAttribute("open");
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        switcher.querySelector("summary")?.focus();
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeArchiveSwitcher(event);
    }

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("pointerdown", closeArchiveSwitcher);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("pointerdown", closeArchiveSwitcher);
    };
  }, []);

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand__mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span>Archeion</span>
      </div>

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
          <div className="section-label">
            Folders
          </div>
          {canManageFolders ? (
            <IconButton
              label="Create folder"
              onClick={onCreateFolder}
            >
              <Plus aria-hidden="true" size={17} weight="regular" />
            </IconButton>
          ) : null}
        </div>
        {folders.length > 0 ? (
          <FolderTree
            bookCounts={bookCountsByFolder}
            folders={folders}
            location={location}
            onDelete={onDeleteFolder}
            onRename={onRenameFolder}
            showActions={canManageFolders}
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
          <summary aria-label={`Current archive: ${archiveName(archivePath)}`}>
            <CaretUpDown aria-hidden="true" size={14} weight="bold" />
            <span>{archiveName(archivePath)}</span>
          </summary>
          <div className="archive-switcher__menu">
            <div className="archive-switcher__current">
              <span>{archiveName(archivePath)}</span>
              <Check aria-hidden="true" size={15} weight="bold" />
            </div>
            <button
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                onChangeArchive();
              }}
              type="button"
            >
              <FolderOpen aria-hidden="true" size={16} />
              Change archive
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
}
