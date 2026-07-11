import type { Folder } from "../../types/folder";

export function isInsideFolder(relativePath: string | undefined, folder: Folder): boolean {
  if (!relativePath || !folder.relativePath) {
    return false;
  }

  return relativePath === folder.relativePath || relativePath.startsWith(`${folder.relativePath}/`);
}
