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
import type { ArchiveScan } from "../reconcileLibraryState";
import type {
  AddArchiveEpubInput,
  ArchiveImportResult,
  ArchivePathChange,
  CoverCacheStatus,
  EpubWritebackBackupStatus,
} from "../LibraryStorage";

type CommandDefinition<Args, Result> = {
  args: Args;
  result: Result;
};

type ArchiveCommandMap = {
  scan_archive: CommandDefinition<undefined, ArchiveScan>;
  load_archive_metadata: CommandDefinition<undefined, MetadataBundle>;
  load_settings_metadata: CommandDefinition<undefined, SettingsMetadata>;
  load_annotations_metadata: CommandDefinition<undefined, unknown>;
  save_library_metadata: CommandDefinition<{ metadata: LibraryMetadata }, void>;
  save_progress_metadata: CommandDefinition<{ metadata: ProgressMetadata }, void>;
  save_settings_metadata: CommandDefinition<{ metadata: SettingsMetadata }, void>;
  save_annotations_metadata: CommandDefinition<{ metadata: StoredAnnotationsMetadata }, void>;
  add_epub_files_to_archive: CommandDefinition<AddArchiveEpubInput, ArchiveImportResult[]>;
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
  delete_archive_epub_file: CommandDefinition<{ relativePath: string }, void>;
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
  delete_archive_folder: CommandDefinition<{ relativePath: string }, void>;
  cover_cache_status: CommandDefinition<undefined, CoverCacheStatus>;
  clear_cover_cache: CommandDefinition<undefined, CoverCacheStatus>;
  get_epub_writeback_backup_status: CommandDefinition<undefined, EpubWritebackBackupStatus>;
  clear_epub_writeback_backups: CommandDefinition<undefined, EpubWritebackBackupStatus>;
  clear_scanner_cache: CommandDefinition<undefined, void>;
  initialize_archive_metadata: CommandDefinition<undefined, void>;
  reveal_archeion_folder: CommandDefinition<undefined, void>;
};

type ArchiveCommandName = keyof ArchiveCommandMap;
type ArchiveCommandArgs<Name extends ArchiveCommandName> = ArchiveCommandMap[Name]["args"];
type ArchiveCommandResult<Name extends ArchiveCommandName> = ArchiveCommandMap[Name]["result"];

export class ArchiveCommandClient {
  invoke<Name extends ArchiveCommandName>(
    command: Name,
    args: ArchiveCommandArgs<Name>,
    rootPath: string | null,
  ): Promise<ArchiveCommandResult<Name>> {
    if (rootPath) {
      return invoke<ArchiveCommandResult<Name>>(command, {
        ...(args ?? {}),
        rootPath,
      });
    }
    if (args) {
      return invoke<ArchiveCommandResult<Name>>(command, args);
    }
    return invoke<ArchiveCommandResult<Name>>(command);
  }
}
