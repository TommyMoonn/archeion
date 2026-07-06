import {
  DotsThree,
  Folder as FolderIcon,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react";
import {
  useEffect,
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import type { Folder } from "../../types/folder";
import type { LibraryLocation } from "../library/libraryFilters";
import {
  buildFolderTree,
  type FolderTreeNode,
} from "./folderTreeUtils";

type FolderTreeProps = {
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
      if (event.key === "Escape" && menuRef.current?.open) {
        menuRef.current?.removeAttribute("open");
        menuRef.current?.querySelector("summary")?.focus();
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
      <summary
        aria-label={`Actions for ${folder.name}`}
        title={`Actions for ${folder.name}`}
      >
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
      <div
        className="folder-tree__row"
        data-has-actions={showActions ? "true" : undefined}
      >
        <button
          aria-current={isSelected ? "page" : undefined}
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
  folders,
  location,
  onDelete,
  onRename,
  onSelect,
  showActions = true,
}: FolderTreeProps) {
  const tree = useMemo(() => buildFolderTree(folders), [folders]);
  const treeRef = useRef<HTMLUListElement>(null);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLUListElement>) {
    const target = event.target;
    if (
      !(target instanceof HTMLButtonElement) ||
      !target.classList.contains("folder-tree__select")
    ) {
      return;
    }

    const items = Array.from(
      treeRef.current?.querySelectorAll<HTMLButtonElement>(
        ".folder-tree__select",
      ) ?? [],
    );
    const index = items.indexOf(target);
    let next: HTMLButtonElement | undefined;

    if (event.key === "ArrowDown") {
      next = items[index + 1];
    } else if (event.key === "ArrowUp") {
      next = items[index - 1];
    } else if (event.key === "Home") {
      next = items[0];
    } else if (event.key === "End") {
      next = items.at(-1);
    } else if (event.key === "ArrowRight") {
      next = target
        .closest("li")
        ?.querySelector<HTMLButtonElement>(
          ":scope > .folder-tree__children > li > .folder-tree__row > .folder-tree__select",
        ) ?? undefined;
    } else if (event.key === "ArrowLeft") {
      next = target
        .closest("ul.folder-tree__children")
        ?.closest("li")
        ?.querySelector<HTMLButtonElement>(
          ":scope > .folder-tree__row > .folder-tree__select",
        ) ?? undefined;
    } else {
      return;
    }

    event.preventDefault();
    next?.focus();
  }

  return (
    <ul
      aria-label="Library folders"
      className="folder-tree"
      onKeyDown={handleKeyDown}
      ref={treeRef}
    >
      {tree.map((folder) => (
        <FolderNode
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
