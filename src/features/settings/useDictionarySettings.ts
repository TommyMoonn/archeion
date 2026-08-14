import { open } from "@tauri-apps/plugin-dialog";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  dictionaryCatalogCommandClient,
  type DictionaryCatalogCommandClient,
} from "../../storage/dictionaryCatalogCommandClient";
import {
  dictionaryDownloadCommandClient,
  type DictionaryDownloadCommandClient,
} from "../../storage/dictionaryDownloadCommandClient";
import {
  dictionaryInstallCommandClient,
  type DictionaryInstallCommandClient,
} from "../../storage/dictionaryInstallCommandClient";
import {
  dictionaryManagementCommandClient,
  type DictionaryManagementCommandClient,
} from "../../storage/dictionaryManagementCommandClient";
import {
  dictionaryRegistryStore,
  type DictionaryRegistrySource,
} from "../../storage/dictionaryRegistryStore";
import type {
  DictionaryCatalogSnapshot,
  DictionaryDownloadOutcome,
  DictionaryRegistrySnapshot,
  InstalledDictionary,
} from "../../types/dictionary";

type LoadState = "idle" | "loading" | "ready" | "error";

export type DictionaryCatalogOperation = Readonly<{
  catalogId: string;
  error: string | null;
  phase: "downloading" | "installing" | "failed";
  receivedBytes: number;
  stagingToken: string | null;
  totalBytes: number;
}>;

export type DictionaryManagementOperation = Readonly<{
  action: "enable" | "order" | "rebuild" | "remove";
  dictionaryId: string;
}>;

export type DictionarySettingsDependencies = Readonly<{
  catalogClient: DictionaryCatalogCommandClient;
  downloadClient: DictionaryDownloadCommandClient;
  installClient: DictionaryInstallCommandClient;
  managementClient: DictionaryManagementCommandClient;
  pickImportFile: () => Promise<string | null>;
  registrySink?: Pick<DictionaryRegistrySource, "publish">;
}>;

const defaultDependencies: DictionarySettingsDependencies = {
  catalogClient: dictionaryCatalogCommandClient,
  downloadClient: dictionaryDownloadCommandClient,
  installClient: dictionaryInstallCommandClient,
  managementClient: dictionaryManagementCommandClient,
  registrySink: dictionaryRegistryStore,
  pickImportFile: async () => {
    const selected = await open({
      directory: false,
      filters: [{ extensions: ["ifo"], name: "StarDict metadata" }],
      multiple: false,
      title: "Import dictionary",
    });
    return typeof selected === "string" ? selected : null;
  },
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function readyRegistry(dictionaries: readonly InstalledDictionary[]): DictionaryRegistrySnapshot {
  return { dictionaries, recovery: null, status: "ready" };
}

export function useDictionarySettings(
  dependencies: DictionarySettingsDependencies = defaultDependencies,
) {
  const [catalog, setCatalog] = useState<DictionaryCatalogSnapshot | null>(null);
  const [catalogState, setCatalogState] = useState<LoadState>("idle");
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [registry, setRegistry] = useState<DictionaryRegistrySnapshot | null>(null);
  const [registryState, setRegistryState] = useState<LoadState>("idle");
  const [registryError, setRegistryError] = useState<string | null>(null);
  const [catalogOperation, setCatalogOperation] = useState<DictionaryCatalogOperation | null>(null);
  const [managementOperation, setManagementOperation] =
    useState<DictionaryManagementOperation | null>(null);
  const [managementError, setManagementError] = useState<{
    dictionaryId: string;
    message: string;
  } | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const catalogOperationRevisionRef = useRef(0);
  const retainedStagingTokenRef = useRef<string | null>(null);
  const catalogInstallInFlightRef = useRef(false);
  const refreshCancellationRequestedRef = useRef(false);
  const managementOperationRef = useRef<DictionaryManagementOperation | null>(null);
  const registryRef = useRef<DictionaryRegistrySnapshot | null>(null);

  const publishRegistry = useCallback(
    (snapshot: DictionaryRegistrySnapshot) => {
      registryRef.current = snapshot;
      setRegistry(snapshot);
      dependencies.registrySink?.publish(snapshot);
    },
    [dependencies.registrySink],
  );

  useEffect(() => {
    mountedRef.current = true;
    let retired = false;
    setCatalogState("loading");
    setRegistryState("loading");
    void dependencies.catalogClient
      .loadCached()
      .then((snapshot) => {
        if (retired) return;
        setCatalog(snapshot);
        setCatalogState("ready");
      })
      .catch((error: unknown) => {
        if (retired) return;
        setCatalogError(errorMessage(error));
        setCatalogState("error");
      });
    void dependencies.managementClient
      .list()
      .then((snapshot) => {
        if (retired) return;
        publishRegistry(snapshot);
        setRegistryState("ready");
      })
      .catch((error: unknown) => {
        if (retired) return;
        setRegistryError(errorMessage(error));
        setRegistryState("error");
      });

    return () => {
      retired = true;
      mountedRef.current = false;
      catalogOperationRevisionRef.current += 1;
      void dependencies.catalogClient.cancelRefresh();
      void dependencies.downloadClient.cancel();
      const retainedToken = retainedStagingTokenRef.current;
      retainedStagingTokenRef.current = null;
      if (retainedToken && !catalogInstallInFlightRef.current) {
        void dependencies.downloadClient.cleanup(retainedToken);
      }
    };
  }, [dependencies, publishRegistry]);

  const refreshCatalog = useCallback(async () => {
    if (refreshing) return;
    refreshCancellationRequestedRef.current = false;
    setRefreshing(true);
    setCatalogError(null);
    try {
      const snapshot = await dependencies.catalogClient.refresh();
      if (!mountedRef.current) return;
      setCatalog(snapshot);
      setCatalogState("ready");
    } catch (error) {
      if (!mountedRef.current) return;
      if (refreshCancellationRequestedRef.current) return;
      setCatalogError(errorMessage(error));
      if (!catalog) setCatalogState("error");
    } finally {
      if (mountedRef.current) setRefreshing(false);
    }
  }, [catalog, dependencies.catalogClient, refreshing]);

  const cancelCatalogRefresh = useCallback(async () => {
    refreshCancellationRequestedRef.current = true;
    await dependencies.catalogClient.cancelRefresh();
  }, [dependencies.catalogClient]);

  const settleInstalled = useCallback(
    (installed: InstalledDictionary) => {
      const dictionaries = [...(registryRef.current?.dictionaries ?? [])]
        .filter((dictionary) => dictionary.id !== installed.id)
        .concat(installed)
        .sort((left, right) => left.order - right.order);
      publishRegistry(readyRegistry(dictionaries));
      setRegistryState("ready");
    },
    [publishRegistry],
  );

  const installCatalog = useCallback(
    async (catalogId: string) => {
      if (catalogOperation && catalogOperation.catalogId !== catalogId) return;
      const operationRevision = ++catalogOperationRevisionRef.current;
      let stagingToken =
        catalogOperation?.catalogId === catalogId ? catalogOperation.stagingToken : null;
      setCatalogOperation({
        catalogId,
        error: null,
        phase: stagingToken ? "installing" : "downloading",
        receivedBytes: 0,
        stagingToken,
        totalBytes: 0,
      });

      if (!stagingToken) {
        let outcome: DictionaryDownloadOutcome;
        try {
          outcome = await dependencies.downloadClient.download(catalogId, (progress) => {
            if (mountedRef.current && catalogOperationRevisionRef.current === operationRevision) {
              setCatalogOperation((current) =>
                current?.catalogId === catalogId
                  ? { ...current, ...progress, phase: "downloading" }
                  : current,
              );
            }
          });
        } catch (error) {
          if (mountedRef.current && catalogOperationRevisionRef.current === operationRevision) {
            setCatalogOperation({
              catalogId,
              error: errorMessage(error),
              phase: "failed",
              receivedBytes: 0,
              stagingToken: null,
              totalBytes: 0,
            });
          }
          return;
        }
        if (!mountedRef.current || catalogOperationRevisionRef.current !== operationRevision) {
          if (outcome.status === "succeeded") {
            void dependencies.downloadClient.cleanup(outcome.package.stagingToken);
          }
          return;
        }
        if (outcome.status === "cancelled") {
          setCatalogOperation(null);
          return;
        }
        if (outcome.status === "failed") {
          setCatalogOperation({
            catalogId,
            error: outcome.message,
            phase: "failed",
            receivedBytes: 0,
            stagingToken: null,
            totalBytes: 0,
          });
          return;
        }
        stagingToken = outcome.package.stagingToken;
        retainedStagingTokenRef.current = stagingToken;
        setCatalogOperation((current) =>
          current?.catalogId === catalogId
            ? { ...current, phase: "installing", stagingToken }
            : current,
        );
      }

      try {
        catalogInstallInFlightRef.current = true;
        const installed = await dependencies.installClient.installCatalog(stagingToken);
        catalogInstallInFlightRef.current = false;
        retainedStagingTokenRef.current = null;
        if (!mountedRef.current || catalogOperationRevisionRef.current !== operationRevision)
          return;
        settleInstalled(installed);
        setCatalogOperation(null);
      } catch (error) {
        catalogInstallInFlightRef.current = false;
        if (!mountedRef.current) {
          retainedStagingTokenRef.current = null;
          void dependencies.downloadClient.cleanup(stagingToken);
          return;
        }
        if (catalogOperationRevisionRef.current !== operationRevision) return;
        setCatalogOperation((current) =>
          current?.catalogId === catalogId
            ? {
                ...current,
                error: errorMessage(error),
                phase: "failed",
                stagingToken,
              }
            : current,
        );
      }
    },
    [catalogOperation, dependencies.downloadClient, dependencies.installClient, settleInstalled],
  );

  const cancelDownload = useCallback(async () => {
    if (catalogOperation?.phase !== "downloading") return;
    await dependencies.downloadClient.cancel();
  }, [catalogOperation, dependencies.downloadClient]);

  const importDictionary = useCallback(async () => {
    if (importing) return;
    setImportError(null);
    let ifoPath: string | null;
    try {
      ifoPath = await dependencies.pickImportFile();
    } catch (error) {
      if (mountedRef.current) setImportError(errorMessage(error));
      return;
    }
    if (!ifoPath || !mountedRef.current) return;
    setImporting(true);
    try {
      const installed = await dependencies.installClient.importStarDict(ifoPath);
      if (!mountedRef.current) return;
      settleInstalled(installed);
    } catch (error) {
      if (mountedRef.current) setImportError(errorMessage(error));
    } finally {
      if (mountedRef.current) setImporting(false);
    }
  }, [dependencies, importing, settleInstalled]);

  const runManagement = useCallback(
    async (
      operation: DictionaryManagementOperation,
      request: () => Promise<DictionaryRegistrySnapshot>,
    ) => {
      if (managementOperationRef.current) return false;
      managementOperationRef.current = operation;
      setManagementError(null);
      setManagementOperation(operation);
      try {
        const snapshot = await request();
        if (!mountedRef.current) return false;
        publishRegistry(snapshot);
        setRegistryState("ready");
        return true;
      } catch (error) {
        if (mountedRef.current) {
          setManagementError({
            dictionaryId: operation.dictionaryId,
            message: errorMessage(error),
          });
        }
        return false;
      } finally {
        managementOperationRef.current = null;
        if (mountedRef.current) setManagementOperation(null);
      }
    },
    [publishRegistry],
  );

  const setEnabled = useCallback(
    (dictionaryId: string, enabled: boolean) =>
      runManagement({ action: "enable", dictionaryId }, () =>
        dependencies.managementClient.setEnabled(dictionaryId, enabled),
      ),
    [dependencies.managementClient, runManagement],
  );

  const move = useCallback(
    (dictionaryId: string, direction: -1 | 1) => {
      const dictionaries = registry?.dictionaries ?? [];
      const index = dictionaries.findIndex((dictionary) => dictionary.id === dictionaryId);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= dictionaries.length) {
        return Promise.resolve(false);
      }
      const ids = dictionaries.map((dictionary) => dictionary.id);
      [ids[index], ids[destination]] = [ids[destination], ids[index]];
      return runManagement({ action: "order", dictionaryId }, () =>
        dependencies.managementClient.setOrder(ids),
      );
    },
    [dependencies.managementClient, registry?.dictionaries, runManagement],
  );

  const rebuildIndex = useCallback(
    (dictionaryId: string) =>
      runManagement({ action: "rebuild", dictionaryId }, () =>
        dependencies.managementClient.rebuildIndex(dictionaryId),
      ),
    [dependencies.managementClient, runManagement],
  );

  const removeDictionary = useCallback(
    (dictionaryId: string) =>
      runManagement({ action: "remove", dictionaryId }, () =>
        dependencies.managementClient.remove(dictionaryId),
      ),
    [dependencies.managementClient, runManagement],
  );

  const recoverResources = useCallback(async () => {
    if (recovering) return false;
    setRecovering(true);
    setRegistryError(null);
    try {
      const snapshot = await dependencies.managementClient.recover();
      if (!mountedRef.current) return false;
      publishRegistry(snapshot);
      setRegistryState("ready");
      return snapshot.status === "ready";
    } catch (error) {
      if (mountedRef.current) setRegistryError(errorMessage(error));
      return false;
    } finally {
      if (mountedRef.current) setRecovering(false);
    }
  }, [dependencies.managementClient, publishRegistry, recovering]);

  return {
    cancelCatalogRefresh,
    cancelDownload,
    catalog,
    catalogError,
    catalogOperation,
    catalogState,
    importDictionary,
    importError,
    importing,
    installCatalog,
    managementError,
    managementOperation,
    move,
    rebuildIndex,
    recoverResources,
    recovering,
    refreshCatalog,
    refreshing,
    registry,
    registryError,
    registryState,
    removeDictionary,
    setEnabled,
  };
}

export type DictionarySettingsController = ReturnType<typeof useDictionarySettings>;
