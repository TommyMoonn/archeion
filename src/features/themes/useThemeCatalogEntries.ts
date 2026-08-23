import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";

import { appearanceRuntime, themeCatalog } from "../../themes/appearanceRuntimeInstance";
import type { ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";

type ThemeCatalogEntriesState = Readonly<{
  entries: readonly ThemeCatalogEntry[];
  error: string | null;
  loading: boolean;
  refresh: () => Promise<boolean>;
  retireRefreshFailure: () => void;
}>;

type ThemeCatalogEntriesOptions = Readonly<{ reportRefreshFailure?: boolean }>;

export function useThemeCatalogEntries(
  enabled: boolean,
  { reportRefreshFailure = true }: ThemeCatalogEntriesOptions = {},
) {
  const snapshot = useSyncExternalStore(
    themeCatalog.subscribe,
    themeCatalog.getSnapshot,
    themeCatalog.getSnapshot,
  );
  const [failure, setFailure] = useState<string | null>(null);
  const mountedRef = useRef(false);
  const refreshOperationRef = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled || snapshot.fullyEnumerated) return;
    let active = true;
    void themeCatalog.enumeratePackages().then(
      () => {
        if (active) setFailure(null);
      },
      () => {
        if (active && reportRefreshFailure) {
          setFailure("Custom themes could not be listed. Reopen Settings to try again.");
        }
      },
    );
    return () => {
      active = false;
    };
  }, [enabled, reportRefreshFailure, snapshot.fullyEnumerated]);

  const refresh = useCallback((): Promise<boolean> => {
    if (!enabled) return Promise.resolve(false);
    if (refreshOperationRef.current) return refreshOperationRef.current;
    const operation = appearanceRuntime.refreshAppearance().then(
      () => {
        if (mountedRef.current) setFailure(null);
        return true;
      },
      () => {
        if (mountedRef.current && reportRefreshFailure) {
          setFailure("Themes could not be refreshed. Reload themes to try again.");
        }
        return false;
      },
    );
    refreshOperationRef.current = operation;
    void operation.finally(() => {
      if (refreshOperationRef.current === operation) refreshOperationRef.current = null;
    });
    return operation;
  }, [enabled, reportRefreshFailure]);

  return {
    entries: snapshot.entries,
    error: reportRefreshFailure ? failure : null,
    loading: enabled && !snapshot.fullyEnumerated && !failure,
    refresh,
    retireRefreshFailure: () => setFailure(null),
  } satisfies ThemeCatalogEntriesState;
}
