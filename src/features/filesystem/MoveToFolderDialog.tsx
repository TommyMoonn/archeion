import { Folder as FolderIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";

import { AppSelect } from "../../components/AppSelect";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import type { Folder } from "../../types/folder";
import { ARCHIVE_ROOT_DESTINATION } from "./archiveImport";

type MoveToFolderDialogProps = {
  currentFolderId?: string | null;
  excludedFolderIds?: string[];
  folders: Folder[];
  onClose: () => void;
  onMove: (folderId: string | null) => Promise<void>;
  title: string;
};

type DestinationValue = typeof ARCHIVE_ROOT_DESTINATION | string;

export function MoveToFolderDialog({
  currentFolderId = null,
  excludedFolderIds = [],
  folders,
  onClose,
  onMove,
  title,
}: MoveToFolderDialogProps) {
  const excluded = useMemo(
    () => new Set(excludedFolderIds),
    [excludedFolderIds],
  );
  const options = useMemo(
    () => [
      { label: "Library root", value: ARCHIVE_ROOT_DESTINATION },
      ...[...folders]
        .filter((folder) => folder.relativePath)
        .sort((left, right) =>
          (left.relativePath ?? "").localeCompare(right.relativePath ?? ""),
        )
        .map((folder) => ({
          disabled: excluded.has(folder.id),
          label: folder.relativePath ?? folder.name,
          value: folder.id,
        })),
    ],
    [excluded, folders],
  );
  const currentValue = currentFolderId ?? ARCHIVE_ROOT_DESTINATION;
  const [destination, setDestination] = useState<DestinationValue>(currentValue);
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const isUnchanged = destination === currentValue;

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
      title={title}
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
            disabled={isSaving || isUnchanged}
            onClick={() => void submit()}
          >
            {isSaving ? "Moving" : "Move"}
          </Button>
        </>
      }
    >
      <div className="move-to-folder-dialog">
        <AppSelect
          id="move-folder-destination"
          label={
            <span className="move-to-folder-dialog__label">
              <FolderIcon aria-hidden="true" size={14} />
              Destination
            </span>
          }
          onChange={setDestination}
          options={options}
          value={destination}
        />
        {error ? <p className="form-error">{error}</p> : null}
      </div>
    </Dialog>
  );
}
