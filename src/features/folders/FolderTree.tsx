import { Folder as FolderIcon } from "lucide-react";
import {
  useMemo,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

import { focusPresentationRuntime } from "../../app/inputModality";
import {
  openContextMenuFromKeyboard,
  openContextMenuFromPointer,
  useContextMenuController,
} from "../../components/contextMenuController";
import { Tooltip } from "../../components/Tooltip";
import type { ReadonlyFolder } from "../../types/folder";
import type { LibraryLocation } from "../../types/library";
import { folderMutationOwnerAttributes } from "./folderMutationFocus";
import { buildFolderTree, type FolderTreeNode } from "./folderTreeUtils";
import { FolderActionsMenu } from "./FolderActionsMenu";

type FolderTreeProps = {
  folderOrder?: ReadonlyMap<string, number>;
  folders: readonly ReadonlyFolder[];
  location: LibraryLocation;
  onDelete: (folder: ReadonlyFolder) => void;
  onMove: (folder: ReadonlyFolder) => void;
  onRename: (folder: ReadonlyFolder) => void;
  onReveal?: (folder: ReadonlyFolder) => void;
  onSelect: (folder: ReadonlyFolder) => void;
  activeImportDropTargetId?: string | null;
  showActions?: boolean;
  showReveal?: boolean;
};

type FolderNodeProps = Omit<FolderTreeProps, "folders"> & {
  folder: FolderTreeNode;
};

function FolderNode({
  folder,
  location,
  onDelete,
  onMove,
  onRename,
  onReveal,
  onSelect,
  activeImportDropTargetId,
  showActions = true,
  showReveal = false,
}: FolderNodeProps) {
  const isSelected = location.type === "folder" && location.folderId === folder.id;
  const contextMenu = useContextMenuController();
  const primaryActionRef = useRef<HTMLButtonElement>(null);
  const menuDismissKey =
    location.type === "folder" || location.type === "series-detail"
      ? `${location.type}:${location.type === "folder" ? location.folderId : location.seriesKey}`
      : location.type;

  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    if (!showActions) return;
    openContextMenuFromPointer(contextMenu, event, primaryActionRef.current);
  }

  function handlePrimaryKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!showActions) return;
    openContextMenuFromKeyboard(contextMenu, event);
  }

  return (
    <li>
      <div
        className="folder-tree__row"
        {...folderMutationOwnerAttributes(folder, "tree")}
        data-context-menu-open={contextMenu.isOpen || undefined}
        data-has-actions={showActions ? "true" : undefined}
        data-import-drop-active={
          activeImportDropTargetId === `sidebar-folder:${folder.id}` || undefined
        }
        data-import-drop-destination={folder.relativePath}
        data-import-drop-id={`sidebar-folder:${folder.id}`}
        data-import-drop-target={folder.relativePath ? "true" : undefined}
        onContextMenu={handleContextMenu}
      >
        <Tooltip content={folder.name} onlyWhenTruncated="span" placement="right">
          <button
            aria-current={isSelected ? "page" : undefined}
            className="folder-tree__select"
            data-active={isSelected || undefined}
            data-library-folder-primary-action
            onClick={() => onSelect(folder)}
            onKeyDown={handlePrimaryKeyDown}
            ref={primaryActionRef}
            type="button"
          >
            <FolderIcon aria-hidden="true" size={17} fill={isSelected ? "currentColor" : "none"} />
            <span>{folder.name}</span>
          </button>
        </Tooltip>
        {showActions ? (
          <FolderActionsMenu
            controller={contextMenu}
            dismissKey={menuDismissKey}
            folder={folder}
            onDelete={onDelete}
            onMove={onMove}
            onRename={onRename}
            onReveal={onReveal}
            showReveal={showReveal}
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
              onMove={onMove}
              onRename={onRename}
              onReveal={onReveal}
              onSelect={onSelect}
              activeImportDropTargetId={activeImportDropTargetId}
              showActions={showActions}
              showReveal={showReveal}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function FolderTree({
  folderOrder,
  folders,
  location,
  onDelete,
  onMove,
  onRename,
  onReveal,
  onSelect,
  activeImportDropTargetId,
  showActions = true,
  showReveal = false,
}: FolderTreeProps) {
  const tree = useMemo(() => buildFolderTree(folders, folderOrder), [folderOrder, folders]);
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
      treeRef.current?.querySelectorAll<HTMLButtonElement>(".folder-tree__select") ?? [],
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
      next =
        target
          .closest("li")
          ?.querySelector<HTMLButtonElement>(
            ":scope > .folder-tree__children > li > .folder-tree__row > .folder-tree__select",
          ) ?? undefined;
    } else if (event.key === "ArrowLeft") {
      next =
        target
          .closest("ul.folder-tree__children")
          ?.closest("li")
          ?.querySelector<HTMLButtonElement>(":scope > .folder-tree__row > .folder-tree__select") ??
        undefined;
    } else {
      return;
    }

    event.preventDefault();
    if (next) {
      focusPresentationRuntime.markKeyboardNavigation();
      next.focus();
    }
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
          onMove={onMove}
          onRename={onRename}
          onReveal={onReveal}
          onSelect={onSelect}
          activeImportDropTargetId={activeImportDropTargetId}
          showActions={showActions}
          showReveal={showReveal}
        />
      ))}
    </ul>
  );
}
