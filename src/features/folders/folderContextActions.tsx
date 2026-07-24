import { ArrowRight, FolderOpen, PencilSimple, Trash } from "@phosphor-icons/react";

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
      icon: <PencilSimple weight="regular" />,
      id: "rename",
      label: "Rename",
      onSelect: () => onRename(folder),
    });
  }

  actions.push({
    icon: <ArrowRight weight="regular" />,
    id: "move",
    label: "Move",
    onSelect: () => onMove(folder),
  });

  if (showReveal && onReveal) {
    actions.push({
      icon: <FolderOpen weight="regular" />,
      id: "reveal",
      label: "Reveal",
      onSelect: () => onReveal(folder),
    });
  }

  actions.push({
    className: "folder-menu__danger",
    danger: true,
    icon: <Trash weight="regular" />,
    id: "delete",
    label: "Delete",
    onSelect: () => onDelete(folder),
  });

  return actions;
}
