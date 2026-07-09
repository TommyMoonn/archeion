import { FolderOpen } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "../../components/Button";
import { archiveStore } from "../../stores/archiveStore";

type OpenArchiveButtonProps = {
  className?: string;
  label?: string;
  onOpened?: () => void | Promise<unknown>;
  variant?: "primary" | "secondary" | "ghost";
};

export function OpenArchiveButton({
  className,
  label = "Open folder as archive",
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
      const opened = await archiveStore.chooseArchive();
      if (opened) {
        await onOpened?.();
      }
    } finally {
      setIsOpening(false);
    }
  }

  return (
    <Button
      className={className}
      disabled={isOpening}
      icon={<FolderOpen aria-hidden="true" size={18} />}
      onClick={handleOpen}
      variant={variant}
    >
      {isOpening ? "Opening" : label}
    </Button>
  );
}
