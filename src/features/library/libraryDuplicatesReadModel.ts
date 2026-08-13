import type { LibrarySnapshotBook } from "../../storage/LibraryStorage";
import type {
  EpubAnalysisFileSignature,
  EpubDuplicateAnalysisGroup,
  EpubDuplicateAnalysisResult,
} from "../../types/epubIntegrity";
import { libraryBookMatchesAnalysisSignature } from "./libraryIntegrityFiles";

export type ResolvedDuplicateMember = Readonly<{
  book: LibrarySnapshotBook;
  signature: EpubAnalysisFileSignature;
}>;

export type ResolvedDuplicateGroup = Readonly<{
  group: EpubDuplicateAnalysisGroup;
  members: readonly ResolvedDuplicateMember[];
}>;

export function resolveDuplicateGroups(
  books: readonly LibrarySnapshotBook[],
  snapshot: EpubDuplicateAnalysisResult | null,
): readonly ResolvedDuplicateGroup[] {
  if (!snapshot) return [];
  const booksByPath = new Map(
    books.flatMap((book) => (book.relativePath ? [[book.relativePath, book] as const] : [])),
  );

  return snapshot.groups.flatMap((group) => {
    const members = group.members.flatMap((relativePath) => {
      const book = booksByPath.get(relativePath);
      const signature = snapshot.signatures[relativePath];
      return book && signature && libraryBookMatchesAnalysisSignature(book, relativePath, signature)
        ? [{ book, signature }]
        : [];
    });
    return members.length >= 2 ? [{ group, members }] : [];
  });
}

export function duplicateGroupBooks(
  books: readonly LibrarySnapshotBook[],
  snapshot: EpubDuplicateAnalysisResult | null,
): readonly LibrarySnapshotBook[] {
  return resolveDuplicateGroups(books, snapshot).flatMap((resolved) =>
    resolved.members.map((member) => member.book),
  );
}
