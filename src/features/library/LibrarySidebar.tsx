import {
  Books,
  CaretDown,
  Folder,
  Heart,
  Plus,
} from "@phosphor-icons/react";
import { NavLink } from "react-router-dom";

import { IconButton } from "../../components/IconButton";

type LibrarySidebarProps = {
  bookCount: number;
};

export function LibrarySidebar({ bookCount }: LibrarySidebarProps) {
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
        <NavLink className="nav-item" to="/">
          <Books aria-hidden="true" size={19} weight="regular" />
          <span>Library</span>
          <span className="nav-item__count">{bookCount}</span>
        </NavLink>
        <button
          className="nav-item"
          type="button"
          disabled
          title="Favorites are not available yet."
        >
          <Heart aria-hidden="true" size={19} weight="regular" />
          <span>Favorites</span>
          <span className="nav-item__count">0</span>
        </button>
      </nav>

      <div className="sidebar__section">
        <div className="sidebar__section-heading">
          <div className="section-label">
            <CaretDown aria-hidden="true" size={14} weight="bold" />
            Folders
          </div>
          <IconButton
            label="Create folder"
            disabled
            title="Folders are not available yet."
          >
            <Plus aria-hidden="true" size={17} weight="regular" />
          </IconButton>
        </div>
        <div className="folder-placeholder">
          <Folder aria-hidden="true" size={17} weight="regular" />
          <span>No folders yet</span>
        </div>
      </div>

      <p className="sidebar__storage">
        Your books stay on this device.
      </p>
    </aside>
  );
}
