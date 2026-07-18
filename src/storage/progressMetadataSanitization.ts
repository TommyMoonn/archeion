import type { LibraryMetadata, ProgressMetadata } from "./metadataFiles";

export type SanitizedProgressMetadata = {
  changed: boolean;
  metadata: ProgressMetadata;
};

export function sanitizeProgressMetadataForLibrary(
  progressMetadata: ProgressMetadata,
  libraryMetadata: LibraryMetadata,
): SanitizedProgressMetadata {
  const ownedBookIds = new Set(Object.keys(libraryMetadata.books));
  const progress = Object.fromEntries(
    Object.entries(progressMetadata.progress).filter(([bookId]) => ownedBookIds.has(bookId)),
  );
  const changed = Object.keys(progress).length !== Object.keys(progressMetadata.progress).length;

  return {
    changed,
    metadata: changed ? { ...progressMetadata, progress } : progressMetadata,
  };
}
