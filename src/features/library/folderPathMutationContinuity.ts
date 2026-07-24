import {
  getArchiveParentPath,
  normalizeArchiveRelativePath,
  validateArchiveItemName,
} from "../../storage/pathSafety";
import type { ReadonlyFolder, UpdateFolderInput } from "../../types/folder";

export type FolderPathMutationMapping = Readonly<{
  oldRelativePath: string;
  newRelativePath: string;
}>;

export function predictFolderPathMutation(
  folder: ReadonlyFolder,
  changes: UpdateFolderInput,
  folders: readonly ReadonlyFolder[],
): FolderPathMutationMapping {
  const oldRelativePath = requireFolderPath(folder.relativePath);
  const name = Object.hasOwn(changes, "name")
    ? validateArchiveItemName(changes.name ?? "")
    : folder.name;
  let parentPath = getArchiveParentPath(oldRelativePath);

  if (Object.hasOwn(changes, "parentId")) {
    if (changes.parentId) {
      const parent = folders.find((candidate) => candidate.id === changes.parentId);
      parentPath = requireFolderPath(parent?.relativePath);
    } else {
      parentPath = "";
    }
  }

  return {
    oldRelativePath,
    newRelativePath: normalizeArchiveRelativePath(parentPath ? `${parentPath}/${name}` : name),
  };
}

export function rewriteFolderPathForMutation(
  relativePath: string | undefined,
  mapping: FolderPathMutationMapping,
): string | null {
  const requestedParts = normalizedPathParts(relativePath);
  const oldParts = normalizedPathParts(mapping.oldRelativePath);
  if (!requestedParts || !oldParts || requestedParts.length < oldParts.length) {
    return null;
  }

  const ownsPrefix = oldParts.every(
    (part, index) => part.toLocaleLowerCase() === requestedParts[index]?.toLocaleLowerCase(),
  );
  if (!ownsPrefix) {
    return null;
  }

  const newParts = normalizedPathParts(mapping.newRelativePath);
  if (!newParts) {
    return null;
  }

  return [...newParts, ...requestedParts.slice(oldParts.length)].join("/");
}

export function sameFolderPath(left: string | undefined, right: string | undefined): boolean {
  const leftPath = normalizedPathKey(left);
  return leftPath !== null && leftPath === normalizedPathKey(right);
}

function normalizedPathParts(relativePath: string | undefined): string[] | null {
  if (!relativePath?.trim()) return null;

  try {
    return normalizeArchiveRelativePath(relativePath).split("/");
  } catch {
    return null;
  }
}

function normalizedPathKey(relativePath: string | undefined): string | null {
  return normalizedPathParts(relativePath)?.join("/").toLocaleLowerCase() ?? null;
}

function requireFolderPath(relativePath: string | undefined): string {
  if (!relativePath) {
    throw new Error("The folder path is unavailable.");
  }
  return normalizeArchiveRelativePath(relativePath);
}
