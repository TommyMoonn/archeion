import type { Book, EpubSourceMetadata } from "../types/book";
import type { LibraryBookMetadata } from "./metadataFiles";
import { normalizeArchiveRelativePath } from "./pathSafety";

export type ScannedBookIdentity = {
  discoveryId: string;
  relativePath: string;
  fileName: string;
  folderPath: string;
  size: number;
  modifiedAt: number;
  sourceMetadata?: EpubSourceMetadata;
};

export type BookIdentityMatch = {
  bookId: string;
  confidence: "path" | "package-identifier" | "file-signature";
};

type PreviousIdentity = {
  bookId: string;
  relativePath: string;
  fileName: string;
  folderPath: string;
  fileSize?: number;
  fileModifiedAt?: number;
  sourceMetadata?: EpubSourceMetadata;
};

type IdentityResolverInput = {
  metadataBooks: Record<string, LibraryBookMetadata>;
  scannedBooks: ScannedBookIdentity[];
  previousBooks?: Book[];
};

type IdentityIndex = {
  byPath: Map<string, PreviousIdentity>;
  byPackageIdentifier: Map<string, PreviousIdentity>;
  byFileSignature: Map<string, PreviousIdentity>;
  scannedPackageIdentifierCounts: Map<string, number>;
  scannedFileSignatureCounts: Map<string, number>;
};

function lastPathSegment(relativePath: string): string {
  return relativePath.split("/").at(-1) ?? relativePath;
}

function parentPath(relativePath: string): string {
  return relativePath.split("/").slice(0, -1).join("/");
}

function normalizeText(value: string | undefined): string {
  return (
    value
      ?.trim()
      .toLocaleLowerCase()
      .normalize("NFKD")
      .replace(/\p{Diacritic}/gu, "") ?? ""
  );
}

function normalizeFileStem(fileName: string | undefined): string {
  return normalizeText(fileName?.replace(/\.epub$/i, ""))
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokenSet(value: string): Set<string> {
  return new Set(value.split(/\s+/).filter(Boolean));
}

function filenameSimilarity(left: string, right: string): number {
  if (!left || !right) return 0;
  if (left === right) return 1;

  const leftTokens = tokenSet(left);
  const rightTokens = tokenSet(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let intersection = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) intersection += 1;
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

function packageIdentifier(metadata: EpubSourceMetadata | undefined): string {
  return normalizeText(metadata?.identifier);
}

function packageTitle(metadata: EpubSourceMetadata | undefined): string {
  return normalizeText(metadata?.title);
}

function packageCreator(metadata: EpubSourceMetadata | undefined): string {
  return normalizeText(metadata?.creator);
}

function fileSignature(
  size: number | undefined,
  modifiedAt: number | undefined,
): string {
  return size === undefined || modifiedAt === undefined
    ? ""
    : `${size}:${modifiedAt}`;
}

function countValues(values: string[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

function uniqueIndex<T>(
  items: T[],
  keyForItem: (item: T) => string,
): Map<string, T> {
  const counts = countValues(items.map(keyForItem));
  const index = new Map<string, T>();

  for (const item of items) {
    const key = keyForItem(item);
    if (key && counts.get(key) === 1) {
      index.set(key, item);
    }
  }

  return index;
}

function previousBookById(
  previousBooks: Book[] | undefined,
): Map<string, Book> {
  return new Map(previousBooks?.map((book) => [book.id, book]) ?? []);
}

function previousIdentityFromMetadata(
  bookId: string,
  metadata: LibraryBookMetadata,
  previousBook: Book | undefined,
): PreviousIdentity {
  const relativePath = normalizeArchiveRelativePath(metadata.relativePath);
  const fileName = previousBook?.fileName ?? lastPathSegment(relativePath);
  const fileModifiedAt =
    metadata.fileModifiedAt ??
    (previousBook?.modifiedAt
      ? Date.parse(previousBook.modifiedAt)
      : undefined);

  return {
    bookId,
    relativePath,
    fileName,
    folderPath: previousBook?.folderPath ?? parentPath(relativePath),
    fileSize: metadata.fileSize ?? previousBook?.size,
    fileModifiedAt: Number.isFinite(fileModifiedAt)
      ? fileModifiedAt
      : undefined,
    sourceMetadata: metadata.sourceMetadata ?? previousBook?.sourceMetadata,
  };
}

function hasPackageTitleAndCreatorMatch(
  previous: PreviousIdentity,
  scanned: ScannedBookIdentity,
): boolean {
  const previousTitle = packageTitle(previous.sourceMetadata);
  const scannedTitle = packageTitle(scanned.sourceMetadata);
  const previousCreator = packageCreator(previous.sourceMetadata);
  const scannedCreator = packageCreator(scanned.sourceMetadata);

  return Boolean(
    previousTitle &&
    scannedTitle &&
    previousTitle === scannedTitle &&
    previousCreator &&
    scannedCreator &&
    previousCreator === scannedCreator,
  );
}

function hasSupportingFileSignal(
  previous: PreviousIdentity,
  scanned: ScannedBookIdentity,
): boolean {
  const previousName = normalizeFileStem(previous.fileName);
  const scannedName = normalizeFileStem(scanned.fileName);

  return (
    (previousName !== "" && previousName === scannedName) ||
    filenameSimilarity(previousName, scannedName) >= 0.85 ||
    hasPackageTitleAndCreatorMatch(previous, scanned)
  );
}

export function createBookIdentityIndex({
  metadataBooks,
  scannedBooks,
  previousBooks,
}: IdentityResolverInput): IdentityIndex {
  const previousById = previousBookById(previousBooks);
  const previousIdentities = Object.entries(metadataBooks).map(
    ([bookId, metadata]) =>
      previousIdentityFromMetadata(bookId, metadata, previousById.get(bookId)),
  );

  return {
    byPath: uniqueIndex(previousIdentities, (book) => book.relativePath),
    byPackageIdentifier: uniqueIndex(previousIdentities, (book) =>
      packageIdentifier(book.sourceMetadata),
    ),
    byFileSignature: uniqueIndex(previousIdentities, (book) =>
      fileSignature(book.fileSize, book.fileModifiedAt),
    ),
    scannedPackageIdentifierCounts: countValues(
      scannedBooks.map((book) => packageIdentifier(book.sourceMetadata)),
    ),
    scannedFileSignatureCounts: countValues(
      scannedBooks.map((book) => fileSignature(book.size, book.modifiedAt)),
    ),
  };
}

export function resolveBookIdFromScan(
  book: ScannedBookIdentity,
  identityIndex: IdentityIndex,
): BookIdentityMatch | undefined {
  const pathMatch = identityIndex.byPath.get(
    normalizeArchiveRelativePath(book.relativePath),
  );
  if (pathMatch) {
    return { bookId: pathMatch.bookId, confidence: "path" };
  }

  const identifier = packageIdentifier(book.sourceMetadata);
  if (
    identifier &&
    identityIndex.scannedPackageIdentifierCounts.get(identifier) === 1
  ) {
    const identifierMatch = identityIndex.byPackageIdentifier.get(identifier);
    if (identifierMatch) {
      return {
        bookId: identifierMatch.bookId,
        confidence: "package-identifier",
      };
    }
  }

  const signature = fileSignature(book.size, book.modifiedAt);
  if (
    signature &&
    identityIndex.scannedFileSignatureCounts.get(signature) === 1
  ) {
    const signatureMatch = identityIndex.byFileSignature.get(signature);
    if (signatureMatch && hasSupportingFileSignal(signatureMatch, book)) {
      return { bookId: signatureMatch.bookId, confidence: "file-signature" };
    }
  }

  return undefined;
}
