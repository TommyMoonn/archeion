import { ArrowRight, DotsThree, FolderOpen, PencilSimple, Trash } from "@phosphor-icons/react";
import type { Folder } from "../../types/folder";
import { useDismissibleDetails } from "../../utils/useDismissibleDetails";
import { MenuItem } from "../../components/MenuItem";

type FolderActionsMenuProps = {
  folder: Folder;
  onDelete: (folder: Folder) => void;
  onMove: (folder: Folder) => void;
  onRename?: (folder: Folder) => void;
  onReveal?: (folder: Folder) => void;
  showRename?: boolean;
  showReveal?: boolean;
};

export function FolderActionsMenu({
  folder,
  onDelete,
  onMove,
  onRename,
  onReveal,
  showRename = true,
  showReveal = false,
}: FolderActionsMenuProps) {
  const { closeDetails, detailsRef } = useDismissibleDetails();

  function runAction(action: (folder: Folder) => void) {
    closeDetails();
    action(folder);
  }

  return (
    <details ref={detailsRef} className="folder-menu" onClick={(event) => event.stopPropagation()}>
      <summary
        aria-label={`Actions for ${folder.name}`}
        className="menu-trigger"
        title={`Actions for ${folder.name}`}
      >
        <span aria-hidden="true" className="icon-slot">
          <DotsThree weight="bold" />
        </span>
      </summary>
      <div className="folder-menu__popover menu-popover" role="menu">
        {showRename && onRename ? (
          <MenuItem icon={<PencilSimple weight="regular" />} onClick={() => runAction(onRename)}>
            Rename
          </MenuItem>
        ) : null}
        <MenuItem icon={<ArrowRight weight="regular" />} onClick={() => runAction(onMove)}>
          Move
        </MenuItem>
        {showReveal && onReveal ? (
          <MenuItem icon={<FolderOpen weight="regular" />} onClick={() => runAction(onReveal)}>
            Reveal
          </MenuItem>
        ) : null}
        <MenuItem
          className="folder-menu__danger"
          danger
          icon={<Trash weight="regular" />}
          onClick={() => runAction(onDelete)}
        >
          Delete
        </MenuItem>
      </div>
    </details>
  );
}
