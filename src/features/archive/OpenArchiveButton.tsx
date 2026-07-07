import { FolderOpen, Plus } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "../../components/Button";
import { archiveStore } from "../../stores/archiveStore";

type ArchiveAction = "create" | "open";

type OpenArchiveButtonProps = {
  action?: ArchiveAction;
  className?: string;
  label?: string;
  onOpened?: () => void;
  variant?: "primary" | "secondary" | "ghost";
};

const actionLabels: Record<ArchiveAction, string> = {
  create: "Create empty archive",
  open: "Open folder as archive",
};

export function OpenArchiveButton({
  action = "open",
  className,
  label = actionLabels[action],
  onOpened,
  variant = "primary",
}: OpenArchiveButtonProps) {
  const [isOpening, setIsOpening] = useState(false);

  async function handleOpen() {
    if (isOpening) {
      return;
    }

    setIsOpening(true);
    try {
      const opened =
        action === "create"
          ? await archiveStore.createArchive()
          : await archiveStore.chooseArchive();
      if (opened) {
        onOpened?.();
      }
    } finally {
      setIsOpening(false);
    }
  }

  return (
    <Button
      className={className}
      disabled={isOpening}
      icon={
        action === "create" ? (
          <Plus aria-hidden="true" size={18} />
        ) : (
          <FolderOpen aria-hidden="true" size={18} />
        )
      }
      onClick={handleOpen}
      variant={variant}
    >
      {isOpening ? "Opening" : label}
    </Button>
  );
}
