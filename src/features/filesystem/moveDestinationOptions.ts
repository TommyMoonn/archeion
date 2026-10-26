import type { ReadonlyFolder } from "../../types/folder";
import { ARCHIVE_ROOT_DESTINATION } from "./archiveImport";
export function moveDestinationOptions(
  folders: readonly ReadonlyFolder[],
  excludedFolderIds: readonly string[] = [],
) {
  const excluded = new Set(excludedFolderIds);
  return [
    { label: "Archive root", value: ARCHIVE_ROOT_DESTINATION },
    ...[...folders]
      .filter((folder) => folder.relativePath)
      .sort((left, right) => (left.relativePath ?? "").localeCompare(right.relativePath ?? ""))
      .map((folder) => ({
        disabled: excluded.has(folder.id),
        label: folder.relativePath ?? folder.name,
        value: folder.id,
      })),
  ];
}
