import type { Folder } from "../../types/folder";
import { normalizeArchiveRelativePath } from "../../storage/pathSafety";

export type FolderMutationFocusSurface = "browser" | "tree";

export type FolderMutationFocusContext = Readonly<{
  relativePath: string;
  surface: FolderMutationFocusSurface;
}>;

export function folderMutationOwnerAttributes(folder: Folder, surface: FolderMutationFocusSurface) {
  return {
    "data-library-folder-path": folder.relativePath,
    "data-library-folder-surface": surface,
  } as const;
}

export function captureFolderMutationFocusContext(
  activeElement: Element | null,
  folder: Folder,
): FolderMutationFocusContext | null {
  const owner = activeElement?.closest<HTMLElement>("[data-library-folder-path]");
  if (!owner || !sameFolderPath(owner.dataset.libraryFolderPath, folder.relativePath)) {
    return null;
  }

  const surface = owner.dataset.libraryFolderSurface;
  if (surface !== "browser" && surface !== "tree") {
    return null;
  }

  return folder.relativePath ? { relativePath: folder.relativePath, surface } : null;
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
