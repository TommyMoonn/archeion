import { vi } from "vitest";

import type { LibrarySnapshot, LibraryStorage } from "../../storage/LibraryStorage";
import type { ArchiveState } from "../../stores/archiveStore";
import type { Book } from "../../types/book";
import type { Folder } from "../../types/folder";

export const readyState: Extract<ArchiveState, { status: "ready" }> = {
  status: "ready",
  path: "D:\\Books",
  archive: {
    id: "archive-books",
    displayName: "Books",
    rootPath: "D:\\Books",
    createdAt: "1",
    lastOpenedAt: "2",
  },
  error: null,
  watcherError: null,
  archives: [
    {
      id: "archive-books",
      displayName: "Books",
      rootPath: "D:\\Books",
      createdAt: "1",
      lastOpenedAt: "2",
    },
  ],
};

export function createStorage({
  books = [],
  bulkSetFavorite = vi.fn().mockImplementation(async (ids: readonly string[]) => ({
    requested: ids.length,
    succeeded: ids.map((bookId) => ({ bookId })),
    failed: [],
    skipped: [],
  })),
  folders = [],
  createFolder = vi.fn().mockResolvedValue({
    id: "folder-light-novels",
    name: "Light Novels",
    parentId: null,
    relativePath: "Light Novels",
    createdAt: "1",
    updatedAt: "1",
  } satisfies Folder),
  deleteBook = vi.fn(),
  deleteFolder = vi.fn(),
  listAnnotations = vi.fn().mockResolvedValue([]),
  getLibrarySnapshot,
  observeLibrarySnapshot,
  renameBookFile = vi.fn(),
  updateBook = vi.fn(),
  updateFolder = vi.fn(),
}: {
  books?: Book[];
  bulkSetFavorite?: LibraryStorage["bulkSetFavorite"];
  folders?: Folder[];
  createFolder?: LibraryStorage["createFolder"];
  deleteBook?: LibraryStorage["deleteBook"];
  deleteFolder?: LibraryStorage["deleteFolder"];
  listAnnotations?: LibraryStorage["listAnnotations"];
  getLibrarySnapshot?: LibraryStorage["getLibrarySnapshot"];
  observeLibrarySnapshot?: LibraryStorage["observeLibrarySnapshot"];
  renameBookFile?: LibraryStorage["renameBookFile"];
  updateBook?: LibraryStorage["updateBook"];
  updateFolder?: LibraryStorage["updateFolder"];
} = {}): LibraryStorage {
  const initialSnapshot: LibrarySnapshot = {
    archiveGeneration: 1,
    archiveRootPath: readyState.archive.rootPath,
    books,
    folders,
    loadState: "ready",
    revision: 1,
    scanStatus: { status: "idle" },
  };
  return {
    reset: vi.fn(),
    rescan: vi.fn(),
    getLibrarySnapshot: getLibrarySnapshot ?? vi.fn(() => initialSnapshot),
    observeLibrarySnapshot: observeLibrarySnapshot ?? vi.fn(() => () => undefined),
    addEpubFilesToArchive: vi.fn(),
    getBook: vi.fn(),
    loadBookCover: vi.fn(),
    prepareBookCover: vi.fn(),
    loadBookFile: vi.fn(),
    revealBookFile: vi.fn(),
    listBooks: vi.fn(),
    updateBook,
    writeBookMetadata: vi.fn(),
    writeBookCover: vi.fn(),
    renameBookFile,
    moveBookToFolder: vi.fn(),
    deleteBook,
    bulkMoveBooksToFolder: vi.fn(),
    bulkSetFavorite,
    bulkDeleteBooks: vi.fn(),
    bulkReextractMetadata: vi.fn(),
    bulkRegenerateCovers: vi.fn(),
    bulkExportBooks: vi.fn(),
    bulkWriteBookMetadata: vi.fn(),
    listAnnotations,
    createFolder,
    getFolder: vi.fn(),
    listFolders: vi.fn(),
    updateFolder,
    revealFolder: vi.fn(),
    deleteFolder,
    getCoverCacheStatus: vi.fn(),
    clearCoverCache: vi.fn(),
    getEpubWritebackBackupStatus: vi.fn(),
    clearEpubWritebackBackups: vi.fn(),
    clearScannerCache: vi.fn(),
    repairArchiveMetadata: vi.fn(),
    revealMetadataFolder: vi.fn(),
  } as unknown as LibraryStorage;
}
