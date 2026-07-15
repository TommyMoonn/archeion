import { useCallback, useEffect, useState, useSyncExternalStore } from "react";

import { archiveThemeCatalog } from "../../themes/appearanceRuntimeInstance";
import type { ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";
import { useArchive } from "../archive/useArchive";

type ArchiveThemeCatalogEntriesState = Readonly<{
  entries: readonly ThemeCatalogEntry[];
  error: string | null;
  loading: boolean;
}>;

export function useArchiveThemeCatalogEntries(enabled: boolean) {
  const archive = useArchive();
  const archiveRootPath = "path" in archive ? archive.path : null;
  const snapshot = useSyncExternalStore(
    archiveThemeCatalog.subscribe,
    archiveThemeCatalog.getSnapshot,
    archiveThemeCatalog.getSnapshot,
  );
  const [failure, setFailure] = useState<Readonly<{ message: string; rootPath: string }> | null>(
    null,
  );
  const error = failure?.rootPath === archiveRootPath ? failure.message : null;
  const inScope = Boolean(
    enabled && archiveRootPath && snapshot.archive?.rootPath === archiveRootPath,
  );

  const refresh = useCallback(() => {
    const current = archiveThemeCatalog.getSnapshot();
    if (!archiveRootPath || current.archive?.rootPath !== archiveRootPath) return;
    setFailure(null);
    if (!current.fullyEnumerated) {
      void archiveThemeCatalog.enumeratePackages().catch((reason: unknown) => {
        setFailure({
          message:
            reason instanceof Error && reason.message.trim()
              ? reason.message
              : "Custom themes could not be listed.",
          rootPath: archiveRootPath,
        });
      });
    }
  }, [archiveRootPath]);

  useEffect(() => {
    const current = archiveThemeCatalog.getSnapshot();
    if (!enabled || !archiveRootPath || current.archive?.rootPath !== archiveRootPath) return;
    if (current.fullyEnumerated) return;

    let active = true;
    void archiveThemeCatalog.enumeratePackages().then(
      () => undefined,
      (reason) => {
        if (!active) return;
        setFailure({
          message:
            reason instanceof Error && reason.message.trim()
              ? reason.message
              : "Custom themes could not be listed.",
          rootPath: archiveRootPath,
        });
      },
    );
    return () => {
      active = false;
    };
  }, [archiveRootPath, enabled, snapshot]);

  return {
    entries: snapshot.entries,
    error,
    loading: inScope && !snapshot.fullyEnumerated && !error,
    refresh,
  } satisfies ArchiveThemeCatalogEntriesState & Readonly<{ refresh: () => void }>;
}
