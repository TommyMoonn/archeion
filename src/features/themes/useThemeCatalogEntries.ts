import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { AppearanceRuntimeSettingsChangedError } from "../../themes/AppearanceRuntime";
import { ThemeCatalogChangedError } from "../../themes/ThemeCatalog";
import { appearanceRuntime, themeCatalog } from "../../themes/appearanceRuntimeInstance";
import type { ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";
import { useArchive } from "../archive/useArchive";

type ThemeCatalogEntriesState = Readonly<{
  entries: readonly ThemeCatalogEntry[];
  error: string | null;
  loading: boolean;
  refresh: () => Promise<boolean>;
  retireRefreshFailure: () => void;
}>;

type ThemeCatalogEntriesOptions = Readonly<{
  reportRefreshFailure?: boolean;
}>;

export function useThemeCatalogEntries(
  enabled: boolean,
  { reportRefreshFailure = true }: ThemeCatalogEntriesOptions = {},
) {
  const archive = useArchive();
  const archiveRootPath = "path" in archive ? archive.path : null;
  const snapshot = useSyncExternalStore(
    themeCatalog.subscribe,
    themeCatalog.getSnapshot,
    themeCatalog.getSnapshot,
  );
  const archiveGeneration =
    snapshot.archive?.rootPath === archiveRootPath ? snapshot.archive.generation : null;
  const scopeKey =
    archiveRootPath && archiveGeneration !== null
      ? `${archiveGeneration}\u0000${archiveRootPath}`
      : null;
  const [failure, setFailure] = useState<Readonly<{ message: string; scopeKey: string }> | null>(
    null,
  );
  const mountedRef = useRef(false);
  const reportRefreshFailureRef = useRef(reportRefreshFailure);
  const refreshOperationRef = useRef<Readonly<{
    operation: Promise<boolean>;
    ownership: object;
    scopeKey: string;
  }> | null>(null);
  const error = reportRefreshFailure && failure?.scopeKey === scopeKey ? failure.message : null;
  const inScope = Boolean(
    enabled && archiveRootPath && snapshot.archive?.rootPath === archiveRootPath,
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useLayoutEffect(() => {
    reportRefreshFailureRef.current = reportRefreshFailure;
  }, [reportRefreshFailure]);

  useEffect(() => {
    const current = themeCatalog.getSnapshot();
    const currentArchive = current.archive;
    if (!enabled || !archiveRootPath || currentArchive?.rootPath !== archiveRootPath) return;
    if (current.fullyEnumerated) return;

    let active = true;
    void themeCatalog.enumeratePackages().then(
      () => {
        if (active) setFailure(null);
      },
      () => {
        if (!active || !reportRefreshFailureRef.current) return;
        setFailure({
          message: "Custom themes could not be listed. Reopen Settings to try again.",
          scopeKey: `${currentArchive.generation}\u0000${archiveRootPath}`,
        });
      },
    );
    return () => {
      active = false;
    };
  }, [archiveRootPath, enabled, snapshot]);

  const refresh = useCallback((): Promise<boolean> => {
    if (!enabled || !archiveRootPath || archiveGeneration === null || !scopeKey) {
      return Promise.resolve(false);
    }
    const activeOperation = refreshOperationRef.current;
    if (activeOperation?.scopeKey === scopeKey) return activeOperation.operation;

    const ownership = {};
    const operation = (async () => {
      let catalogRefreshed = false;
      try {
        await themeCatalog.refreshPackages();
        catalogRefreshed = true;
        const currentCatalogScope = themeCatalog.getSnapshot().archive;
        if (
          currentCatalogScope?.rootPath !== archiveRootPath ||
          currentCatalogScope.generation !== archiveGeneration
        ) {
          return false;
        }
        const activeAppearanceArchive = appearanceRuntime.getSnapshot().archive;
        if (
          activeAppearanceArchive?.rootPath === archiveRootPath &&
          activeAppearanceArchive.generation === archiveGeneration
        ) {
          await appearanceRuntime.refreshArchiveAppearance(activeAppearanceArchive);
        }
        if (mountedRef.current && refreshOperationRef.current?.scopeKey === scopeKey) {
          setFailure(null);
        }
        return true;
      } catch (reason) {
        const currentCatalogScope = themeCatalog.getSnapshot().archive;
        if (
          reason instanceof ThemeCatalogChangedError ||
          currentCatalogScope?.rootPath !== archiveRootPath ||
          currentCatalogScope.generation !== archiveGeneration
        ) {
          return false;
        }
        if (catalogRefreshed && reason instanceof AppearanceRuntimeSettingsChangedError) {
          const currentAppearanceScope = appearanceRuntime.getSnapshot().archive;
          if (
            currentAppearanceScope?.rootPath !== archiveRootPath ||
            currentAppearanceScope.generation !== archiveGeneration
          ) {
            return false;
          }
          if (mountedRef.current && refreshOperationRef.current?.scopeKey === scopeKey) {
            setFailure(null);
          }
          return true;
        }
        if (mountedRef.current && reportRefreshFailureRef.current) {
          setFailure({
            message: catalogRefreshed
              ? "Themes were refreshed, but the active appearance could not be updated. Reload themes to try again."
              : "Themes could not be refreshed. Reload themes to try again.",
            scopeKey,
          });
        }
        return false;
      } finally {
        if (refreshOperationRef.current?.ownership === ownership) {
          refreshOperationRef.current = null;
        }
      }
    })();
    refreshOperationRef.current = { operation, ownership, scopeKey };
    return operation;
  }, [archiveGeneration, archiveRootPath, enabled, scopeKey]);
  const retireRefreshFailure = useCallback(() => {
    setFailure(null);
  }, []);

  return {
    entries: snapshot.entries,
    error,
    loading: inScope && !snapshot.fullyEnumerated && !error,
    refresh,
    retireRefreshFailure,
  } satisfies ThemeCatalogEntriesState;
}
