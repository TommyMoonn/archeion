import type { ReadonlyFolder } from "../../types/folder";
import { normalizeArchiveRelativePath } from "../../storage/pathSafety";

export type FolderMutationFocusSurface = "browser" | "tree";

export type FolderMutationFocusContext = Readonly<{
  relativePath: string;
  surface: FolderMutationFocusSurface;
}>;

export type FolderDeletionFocusContext = Readonly<{
  candidatePaths: readonly string[];
  deletedPath: string;
  surface: FolderMutationFocusSurface;
}>;

export function folderMutationOwnerAttributes(
  folder: ReadonlyFolder,
  surface: FolderMutationFocusSurface,
) {
  return {
    "data-library-folder-path": folder.relativePath,
    "data-library-folder-surface": surface,
  } as const;
}

export function captureFolderMutationFocusContext(
  activeElement: Element | null,
  folder: ReadonlyFolder,
): FolderMutationFocusContext | null {
  const owner = activeElement?.closest<HTMLElement>("[data-library-folder-path]");
  if (!owner || !sameFolderPath(owner.dataset.libraryFolderPath, folder.relativePath)) {
    return null;
  }

  const surface = folderFocusSurface(owner);
  return surface && folder.relativePath ? { relativePath: folder.relativePath, surface } : null;
}

export function captureFolderDeletionFocusContext(
  activeElement: Element | null,
  folder: ReadonlyFolder,
  root: ParentNode = document,
): FolderDeletionFocusContext | null {
  const deletedPath = folder.relativePath;
  const owner = activeElement?.closest<HTMLElement>("[data-library-folder-path]");
  if (!deletedPath || !owner || !sameFolderPath(owner.dataset.libraryFolderPath, deletedPath)) {
    return null;
  }

  const surface = folderFocusSurface(owner);
  if (!surface) return null;

  const owners = Array.from(
    root.querySelectorAll<HTMLElement>(
      `[data-library-folder-surface="${surface}"][data-library-folder-path]`,
    ),
  );
  const ownerIndex = owners.indexOf(owner);
  const following = owners
    .slice(ownerIndex + 1)
    .map((candidate) => candidate.dataset.libraryFolderPath);
  const preceding = owners
    .slice(0, Math.max(0, ownerIndex))
    .reverse()
    .map((candidate) => candidate.dataset.libraryFolderPath);
  const parentPath = parentFolderPath(deletedPath);
  const candidatePaths = [...following, ...preceding, parentPath].filter(
    (path): path is string => typeof path === "string" && !sameFolderPath(path, deletedPath),
  );

  return {
    candidatePaths: [...new Set(candidatePaths)],
    deletedPath,
    surface,
  };
}

export function findFolderMutationFocusTarget(
  root: ParentNode,
  relativePath: string,
  surface: FolderMutationFocusSurface,
): HTMLElement | null {
  for (const owner of root.querySelectorAll<HTMLElement>("[data-library-folder-path]")) {
    if (
      owner.dataset.libraryFolderSurface !== surface ||
      !sameFolderPath(owner.dataset.libraryFolderPath, relativePath)
    ) {
      continue;
    }

    return owner.querySelector<HTMLElement>("[data-library-folder-primary-action]");
  }

  return null;
}

export function focusBelongsToDeletedFolder(
  activeElement: Element | null,
  context: FolderDeletionFocusContext,
): boolean {
  const owner = activeElement?.closest<HTMLElement>("[data-library-folder-path]");
  return Boolean(owner && sameFolderPath(owner.dataset.libraryFolderPath, context.deletedPath));
}

export function findFolderDeletionFocusTarget(
  root: ParentNode,
  context: FolderDeletionFocusContext,
): HTMLElement | null {
  const surfaces: FolderMutationFocusSurface[] =
    context.surface === "browser" ? ["browser", "tree"] : ["tree", "browser"];
  for (const relativePath of context.candidatePaths) {
    for (const surface of surfaces) {
      const target = findFolderMutationFocusTarget(root, relativePath, surface);
      if (target) return target;
    }
  }

  return root.querySelector<HTMLElement>("[data-library-folder-collection-entry]");
}

function folderFocusSurface(owner: HTMLElement): FolderMutationFocusSurface | null {
  const surface = owner.dataset.libraryFolderSurface;
  return surface === "browser" || surface === "tree" ? surface : null;
}

function parentFolderPath(relativePath: string | undefined): string | null {
  if (!relativePath) return null;
  try {
    const normalized = normalizeArchiveRelativePath(relativePath);
    const separatorIndex = normalized.lastIndexOf("/");
    return separatorIndex > 0 ? normalized.slice(0, separatorIndex) : null;
  } catch {
    return null;
  }
}

function sameFolderPath(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) return false;
  try {
    return (
      normalizeArchiveRelativePath(left).toLocaleLowerCase() ===
      normalizeArchiveRelativePath(right).toLocaleLowerCase()
    );
  } catch {
    return false;
  }
}
