import { invoke } from "@tauri-apps/api/core";
import { expect, vi } from "vitest";

import { TauriArchiveLibraryStorage } from "../TauriArchiveLibraryStorage";
import type { LibraryMetadata } from "../metadataFiles";
import type {
  ArchiveCommandArgs,
  ArchiveCommandName,
  ArchiveCommandResult,
} from "./archiveCommandClient";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));

export const invokeMock = vi.mocked(invoke);

type StorageCommandArgs<Name extends ArchiveCommandName> =
  ArchiveCommandArgs<Name> extends undefined
    ? { rootPath?: string } | undefined
    : ArchiveCommandArgs<Name> & { rootPath?: string };

type StorageCommandHandlers = {
  [Name in ArchiveCommandName]?: (
    args: StorageCommandArgs<Name>,
  ) => ArchiveCommandResult<Name> | Promise<ArchiveCommandResult<Name>>;
};

export function mockStorageCommands(overrides: StorageCommandHandlers = {}): void {
  const handlers: StorageCommandHandlers = {
    scan_archive: () => firstScan,
    load_archive_metadata: () => structuredClone(metadata),
    save_library_metadata: () => undefined,
    save_progress_metadata: () => undefined,
    save_annotations_metadata: () => undefined,
    invalidate_scanner_cache_entries: () => undefined,
    invalidate_cover_cache_entries: () => undefined,
    ...overrides,
  };

  invokeMock.mockImplementation(async (command, args) => {
    const handler = Object.hasOwn(handlers, command)
      ? handlers[command as ArchiveCommandName]
      : undefined;
    if (!handler) {
      throw new Error(`Unexpected archive command "${command}". Configure a storage test handler.`);
    }
    // The native transport erases the command/argument correlation; overrides are checked above.
    return (handler as (args: unknown) => unknown)(args);
  });
}

export const firstScan = {
  folders: [
    {
      id: "folder:Author",
      name: "Author",
      relativePath: "Author",
      parentPath: null,
    },
    {
      id: "folder:Author/Series",
      name: "Series",
      relativePath: "Author/Series",
      parentPath: "Author",
    },
  ],
  books: [
    {
      discoveryId: "book-1",
      relativePath: "Author/Series/Volume_01.epub",
      fileName: "Volume_01.epub",
      folderPath: "Author/Series",
      size: 2048,
      modifiedAt: 1_700_000_000_000,
    },
  ],
};

export const editedFileStat = {
  relativePath: "Author/Series/Volume_01.epub",
  fileName: "Volume_01.epub",
  folderPath: "Author/Series",
  size: 4096,
  modifiedAt: 1_700_000_001_000,
};

export function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

export const metadata = {
  library: {
    version: 1 as const,
    books: {
      "book-1": {
        relativePath: "Author/Series/Volume_01.epub",
        isFavorite: true,
        fileSize: 2048,
        fileModifiedAt: 1_700_000_000_000,
        addedAt: "2023-11-01T00:00:00.000Z",
        updatedAt: "2023-11-02T00:00:00.000Z",
      },
    },
  },
  progress: {
    version: 1 as const,
    progress: {
      "book-1": {
        cfi: "epubcfi(/6/2)",
        percent: 42,
        lastOpenedAt: "2023-11-03T00:00:00.000Z",
      },
    },
  },
};

export function twoBookArchive(folderPath: string) {
  const firstRelativePath = `${folderPath}/Volume_01.epub`;
  const secondRelativePath = `${folderPath}/Volume_02.epub`;
  const archiveMetadata = structuredClone(metadata);
  const library = archiveMetadata.library as LibraryMetadata;
  library.books = {
    "book-1": {
      ...library.books["book-1"],
      relativePath: firstRelativePath,
      fileSize: 2048,
      fileModifiedAt: 1_700_000_000_000,
      sourceMetadata: { publisher: "Original Press" },
    },
    "book-2": {
      ...library.books["book-1"],
      relativePath: secondRelativePath,
      fileSize: 3072,
      fileModifiedAt: 1_700_000_002_000,
      isFavorite: false,
      sourceMetadata: { publisher: "Original Press" },
    },
  };
  return {
    metadata: archiveMetadata,
    scan: {
      folders: [],
      books: [
        {
          discoveryId: "book-1",
          relativePath: firstRelativePath,
          fileName: "Volume_01.epub",
          folderPath,
          size: 2048,
          modifiedAt: 1_700_000_000_000,
          sourceMetadata: { publisher: "Original Press" },
        },
        {
          discoveryId: "book-2",
          relativePath: secondRelativePath,
          fileName: "Volume_02.epub",
          folderPath,
          size: 3072,
          modifiedAt: 1_700_000_002_000,
          sourceMetadata: { publisher: "Original Press" },
        },
      ],
    },
  };
}

export function metadataWritebackResult(input: {
  metadata: Record<string, unknown>;
  relativePath: string;
}) {
  const fileName = input.relativePath.split("/").at(-1) ?? input.relativePath;
  const folderPath = input.relativePath.split("/").slice(0, -1).join("/");
  return {
    backupPath: null,
    sourceMetadata: input.metadata,
    fileStat: {
      relativePath: input.relativePath,
      fileName,
      folderPath,
      size: 4096,
      modifiedAt: 1_700_000_003_000,
    },
  };
}

export function setupDefaultStorageMock(): void {
  vi.clearAllMocks();
  mockStorageCommands({
    read_epub_file: () => new Uint8Array([80, 75, 3, 4]).buffer,
    load_epub_cover: () => new Uint8Array([255, 216, 255]).buffer,
    add_epub_files_to_archive: () => ({ results: [] }),
    cleanup_archive_import_artifacts: () => ({ removedCount: 0, failures: [] }),
    delete_archive_epub_file: () => ({}),
    delete_archive_folder: () => ({}),
    rename_archive_epub_file: () => ({
      oldRelativePath: "Author/Series/Volume_01.epub",
      newRelativePath: "Author/Series/Renamed.epub",
    }),
    move_archive_epub_file: () => ({
      oldRelativePath: "Author/Series/Volume_01.epub",
      newRelativePath: "Author/Volume_01.epub",
    }),
    create_archive_folder: () => "New Folder",
    rename_archive_folder: () => ({
      oldRelativePath: "Author/Series",
      newRelativePath: "Author/Renamed",
    }),
    move_archive_folder: () => ({
      oldRelativePath: "Author/Series",
      newRelativePath: "Series",
    }),
    cover_cache_status: () => ({ fileCount: 0, totalBytes: 0 }),
    clear_cover_cache: () => ({ fileCount: 0, totalBytes: 0 }),
    reveal_epub_file: () => undefined,
    reveal_archive_folder: () => undefined,
    reveal_archeion_folder: () => undefined,
    clear_scanner_cache: () => undefined,
    maintain_cover_cache: () => undefined,
    initialize_archive_metadata: () => undefined,
    export_archive_epub_file: () => undefined,
  });
}

export function setupBulkStorageMock(): void {
  vi.clearAllMocks();
  mockStorageCommands({
    export_archive_epub_file: () => undefined,
    move_archive_epub_file: () => ({
      oldRelativePath: "Author/Series/Volume_01.epub",
      newRelativePath: "Author/Volume_01.epub",
    }),
  });
}

export async function scopedStorage(rootPath = "C:/ArchiveA") {
  const storage = new TauriArchiveLibraryStorage();
  storage.reset(rootPath);
  await storage.listBooks();
  invokeMock.mockClear();
  return { rootPath, storage };
}

export async function scopedBulkStorage() {
  const storage = new TauriArchiveLibraryStorage();
  storage.reset("C:/ArchiveA");
  await storage.listBooks();
  invokeMock.mockClear();
  return storage;
}

export function expectCommandRootPath(command: string, rootPath: string): void {
  const call = invokeMock.mock.calls.find(([candidate]) => candidate === command);
  expect(call?.[1]).toMatchObject({ rootPath });
}

export { TauriArchiveLibraryStorage };
