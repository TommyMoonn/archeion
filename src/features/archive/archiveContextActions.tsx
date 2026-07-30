import { FolderOpen, Pencil, Trash2 } from "lucide-react";

import type { ContextMenuAction } from "../../components/ContextMenu";

type ArchiveContextActionOptions = {
  disabled: boolean;
  onForget: () => void;
  onReveal: () => void;
  onRename: () => void;
};

export function createArchiveContextActions({
  disabled,
  onForget,
  onReveal,
  onRename,
}: ArchiveContextActionOptions): ContextMenuAction[] {
  return [
    {
      disabled,
      icon: <Pencil />,
      id: "rename",
      label: "Rename archive",
      onSelect: onRename,
    },
    {
      disabled,
      icon: <FolderOpen />,
      id: "reveal",
      label: "Reveal archive folder",
      onSelect: onReveal,
    },
    {
      className: "archive-row-menu__danger",
      danger: true,
      disabled,
      icon: <Trash2 />,
      id: "forget",
      label: "Forget archive",
      onSelect: onForget,
    },
  ];
}
