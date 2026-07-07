import type {
  ArchiveImportConflictAction,
  ArchiveImportMode,
  ArchiveImportResult,
} from "../../storage/LibraryStorage";
import type { Folder } from "../../types/folder";

export const ARCHIVE_ROOT_DESTINATION = "__archive-root__";

export type ArchiveImportDestination = {
  label: string;
  value: string;
};

export type ArchiveImportSummary = {
  failed: number;
  imported: number;
  message: string;
  skipped: number;
};

export const archiveImportConflictOptions: Array<{
  label: string;
  value: ArchiveImportConflictAction;
}> = [
  { label: "Keep both", value: "keepBoth" },
  { label: "Skip duplicates", value: "skip" },
  { label: "Replace existing", value: "replace" },
];

export const archiveImportModeOptions: Array<{
  label: string;
  value: ArchiveImportMode;
}> = [
  { label: "Copy", value: "copy" },
  { label: "Move", value: "move" },
];

export function getFileNameFromPath(path: string): string {
  return path.replaceAll("\\", "/").split("/").filter(Boolean).at(-1) ?? path;
}

export function isEpubSourcePath(path: string): boolean {
  return /\.epub$/i.test(getFileNameFromPath(path));
}

export function createArchiveDestinationOptions(
  folders: Folder[],
): ArchiveImportDestination[] {
  return [
    { label: "Archive root", value: ARCHIVE_ROOT_DESTINATION },
    ...[...folders]
      .filter((folder) => folder.relativePath)
      .sort((left, right) =>
        (left.relativePath ?? "").localeCompare(right.relativePath ?? ""),
      )
      .map((folder) => ({
        label: folder.relativePath ?? folder.name,
        value: folder.relativePath ?? folder.name,
      })),
  ];
}

export function destinationValueToFolderPath(value: string): string | undefined {
  return value === ARCHIVE_ROOT_DESTINATION ? undefined : value;
}

export function destinationValueFromFolderPath(folderPath?: string | null): string {
  return folderPath || ARCHIVE_ROOT_DESTINATION;
}

export function summarizeArchiveImportResults(
  results: ArchiveImportResult[],
): ArchiveImportSummary | null {
  if (results.length === 0) {
    return null;
  }

  const imported = results.filter((result) => result.status === "imported").length;
  const skipped = results.filter((result) => result.status === "skipped").length;
  const failed = results.filter((result) => result.status === "failed").length;
  const segments: string[] = [];

  if (imported > 0) {
    segments.push(`${imported} added`);
  }
  if (skipped > 0) {
    segments.push(`${skipped} skipped`);
  }
  if (failed > 0) {
    segments.push(`${failed} failed`);
  }

  return {
    failed,
    imported,
    message: segments.join(". ") + ".",
    skipped,
  };
}
