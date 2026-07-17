import type { ArchiveWatcherChangeSet } from "./LibraryStorage";
import { isReservedArchivePath, normalizeArchiveRelativePath } from "./pathSafety";

export type ArchiveWatcherChangePlan =
  { kind: "full-scan"; reason: string } | { kind: "targeted-epub-scan"; relativePaths: string[] };

function isEpubPath(relativePath: string): boolean {
  return relativePath.toLocaleLowerCase().endsWith(".epub");
}

export function planArchiveWatcherChanges(
  changeSet: ArchiveWatcherChangeSet,
): ArchiveWatcherChangePlan {
  if (changeSet.overflow) {
    return { kind: "full-scan", reason: "watcher-overflow" };
  }

  const targetedPaths = new Map<string, string>();
  for (const change of changeSet.changes) {
    if (change.kind === "unknown" || change.kind === "metadata") {
      return { kind: "full-scan", reason: change.kind };
    }

    const normalizedPaths: string[] = [];
    for (const path of change.relativePaths) {
      let normalized: string;
      try {
        normalized = normalizeArchiveRelativePath(path);
      } catch {
        return { kind: "full-scan", reason: "invalid-path" };
      }
      if (isReservedArchivePath(normalized)) {
        return { kind: "full-scan", reason: "metadata" };
      }
      normalizedPaths.push(normalized);
    }

    if (!normalizedPaths.length) {
      return { kind: "full-scan", reason: "missing-path" };
    }
    if (change.kind === "rename" && normalizedPaths.length !== 2) {
      return { kind: "full-scan", reason: "ambiguous-rename" };
    }
    if (normalizedPaths.some((path) => !isEpubPath(path))) {
      return { kind: "full-scan", reason: "folder-topology" };
    }

    for (const path of normalizedPaths) {
      const comparisonPath = path.toLocaleLowerCase();
      if (!targetedPaths.has(comparisonPath)) {
        targetedPaths.set(comparisonPath, path);
      }
    }
  }

  if (!targetedPaths.size) {
    return { kind: "full-scan", reason: "empty-change-set" };
  }

  return {
    kind: "targeted-epub-scan",
    relativePaths: [...targetedPaths.values()].sort((left, right) => left.localeCompare(right)),
  };
}
