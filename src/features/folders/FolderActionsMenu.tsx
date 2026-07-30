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
          tooltip={`Actions for ${folder.name}`}
        >
          <span aria-hidden="true" className="icon-slot">
            <Ellipsis strokeWidth={2.25} />
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
