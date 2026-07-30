import { open } from "@tauri-apps/plugin-dialog";
import { FilePlus, Files, Folder as FolderIcon, CircleAlert } from "lucide-react";
import { useMemo, useState } from "react";

import { AppSelect } from "../../components/AppSelect";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { SegmentedControl } from "../../components/SegmentedControl";
import type { AddArchiveEpubInput } from "../../storage/LibraryStorage";
import type { ArchiveImportConflictAction, ArchiveImportMode } from "../../types/archiveImport";
import type { ReadonlyFolder } from "../../types/folder";
import { defaultAppPreferences } from "../../types/appSettings";
import type { ImportSettings } from "../../types/settings";
import {
  ARCHIVE_ROOT_DESTINATION,
  archiveImportConflictOptions,
  archiveImportModeOptions,
  createArchiveDestinationOptions,
  destinationValueFromFolderPath,
  destinationValueToFolderPath,
  getFileNameFromPath,
  isEpubSourcePath,
} from "./archiveImport";
import { shouldConfirmImportReplace } from "./destructiveActionPolicy";

type AddEpubDialogProps = {
  folders: readonly ReadonlyFolder[];
  confirmDestructiveFileActions?: boolean;
  importDefaults?: ImportSettings;
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
  const initialDestination = destinationValueFromFolderPath(
    initialFolderPath ?? importDefaults.defaultDestinationFolderPath,
  );
  const hasInitialDestination = destinations.some(
    (destination) => destination.value === initialDestination,
  );
  const [sourcePaths, setSourcePaths] = useState<string[]>(() =>
    initialSourcePaths.filter(isEpubSourcePath),
  );
  const [destinationValue, setDestinationValue] = useState(
    hasInitialDestination
      ? initialDestination
      : (destinations[0]?.value ?? ARCHIVE_ROOT_DESTINATION),
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

  const selectedLabel =
    sourcePaths.length === 0
      ? "No files selected"
      : sourcePaths.length === 1
        ? getFileNameFromPath(sourcePaths[0])
        : `${sourcePaths.length} selected`;

  if (replaceConfirmationOpen) {
    return (
      <Dialog
        closeOnBackdropClick={initialSourcePaths.length === 0}
        title="Replace existing EPUB files?"
        description="Files with matching names will be replaced. Existing files are preserved until each replacement succeeds."
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
            <Button disabled={isImporting} onClick={() => void runImport()} variant="danger">
              {isImporting ? "Replacing" : "Replace and add"}
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
            disabled={isImporting || sourcePaths.length === 0}
            icon={<FilePlus aria-hidden="true" strokeWidth={2.25} />}
            onClick={submit}
          >
            {isImporting ? "Adding" : "Add EPUB"}
          </Button>
        </>
      }
    >
      <div className="add-epub-dialog">
        <button
          className="add-epub-dialog__picker"
          disabled={isImporting}
          onClick={() => void chooseFiles()}
          type="button"
        >
          <Files aria-hidden="true" size={20} />
          <span>{selectedLabel}</span>
        </button>

        {sourcePaths.length > 1 ? (
          <ul className="add-epub-dialog__files" aria-label="Selected EPUB files">
            {sourcePaths.slice(0, 5).map((path) => (
              <li key={path}>{getFileNameFromPath(path)}</li>
            ))}
            {sourcePaths.length > 5 ? <li>{sourcePaths.length - 5} more</li> : null}
          </ul>
        ) : null}

        <AppSelect
          id="add-epub-destination"
          label={
            <span className="add-epub-dialog__label">
              <FolderIcon aria-hidden="true" size={14} />
              Destination
            </span>
          }
          onChange={setDestinationValue}
          options={destinations}
          value={destinationValue}
        />

        <AppSelect
          id="add-epub-conflict"
          label="Filename conflicts"
          onChange={setConflictAction}
          options={archiveImportConflictOptions}
          value={conflictAction}
        />

        <div
          aria-labelledby="add-epub-operation-label"
          className="add-epub-dialog__field"
          role="group"
        >
          <span id="add-epub-operation-label">Operation</span>
          <SegmentedControl
            label="Import operation"
            onChange={setMode}
            options={archiveImportModeOptions}
            value={mode}
          />
        </div>

        {error ? (
          <p className="form-error add-epub-dialog__error" role="alert">
            <CircleAlert aria-hidden="true" size={15} />
            {error}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
