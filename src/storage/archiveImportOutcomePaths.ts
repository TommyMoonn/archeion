import type { ArchiveImportResult, ArchiveWatcherChange } from "./LibraryStorage";
import { normalizeArchiveRelativePath } from "./pathSafety";

export type ArchiveImportOutcomePaths = {
  requiredPresentPaths: string[];
  replacementPaths: string[];
  scanPaths: string[];
  contractError?: Error;
};

function normalizeFoldedPath(path: string): string {
  const normalized = normalizeArchiveRelativePath(path);
  if (!normalized.toLowerCase().endsWith(".epub")) {
    throw new Error("not an EPUB path");
  }
  return normalized;
}

export function collectImportOutcomePaths(
  results: readonly ArchiveImportResult[],
  foldedWatcherChanges: readonly ArchiveWatcherChange[],
): ArchiveImportOutcomePaths {
  const replacementPaths: string[] = [];
  const importedIdentities = new Set<string>();
  const replacementIdentities = new Set<string>();
  const requiredPresence = new Map<string, boolean>();
  const scanPathsByIdentity = new Map<string, string>();
  const contractProblems: string[] = [];

  for (const result of results) {
    if (result.status !== "imported" || !result.relativePath) continue;
    let normalized: string;
    try {
      normalized = normalizeArchiveRelativePath(result.relativePath);
    } catch {
      contractProblems.push("an invalid archive path");
      continue;
    }
    const identity = normalized.toLowerCase();
    if (result.replacedExisting && !replacementIdentities.has(identity)) {
      replacementIdentities.add(identity);
      replacementPaths.push(normalized);
    }
    if (importedIdentities.has(identity)) {
      contractProblems.push(`multiple durable imports for ${normalized}`);
      continue;
    }
    importedIdentities.add(identity);
    requiredPresence.set(identity, true);
    scanPathsByIdentity.set(identity, normalized);
  }

  let previousChangeKey: string | undefined;
  for (const change of foldedWatcherChanges) {
    const normalizedPaths: string[] = [];
    const seenPaths = new Set<string>();
    let invalidPath = false;
    for (const path of change.relativePaths) {
      let normalized: string;
      try {
        normalized = normalizeFoldedPath(path);
      } catch {
        contractProblems.push("an invalid folded watcher path");
        invalidPath = true;
        continue;
      }
      const identity = normalized.toLowerCase();
      if (seenPaths.has(identity)) {
        continue;
      }
      seenPaths.add(identity);
      normalizedPaths.push(normalized);
    }
    if (invalidPath) continue;
    if (!normalizedPaths.length) {
      contractProblems.push(`an empty folded ${change.kind} change`);
      continue;
    }

    const changeKey = `${change.kind}\0${normalizedPaths
      .map((path) => path.toLowerCase())
      .join("\0")}`;
    if (changeKey === previousChangeKey) continue;
    previousChangeKey = changeKey;

    for (const normalized of normalizedPaths) {
      const identity = normalized.toLowerCase();
      scanPathsByIdentity.set(identity, scanPathsByIdentity.get(identity) ?? normalized);
    }

    switch (change.kind) {
      case "create":
      case "modify":
        for (const normalized of normalizedPaths) {
          const identity = normalized.toLowerCase();
          requiredPresence.set(identity, true);
        }
        break;
      case "remove":
        for (const normalized of normalizedPaths) {
          const identity = normalized.toLowerCase();
          requiredPresence.set(identity, false);
        }
        break;
      case "rename": {
        if (normalizedPaths.length !== 2) {
          contractProblems.push("an incomplete folded rename change");
          break;
        }
        const [fromPath, toPath] = normalizedPaths;
        const fromIdentity = fromPath.toLowerCase();
        const toIdentity = toPath.toLowerCase();
        if (fromIdentity === toIdentity) {
          contractProblems.push("a folded rename with identical paths");
          break;
        }
        requiredPresence.set(fromIdentity, false);
        requiredPresence.set(toIdentity, true);
        break;
      }
      case "metadata":
      case "unknown":
        contractProblems.push(`an ambiguous folded ${change.kind} change`);
        break;
    }
  }

  return {
    requiredPresentPaths: [...scanPathsByIdentity.values()].filter((relativePath) =>
      requiredPresence.get(relativePath.toLowerCase()),
    ),
    replacementPaths,
    scanPaths: [...scanPathsByIdentity.values()],
    contractError: contractProblems.length
      ? new Error(
          `The native import result was internally contradictory: ${contractProblems.join(", ")}.`,
        )
      : undefined,
  };
}
