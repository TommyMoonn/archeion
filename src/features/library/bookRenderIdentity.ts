import type { Book } from "../../types/book";

export function isBookRenderEquivalent(left: Book, right: Book): boolean {
  return (
    left === right ||
    (left.id === right.id &&
      left.addedAt === right.addedAt &&
      left.fileName === right.fileName &&
      left.folderId === right.folderId &&
      left.folderPath === right.folderPath &&
      left.isFavorite === right.isFavorite &&
      left.isFileMissing === right.isFileMissing &&
      left.lastOpenedAt === right.lastOpenedAt &&
      left.modifiedAt === right.modifiedAt &&
      left.originalAuthor === right.originalAuthor &&
      left.originalTitle === right.originalTitle &&
      left.progressCfi === right.progressCfi &&
      left.progressPercent === right.progressPercent &&
      left.relativePath === right.relativePath &&
      left.size === right.size &&
      left.sourceMetadata?.creator === right.sourceMetadata?.creator &&
      left.sourceMetadata?.language === right.sourceMetadata?.language &&
      left.sourceMetadata?.title === right.sourceMetadata?.title)
  );
}
