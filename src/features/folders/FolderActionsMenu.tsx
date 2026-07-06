import {
  ArrowRight,
  DotsThree,
  FolderOpen,
  PencilSimple,
  Trash,
} from "@phosphor-icons/react";
import { useEffect, useRef } from "react";

import type { Folder } from "../../types/folder";

type FolderActionsMenuProps = {
  folder: Folder;
  onDelete: (folder: Folder) => void;
  onMove: (folder: Folder) => void;
  onRename: (folder: Folder) => void;
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
    <details
      ref={menuRef}
      className="folder-menu"
      onClick={(event) => event.stopPropagation()}
    >
      <summary
        aria-label={`Actions for ${folder.name}`}
        title={`Actions for ${folder.name}`}
      >
        <DotsThree aria-hidden="true" size={18} weight="bold" />
      </summary>
      <div className="folder-menu__popover" role="menu">
        {showRename ? (
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
          <button
            type="button"
            role="menuitem"
            onClick={() => runAction(onReveal)}
          >
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
