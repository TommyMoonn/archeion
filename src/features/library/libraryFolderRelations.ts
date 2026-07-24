import type { ReadonlyFolder } from "../../types/folder";

export function isInsideFolder(relativePath: string | undefined, folder: ReadonlyFolder): boolean {
  if (!relativePath || !folder.relativePath) {
    return false;
  }

  return relativePath === folder.relativePath || relativePath.startsWith(`${folder.relativePath}/`);
}
