export const WRITEBACK_WATCHER_SUPPRESSION_TTL_MS = 5_000;

type SuppressedWritebackPath = {
  activeCount: number;
  expiresAt: number;
  relativePath: string;
};

export type WritebackSuppressionToken = {
  archiveRootPath: string;
  relativePath: string;
};

const suppressedWritebackPaths = new Map<string, SuppressedWritebackPath>();

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/g, "");
}

function normalizePathForComparison(path: string): string {
  return trimTrailingSlash(path.trim().replaceAll("\\", "/")).toLowerCase();
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/g, "")
    .replace(/\/+/g, "/");
}

function normalizeRelativePathForComparison(relativePath: string): string {
  return normalizeRelativePath(relativePath).toLowerCase();
}

function suppressionKey(rootPath: string, relativePath: string): string {
  return `${normalizePathForComparison(rootPath)}::${normalizeRelativePathForComparison(relativePath)}`;
}

function normalizedParentPath(relativePath: string): string {
  const normalized = normalizeRelativePathForComparison(relativePath);
  const lastSeparator = normalized.lastIndexOf("/");
  if (lastSeparator < 0) {
    return "";
  }
  return normalized.slice(0, lastSeparator);
}

function isActiveOrUnexpired(entry: SuppressedWritebackPath, now: number): boolean {
  return entry.activeCount > 0 || entry.expiresAt > now;
}

function pruneExpiredSuppressions(now = Date.now()): void {
  for (const [key, entry] of suppressedWritebackPaths) {
    if (!isActiveOrUnexpired(entry, now)) {
      suppressedWritebackPaths.delete(key);
    }
  }
}

function upsertSuppression(
  archiveRootPath: string,
  relativePath: string,
  update: (entry: SuppressedWritebackPath) => SuppressedWritebackPath,
): SuppressedWritebackPath {
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  const key = suppressionKey(archiveRootPath, normalizedRelativePath);
  const current = suppressedWritebackPaths.get(key) ?? {
    activeCount: 0,
    expiresAt: 0,
    relativePath: normalizedRelativePath,
  };
  const next = update(current);
  suppressedWritebackPaths.set(key, next);
  return next;
}

export function archiveRelativePathFromAbsolutePath(
  archiveRootPath: string | null | undefined,
  absolutePath: string | null | undefined,
): string | undefined {
  if (!archiveRootPath || !absolutePath) {
    return undefined;
  }

  const normalizedRoot = normalizePathForComparison(archiveRootPath);
  const normalizedAbsolute = normalizePathForComparison(absolutePath);
  if (normalizedAbsolute === normalizedRoot) {
    return "";
  }

  if (!normalizedAbsolute.startsWith(`${normalizedRoot}/`)) {
    return undefined;
  }

  return normalizeRelativePath(absolutePath.replaceAll("\\", "/").slice(normalizedRoot.length + 1));
}

export function beginWritebackWatcherSuppression(
  archiveRootPath: string | null | undefined,
  relativePath: string | null | undefined,
): WritebackSuppressionToken | undefined {
  if (!archiveRootPath || !relativePath) {
    return undefined;
  }

  pruneExpiredSuppressions();
  const normalizedArchiveRootPath = normalizePathForComparison(archiveRootPath);
  const normalizedRelativePath = normalizeRelativePath(relativePath);
  upsertSuppression(archiveRootPath, normalizedRelativePath, (entry) => ({
    ...entry,
    activeCount: entry.activeCount + 1,
    expiresAt: Math.max(entry.expiresAt, Date.now() + WRITEBACK_WATCHER_SUPPRESSION_TTL_MS),
  }));
  return {
    archiveRootPath: normalizedArchiveRootPath,
    relativePath: normalizedRelativePath,
  };
}

export function finishWritebackWatcherSuppression(
  token: WritebackSuppressionToken | undefined,
): void {
  if (!token) {
    return;
  }

  pruneExpiredSuppressions();
  upsertSuppression(token.archiveRootPath, token.relativePath, (entry) => ({
    ...entry,
    activeCount: Math.max(0, entry.activeCount - 1),
    expiresAt: Date.now() + WRITEBACK_WATCHER_SUPPRESSION_TTL_MS,
  }));
}

export function suppressWritebackWatcherPath(
  archiveRootPath: string | null | undefined,
  relativePath: string | null | undefined,
): void {
  if (!archiveRootPath || !relativePath) {
    return;
  }

  pruneExpiredSuppressions();
  upsertSuppression(archiveRootPath, relativePath, (entry) => ({
    ...entry,
    expiresAt: Date.now() + WRITEBACK_WATCHER_SUPPRESSION_TTL_MS,
  }));
}

export function shouldSuppressWritebackWatcherEvent(
  archiveRootPath: string | null | undefined,
  relativePath: string | null | undefined,
): boolean {
  if (!archiveRootPath || relativePath === null || relativePath === undefined) {
    return false;
  }

  pruneExpiredSuppressions();
  const normalizedRoot = normalizePathForComparison(archiveRootPath);
  const eventPath = normalizeRelativePathForComparison(relativePath);

  for (const [key, entry] of suppressedWritebackPaths) {
    if (!key.startsWith(`${normalizedRoot}::`) || !isActiveOrUnexpired(entry, Date.now())) {
      continue;
    }

    const suppressedPath = normalizeRelativePathForComparison(entry.relativePath);
    if (eventPath === suppressedPath || eventPath === normalizedParentPath(suppressedPath)) {
      return true;
    }
  }

  return false;
}

export function clearWritebackWatcherSuppressionsForTests(): void {
  suppressedWritebackPaths.clear();
}
