import type { LibraryBookMetadata } from "./metadataFiles";
import { normalizeArchiveRelativePath } from "./pathSafety";

export type ScannedBookIdentity = {
  discoveryId: string;
  relativePath: string;
};

export function createBookIdentityIndex(
  books: Record<string, Pick<LibraryBookMetadata, "relativePath">>,
): Map<string, string> {
  const index = new Map<string, string>();
  for (const [bookId, metadata] of Object.entries(books)) {
    index.set(normalizeArchiveRelativePath(metadata.relativePath), bookId);
  }
  return index;
}

export function resolveBookIdFromScan(
  book: ScannedBookIdentity,
  identityIndex: ReadonlyMap<string, string>,
): string {
  return (
    identityIndex.get(normalizeArchiveRelativePath(book.relativePath)) ??
    book.discoveryId
  );
}
