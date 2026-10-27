import { MoveRight } from "lucide-react";
import { useMemo, useState } from "react";

import { MoveToFolderFields } from "./MoveToFolderFields";
import { moveDestinationOptions } from "./moveDestinationOptions";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import type { ReadonlyFolder } from "../../types/folder";
import { ARCHIVE_ROOT_DESTINATION } from "./archiveImport";

type MoveToFolderDialogProps = {
  currentFolderId?: string | null;
  excludedFolderIds?: string[];
  folders: readonly ReadonlyFolder[];
  onClose: () => void;
  onMove: (folderId: string | null) => Promise<void>;
  returnFocusTo?: HTMLElement | null;
  title: string;
  disableUnchanged?: boolean;
};

type DestinationValue = typeof ARCHIVE_ROOT_DESTINATION | string;

export function MoveToFolderDialog({
  currentFolderId = null,
  excludedFolderIds = [],
  folders,
  onClose,
  onMove,
  returnFocusTo,
  title,
  disableUnchanged = true,
}: MoveToFolderDialogProps) {
  const options = useMemo(
    () => moveDestinationOptions(folders, excludedFolderIds),
    [folders, excludedFolderIds],
  );
  const currentValue = currentFolderId ?? ARCHIVE_ROOT_DESTINATION;
  const [destination, setDestination] = useState<DestinationValue>(currentValue);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isUnchanged = disableUnchanged && destination === currentValue;

  async function submit() {
    if (isSaving || isUnchanged) {
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await onMove(destination === ARCHIVE_ROOT_DESTINATION ? null : destination);
      onClose();
    } catch (moveError) {
      setError(
        moveError instanceof Error && moveError.message
          ? moveError.message
          : "The item could not be moved.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Dialog
      returnFocusTo={returnFocusTo}
      title={title}
      feedback={
        error ? (
          <p className="form-error" role="alert">
            {error}
          </p>
        ) : (
          <p role="status">{isSaving ? "Moving…" : ""}</p>
        )
      }
      onClose={() => {
        if (!isSaving) {
          onClose();
        }
      }}
      footer={
        <>
          <Button variant="secondary" disabled={isSaving} onClick={onClose}>
            Cancel
          </Button>
          <Button
            icon={<MoveRight aria-hidden="true" />}
            busy={isSaving}
            disabled={isSaving || isUnchanged}
            onClick={() => void submit()}
          >
            Move
          </Button>
        </>
      }
    >
      <MoveToFolderFields {...{ options, destination, setDestination }} />
    </Dialog>
  );
}
