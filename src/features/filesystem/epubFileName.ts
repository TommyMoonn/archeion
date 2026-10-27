import { validateArchiveItemName } from "../../storage/pathSafety";
export const EPUB_EXTENSION = ".epub";
export function getEpubNameStem(fileName: string): string {
  return fileName.toLowerCase().endsWith(EPUB_EXTENSION)
    ? fileName.slice(0, -EPUB_EXTENSION.length)
    : fileName;
}
export function normalizeEpubFileName(value: string): string {
  const stem = getEpubNameStem(value).trim();
  if (!stem) throw new Error("Enter a filename.");
  return validateArchiveItemName(`${stem}${EPUB_EXTENSION}`);
}
