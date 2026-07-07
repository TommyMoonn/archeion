import type { Book, UpdateBookInput } from "../types/book";
import type {
  CreateFolderInput,
  Folder,
  UpdateFolderInput,
} from "../types/folder";
import type { ReaderSettings } from "../types/reader";
import type { ArchiveImportConflictAction } from "./pathSafety";

export type { ArchiveImportConflictAction } from "./pathSafety";

export type StorageObserver<T> = {
  next: (value: T) => void;
  error?: (error: unknown) => void;
};

export type StorageSubscription = () => void;

export type RescanOptions = {
  followUpIfRunning?: boolean;
};

export type ScanStatus =
  { status: "idle" } | { status: "scanning"; startedAt: string };

export type ArchiveImportMode = "copy" | "move";

export type ArchivePathChange = {
  oldRelativePath: string;
  newRelativePath: string;
};

export type AddArchiveEpubInput = {
  conflictAction: ArchiveImportConflictAction;
  destinationFolderPath?: string;
  mode: ArchiveImportMode;
  sourcePaths: string[];
};

export type ArchiveImportResult = {
  status: "imported" | "skipped" | "failed";
  fileName: string;
  message?: string;
  relativePath?: string;
  sourcePath: string;
};

export type CoverCacheStatus = {
  fileCount: number;
  totalBytes: number;
};

export interface LibraryStorage {
  reset(archiveRootPath?: string | null): void;
  rescan(options?: RescanOptions): Promise<void>;
  observeScanStatus(observer: StorageObserver<ScanStatus>): StorageSubscription;
  addEpubFilesToArchive(
    input: AddArchiveEpubInput,
  ): Promise<ArchiveImportResult[]>;

  getBook(id: string): Promise<Book | undefined>;
  loadBookCover(id: string): Promise<Blob | undefined>;
  loadBookFile(id: string): Promise<Blob>;
  revealBookFile(id: string): Promise<void>;
  listBooks(): Promise<Book[]>;
  updateBook(id: string, changes: UpdateBookInput): Promise<Book | undefined>;
  renameBookFile(id: string, fileName: string): Promise<Book | undefined>;
  moveBookToFolder(
    id: string,
    folderId: string | null,
  ): Promise<Book | undefined>;
  deleteBook(id: string): Promise<boolean>;
  observeBooks(observer: StorageObserver<Book[]>): StorageSubscription;

  createFolder(input: CreateFolderInput): Promise<Folder>;
  getFolder(id: string): Promise<Folder | undefined>;
  listFolders(): Promise<Folder[]>;
  updateFolder(
    id: string,
    changes: UpdateFolderInput,
  ): Promise<Folder | undefined>;
  revealFolder(id: string): Promise<void>;
  deleteFolder(id: string): Promise<boolean>;
  observeFolders(observer: StorageObserver<Folder[]>): StorageSubscription;

  getReaderSettings(): Promise<ReaderSettings>;
  saveReaderSettings(settings: ReaderSettings): Promise<ReaderSettings>;
  updateReaderSettings(
    changes: Partial<ReaderSettings>,
  ): Promise<ReaderSettings>;
  resetReaderSettings(): Promise<ReaderSettings>;

  getCoverCacheStatus(): Promise<CoverCacheStatus>;
  clearCoverCache(): Promise<CoverCacheStatus>;
  revealMetadataFolder(): Promise<void>;
}
