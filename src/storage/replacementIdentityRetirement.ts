import type { LibraryMetadata } from "./metadataFiles";
import { normalizeArchiveRelativePath } from "./pathSafety";

export type ReplacementIdentityRetirement = {
  libraryMetadata: LibraryMetadata;
  retiredBookIds: Set<string>;
};

export function retireReplacementPathIdentities(
  libraryMetadata: LibraryMetadata,
  replacementRelativePaths: readonly string[],
  allowedRelativePaths?: readonly string[],
): ReplacementIdentityRetirement {
  const normalizedPaths = replacementRelativePaths.map((path) =>
    normalizeArchiveRelativePath(path).toLocaleLowerCase(),
  );
  if (new Set(normalizedPaths).size !== normalizedPaths.length) {
    throw new Error("Replacement import contains duplicate destination paths.");
  }

  if (allowedRelativePaths) {
    const allowed = new Set(
      allowedRelativePaths.map((path) => normalizeArchiveRelativePath(path).toLocaleLowerCase()),
    );
    for (const path of normalizedPaths) {
      if (!allowed.has(path)) {
        throw new Error(`Replacement path "${path}" is not present in the scan result.`);
      }
    }
  }

  if (!normalizedPaths.length) {
    return { libraryMetadata, retiredBookIds: new Set() };
  }

  const replacements = new Set(normalizedPaths);
  const books = { ...libraryMetadata.books };
  const retiredBookIds = new Set<string>();
  for (const [bookId, entry] of Object.entries(books)) {
    const path = normalizeArchiveRelativePath(entry.relativePath).toLocaleLowerCase();
    if (!replacements.has(path)) continue;
    delete books[bookId];
    retiredBookIds.add(bookId);
  }

  return {
    libraryMetadata: retiredBookIds.size > 0 ? { ...libraryMetadata, books } : libraryMetadata,
    retiredBookIds,
  };
}
