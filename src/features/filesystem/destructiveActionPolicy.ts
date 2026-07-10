import type { ArchiveImportConflictAction } from "../../storage/LibraryStorage";

export function shouldConfirmBookDeletion(
  confirmationsEnabled: boolean,
  isFileMissing: boolean,
): boolean {
  return confirmationsEnabled || isFileMissing;
}

export function shouldConfirmFolderDeletion(confirmationsEnabled: boolean): boolean {
  return confirmationsEnabled;
}

export function shouldConfirmImportReplace(
  confirmationsEnabled: boolean,
  conflictAction: ArchiveImportConflictAction,
): boolean {
  return confirmationsEnabled && conflictAction === "replace";
}
