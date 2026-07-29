import { FolderOpen, PencilSimple, Trash } from "@phosphor-icons/react";

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
      icon: <PencilSimple weight="regular" />,
      id: "rename",
      label: "Rename archive",
      onSelect: onRename,
    },
    {
      disabled,
      icon: <FolderOpen weight="regular" />,
      id: "reveal",
      label: "Reveal archive folder",
      onSelect: onReveal,
    },
    {
      className: "archive-row-menu__danger",
      danger: true,
      disabled,
      icon: <Trash weight="regular" />,
      id: "forget",
      label: "Forget archive",
      onSelect: onForget,
    },
  ];
}
