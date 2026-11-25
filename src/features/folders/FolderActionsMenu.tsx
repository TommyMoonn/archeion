import { Ellipsis } from "lucide-react";

import { ContextMenuSurface, ContextMenuTrigger } from "../../components/ContextMenu";
import type { ContextMenuController } from "../../components/contextMenuController";
import type { ReadonlyFolder } from "../../types/folder";
import { createFolderContextActions } from "./folderContextActions";

type FolderActionsMenuProps = {
  controller: ContextMenuController;
  folder: ReadonlyFolder;
  onDelete: (folder: ReadonlyFolder) => void;
  onMove: (folder: ReadonlyFolder) => void;
  onRename?: (folder: ReadonlyFolder) => void;
  onReveal?: (folder: ReadonlyFolder) => void;
  dismissKey?: string;
  surface?: "tree" | "browser";
  showRename?: boolean;
  showReveal?: boolean;
};

export function FolderActionsMenu({
  controller,
  folder,
  onDelete,
  onMove,
  onRename,
  onReveal,
  dismissKey,
  surface = "browser",
  showRename = true,
  showReveal = false,
}: FolderActionsMenuProps) {
  const actions = createFolderContextActions({
    folder,
    onDelete,
    onMove,
    onRename,
    onReveal,
    showRename,
    showReveal,
  });

  return (
    <>
      <span
        className={
          surface === "tree" ? "folder-menu absolute top-folder-action-gap end-0" : "folder-menu"
        }
        data-open={controller.isOpen || undefined}
      >
        <ContextMenuTrigger
          controller={controller}
          className={[
            "transition-folder-menu hover:text-text hover:bg-surface-raised focus-visible:text-text focus-visible:bg-surface-raised aria-expanded:text-text aria-expanded:bg-surface-raised",
            surface === "tree" &&
              "folder-fine-pointer:opacity-0 folder-fine-pointer:group-hover/folder-row:opacity-100 folder-fine-pointer:group-focus-within/folder-row:opacity-100 folder-fine-pointer:group-data-[context-menu-open]/folder-row:opacity-100 folder-fine-pointer:aria-expanded:opacity-100",
          ]
            .filter(Boolean)
            .join(" ")}
          label={`Actions for ${folder.name}`}
          tooltip={`Actions for ${folder.name}`}
        >
          <span aria-hidden="true" className="icon-slot">
            <Ellipsis />
          </span>
        </ContextMenuTrigger>
      </span>
      <ContextMenuSurface
        actions={actions}
        ariaLabel={`Actions for ${folder.name}`}
        className="folder-menu__popover w-folder-menu-width"
        controller={controller}
        dismissKey={dismissKey}
      />
    </>
  );
}
