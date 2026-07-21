import { DotsThree } from "@phosphor-icons/react";

import { ContextMenuSurface, ContextMenuTrigger } from "../../components/ContextMenu";
import type { ContextMenuController } from "../../components/contextMenuController";
import type { Folder } from "../../types/folder";
import { createFolderContextActions } from "./folderContextActions";

type FolderActionsMenuProps = {
  controller: ContextMenuController;
  folder: Folder;
  onDelete: (folder: Folder) => void;
  onMove: (folder: Folder) => void;
  onRename?: (folder: Folder) => void;
  onReveal?: (folder: Folder) => void;
  dismissKey?: string;
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
      <span className="folder-menu" data-open={controller.isOpen || undefined}>
        <ContextMenuTrigger
          controller={controller}
          label={`Actions for ${folder.name}`}
          title={`Actions for ${folder.name}`}
        >
          <span aria-hidden="true" className="icon-slot">
            <DotsThree weight="bold" />
          </span>
        </ContextMenuTrigger>
      </span>
      <ContextMenuSurface
        actions={actions}
        ariaLabel={`Actions for ${folder.name}`}
        className="folder-menu__popover"
        controller={controller}
        dismissKey={dismissKey}
      />
    </>
  );
}
