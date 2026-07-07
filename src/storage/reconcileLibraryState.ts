import type { Book, EpubSourceMetadata } from "../types/book";
import type { Folder } from "../types/folder";
import { reconcileById, shallowEqualRecords } from "../utils/reconcileById";
import {
  createBookIdentityIndex,
  resolveBookIdFromScan,
  type ScannedBookIdentity,
} from "./bookIdentity";
import type {
  LibraryBookMetadata,
  LibraryMetadata,
  ProgressMetadata,
} from "./metadataFiles";
import { normalizeArchiveRelativePath } from "./pathSafety";
import { normalizeSourceMetadata, sourceMetadataEqual } from "./sourceMetadata";

export type ScannedBook = ScannedBookIdentity;

export type ScannedFolder = {
  id: string;
  name: string;
  relativePath: string;
  parentPath: string | null;
};

export type ArchiveScanWarning = {
  relativePath: string;
  message: string;
};

export type ArchiveScan = {
  books: ScannedBook[];
  folders: ScannedFolder[];
  warnings?: ArchiveScanWarning[];
};

export type ReconcileLibraryStateInput = {
  previousBooks: Book[];
  previousFolders: Folder[];
  libraryMetadata: LibraryMetadata;
  progressMetadata: ProgressMetadata;
  scan: ArchiveScan;
  timestamp: string;
};

export type ReconciledLibraryState = {
  books: Book[];
  booksChanged: boolean;
  folders: Folder[];
  foldersChanged: boolean;
  libraryMetadata: LibraryMetadata;
  libraryChanged: boolean;
  missingBooks: Map<string, Book>;
};

function titleFromFileName(fileName: string) {
  return (
    fileName
      .replace(/\.epub$/i, "")
      .replaceAll(/[_-]+/g, " ")
      .trim() || "Untitled"
  );
}

function fileNameFromPath(relativePath: string): string {
  return relativePath.split("/").at(-1) ?? relativePath;
}

function sourceMetadataForScan(
  book: ScannedBook,
  metadataWarningPaths: ReadonlySet<string>,
  current: LibraryBookMetadata | undefined,
): EpubSourceMetadata | undefined {
  if (metadataWarningPaths.has(book.relativePath)) {
    return normalizeSourceMetadata(current?.sourceMetadata);
  }

  return normalizeSourceMetadata(book.sourceMetadata);
}

function metadataEntryChanged(
  current: LibraryBookMetadata,
  next: LibraryBookMetadata,
): boolean {
  return (
    current.relativePath !== next.relativePath ||
    current.fileSize !== next.fileSize ||
    current.fileModifiedAt !== next.fileModifiedAt ||
    !sourceMetadataEqual(current.sourceMetadata, next.sourceMetadata)
  );
}

function buildBook(
  id: string,
  scanned: ScannedBook,
  folderId: string | null,
  metadata: LibraryBookMetadata,
  progress: ProgressMetadata,
  sourceMetadata: EpubSourceMetadata | undefined,
): Book {
  const readingProgress = progress.progress[id];

  return {
    id,
    relativePath: scanned.relativePath,
    fileName: scanned.fileName,
    folderPath: scanned.folderPath,
    size: scanned.size,
    folderId,
    originalTitle: titleFromFileName(scanned.fileName),
    originalAuthor: sourceMetadata?.creator,
    sourceMetadata,
    displayTitle: metadata.displayTitle,
    displayAuthor: metadata.displayAuthor,
    coverPath: metadata.coverPath,
    isFileMissing: false,
    isFavorite: metadata.isFavorite,
    addedAt: metadata.addedAt,
    updatedAt: metadata.updatedAt,
    modifiedAt: new Date(scanned.modifiedAt).toISOString(),
    progressCfi: readingProgress?.cfi,
    progressPercent: readingProgress?.percent,
    lastOpenedAt: readingProgress?.lastOpenedAt,
  };
}

function buildMissingBook(
  id: string,
  metadata: LibraryBookMetadata,
  progress: ProgressMetadata,
): Book {
  const fileName = fileNameFromPath(metadata.relativePath);
  const readingProgress = progress.progress[id];

  return {
    id,
    relativePath: metadata.relativePath,
    fileName,
    folderPath: undefined,
    size: metadata.fileSize,
    modifiedAt:
      metadata.fileModifiedAt === undefined
        ? undefined
        : new Date(metadata.fileModifiedAt).toISOString(),
    originalTitle: titleFromFileName(fileName),
    originalAuthor: metadata.sourceMetadata?.creator,
    sourceMetadata: metadata.sourceMetadata,
    displayTitle: metadata.displayTitle,
    displayAuthor: metadata.displayAuthor,
    coverPath: metadata.coverPath,
    isFileMissing: true,
    folderId: null,
    isFavorite: metadata.isFavorite,
    addedAt: metadata.addedAt,
    updatedAt: metadata.updatedAt,
    progressCfi: readingProgress?.cfi,
    progressPercent: readingProgress?.percent,
    lastOpenedAt: readingProgress?.lastOpenedAt,
  };
}

function reconcileFolders(
  previousFolders: Folder[],
  scanFolders: ScannedFolder[],
  timestamp: string,
) {
  const folderIds = new Map(
    scanFolders.map((folder) => [folder.relativePath, folder.id]),
  );
  const previousById = new Map(
    previousFolders.map((folder) => [folder.id, folder]),
  );

  const nextFolders = scanFolders.map((folder) => {
    const parentId = folder.parentPath
      ? (folderIds.get(folder.parentPath) ?? null)
      : null;
    const previous = previousById.get(folder.id);
    const unchanged =
      previous &&
      previous.name === folder.name &&
      previous.relativePath === folder.relativePath &&
      previous.parentPath === folder.parentPath &&
      previous.parentId === parentId;

    return {
      ...folder,
      parentId,
      createdAt: previous?.createdAt ?? timestamp,
      updatedAt: unchanged ? previous.updatedAt : timestamp,
    } satisfies Folder;
  });

  return reconcileById(previousFolders, nextFolders, shallowEqualRecords);
}

export function reconcileLibraryState({
  previousBooks,
  previousFolders,
  libraryMetadata,
  progressMetadata,
  scan,
  timestamp,
}: ReconcileLibraryStateInput): ReconciledLibraryState {
  const folderIds = new Map(
    scan.folders.map((folder) => [folder.relativePath, folder.id]),
  );
  const metadataWarningPaths = new Set(
    scan.warnings?.map((warning) => warning.relativePath) ?? [],
  );
  const identityIndex = createBookIdentityIndex({
    metadataBooks: libraryMetadata.books,
    scannedBooks: scan.books,
    previousBooks,
  });
  const nextLibraryMetadata: LibraryMetadata = {
    ...libraryMetadata,
    books: { ...libraryMetadata.books },
  };
  let libraryChanged = false;
  const visibleBooks: Book[] = [];
  const matchedBookIds = new Set<string>();

  for (const scanned of scan.books) {
    const match = resolveBookIdFromScan(scanned, identityIndex);
    const id = match?.bookId ?? scanned.discoveryId;
    const current = nextLibraryMetadata.books[id];
    const sourceMetadata = sourceMetadataForScan(
      scanned,
      metadataWarningPaths,
      current,
    );
    const nextEntry: LibraryBookMetadata = current
      ? {
          ...current,
          relativePath: normalizeArchiveRelativePath(scanned.relativePath),
          sourceMetadata,
          fileSize: scanned.size,
          fileModifiedAt: scanned.modifiedAt,
          updatedAt: current.updatedAt,
        }
      : {
          relativePath: normalizeArchiveRelativePath(scanned.relativePath),
          isFavorite: false,
          addedAt: timestamp,
          updatedAt: timestamp,
          sourceMetadata,
          fileSize: scanned.size,
          fileModifiedAt: scanned.modifiedAt,
        };

    if (!current) {
      nextLibraryMetadata.books[id] = nextEntry;
      libraryChanged = true;
    } else if (metadataEntryChanged(current, nextEntry)) {
      nextLibraryMetadata.books[id] = {
        ...nextEntry,
        updatedAt: timestamp,
      };
      libraryChanged = true;
    }

    const metadata = nextLibraryMetadata.books[id];
    matchedBookIds.add(id);
    visibleBooks.push(
      buildBook(
        id,
        scanned,
        folderIds.get(scanned.folderPath) ?? null,
        metadata,
        progressMetadata,
        sourceMetadata,
      ),
    );
  }

  const missingBooks = new Map<string, Book>();
  for (const [id, metadata] of Object.entries(nextLibraryMetadata.books)) {
    if (matchedBookIds.has(id)) {
      continue;
    }
    missingBooks.set(id, buildMissingBook(id, metadata, progressMetadata));
  }

  const reconciledBooks = reconcileById(
    previousBooks,
    visibleBooks,
    shallowEqualRecords,
  );
  const reconciledFolders = reconcileFolders(
    previousFolders,
    scan.folders,
    timestamp,
  );

  return {
    books: reconciledBooks.items,
    booksChanged: reconciledBooks.changed,
    folders: reconciledFolders.items,
    foldersChanged: reconciledFolders.changed,
    libraryMetadata: nextLibraryMetadata,
    libraryChanged,
    missingBooks,
  };
}
