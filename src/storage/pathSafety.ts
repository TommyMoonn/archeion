export type FileOperationStatus =
  "success" | "skipped" | "conflict" | "denied" | "missingSource" | "failed";

export type FileOperationResult = {
  status: FileOperationStatus;
  relativePath?: string;
  message?: string;
};

const RESERVED_METADATA_DIRECTORY = ".archeion";
const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

export function normalizeArchiveRelativePath(path: string): string {
  const normalized = path
    .replaceAll("\\", "/")
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);

  const parts: string[] = [];
  for (const part of normalized) {
    if (part === ".") continue;
    if (part === "..") {
      throw new Error("Archive paths cannot leave the archive folder.");
    }
    parts.push(part);
  }

  const result = parts.join("/");
  if (!result) {
    throw new Error("Archive paths cannot be empty.");
  }
  if (isReservedArchivePath(result)) {
    throw new Error("The .archeion metadata folder is reserved.");
  }
  return result;
}

export function getArchiveParentPath(relativePath: string): string {
  const normalized = normalizeArchiveRelativePath(relativePath);
  const parts = normalized.split("/");
  parts.pop();
  return parts.join("/");
}

export function isReservedArchivePath(relativePath: string): boolean {
  const firstPart = relativePath.replaceAll("\\", "/").split("/").filter(Boolean)[0];
  return firstPart?.toLowerCase() === RESERVED_METADATA_DIRECTORY;
}

export function validateArchiveItemName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new Error("Names cannot be empty.");
  }
  if (trimmed === "." || trimmed === "..") {
    throw new Error("Names cannot use path traversal segments.");
  }
  if (/[\\/:*?"<>|]/.test(trimmed)) {
    throw new Error("Names cannot contain path separators or reserved characters.");
  }
  if (/[ .]$/.test(trimmed)) {
    throw new Error("Names cannot end with a space or period.");
  }
  const baseName = trimmed.split(".")[0]?.toLowerCase() ?? "";
  if (WINDOWS_RESERVED_NAMES.has(baseName)) {
    throw new Error("This name is reserved by Windows.");
  }
  if (trimmed.toLowerCase() === RESERVED_METADATA_DIRECTORY) {
    throw new Error("The .archeion metadata folder is reserved.");
  }
  return trimmed;
}

export function validateEpubFileName(name: string): string {
  const trimmed = validateArchiveItemName(name);
  if (!trimmed.toLowerCase().endsWith(".epub")) {
    throw new Error("EPUB file names must end with .epub.");
  }
  return trimmed;
}

export function hasDestinationConflict(
  existingRelativePaths: Iterable<string>,
  destinationRelativePath: string,
): boolean {
  const destination = normalizeArchiveRelativePath(destinationRelativePath).toLowerCase();
  for (const existing of existingRelativePaths) {
    if (normalizeArchiveRelativePath(existing).toLowerCase() === destination) {
      return true;
    }
  }
  return false;
}

export function createFileOperationResult(
  status: FileOperationStatus,
  options: Omit<FileOperationResult, "status"> = {},
): FileOperationResult {
  return { status, ...options };
}
