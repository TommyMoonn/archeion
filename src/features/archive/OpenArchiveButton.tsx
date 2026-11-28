import { FolderOpen } from "lucide-react";
import { useRef, useState } from "react";

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
  const opening = useRef(false);

  async function handleOpen() {
    if (opening.current) {
      return;
    }

    opening.current = true;
    setIsOpening(true);
    try {
      const opened = await archiveStore.chooseArchive();
      if (opened) {
        await onOpened?.();
      }
    } finally {
      opening.current = false;
      setIsOpening(false);
    }
  }

  return (
    <Button
      busy={isOpening}
      busyStatus="Opening archive…"
      className={className}
      disabled={isOpening}
      icon={<FolderOpen aria-hidden="true" />}
      onClick={handleOpen}
      variant={variant}
    >
      {description ? (
        <span className="grid min-w-0 gap-archive-action-gap text-start">
          <span className="text-body-only font-medium text-text-strong wrap-anywhere">{label}</span>
          <span className="text-caption leading-archive-action-description text-muted wrap-anywhere">
            {description}
          </span>
        </span>
      ) : (
        label
      )}
    </Button>
  );
}
