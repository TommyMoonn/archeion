import type {
  Book,
  BulkMetadataEditInput,
  EpubCoverFraming,
  EpubCoverPreparation,
  EpubCoverWritebackInput,
  EpubCoverWritebackResult,
  EpubMetadataWritebackInput,
  EpubMetadataWritebackResult,
  UpdateBookInput,
} from "../types/book";
import type { CreateFolderInput, Folder, UpdateFolderInput } from "../types/folder";
import type { ArchiveImportConflictAction, ArchiveImportMode } from "../types/archiveImport";
import type { Annotation, CreateAnnotationInput, UpdateAnnotationInput } from "../types/annotation";
import type { ArchiveImportSettings } from "../types/settings";

export type StorageObserver<T> = {
  next: (value: T) => void;
  error?: (error: unknown) => void;
};

export type StorageSubscription = () => void;

export type RescanOptions = {
  followUpIfRunning?: boolean;
  quiet?: boolean;
};

export type ScanStatus = { status: "idle" } | { status: "scanning"; startedAt: string };

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

export type EpubWritebackBackupStatus = {
  fileCount: number;
  totalBytes: number;
};

export type BulkActionResult = {
  requested: number;
  succeeded: Array<{ bookId: string }>;
  failed: Array<{ bookId: string; message: string }>;
  skipped: Array<{ bookId: string; reason: string }>;
};

export interface LibraryStorage {
  reset(archiveRootPath?: string | null): void;
  rescan(options?: RescanOptions): Promise<void>;
  observeScanStatus(observer: StorageObserver<ScanStatus>): StorageSubscription;
  addEpubFilesToArchive(input: AddArchiveEpubInput): Promise<ArchiveImportResult[]>;

  getBook(id: string): Promise<Book | undefined>;
  loadBookCover(id: string): Promise<Blob | undefined>;
  prepareBookCover(
    id: string,
    imagePath: string,
    framing: EpubCoverFraming,
  ): Promise<EpubCoverPreparation>;
  loadBookFile(id: string): Promise<Blob>;
  revealBookFile(id: string): Promise<void>;
  listBooks(): Promise<Book[]>;
  updateBook(id: string, changes: UpdateBookInput): Promise<Book | undefined>;
  writeBookMetadata(
    id: string,
    metadata: EpubMetadataWritebackInput,
  ): Promise<EpubMetadataWritebackResult>;
  writeBookCover(id: string, input: EpubCoverWritebackInput): Promise<EpubCoverWritebackResult>;
  renameBookFile(id: string, fileName: string): Promise<Book | undefined>;
  moveBookToFolder(id: string, folderId: string | null): Promise<Book | undefined>;
  deleteBook(id: string): Promise<boolean>;
  bulkMoveBooksToFolder(ids: readonly string[], folderId: string | null): Promise<BulkActionResult>;
  bulkSetFavorite(ids: readonly string[], isFavorite: boolean): Promise<BulkActionResult>;
  bulkDeleteBooks(ids: readonly string[]): Promise<BulkActionResult>;
  bulkReextractMetadata(ids: readonly string[]): Promise<BulkActionResult>;
  bulkRegenerateCovers(ids: readonly string[]): Promise<BulkActionResult>;
  bulkExportBooks(ids: readonly string[], destinationPath: string): Promise<BulkActionResult>;
  bulkWriteBookMetadata(
    ids: readonly string[],
    edits: BulkMetadataEditInput,
  ): Promise<BulkActionResult>;
  observeBooks(observer: StorageObserver<Book[]>): StorageSubscription;

  listAnnotations(bookId: string): Promise<Annotation[]>;
  getAnnotation(bookId: string, annotationId: string): Promise<Annotation | undefined>;
  createAnnotation(bookId: string, input: CreateAnnotationInput): Promise<Annotation>;
  updateAnnotation(
    bookId: string,
    annotationId: string,
    changes: UpdateAnnotationInput,
  ): Promise<Annotation | undefined>;
  deleteAnnotation(bookId: string, annotationId: string): Promise<boolean>;

  createFolder(input: CreateFolderInput): Promise<Folder>;
  getFolder(id: string): Promise<Folder | undefined>;
  listFolders(): Promise<Folder[]>;
  updateFolder(id: string, changes: UpdateFolderInput): Promise<Folder | undefined>;
  revealFolder(id: string): Promise<void>;
  deleteFolder(id: string): Promise<boolean>;
  observeFolders(observer: StorageObserver<Folder[]>): StorageSubscription;

  getArchiveImportSettings(): Promise<ArchiveImportSettings>;
  saveArchiveImportSettings(settings: ArchiveImportSettings): Promise<ArchiveImportSettings>;
  updateArchiveImportSettings(
    changes: Partial<ArchiveImportSettings>,
  ): Promise<ArchiveImportSettings>;
  resetArchiveImportSettings(): Promise<ArchiveImportSettings>;

  getCoverCacheStatus(): Promise<CoverCacheStatus>;
  clearCoverCache(): Promise<CoverCacheStatus>;
  getEpubWritebackBackupStatus(): Promise<EpubWritebackBackupStatus>;
  clearEpubWritebackBackups(): Promise<EpubWritebackBackupStatus>;
  clearScannerCache(): Promise<void>;
  repairArchiveMetadata(): Promise<void>;
  revealMetadataFolder(): Promise<void>;
}
