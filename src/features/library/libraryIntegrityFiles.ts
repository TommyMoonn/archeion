import type { LibrarySnapshotBook } from "../../storage/LibraryStorage";
import type { EpubAnalysisFileRequest, EpubAnalysisFileSignature } from "../../types/epubIntegrity";

export function libraryBookAnalysisFile(book: LibrarySnapshotBook): EpubAnalysisFileRequest | null {
  if (book.isFileMissing || !book.relativePath || book.size === undefined || !book.modifiedAt) {
    return null;
  }
  const modifiedAtMillis = Date.parse(book.modifiedAt);
  if (!Number.isFinite(modifiedAtMillis) || !Number.isSafeInteger(book.size) || book.size < 0) {
    return null;
  }
  return {
    relativePath: book.relativePath,
    signature: { modifiedAtMillis, sizeBytes: book.size },
  };
}

export function libraryBookMatchesAnalysisSignature(
  book: LibrarySnapshotBook,
  relativePath: string,
  signature: EpubAnalysisFileSignature,
): boolean {
  const currentFile = libraryBookAnalysisFile(book);
  return (
    currentFile?.relativePath === relativePath &&
    currentFile.signature.sizeBytes === signature.sizeBytes &&
    currentFile.signature.modifiedAtMillis === signature.modifiedAtMillis
  );
}
