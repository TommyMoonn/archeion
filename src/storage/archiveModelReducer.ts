import type { Book } from "../types/book";
import type { Folder } from "../types/folder";
import type { LibraryMetadata, ProgressMetadata } from "./metadataFiles";
import { normalizeArchiveRelativePath } from "./pathSafety";
import { sanitizeProgressMetadataForLibrary } from "./progressMetadataSanitization";
import { retireReplacementPathIdentities } from "./replacementIdentityRetirement";
import {
  reconcileLibraryState,
  type ArchiveScan,
  type ArchiveScanWarning,
  type ScannedBook,
  type ScannedFolder,
} from "./reconcileLibraryState";

export type ArchiveBookPathChange = {
  bookId: string;
  newRelativePath: string;
};

export type ArchiveModelDelta =
  | {
      kind: "book-paths";
      changes: readonly ArchiveBookPathChange[];
    }
  | {
      kind: "remove-books";
      bookIds: readonly string[];
    }
  | {
      kind: "scanned-books";
      books: readonly ScannedBook[];
      removedRelativePaths?: readonly string[];
      warnings?: readonly ArchiveScanWarning[];
      coverRevisionOverrides?: Readonly<Record<string, string | undefined>>;
      replacementRelativePaths?: readonly string[];
    }
  | {
      kind: "create-folder";
      relativePath: string;
    }
  | {
      kind: "folder-path";
      oldRelativePath: string;
      newRelativePath: string;
    }
  | {
      kind: "remove-folder";
      relativePath: string;
    };

export type ArchiveModelSnapshot = {
  books: Book[];
  folders: Folder[];
  libraryMetadata: LibraryMetadata;
  missingBooks: ReadonlyMap<string, Book>;
  progressMetadata: ProgressMetadata;
};

export type ArchiveModelReduction = {
  books: Book[];
  booksChanged: boolean;
  folders: Folder[];
  foldersChanged: boolean;
  libraryMetadata: LibraryMetadata;
  libraryChanged: boolean;
  missingBooks: Map<string, Book>;
  progressMetadata: ProgressMetadata;
  progressChanged: boolean;
  progressPersistenceDeferred: boolean;
};

function fileNameFromPath(relativePath: string): string {
  return relativePath.split("/").at(-1) ?? relativePath;
}

function parentPath(relativePath: string): string {
  return relativePath.split("/").slice(0, -1).join("/");
}

function normalizeFolderPath(relativePath: string): string {
  return relativePath ? normalizeArchiveRelativePath(relativePath) : "";
}

function scannedBookFromBook(book: Book): ScannedBook {
  if (!book.relativePath || book.size === undefined || !book.modifiedAt) {
    throw new Error(`Book "${book.id}" does not have complete filesystem identity.`);
  }

  const modifiedAt = Date.parse(book.modifiedAt);
  if (!Number.isFinite(modifiedAt)) {
    throw new Error(`Book "${book.id}" has an invalid modified timestamp.`);
  }

  return {
    discoveryId: book.id,
    relativePath: normalizeArchiveRelativePath(book.relativePath),
    fileName: book.fileName,
    folderPath: book.folderPath ?? parentPath(book.relativePath),
    size: book.size,
    modifiedAt,
    sourceMetadata: book.sourceMetadata,
  };
}

function scannedFolderFromFolder(folder: Folder): ScannedFolder {
  if (!folder.relativePath) {
    throw new Error(`Folder "${folder.id}" does not have a relative path.`);
  }
  return {
    id: folder.id,
    name: folder.name,
    relativePath: normalizeArchiveRelativePath(folder.relativePath),
    parentPath: folder.parentPath ?? null,
  };
}

function isInsidePath(relativePath: string, parent: string): boolean {
  return relativePath === parent || relativePath.startsWith(`${parent}/`);
}

function replacePathPrefix(relativePath: string, oldPrefix: string, newPrefix: string): string {
  if (relativePath === oldPrefix) {
    return newPrefix;
  }
  if (!relativePath.startsWith(`${oldPrefix}/`)) {
    return relativePath;
  }
  const suffix = relativePath.slice(oldPrefix.length + 1);
  return newPrefix ? `${newPrefix}/${suffix}` : suffix;
}

function cloneLibraryMetadata(metadata: LibraryMetadata): LibraryMetadata {
  return {
    ...metadata,
    books: { ...metadata.books },
  };
}

function cloneProgressMetadata(metadata: ProgressMetadata): ProgressMetadata {
  return {
    ...metadata,
    progress: { ...metadata.progress },
  };
}

function assertUnique(values: readonly string[], label: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    const comparison = value.toLocaleLowerCase();
    if (seen.has(comparison)) {
      throw new Error(`Archive delta produced a duplicate ${label}: ${value}`);
    }
    seen.add(comparison);
  }
}

function validateScan(scan: ArchiveScan): void {
  assertUnique(
    scan.books.map((book) => normalizeArchiveRelativePath(book.relativePath)),
    "EPUB path",
  );
  assertUnique(
    scan.folders.map((folder) => normalizeArchiveRelativePath(folder.relativePath)),
    "folder path",
  );
}

function buildCurrentScan(snapshot: ArchiveModelSnapshot): ArchiveScan {
  return {
    books: snapshot.books.map(scannedBookFromBook),
    folders: snapshot.folders.map(scannedFolderFromFolder),
  };
}

function applyCoverRevisionOverrides(
  books: Book[],
  overrides: Readonly<Record<string, string | undefined>> | undefined,
): { books: Book[]; changed: boolean } {
  if (!overrides || !Object.keys(overrides).length) {
    return { books, changed: false };
  }

  let nextBooks: Book[] | undefined;
  books.forEach((book, index) => {
    if (!Object.hasOwn(overrides, book.id)) {
      return;
    }
    const coverRevision = overrides[book.id];
    if (book.coverRevision === coverRevision) {
      return;
    }
    nextBooks ??= [...books];
    nextBooks[index] = { ...book, coverRevision };
  });
  return { books: nextBooks ?? books, changed: Boolean(nextBooks) };
}

function applyBookPathChanges(
  scan: ArchiveScan,
  libraryMetadata: LibraryMetadata,
  changes: readonly ArchiveBookPathChange[],
  timestamp: string,
): void {
  const changesById = new Map(changes.map((change) => [change.bookId, change]));
  if (changesById.size !== changes.length) {
    throw new Error("Archive delta contains duplicate book path changes.");
  }

  const found = new Set<string>();
  scan.books = scan.books.map((book) => {
    const change = changesById.get(book.discoveryId);
    if (!change) {
      return book;
    }
    found.add(change.bookId);
    const relativePath = normalizeArchiveRelativePath(change.newRelativePath);
    const folderPath = parentPath(relativePath);
    return {
      ...book,
      relativePath,
      fileName: fileNameFromPath(relativePath),
      folderPath,
    };
  });

  for (const change of changes) {
    const entry = libraryMetadata.books[change.bookId];
    if (!entry || !found.has(change.bookId)) {
      throw new Error(`Book "${change.bookId}" could not be updated from the native result.`);
    }
    libraryMetadata.books[change.bookId] = {
      ...entry,
      relativePath: normalizeArchiveRelativePath(change.newRelativePath),
      updatedAt: timestamp,
    };
  }
}

function applyScannedBookChanges(
  scan: ArchiveScan,
  books: readonly ScannedBook[],
  removedRelativePaths: readonly string[],
): void {
  const removed = new Set(
    removedRelativePaths.map((relativePath) =>
      normalizeArchiveRelativePath(relativePath).toLocaleLowerCase(),
    ),
  );
  const incomingPaths = new Set(
    books.map((book) => normalizeArchiveRelativePath(book.relativePath).toLocaleLowerCase()),
  );

  scan.books = scan.books.filter((book) => {
    const path = normalizeArchiveRelativePath(book.relativePath).toLocaleLowerCase();
    return !removed.has(path) && !incomingPaths.has(path);
  });
  scan.books.push(
    ...books.map((book) => ({
      ...book,
      relativePath: normalizeArchiveRelativePath(book.relativePath),
      folderPath: normalizeFolderPath(book.folderPath),
    })),
  );
}

function applyFolderPathChange(
  scan: ArchiveScan,
  libraryMetadata: LibraryMetadata,
  oldRelativePath: string,
  newRelativePath: string,
  timestamp: string,
): boolean {
  const oldPath = normalizeArchiveRelativePath(oldRelativePath);
  const newPath = normalizeArchiveRelativePath(newRelativePath);
  if (!scan.folders.some((folder) => folder.relativePath === oldPath)) {
    throw new Error(`Folder "${oldPath}" could not be updated from the native result.`);
  }

  scan.folders = scan.folders.map((folder) => {
    if (!isInsidePath(folder.relativePath, oldPath)) {
      return folder;
    }
    const relativePath = replacePathPrefix(folder.relativePath, oldPath, newPath);
    const nextParentPath = parentPath(relativePath);
    return {
      ...folder,
      id: `folder:${relativePath}`,
      name: fileNameFromPath(relativePath),
      relativePath,
      parentPath: nextParentPath || null,
    };
  });

  scan.books = scan.books.map((book) => {
    if (!isInsidePath(book.relativePath, oldPath)) {
      return book;
    }
    const relativePath = replacePathPrefix(book.relativePath, oldPath, newPath);
    return {
      ...book,
      relativePath,
      folderPath: parentPath(relativePath),
    };
  });

  let metadataChanged = false;
  for (const [bookId, entry] of Object.entries(libraryMetadata.books)) {
    if (!isInsidePath(entry.relativePath, oldPath)) {
      continue;
    }
    libraryMetadata.books[bookId] = {
      ...entry,
      relativePath: replacePathPrefix(entry.relativePath, oldPath, newPath),
      updatedAt: timestamp,
    };
    metadataChanged = true;
  }
  return metadataChanged;
}

function applyFolderRemoval(
  scan: ArchiveScan,
  libraryMetadata: LibraryMetadata,
  relativePath: string,
): boolean {
  const folderPath = normalizeArchiveRelativePath(relativePath);
  if (!scan.folders.some((folder) => folder.relativePath === folderPath)) {
    throw new Error(`Folder "${folderPath}" could not be removed from the archive model.`);
  }

  scan.folders = scan.folders.filter((folder) => !isInsidePath(folder.relativePath, folderPath));
  scan.books = scan.books.filter((book) => !isInsidePath(book.relativePath, folderPath));

  let libraryChanged = false;
  for (const [bookId, entry] of Object.entries(libraryMetadata.books)) {
    if (!isInsidePath(entry.relativePath, folderPath)) {
      continue;
    }
    delete libraryMetadata.books[bookId];
    libraryChanged = true;
  }
  return libraryChanged;
}

export function reduceArchiveModel(
  snapshot: ArchiveModelSnapshot,
  delta: ArchiveModelDelta,
  timestamp: string,
): ArchiveModelReduction {
  const scan = buildCurrentScan(snapshot);
  const clonedLibraryMetadata = cloneLibraryMetadata(snapshot.libraryMetadata);
  const retirement =
    delta.kind === "scanned-books"
      ? retireReplacementPathIdentities(
          clonedLibraryMetadata,
          delta.replacementRelativePaths ?? [],
          delta.books.map((book) => book.relativePath),
        )
      : { libraryMetadata: clonedLibraryMetadata, retiredBookIds: new Set<string>() };
  const libraryMetadata = retirement.libraryMetadata;
  const retiredBookIds = retirement.retiredBookIds;
  const sanitizedProgress =
    delta.kind === "scanned-books"
      ? sanitizeProgressMetadataForLibrary(snapshot.progressMetadata, libraryMetadata)
      : { changed: false, metadata: snapshot.progressMetadata };
  const progressMetadata = cloneProgressMetadata(sanitizedProgress.metadata);
  let libraryMutated = retiredBookIds.size > 0;
  // Filesystem deltas remain single-sidecar commits. Targeted scanned-book reconciliation
  // applies orphan cleanup immediately in memory and leaves persistence to a repair scan.
  const progressChanged = sanitizedProgress.changed;
  const progressPersistenceDeferred = delta.kind === "scanned-books" && progressChanged;

  switch (delta.kind) {
    case "book-paths":
      applyBookPathChanges(scan, libraryMetadata, delta.changes, timestamp);
      libraryMutated = delta.changes.length > 0;
      break;
    case "remove-books": {
      const ids = new Set(delta.bookIds);
      if (ids.size !== delta.bookIds.length) {
        throw new Error("Archive delta contains duplicate book removals.");
      }
      for (const id of ids) {
        if (!libraryMetadata.books[id]) {
          throw new Error(`Book metadata "${id}" could not be removed.`);
        }
        delete libraryMetadata.books[id];
      }
      scan.books = scan.books.filter((book) => !ids.has(book.discoveryId));
      libraryMutated = ids.size > 0;
      break;
    }
    case "scanned-books":
      applyScannedBookChanges(scan, delta.books, delta.removedRelativePaths ?? []);
      scan.warnings = delta.warnings ? [...delta.warnings] : undefined;
      break;
    case "create-folder": {
      const relativePath = normalizeArchiveRelativePath(delta.relativePath);
      if (scan.folders.some((folder) => folder.relativePath === relativePath)) {
        throw new Error(`Folder "${relativePath}" already exists in the archive model.`);
      }
      const parent = parentPath(relativePath);
      if (parent && !scan.folders.some((folder) => folder.relativePath === parent)) {
        throw new Error(`Parent folder "${parent}" is not in the archive model.`);
      }
      scan.folders.push({
        id: `folder:${relativePath}`,
        name: fileNameFromPath(relativePath),
        relativePath,
        parentPath: parent || null,
      });
      break;
    }
    case "folder-path":
      libraryMutated = applyFolderPathChange(
        scan,
        libraryMetadata,
        delta.oldRelativePath,
        delta.newRelativePath,
        timestamp,
      );
      break;
    case "remove-folder": {
      libraryMutated = applyFolderRemoval(scan, libraryMetadata, delta.relativePath);
      break;
    }
  }

  scan.books.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  scan.folders.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  validateScan(scan);

  const reconciled = reconcileLibraryState({
    previousBooks: retiredBookIds.size
      ? snapshot.books.filter((book) => !retiredBookIds.has(book.id))
      : snapshot.books,
    previousFolders: snapshot.folders,
    libraryMetadata,
    progressMetadata,
    scan,
    timestamp,
  });

  assertUnique(
    reconciled.books.map((book) => book.id),
    "book id",
  );
  assertUnique(
    reconciled.folders.map((folder) => folder.id),
    "folder id",
  );

  const coverRevisionResult = applyCoverRevisionOverrides(
    reconciled.books,
    delta.kind === "scanned-books" ? delta.coverRevisionOverrides : undefined,
  );

  return {
    ...reconciled,
    books: coverRevisionResult.books,
    booksChanged: reconciled.booksChanged || coverRevisionResult.changed,
    libraryChanged: reconciled.libraryChanged || libraryMutated,
    progressMetadata,
    progressChanged,
    progressPersistenceDeferred,
  };
}
