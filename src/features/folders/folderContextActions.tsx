import { ArrowRight, FolderOpen, Pencil, Trash2 } from "lucide-react";

import type { ContextMenuAction } from "../../components/ContextMenu";
import type { ReadonlyFolder } from "../../types/folder";

type FolderContextActionOptions = {
  folder: ReadonlyFolder;
  onDelete: (folder: ReadonlyFolder) => void;
  onMove: (folder: ReadonlyFolder) => void;
  onRename?: (folder: ReadonlyFolder) => void;
  onReveal?: (folder: ReadonlyFolder) => void;
  showRename: boolean;
  showReveal: boolean;
};

export function createFolderContextActions({
  folder,
  onDelete,
  onMove,
  onRename,
  onReveal,
  showRename,
  showReveal,
}: FolderContextActionOptions): ContextMenuAction[] {
  const actions: ContextMenuAction[] = [];

  if (showRename && onRename) {
    actions.push({
      icon: <Pencil />,
      id: "rename",
      label: "Rename folder",
      onSelect: () => onRename(folder),
    });
  }

  actions.push({
    icon: <ArrowRight />,
    id: "move",
    label: "Move folder",
    onSelect: () => onMove(folder),
  });

  if (showReveal && onReveal) {
    actions.push({
      icon: <FolderOpen />,
      id: "reveal",
      label: "Reveal folder",
      onSelect: () => onReveal(folder),
    });
  }

  actions.push({
    className: "folder-menu__danger",
    danger: true,
    icon: <Trash2 />,
    id: "delete",
    label: "Delete folder",
    onSelect: () => onDelete(folder),
  });

  return actions;
}
