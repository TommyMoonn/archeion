import { invoke } from "@tauri-apps/api/core";

import type {
  EpubCoverPreparation,
  EpubCoverWritebackInput,
  EpubCoverWritebackResult,
  EpubMetadataWritebackInput,
  EpubMetadataWritebackResult,
} from "../../types/book";
import type { StoredAnnotationsMetadata } from "../annotations/annotationsMetadata";
import type {
  LibraryMetadata,
  MetadataBundle,
  ProgressMetadata,
  SettingsMetadata,
} from "../metadataFiles";
import type { ArchiveEpubScan, ArchiveScan } from "../reconcileLibraryState";
import type {
  AddArchiveEpubInput,
  ArchiveImportArtifactCleanupResult,
  ArchiveImportCommandResult,
  ArchiveOperationResult,
  ArchivePathChange,
  CoverCacheStatus,
  EpubWritebackBackupStatus,
} from "../LibraryStorage";
import {
  beginWritebackWatcherSuppression,
  finishWritebackWatcherSuppression,
} from "../writebackWatcherSuppression";

type CommandDefinition<Args, Result> = {
  args: Args;
  result: Result;
};

export type EpubAnalysisFileSignature = {
  sizeBytes: number;
  modifiedAtMillis: number;
};

export type EpubDuplicateAnalysisCandidate = {
  relativePath: string;
  signature: EpubAnalysisFileSignature;
  identifier?: string;
};

export type EpubDuplicateAnalysisGroup = {
  kind: "exact" | "probable";
  identity: string;
  members: string[];
};

export type EpubDuplicateAnalysisResult = {
  archiveGeneration: number;
  requestRevision: number;
  signatures: Record<string, EpubAnalysisFileSignature>;
  groups: EpubDuplicateAnalysisGroup[];
};

export type EpubDiagnosticCode =
  | "unreadable-zip"
  | "inspection-limit-exceeded"
  | "missing-container"
  | "malformed-container"
  | "missing-rootfile"
  | "unsafe-rootfile"
  | "missing-package-document"
  | "malformed-package-document"
  | "spine-manifest-item-missing"
  | "unsafe-reading-resource"
  | "reading-resource-missing"
  | "unsupported-reading-resource"
  | "encrypted-reading-resource"
  | "no-usable-reading-order"
  | "navigation-resource-missing"
  | "navigation-resource-unusable"
  | "broken-local-document-target"
  | "unsafe-local-link-target"
  | "invalid-local-link-target"
  | "readable-document-unusable";

export type EpubDiagnostics = {
  formatVersion: number;
  issues: Array<{
    code: EpubDiagnosticCode;
    severity: "error" | "warning";
    messageInputs?: Record<string, string>;
    resourcePath?: string;
  }>;
};

export type EpubDiagnosticAnalysisResult = {
  archiveGeneration: number;
  requestRevision: number;
  entries: Array<{
    relativePath: string;
    signature: EpubAnalysisFileSignature;
    diagnostics: EpubDiagnostics;
    source: "cached" | "computed";
  }>;
};

type ArchiveCommandMap = {
  scan_archive: CommandDefinition<undefined, ArchiveScan>;
  scan_archive_epub_paths: CommandDefinition<{ relativePaths: string[] }, ArchiveEpubScan>;
  request_epub_duplicate_analysis: CommandDefinition<
    {
      archiveGeneration: number;
      requestRevision: number;
      candidates: EpubDuplicateAnalysisCandidate[];
    },
    EpubDuplicateAnalysisResult
  >;
  request_epub_diagnostics: CommandDefinition<
    {
      archiveGeneration: number;
      requestRevision: number;
      files: Array<{
        relativePath: string;
        signature: EpubAnalysisFileSignature;
      }>;
    },
    EpubDiagnosticAnalysisResult
  >;
  load_archive_metadata: CommandDefinition<undefined, MetadataBundle>;
  load_settings_metadata: CommandDefinition<undefined, SettingsMetadata>;
  load_annotations_metadata: CommandDefinition<undefined, unknown>;
  save_library_metadata: CommandDefinition<{ metadata: LibraryMetadata }, void>;
  save_progress_metadata: CommandDefinition<{ metadata: ProgressMetadata }, void>;
  save_settings_metadata: CommandDefinition<{ metadata: SettingsMetadata }, void>;
  save_annotations_metadata: CommandDefinition<{ metadata: StoredAnnotationsMetadata }, void>;
  add_epub_files_to_archive: CommandDefinition<AddArchiveEpubInput, ArchiveImportCommandResult>;
  read_epub_file: CommandDefinition<{ relativePath: string }, ArrayBuffer>;
  load_epub_cover: CommandDefinition<{ relativePath: string; bookId: string }, ArrayBuffer>;
  reveal_epub_file: CommandDefinition<{ relativePath: string }, void>;
  write_epub_metadata: CommandDefinition<
    {
      input: {
        relativePath: string;
        metadata: EpubMetadataWritebackInput;
        keepSuccessfulBackup: boolean;
      };
    },
    EpubMetadataWritebackResult
  >;
  prepare_epub_cover_writeback: CommandDefinition<
    {
      input: {
        relativePath: string;
        imagePath: string;
        framing: "crop" | "fit";
      };
    },
    EpubCoverPreparation
  >;
  write_epub_cover: CommandDefinition<
    {
      input: EpubCoverWritebackInput & {
        relativePath: string;
        bookId: string;
        keepSuccessfulBackup: boolean;
      };
    },
    EpubCoverWritebackResult
  >;
  rename_archive_epub_file: CommandDefinition<
    { relativePath: string; newFileName: string },
    ArchivePathChange
  >;
  move_archive_epub_file: CommandDefinition<
    { relativePath: string; destinationFolderPath?: string },
    ArchivePathChange
  >;
  delete_archive_epub_file: CommandDefinition<{ relativePath: string }, ArchiveOperationResult>;
  invalidate_scanner_cache_entries: CommandDefinition<{ relativePaths: string[] }, void>;
  invalidate_cover_cache_entries: CommandDefinition<{ bookIds: string[] }, void>;
  export_archive_epub_file: CommandDefinition<
    { relativePath: string; destinationPath: string },
    void
  >;
  create_archive_folder: CommandDefinition<{ parentRelativePath?: string; name: string }, string>;
  rename_archive_folder: CommandDefinition<
    { relativePath: string; newName: string },
    ArchivePathChange
  >;
  move_archive_folder: CommandDefinition<
    { relativePath: string; destinationParentPath?: string },
    ArchivePathChange
  >;
  reveal_archive_folder: CommandDefinition<{ relativePath: string }, void>;
  delete_archive_folder: CommandDefinition<{ relativePath: string }, ArchiveOperationResult>;
  cover_cache_status: CommandDefinition<undefined, CoverCacheStatus>;
  clear_cover_cache: CommandDefinition<undefined, CoverCacheStatus>;
  maintain_cover_cache: CommandDefinition<undefined, void>;
  get_epub_writeback_backup_status: CommandDefinition<undefined, EpubWritebackBackupStatus>;
  clear_epub_writeback_backups: CommandDefinition<undefined, EpubWritebackBackupStatus>;
  clear_scanner_cache: CommandDefinition<undefined, void>;
  cleanup_archive_import_artifacts: CommandDefinition<
    undefined,
    ArchiveImportArtifactCleanupResult
  >;
  initialize_archive_metadata: CommandDefinition<undefined, void>;
  reveal_archeion_folder: CommandDefinition<undefined, void>;
};

type ArchiveCommandName = keyof ArchiveCommandMap;
type ArchiveCommandArgs<Name extends ArchiveCommandName> = ArchiveCommandMap[Name]["args"];
type ArchiveCommandResult<Name extends ArchiveCommandName> = ArchiveCommandMap[Name]["result"];

const METADATA_WRITE_COMMANDS = new Set<ArchiveCommandName>([
  "save_library_metadata",
  "save_progress_metadata",
  "save_settings_metadata",
  "save_annotations_metadata",
  "initialize_archive_metadata",
]);

export class ArchiveCommandClient {
  invoke<Name extends ArchiveCommandName>(
    command: Name,
    args: ArchiveCommandArgs<Name>,
    rootPath: string | null,
  ): Promise<ArchiveCommandResult<Name>> {
    const suppression = METADATA_WRITE_COMMANDS.has(command)
      ? beginWritebackWatcherSuppression(rootPath, ".archeion")
      : undefined;
    let result: Promise<ArchiveCommandResult<Name>>;
    if (rootPath) {
      result = invoke<ArchiveCommandResult<Name>>(command, {
        ...(args ?? {}),
        rootPath,
      });
    } else if (args) {
      result = invoke<ArchiveCommandResult<Name>>(command, args);
    } else {
      result = invoke<ArchiveCommandResult<Name>>(command);
    }
    return result.finally(() => finishWritebackWatcherSuppression(suppression));
  }
}
