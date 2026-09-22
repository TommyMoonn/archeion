import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { CoverCacheStatus, EpubWritebackBackupStatus } from "../../storage/LibraryStorage";
import {
  appPreferencesStore,
  useAppPreferences,
  useAppPreferencesPersistenceStatus,
} from "../../stores/appPreferencesStore";
import { archiveStore } from "../../stores/archiveStore";
import type { ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";
import { defaultAppPreferences, type AppPreferences } from "../../types/appSettings";
import type { KnownArchive } from "../../types/archive";
import type { SettingsConfirmationKey, SettingsConfirmationState } from "./SettingsConfirmations";
import type { SettingsLocalStatus, SettingsStatusTone } from "./SettingsStatus";
import type { SettingsArchiveMaintenance } from "./settingsArchiveMaintenanceClient";

const initialConfirmations: SettingsConfirmationState = {
  clearCoverCache: false,
  clearEpubWritebackBackups: false,
  clearScannerCache: false,
  reextractMetadata: false,
  repairMetadata: false,
  rescanArchive: false,
};

const initialBusyConfirmations: SettingsConfirmationState = {
  clearCoverCache: false,
  clearEpubWritebackBackups: false,
  clearScannerCache: false,
  reextractMetadata: false,
  repairMetadata: false,
  rescanArchive: false,
};

const archiveScanConfirmationKeys = new Set<SettingsConfirmationKey>([
  "reextractMetadata",
  "repairMetadata",
  "rescanArchive",
]);

export type SettingsControllerOptions = {
  archiveGeneration?: number;
  archiveIdentity?: KnownArchive | null;
  archiveMaintenance?: SettingsArchiveMaintenance | null;
  loadCoverCacheStatus?: boolean;
  loadEpubWritebackBackupStatus?: boolean;
  onOpenThemeManager?: () => void;
  refreshThemeCatalog?: () => Promise<boolean>;
  themeCatalogEntries?: readonly ThemeCatalogEntry[];
  themeCatalogLoading?: boolean;
};

export function useSettingsController({
  archiveGeneration = 0,
  archiveIdentity = null,
  archiveMaintenance = null,
  loadCoverCacheStatus = false,
  loadEpubWritebackBackupStatus = false,
  onOpenThemeManager,
  refreshThemeCatalog = async () => false,
  themeCatalogEntries = [],
  themeCatalogLoading = false,
}: SettingsControllerOptions = {}) {
  const storage = archiveMaintenance;
  const currentArchiveIdentity = archiveIdentity;
  const archiveLocalScope = useMemo(
    () => ({
      archiveId: currentArchiveIdentity?.id ?? null,
      generation: archiveGeneration,
      rootPath: currentArchiveIdentity?.rootPath ?? null,
      storage,
    }),
    [archiveGeneration, currentArchiveIdentity?.id, currentArchiveIdentity?.rootPath, storage],
  );
  const archiveLocalScopeRef = useRef(archiveLocalScope);
  useLayoutEffect(() => {
    archiveLocalScopeRef.current = archiveLocalScope;
  }, [archiveLocalScope]);
  const preferences = useAppPreferences();
  const persistenceStatus = useAppPreferencesPersistenceStatus();
  const reader = preferences.reader;
  const library = preferences.library;
  const files = preferences.filesAndMetadata;
  const [cacheState, setCacheState] = useState<{
    scope: typeof archiveLocalScope;
    value: CoverCacheStatus | null;
  }>({ scope: archiveLocalScope, value: null });
  const [epubWritebackBackupStatusState, setEpubWritebackBackupStatusState] = useState<{
    scope: typeof archiveLocalScope;
    status: "loading" | "loaded" | "unavailable";
    value: EpubWritebackBackupStatus | null;
  }>({ scope: archiveLocalScope, status: "loading", value: null });
  const [status, setStatus] = useState<SettingsLocalStatus | null>(null);
  const coverCacheLoadedRef = useRef(false);
  const coverCacheLoadingRef = useRef(false);
  const epubWritebackBackupStatusLoadedRef = useRef(false);
  const epubWritebackBackupStatusLoadingRef = useRef(false);
  const dataLoadGenerationRef = useRef(0);
  const appPreferenceSaveRevisionRef = useRef(0);
  const statusOperationRevisionRef = useRef(0);
  const confirmationOperationLocksRef = useRef(new Set<SettingsConfirmationKey>());
  const confirmationOperationRevisionsRef = useRef(new Map<SettingsConfirmationKey, number>());
  const [confirmations, setConfirmations] =
    useState<SettingsConfirmationState>(initialConfirmations);
  const [busyConfirmations, setBusyConfirmations] =
    useState<SettingsConfirmationState>(initialBusyConfirmations);
  const archiveScanActive =
    busyConfirmations.rescanArchive ||
    busyConfirmations.reextractMetadata ||
    busyConfirmations.repairMetadata;
  const cache = cacheState.scope === archiveLocalScope ? cacheState.value : null;
  const currentEpubWritebackBackupStatus =
    epubWritebackBackupStatusState.scope === archiveLocalScope
      ? epubWritebackBackupStatusState
      : { status: "loading" as const, value: null };
  const epubWritebackBackupStatus = currentEpubWritebackBackupStatus.value;

  const importSettings = preferences.import;
  const selectedArchivePath = archiveIdentity?.rootPath;

  const clearLocalStatus = useCallback(() => {
    setStatus(null);
  }, []);

  const setLocalStatus = useCallback(
    (message: string, tone: SettingsStatusTone, options?: { autoDismiss?: boolean }) => {
      const autoDismiss = options?.autoDismiss ?? tone !== "error";
      setStatus({ autoDismiss, message, tone });
    },
    [],
  );

  const beginStatusOperation = useCallback((): number => {
    statusOperationRevisionRef.current += 1;
    setStatus(null);
    return statusOperationRevisionRef.current;
  }, []);

  const publishStatusOperation = useCallback(
    (
      operationRevision: number,
      message: string,
      tone: SettingsStatusTone,
      options?: { autoDismiss?: boolean },
    ): boolean => {
      if (statusOperationRevisionRef.current !== operationRevision) return false;
      setLocalStatus(message, tone, options);
      return true;
    },
    [setLocalStatus],
  );

  useEffect(() => {
    return () => {
      dataLoadGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    dataLoadGenerationRef.current += 1;
    coverCacheLoadedRef.current = false;
    coverCacheLoadingRef.current = false;
    epubWritebackBackupStatusLoadedRef.current = false;
    epubWritebackBackupStatusLoadingRef.current = false;
  }, [archiveLocalScope]);

  useEffect(() => {
    if (!archiveMaintenance) return;
    statusOperationRevisionRef.current += 1;
    confirmationOperationLocksRef.current.clear();
    confirmationOperationRevisionsRef.current.clear();
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      setConfirmations(initialConfirmations);
      setBusyConfirmations(initialBusyConfirmations);
      setStatus(null);
    });
    return () => {
      active = false;
    };
  }, [archiveGeneration, archiveMaintenance]);

  useEffect(() => {
    if (
      !storage ||
      !loadCoverCacheStatus ||
      coverCacheLoadedRef.current ||
      coverCacheLoadingRef.current
    ) {
      return;
    }

    const activeStorage = storage;
    const generation = dataLoadGenerationRef.current;
    const scope = archiveLocalScope;
    coverCacheLoadingRef.current = true;
    void activeStorage
      .getCoverCacheStatus()
      .then((cacheStatus) => {
        if (
          dataLoadGenerationRef.current !== generation ||
          archiveLocalScopeRef.current !== scope
        ) {
          return;
        }
        coverCacheLoadedRef.current = true;
        setCacheState({ scope, value: cacheStatus });
      })
      .catch(() => {
        if (
          dataLoadGenerationRef.current === generation &&
          archiveLocalScopeRef.current === scope
        ) {
          setCacheState({ scope, value: null });
          setLocalStatus(
            "Cover cache status is unavailable. Close and reopen Settings to try again.",
            "error",
          );
        }
      })
      .finally(() => {
        if (
          dataLoadGenerationRef.current === generation &&
          archiveLocalScopeRef.current === scope
        ) {
          coverCacheLoadingRef.current = false;
        }
      });
  }, [archiveLocalScope, loadCoverCacheStatus, storage, setLocalStatus]);

  useEffect(() => {
    if (
      !storage ||
      !loadEpubWritebackBackupStatus ||
      epubWritebackBackupStatusLoadedRef.current ||
      epubWritebackBackupStatusLoadingRef.current
    ) {
      return;
    }

    const activeStorage = storage;
    const generation = dataLoadGenerationRef.current;
    const scope = archiveLocalScope;
    epubWritebackBackupStatusLoadingRef.current = true;
    void activeStorage
      .getEpubWritebackBackupStatus()
      .then((backupStatus) => {
        if (
          dataLoadGenerationRef.current !== generation ||
          archiveLocalScopeRef.current !== scope
        ) {
          return;
        }
        epubWritebackBackupStatusLoadedRef.current = true;
        setEpubWritebackBackupStatusState({ scope, status: "loaded", value: backupStatus });
      })
      .catch(() => {
        if (
          dataLoadGenerationRef.current === generation &&
          archiveLocalScopeRef.current === scope
        ) {
          setEpubWritebackBackupStatusState({ scope, status: "unavailable", value: null });
          setLocalStatus(
            "Backup status is unavailable. Close and reopen Settings to try again.",
            "error",
          );
        }
      })
      .finally(() => {
        if (
          dataLoadGenerationRef.current === generation &&
          archiveLocalScopeRef.current === scope
        ) {
          epubWritebackBackupStatusLoadingRef.current = false;
        }
      });
  }, [archiveLocalScope, loadEpubWritebackBackupStatus, storage, setLocalStatus]);

  function openConfirmation(confirmation: SettingsConfirmationKey) {
    if (!storage) return;
    if (archiveScanConfirmationKeys.has(confirmation) && archiveScanActive) return;
    setConfirmations((current) => ({ ...current, [confirmation]: true }));
  }

  function closeConfirmation(confirmation: SettingsConfirmationKey) {
    if (confirmationOperationLocksRef.current.has(confirmation)) return;
    setConfirmations((current) => ({ ...current, [confirmation]: false }));
  }

  function beginConfirmationOperation(confirmation: SettingsConfirmationKey): number | null {
    if (confirmationOperationLocksRef.current.has(confirmation)) return null;
    confirmationOperationLocksRef.current.add(confirmation);
    setBusyConfirmations((current) => ({ ...current, [confirmation]: true }));
    const operationRevision = beginStatusOperation();
    confirmationOperationRevisionsRef.current.set(confirmation, operationRevision);
    return operationRevision;
  }

  function finishConfirmationOperation(
    confirmation: SettingsConfirmationKey,
    operationRevision: number,
  ) {
    if (confirmationOperationRevisionsRef.current.get(confirmation) !== operationRevision) return;
    confirmationOperationRevisionsRef.current.delete(confirmation);
    confirmationOperationLocksRef.current.delete(confirmation);
    setBusyConfirmations((current) => ({ ...current, [confirmation]: false }));
    setConfirmations((current) => ({ ...current, [confirmation]: false }));
  }

  function beginArchiveScanOperation(
    confirmation: SettingsConfirmationKey,
  ): { statusOperation: number } | null {
    if (!storage) return null;
    const statusOperation = beginConfirmationOperation(confirmation);
    return statusOperation === null ? null : { statusOperation };
  }

  async function persistAppPreferences(
    operation: () => Promise<AppPreferences>,
    options?: { statusOperation?: number; successMessage?: string | false },
  ): Promise<boolean> {
    appPreferenceSaveRevisionRef.current += 1;
    const saveRevision = appPreferenceSaveRevisionRef.current;
    const statusOperation = options?.statusOperation ?? beginStatusOperation();

    try {
      await operation();
      if (appPreferenceSaveRevisionRef.current !== saveRevision) {
        return true;
      }

      const successMessage = options?.successMessage ?? "Settings saved.";
      if (successMessage) {
        publishStatusOperation(statusOperation, successMessage, "success");
      }
      return true;
    } catch {
      if (appPreferenceSaveRevisionRef.current === saveRevision) {
        publishStatusOperation(
          statusOperation,
          "App settings could not be saved. Your changes remain active until Archeion closes. Try changing the setting again.",
          "error",
        );
      }
      return false;
    }
  }

  function updateAppPreferences(
    changes: Partial<AppPreferences>,
    options?: { successMessage?: string | false },
  ): Promise<boolean> {
    return persistAppPreferences(() => appPreferencesStore.update(changes), options);
  }

  function updateReader(changes: Partial<AppPreferences["reader"]>) {
    void updateAppPreferences({ reader: { ...reader, ...changes } });
  }

  function updateLibrary(changes: Partial<AppPreferences["library"]>) {
    void persistAppPreferences(() => appPreferencesStore.updateLibrary(changes));
  }

  function updateLibraryCollection<
    TCollection extends keyof AppPreferences["library"]["collections"],
  >(
    collection: TCollection,
    changes: Partial<AppPreferences["library"]["collections"][TCollection]>,
  ) {
    void persistAppPreferences(() =>
      appPreferencesStore.updateLibraryCollection(collection, changes),
    );
  }

  function updateFiles(changes: Partial<AppPreferences["filesAndMetadata"]>) {
    void updateAppPreferences({
      filesAndMetadata: { ...files, ...changes },
    });
  }

  function updateImportDefaults(changes: Partial<AppPreferences["import"]>) {
    void updateAppPreferences({
      import: { ...preferences.import, ...changes },
    });
  }

  function updateAppearance(
    changes: Pick<Partial<AppPreferences>, "appTheme" | "readerTheme">,
  ): Promise<boolean> {
    return updateAppPreferences(changes, { successMessage: "Appearance saved." });
  }

  function openThemeManager() {
    const statusOperation = beginStatusOperation();
    if (!onOpenThemeManager) {
      publishStatusOperation(
        statusOperation,
        "Theme Manager is unavailable. Close and reopen Settings, then try again.",
        "error",
      );
      return;
    }
    onOpenThemeManager();
  }

  async function rescan() {
    if (!storage) return;
    const operation = beginArchiveScanOperation("rescanArchive");
    if (!operation) return;
    const { statusOperation } = operation;
    publishStatusOperation(statusOperation, "Rescanning archive", "neutral", {
      autoDismiss: false,
    });
    try {
      await storage.rescan();
      publishStatusOperation(statusOperation, "Archive scan complete.", "success");
    } catch {
      publishStatusOperation(
        statusOperation,
        "The archive could not be scanned. Try again.",
        "error",
      );
    } finally {
      finishConfirmationOperation("rescanArchive", statusOperation);
    }
  }

  async function openArchiveManager() {
    const statusOperation = beginStatusOperation();
    const opened = await archiveStore.openArchiveManagerWindow();
    if (!opened) {
      publishStatusOperation(
        statusOperation,
        "Archive Manager could not be opened. Try again.",
        "error",
      );
    }
  }

  async function revealArchiveFolder() {
    const statusOperation = beginStatusOperation();
    if (!storage) return;
    try {
      await storage.revealArchiveFolder();
    } catch {
      publishStatusOperation(
        statusOperation,
        "The archive folder could not be opened. Check that the folder still exists.",
        "error",
      );
    }
  }

  async function revealMetadata() {
    if (!storage) return;
    const statusOperation = beginStatusOperation();
    try {
      await storage.revealMetadataFolder();
    } catch {
      publishStatusOperation(
        statusOperation,
        "The .archeion folder could not be opened. Check that the archive is available.",
        "error",
      );
    }
  }

  async function clearCache() {
    if (!storage) return;
    const activeStorage = storage;
    const scope = archiveLocalScope;
    const statusOperation = beginConfirmationOperation("clearCoverCache");
    if (statusOperation === null) return;
    try {
      const clearedCache = await activeStorage.clearCoverCache();
      if (archiveLocalScopeRef.current !== scope) return;
      setCacheState({ scope, value: clearedCache });
      publishStatusOperation(statusOperation, "Cover cache cleared.", "success");
    } catch {
      if (archiveLocalScopeRef.current !== scope) return;
      publishStatusOperation(
        statusOperation,
        "The cover cache could not be cleared. EPUB files are unchanged. Try again.",
        "error",
      );
    } finally {
      finishConfirmationOperation("clearCoverCache", statusOperation);
    }
  }

  async function clearScannerCache() {
    if (!storage) return;
    const statusOperation = beginConfirmationOperation("clearScannerCache");
    if (statusOperation === null) return;
    try {
      await storage.clearScannerCache();
      publishStatusOperation(statusOperation, "Scanner cache cleared.", "success");
    } catch {
      publishStatusOperation(
        statusOperation,
        "The scanner cache could not be cleared. Try again.",
        "error",
      );
    } finally {
      finishConfirmationOperation("clearScannerCache", statusOperation);
    }
  }

  async function clearEpubWritebackBackups() {
    if (!storage) return;
    const activeStorage = storage;
    const scope = archiveLocalScope;
    const statusOperation = beginConfirmationOperation("clearEpubWritebackBackups");
    if (statusOperation === null) return;
    try {
      const clearedBackups = await activeStorage.clearEpubWritebackBackups();
      if (archiveLocalScopeRef.current !== scope) return;
      setEpubWritebackBackupStatusState({ scope, status: "loaded", value: clearedBackups });
      publishStatusOperation(statusOperation, "EPUB writeback backups cleared.", "success");
    } catch {
      if (archiveLocalScopeRef.current !== scope) return;
      publishStatusOperation(
        statusOperation,
        "EPUB writeback backups could not be cleared. EPUB files are unchanged. Try again.",
        "error",
      );
    } finally {
      finishConfirmationOperation("clearEpubWritebackBackups", statusOperation);
    }
  }

  async function reextractMetadata() {
    if (!storage) return;
    const operation = beginArchiveScanOperation("reextractMetadata");
    if (!operation) return;
    const { statusOperation } = operation;
    try {
      await storage.clearScannerCache();
      await storage.rescan();
      publishStatusOperation(statusOperation, "Source metadata re-extracted.", "success");
    } catch {
      publishStatusOperation(
        statusOperation,
        "Source metadata could not be re-extracted. Try again.",
        "error",
      );
    } finally {
      finishConfirmationOperation("reextractMetadata", statusOperation);
    }
  }

  async function repairMetadata() {
    if (!storage) return;
    const operation = beginArchiveScanOperation("repairMetadata");
    if (!operation) return;
    const { statusOperation } = operation;
    try {
      await storage.repairArchiveMetadata();
      publishStatusOperation(statusOperation, "Archive metadata repaired.", "success");
    } catch {
      publishStatusOperation(
        statusOperation,
        "Archive metadata could not be repaired. Try again.",
        "error",
      );
    } finally {
      finishConfirmationOperation("repairMetadata", statusOperation);
    }
  }

  async function resetGeneral() {
    await updateAppPreferences(
      {
        confirmDestructiveFileActions: defaultAppPreferences.confirmDestructiveFileActions,
        restoreLastReader: defaultAppPreferences.restoreLastReader,
        startupBehavior: defaultAppPreferences.startupBehavior,
      },
      { successMessage: "General settings reset." },
    );
  }

  async function resetReader() {
    await updateAppPreferences(
      { reader: defaultAppPreferences.reader, readerTheme: defaultAppPreferences.readerTheme },
      { successMessage: "Reader settings reset." },
    );
  }

  async function resetLibrary() {
    await updateAppPreferences(
      {
        library: defaultAppPreferences.library,
        showContinueReading: defaultAppPreferences.showContinueReading,
      },
      { successMessage: "Library settings reset." },
    );
  }

  async function resetAppearance() {
    await updateAppPreferences(
      {
        appTheme: defaultAppPreferences.appTheme,
        appThemePreset: defaultAppPreferences.appThemePreset,
        appearance: defaultAppPreferences.appearance,
        density: defaultAppPreferences.density,
      },
      { successMessage: "Appearance settings reset." },
    );
  }

  async function resetWindow() {
    await updateAppPreferences(
      {
        rememberWindowState: defaultAppPreferences.rememberWindowState,
      },
      { successMessage: "Window settings reset." },
    );
  }

  async function resetStorage() {
    await updateAppPreferences(
      {
        filesAndMetadata: defaultAppPreferences.filesAndMetadata,
      },
      { successMessage: "Storage preferences reset." },
    );
  }

  async function resetImportDefaults() {
    await updateAppPreferences(
      { import: defaultAppPreferences.import },
      { successMessage: "Import defaults reset." },
    );
  }

  return {
    archiveAvailable: storage !== null,
    archiveScanActive,
    cache,
    busyConfirmations,
    closeConfirmation,
    confirmations,
    dismissStatus: clearLocalStatus,
    epubWritebackBackupStatus,
    epubWritebackBackupStatusState: currentEpubWritebackBackupStatus.status,
    files,
    importSettings,
    library,
    openArchiveManager,
    openThemeManager,
    openConfirmation,
    persistenceStatus,
    preferences,
    reader,
    resetAppearance,
    resetGeneral,
    resetImportDefaults,
    resetLibrary,
    resetReader,
    resetStorage,
    resetWindow,
    revealArchiveFolder,
    revealMetadata,
    refreshThemeCatalog,
    selectedArchivePath,
    status,
    themeCatalogEntries,
    themeCatalogLoading,
    updateAppearance,
    updateAppPreferences,
    updateFiles,
    updateImportDefaults,
    updateLibrary,
    updateLibraryCollection,
    updateReader,
    confirmClearCoverCache: () => void clearCache(),
    confirmClearEpubWritebackBackups: () => void clearEpubWritebackBackups(),
    confirmClearScannerCache: () => void clearScannerCache(),
    confirmReextractMetadata: () => void reextractMetadata(),
    confirmRepairMetadata: () => void repairMetadata(),
    confirmRescanArchive: () => void rescan(),
  };
}

export type SettingsController = ReturnType<typeof useSettingsController>;
