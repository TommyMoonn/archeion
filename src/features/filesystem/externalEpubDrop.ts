import { ARCHIVE_ROOT_DESTINATION, isEpubSourcePath } from "./archiveImport";

export const IMPORT_DROP_TARGET_ATTRIBUTE = "data-import-drop-target";
export const IMPORT_DROP_DESTINATION_ATTRIBUTE = "data-import-drop-destination";
export const IMPORT_DROP_ID_ATTRIBUTE = "data-import-drop-id";

export type ImportDropTarget = { destination: string; id: string };

export type ExternalEpubDropValidation =
  { valid: true; sourcePaths: string[] } | { valid: false; message: string };

export function validateExternalEpubDrop(paths: readonly string[]): ExternalEpubDropValidation {
  if (paths.length === 0) {
    return { valid: false, message: "No files were dropped." };
  }
  if (paths.some((path) => !isEpubSourcePath(path))) {
    return {
      valid: false,
      message: "Only EPUB files can be dropped. Folders are not supported.",
    };
  }
  return { valid: true, sourcePaths: [...paths] };
}

export function importDropDestinationAtPoint(
  x: number,
  y: number,
  documentRoot: Document = document,
): ImportDropTarget | null {
  const target = documentRoot
    .elementFromPoint(x, y)
    ?.closest<HTMLElement>(`[${IMPORT_DROP_TARGET_ATTRIBUTE}="true"]`);
  if (!target) return null;
  const destination = target.getAttribute(IMPORT_DROP_DESTINATION_ATTRIBUTE);
  const id = target.getAttribute(IMPORT_DROP_ID_ATTRIBUTE);
  return destination && id ? { destination, id } : null;
}

export function importDropTargetAttributes(destinationFolderPath?: string, id = "archive-root") {
  return {
    [IMPORT_DROP_TARGET_ATTRIBUTE]: "true",
    [IMPORT_DROP_DESTINATION_ATTRIBUTE]: destinationFolderPath || ARCHIVE_ROOT_DESTINATION,
    [IMPORT_DROP_ID_ATTRIBUTE]: id,
  };
}
