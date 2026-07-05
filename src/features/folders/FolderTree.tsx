import {
  DotsThree,
  Folder as FolderIcon,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef } from "react";

import type { Folder } from "../../types/folder";
import type { LibraryLocation } from "../library/libraryFilters";
import {
  buildFolderTree,
  type FolderTreeNode,
} from "./folderTreeUtils";

type FolderTreeProps = {
  bookCounts: Map<string, number>;
  folders: Folder[];
  location: LibraryLocation;
  onDelete: (folder: Folder) => void;
  onRename: (folder: Folder) => void;
  onSelect: (folder: Folder) => void;
  showActions?: boolean;
};

type FolderNodeProps = Omit<FolderTreeProps, "folders"> & {
  folder: FolderTreeNode;
};

function FolderMenu({
  folder,
  onDelete,
  onRename,
}: Pick<FolderNodeProps, "folder" | "onDelete" | "onRename">) {
  const menuRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    function handlePointerDown(event: PointerEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        menuRef.current?.removeAttribute("open");
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        menuRef.current?.removeAttribute("open");
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  function runAction(action: (folder: Folder) => void) {
    menuRef.current?.removeAttribute("open");
    action(folder);
  }

  return (
    <details ref={menuRef} className="folder-menu">
      <summary aria-label={`Actions for ${folder.name}`}>
        <DotsThree aria-hidden="true" size={18} weight="bold" />
      </summary>
      <div className="folder-menu__popover" role="menu">
        <button type="button" role="menuitem" onClick={() => runAction(onRename)}>
          <PencilSimple aria-hidden="true" size={16} weight="regular" />
          Rename
        </button>
        <button
          className="folder-menu__danger"
          type="button"
          role="menuitem"
          onClick={() => runAction(onDelete)}
        >
          <Trash aria-hidden="true" size={16} weight="regular" />
          Delete
        </button>
      </div>
    </details>
  );
}

function FolderNode({
  bookCounts,
  folder,
  location,
  onDelete,
  onRename,
  onSelect,
  showActions = true,
}: FolderNodeProps) {
  const isSelected =
    location.type === "folder" && location.folderId === folder.id;

  return (
    <li>
      <div className="folder-tree__row">
        <button
          className="folder-tree__select"
          data-active={isSelected || undefined}
          type="button"
          onClick={() => onSelect(folder)}
        >
          <FolderIcon
            aria-hidden="true"
            size={17}
            weight={isSelected ? "fill" : "regular"}
          />
          <span>{folder.name}</span>
          <span className="nav-item__count">
            {bookCounts.get(folder.id) ?? 0}
          </span>
        </button>
        {showActions ? (
          <FolderMenu
            folder={folder}
            onDelete={onDelete}
            onRename={onRename}
          />
        ) : null}
      </div>
      {folder.children.length > 0 ? (
        <ul className="folder-tree__children">
          {folder.children.map((child) => (
            <FolderNode
              bookCounts={bookCounts}
              folder={child}
              key={child.id}
              location={location}
              onDelete={onDelete}
              onRename={onRename}
              onSelect={onSelect}
              showActions={showActions}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function FolderTree({
  bookCounts,
  folders,
  location,
  onDelete,
  onRename,
  onSelect,
  showActions = true,
}: FolderTreeProps) {
  const tree = useMemo(() => buildFolderTree(folders), [folders]);

  return (
    <ul className="folder-tree">
      {tree.map((folder) => (
        <FolderNode
          bookCounts={bookCounts}
          folder={folder}
          key={folder.id}
          location={location}
          onDelete={onDelete}
          onRename={onRename}
          onSelect={onSelect}
          showActions={showActions}
        />
      ))}
    </ul>
  );
}
