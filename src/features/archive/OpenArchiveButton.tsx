import { FolderOpen } from "@phosphor-icons/react";
import { useState } from "react";

import { Button } from "../../components/Button";
import { archiveStore } from "../../stores/archiveStore";

type OpenArchiveButtonProps = {
  className?: string;
  description?: string;
  label?: string;
  onOpened?: () => void | Promise<unknown>;
  variant?: "primary" | "secondary" | "ghost";
};

export function OpenArchiveButton({
  className,
  description,
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

  const buttonLabel = isOpening ? "Opening" : label;

  return (
    <Button
      className={className}
      disabled={isOpening}
      icon={<FolderOpen aria-hidden="true" size={18} />}
      onClick={handleOpen}
      variant={variant}
    >
      {description ? (
        <span className="archive-action-row__copy">
          <span className="archive-action-row__title">{buttonLabel}</span>
          <span className="archive-action-row__description">{description}</span>
        </span>
      ) : (
        buttonLabel
      )}
    </Button>
  );
}
