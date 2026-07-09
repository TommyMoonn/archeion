import { ArrowRight, DotsThree, FolderOpen, PencilSimple, Trash } from "@phosphor-icons/react";
import type { Folder } from "../../types/folder";
import { useDismissibleDetails } from "../../utils/useDismissibleDetails";

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
      <summary aria-label={`Actions for ${folder.name}`} title={`Actions for ${folder.name}`}>
        <DotsThree aria-hidden="true" size={18} weight="bold" />
      </summary>
      <div className="folder-menu__popover" role="menu">
        {showRename && onRename ? (
          <button type="button" role="menuitem" onClick={() => runAction(onRename)}>
            <PencilSimple aria-hidden="true" size={16} weight="regular" />
            Rename
          </button>
        ) : null}
        <button type="button" role="menuitem" onClick={() => runAction(onMove)}>
          <ArrowRight aria-hidden="true" size={16} weight="regular" />
          Move
        </button>
        {showReveal && onReveal ? (
          <button type="button" role="menuitem" onClick={() => runAction(onReveal)}>
            <FolderOpen aria-hidden="true" size={16} weight="regular" />
            Reveal
          </button>
        ) : null}
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
