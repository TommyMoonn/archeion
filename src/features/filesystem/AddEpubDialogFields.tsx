import { Files, Folder as FolderIcon } from "lucide-react";
import { AppSelect } from "../../components/AppSelect";
import { SegmentedControl } from "../../components/SegmentedControl";
import type { ArchiveImportConflictAction, ArchiveImportMode } from "../../types/archiveImport";
import {
  archiveImportConflictOptions,
  archiveImportModeOptions,
  getFileNameFromPath,
  type createArchiveDestinationOptions,
} from "./archiveImport";
export function AddEpubDialogFields({
  sourcePaths,
  destinations,
  destinationValue,
  conflictAction,
  mode,
  isImporting = false,
  chooseFiles,
  setDestinationValue,
  setConflictAction,
  setMode,
}: {
  sourcePaths: readonly string[];
  destinations: ReturnType<typeof createArchiveDestinationOptions>;
  destinationValue: string;
  conflictAction: ArchiveImportConflictAction;
  mode: ArchiveImportMode;
  isImporting?: boolean;
  chooseFiles: () => Promise<void>;
  setDestinationValue: (value: string) => void;
  setConflictAction: (value: ArchiveImportConflictAction) => void;
  setMode: (value: ArchiveImportMode) => void;
}) {
  const selectedLabel =
    sourcePaths.length === 0
      ? "No files selected"
      : sourcePaths.length === 1
        ? getFileNameFromPath(sourcePaths[0])
        : `${sourcePaths.length} selected`;
  return (
    <div className="add-epub-dialog">
      <button
        className="add-epub-dialog__picker"
        disabled={isImporting}
        onClick={() => void chooseFiles()}
        type="button"
      >
        <Files aria-hidden="true" size={20} />
        <span className="constrained-user-content">{selectedLabel}</span>
      </button>

      {sourcePaths.length > 1 ? (
        <ul className="add-epub-dialog__files" aria-label="Selected EPUB files">
          {sourcePaths.slice(0, 5).map((path) => (
            <li className="constrained-user-content" key={path}>
              {getFileNameFromPath(path)}
            </li>
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
    </div>
  );
}
