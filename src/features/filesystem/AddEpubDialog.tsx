import { open } from "@tauri-apps/plugin-dialog";
import { Plus, CircleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { AddEpubDialogFields } from "./AddEpubDialogFields";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import type { AddArchiveEpubInput } from "../../storage/LibraryStorage";
import type { ArchiveImportConflictAction, ArchiveImportMode } from "../../types/archiveImport";
import type { ReadonlyFolder } from "../../types/folder";
import { defaultAppPreferences } from "../../types/appSettings";
import type { GlobalImportSettings } from "../../types/settings";
import {
  ARCHIVE_ROOT_DESTINATION,
  createArchiveDestinationOptions,
  destinationValueFromFolderPath,
  destinationValueToFolderPath,
  isEpubSourcePath,
} from "./archiveImport";
import { shouldConfirmImportReplace } from "./destructiveActionPolicy";

type AddEpubDialogProps = {
  folders: readonly ReadonlyFolder[];
  confirmDestructiveFileActions?: boolean;
  importDefaults?: GlobalImportSettings;
  initialFolderPath?: string;
  initialSourcePaths?: string[];
  isImporting?: boolean;
  onClose: () => void;
  onImport: (input: AddArchiveEpubInput) => Promise<void>;
};

function normalizeSelectedPaths(selected: string | string[] | null): string[] {
  if (!selected) {
    return [];
  }
  return Array.isArray(selected) ? selected : [selected];
}

export function AddEpubDialog({
  folders,
  confirmDestructiveFileActions = true,
  importDefaults = defaultAppPreferences.import,
  initialFolderPath,
  initialSourcePaths = [],
  isImporting = false,
  onClose,
  onImport,
}: AddEpubDialogProps) {
  const destinations = useMemo(() => createArchiveDestinationOptions(folders), [folders]);
  const initialDestination = destinationValueFromFolderPath(initialFolderPath);
  const hasInitialDestination = destinations.some(
    (destination) => destination.value === initialDestination,
  );
  const [sourcePaths, setSourcePaths] = useState<string[]>(() =>
    initialSourcePaths.filter(isEpubSourcePath),
  );
  const [destinationValue, setDestinationValue] = useState(
    hasInitialDestination ? initialDestination : ARCHIVE_ROOT_DESTINATION,
  );
  const [conflictAction, setConflictAction] = useState<ArchiveImportConflictAction>(
    importDefaults.defaultConflictAction,
  );
  const [mode, setMode] = useState<ArchiveImportMode>(importDefaults.defaultMode);
  const [error, setError] = useState<string | null>(null);
  const [replaceConfirmationOpen, setReplaceConfirmationOpen] = useState(false);

  async function chooseFiles() {
    setError(null);
    const selected = await open({
      multiple: true,
      filters: [{ name: "EPUB", extensions: ["epub"] }],
    });
    const paths = normalizeSelectedPaths(selected);
    const epubPaths = paths.filter(isEpubSourcePath);

    if (paths.length > 0 && epubPaths.length !== paths.length) {
      setError("Only EPUB files can be added.");
    }

    setSourcePaths(epubPaths);
  }

  async function runImport() {
    if (sourcePaths.length === 0 || isImporting) {
      return;
    }

    setError(null);
    try {
      await onImport({
        conflictAction,
        destinationFolderPath: destinationValueToFolderPath(destinationValue),
        mode,
        sourcePaths,
      });
      onClose();
    } catch (submitError) {
      setError(
        submitError instanceof Error && submitError.message
          ? submitError.message
          : "The EPUB files could not be added.",
      );
    }
  }

  function submit() {
    if (sourcePaths.length === 0 || isImporting) {
      return;
    }

    if (shouldConfirmImportReplace(confirmDestructiveFileActions, conflictAction)) {
      setReplaceConfirmationOpen(true);
      return;
    }

    void runImport();
  }

  if (replaceConfirmationOpen) {
    return (
      <Dialog
        closeOnBackdropClick={initialSourcePaths.length === 0}
        title="Replace existing EPUB files?"
        description="Files with matching names will be replaced. Existing files are preserved until each replacement succeeds."
        feedback={
          error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : (
            <p role="status">{isImporting ? "Replacing and adding EPUB files…" : ""}</p>
          )
        }
        onClose={() => {
          if (!isImporting) {
            setReplaceConfirmationOpen(false);
          }
        }}
        footer={
          <>
            <Button
              disabled={isImporting}
              onClick={() => setReplaceConfirmationOpen(false)}
              variant="secondary"
            >
              Cancel
            </Button>
            <Button
              icon={<Plus aria-hidden="true" />}
              busy={isImporting}
              disabled={isImporting}
              onClick={() => void runImport()}
              variant="danger"
            >
              Replace and add
            </Button>
          </>
        }
      />
    );
  }

  return (
    <Dialog
      closeOnBackdropClick={initialSourcePaths.length === 0}
      title="Add EPUB files"
      feedback={
        error ? (
          <p className="form-error add-epub-dialog__error" role="alert">
            <CircleAlert aria-hidden="true" size={15} />
            {error}
          </p>
        ) : (
          <p role="status">{isImporting ? "Adding EPUB files…" : ""}</p>
        )
      }
      onClose={() => {
        if (!isImporting) {
          onClose();
        }
      }}
      footer={
        <>
          <Button disabled={isImporting} variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            busy={isImporting}
            disabled={isImporting || sourcePaths.length === 0}
            icon={<Plus aria-hidden="true" />}
            onClick={submit}
          >
            Add EPUB
          </Button>
        </>
      }
    >
      <AddEpubDialogFields
        {...{
          sourcePaths,
          destinations,
          destinationValue,
          conflictAction,
          mode,
          isImporting,
          chooseFiles,
          setDestinationValue,
          setConflictAction,
          setMode,
        }}
      />
    </Dialog>
  );
}
