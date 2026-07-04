import {
  Books,
  Heart,
  Plus,
} from "@phosphor-icons/react";

import { IconButton } from "../../components/IconButton";
import { FolderTree } from "../folders/FolderTree";
import type { Folder } from "../../types/folder";
import type { LibraryLocation } from "./libraryFilters";

type LibrarySidebarProps = {
  bookCount: number;
  bookCountsByFolder: Map<string, number>;
  favoriteCount: number;
  folders: Folder[];
  location: LibraryLocation;
  onCreateFolder: () => void;
  onDeleteFolder: (folder: Folder) => void;
  onLocationChange: (location: LibraryLocation) => void;
  onRenameFolder: (folder: Folder) => void;
};

export function LibrarySidebar({
  bookCount,
  bookCountsByFolder,
  favoriteCount,
  folders,
  location,
  onCreateFolder,
  onDeleteFolder,
  onLocationChange,
  onRenameFolder,
}: LibrarySidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand__mark" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <span>EPUB Archive</span>
      </div>

      <nav className="sidebar__nav" aria-label="Library navigation">
        <button
          className={`nav-item ${location.type === "library" ? "active" : ""}`}
          type="button"
          onClick={() => onLocationChange({ type: "library" })}
        >
          <Books aria-hidden="true" size={19} weight="regular" />
          <span>Library</span>
          <span className="nav-item__count">{bookCount}</span>
        </button>
        <button
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
      </nav>

      <div className="sidebar__section">
        <div className="sidebar__section-heading">
          <div className="section-label">
            Folders
          </div>
          <IconButton
            label="Create folder"
            onClick={onCreateFolder}
          >
            <Plus aria-hidden="true" size={17} weight="regular" />
          </IconButton>
        </div>
        {folders.length > 0 ? (
          <FolderTree
            bookCounts={bookCountsByFolder}
            folders={folders}
            location={location}
            onDelete={onDeleteFolder}
            onRename={onRenameFolder}
            onSelect={(folder) =>
              onLocationChange({ type: "folder", folderId: folder.id })
            }
          />
        ) : (
          <p className="folder-placeholder">No folders yet</p>
        )}
      </div>

      <p className="sidebar__storage">
        Your books stay on this device.
      </p>
    </aside>
  );
}
