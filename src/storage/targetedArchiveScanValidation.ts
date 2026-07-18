import type { Folder } from "../types/folder";
import {
  normalizeArchiveRelativePath,
  validateArchiveItemName,
  validateEpubFileName,
} from "./pathSafety";
import type { ArchiveEpubScan, ScannedBook } from "./reconcileLibraryState";

export type TargetedScanPresenceRule = "represented" | "scanned-book-required";

export type TargetedArchiveScanValidationInput = {
  currentFolders: readonly Folder[];
  presenceRule: TargetedScanPresenceRule;
  requiredPresentRelativePaths?: readonly string[];
  requestedRelativePaths: readonly string[];
  scan: ArchiveEpubScan;
};

export type ValidatedTargetedArchiveScan = ArchiveEpubScan & {
  requestedRelativePaths: string[];
};

function archivePathKey(relativePath: string): string {
  return relativePath.toLowerCase();
}

function isAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || /^[\\/]{2}/.test(path) || /^[\\/]/.test(path);
}

function validateArchivePathSegments(relativePath: string, epub: boolean): void {
  const parts = relativePath.split("/");
  const lastIndex = parts.length - 1;
  parts.forEach((part, index) => {
    if (epub && index === lastIndex) {
      validateEpubFileName(part);
    } else {
      validateArchiveItemName(part);
    }
  });
}

function validateRawRelativePath(path: string, label: string): string {
  const normalizedSeparators = path.trim().replaceAll("\\", "/");
  if (isAbsolutePath(normalizedSeparators)) {
    throw new Error(`${label} must be relative to the archive folder.`);
  }
  if (!normalizedSeparators || normalizedSeparators.includes("\0")) {
    throw new Error(`${label} cannot be empty or contain null characters.`);
  }
  const parts = normalizedSeparators.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new Error(`${label} contains an invalid path segment.`);
  }
  return normalizedSeparators;
}

function normalizeTargetedEpubPath(path: string, label: string): string {
  let normalized: string;
  try {
    normalized = normalizeArchiveRelativePath(validateRawRelativePath(path, label));
    validateArchivePathSegments(normalized, true);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is invalid. ${reason}`, { cause: error });
  }
  return normalized;
}

function normalizeFolderPath(path: string, label: string): string {
  if (!path) {
    return "";
  }
  let normalized: string;
  try {
    normalized = normalizeArchiveRelativePath(validateRawRelativePath(path, label));
    validateArchivePathSegments(normalized, false);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} is invalid. ${reason}`, { cause: error });
  }
  return normalized;
}

function parentPath(relativePath: string): string {
  return relativePath.split("/").slice(0, -1).join("/");
}

function normalizeRequestedPaths(paths: readonly string[]): string[] {
  const normalizedByKey = new Map<string, string>();
  for (const path of paths) {
    const normalized = normalizeTargetedEpubPath(path, "Requested EPUB path");
    const key = archivePathKey(normalized);
    normalizedByKey.set(key, normalizedByKey.get(key) ?? normalized);
  }
  if (!normalizedByKey.size) {
    throw new Error("A targeted EPUB scan must request at least one path.");
  }
  return [...normalizedByKey.values()];
}

function normalizeReturnedBook(book: ScannedBook): ScannedBook {
  const relativePath = normalizeTargetedEpubPath(book.relativePath, "Returned EPUB path");
  const expectedFolderPath = parentPath(relativePath);
  const folderPath = normalizeFolderPath(book.folderPath, "Returned EPUB folder path");
  if (archivePathKey(folderPath) !== archivePathKey(expectedFolderPath)) {
    throw new Error(`Returned EPUB "${relativePath}" has an inconsistent folder path.`);
  }

  return {
    ...book,
    relativePath,
    fileName: relativePath.split("/").at(-1) ?? book.fileName,
    folderPath,
  };
}

export function validateTargetedArchiveScan({
  currentFolders,
  presenceRule,
  requiredPresentRelativePaths,
  requestedRelativePaths,
  scan,
}: TargetedArchiveScanValidationInput): ValidatedTargetedArchiveScan {
  const requested = normalizeRequestedPaths(requestedRelativePaths);
  const requestedByKey = new Map(requested.map((path) => [archivePathKey(path), path]));
  const requiredPresentKeys = new Set(
    (requiredPresentRelativePaths ?? requested).map((path) => {
      const normalized = normalizeTargetedEpubPath(path, "Required EPUB path");
      const key = archivePathKey(normalized);
      if (!requestedByKey.has(key)) {
        throw new Error(`Required EPUB path "${normalized}" was not requested.`);
      }
      return key;
    }),
  );
  const folderKeys = new Set(
    currentFolders.flatMap((folder) => {
      if (!folder.relativePath) {
        return [];
      }
      return [archivePathKey(normalizeFolderPath(folder.relativePath, "Current folder path"))];
    }),
  );

  const returnedKeys = new Set<string>();
  const books = scan.books.map((book) => {
    const normalized = normalizeReturnedBook(book);
    const key = archivePathKey(normalized.relativePath);
    if (returnedKeys.has(key)) {
      throw new Error(`Targeted EPUB scan returned duplicate path "${normalized.relativePath}".`);
    }
    if (!requestedByKey.has(key)) {
      throw new Error(`Targeted EPUB scan returned unrequested path "${normalized.relativePath}".`);
    }
    if (normalized.folderPath && !folderKeys.has(archivePathKey(normalized.folderPath))) {
      throw new Error(
        `Targeted EPUB scan returned "${normalized.relativePath}" in unknown folder "${normalized.folderPath}".`,
      );
    }
    returnedKeys.add(key);
    return normalized;
  });

  const missingByKey = new Map<string, string>();
  for (const path of scan.missingRelativePaths) {
    const normalized = normalizeTargetedEpubPath(path, "Missing EPUB path");
    const key = archivePathKey(normalized);
    if (!requestedByKey.has(key)) {
      throw new Error(`Targeted EPUB scan reported unrequested missing path "${normalized}".`);
    }
    if (returnedKeys.has(key)) {
      throw new Error(`Targeted EPUB scan reported "${normalized}" as both scanned and missing.`);
    }
    if (missingByKey.has(key)) {
      throw new Error(`Targeted EPUB scan returned duplicate missing path "${normalized}".`);
    }
    missingByKey.set(key, normalized);
  }

  for (const [key, path] of requestedByKey) {
    if (!returnedKeys.has(key) && !missingByKey.has(key)) {
      throw new Error(`Targeted EPUB scan omitted requested path "${path}".`);
    }
    if (
      presenceRule === "scanned-book-required" &&
      requiredPresentKeys.has(key) &&
      !returnedKeys.has(key)
    ) {
      throw new Error(`Targeted EPUB scan did not return imported EPUB "${path}".`);
    }
  }

  return {
    books,
    missingRelativePaths: [...missingByKey.values()],
    requestedRelativePaths: requested,
    warnings: scan.warnings,
  };
}
