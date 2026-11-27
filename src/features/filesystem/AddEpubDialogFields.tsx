import { Files, Folder as FolderIcon } from "lucide-react";
import { AppSelect } from "../../components/AppSelect";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Button } from "../../components/ui/button";
import { FieldLabel } from "../../components/ui/field";
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
    <div className="grid min-w-0 gap-import-form">
      <Button
        className="flex min-h-import-picker w-full min-w-0 cursor-pointer items-center gap-dialog-copy border-dashed border-line-strong bg-canvas-deep p-input-inline text-start text-text control-hover:border-accent-border control-hover:bg-surface-raised focus-visible:border-accent-border focus-visible:bg-surface-raised disabled:cursor-not-allowed disabled:opacity-60 forced-colors:disabled:opacity-60!"
        disabled={isImporting}
        onClick={() => void chooseFiles()}
        size={null}
        type="button"
        variant={null}
      >
        <Files aria-hidden="true" className="size-icon-glyph-prominent flex-none text-accent" />
        <span className="min-w-0 flex-auto wrap-anywhere whitespace-normal text-meta-size">
          {selectedLabel}
        </span>
      </Button>

      {sourcePaths.length > 1 ? (
        <ul
          aria-label="Selected EPUB files"
          className="m-0 grid max-w-full min-w-0 list-none gap-import-file-list rounded-control border-standard border-solid border-line bg-import-file-list px-dialog-gap-narrow py-dialog-copy text-meta-size leading-field-compact text-muted"
        >
          {sourcePaths.slice(0, 5).map((path) => (
            <li className="min-w-0 wrap-anywhere whitespace-normal" key={path}>
              {getFileNameFromPath(path)}
            </li>
          ))}
          {sourcePaths.length > 5 ? <li>{sourcePaths.length - 5} more</li> : null}
        </ul>
      ) : null}

      <AppSelect
        className="w-full"
        id="add-epub-destination"
        label={
          <FieldLabel className="inline-flex items-center gap-control-gap-compact">
            <FolderIcon aria-hidden="true" className="size-icon-glyph-compact" />
            Destination
          </FieldLabel>
        }
        onChange={setDestinationValue}
        options={destinations}
        value={destinationValue}
      />

      <AppSelect
        className="w-full"
        id="add-epub-conflict"
        label="Filename conflicts"
        onChange={setConflictAction}
        options={archiveImportConflictOptions}
        value={conflictAction}
      />

      <div aria-labelledby="add-epub-operation-label" className="grid gap-control-gap" role="group">
        <FieldLabel id="add-epub-operation-label" className="leading-inherit">
          Operation
        </FieldLabel>
        <SegmentedControl
          className="justify-self-start"
          label="Import operation"
          onChange={setMode}
          options={archiveImportModeOptions}
          value={mode}
        />
      </div>
    </div>
  );
}
