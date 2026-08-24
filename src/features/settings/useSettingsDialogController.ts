import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { CoverCacheStatus, EpubWritebackBackupStatus } from "../../storage/LibraryStorage";
import { defaultArchiveImportSettings } from "../../storage/metadataFiles";
import { useOptionalLibraryStorage } from "../../storage/useLibraryStorage";
import {
  appPreferencesStore,
  useAppPreferences,
  useAppPreferencesPersistenceStatus,
} from "../../stores/appPreferencesStore";
import { archiveStore } from "../../stores/archiveStore";
import type { ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";
import { defaultAppPreferences, type AppPreferences } from "../../types/appSettings";
import type { Folder } from "../../types/folder";
import type { ArchiveImportSettings, ImportSettings } from "../../types/settings";
import type { KnownArchive } from "../../types/archive";
import {
  releaseArchiveScanOperation,
  tryAcquireArchiveScanOperation,
  useArchiveScanActivity,
  type ArchiveScanOperationClaim,
} from "../archive/useArchiveScanActivity";
import { useArchive } from "../archive/useArchive";
import {
  createArchiveDestinationOptions,
  destinationValueFromFolderPath,
  destinationValueToFolderPath,
} from "../filesystem/archiveImport";
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
const emptyFolders: readonly Folder[] = Object.freeze([]);

export type SettingsDialogControllerOptions = {
  archiveAccess?: "required" | "unavailable";
  archiveGeneration?: number;
  archiveIdentity?: KnownArchive | null;
  archiveMaintenance?: SettingsArchiveMaintenance | null;
  loadArchiveImportSettings?: boolean;
  loadCoverCacheStatus?: boolean;
  loadEpubWritebackBackupStatus?: boolean;
  loadFolders?: boolean;
  onOpenThemeManager?: () => void;
  refreshThemeCatalog?: () => Promise<boolean>;
  themeCatalogEntries?: readonly ThemeCatalogEntry[];
  themeCatalogLoading?: boolean;
};

export function useSettingsDialogController({
  archiveAccess = "required",
  archiveGeneration = 0,
  archiveIdentity = null,
  archiveMaintenance = null,
  loadArchiveImportSettings = false,
  loadCoverCacheStatus = false,
  loadEpubWritebackBackupStatus = false,
  loadFolders = false,
  onOpenThemeManager,
  refreshThemeCatalog = async () => false,
  themeCatalogEntries = [],
  themeCatalogLoading = false,
}: SettingsDialogControllerOptions = {}) {
  const contextualStorage = useOptionalLibraryStorage();
  const storage =
    archiveMaintenance ?? (archiveAccess === "unavailable" ? null : contextualStorage);
  if (archiveAccess === "required" && !storage) {
    throw new Error("LibraryStorageProvider is missing.");
  }
  const contextualArchiveScanActive = useArchiveScanActivity(
    storage === contextualStorage ? contextualStorage : null,
  );
  const archive = useArchive();
  const currentArchiveIdentity =
    archiveIdentity ?? (archive.status === "ready" ? archive.archive : null);
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
  const [archiveImportState, setArchiveImportState] = useState<{
    scope: typeof archiveLocalScope;
    value: ArchiveImportSettings;
  }>({ scope: archiveLocalScope, value: { ...defaultArchiveImportSettings } });
  const [foldersState, setFoldersState] = useState<{
    scope: typeof archiveLocalScope;
    value: Folder[];
  }>({ scope: archiveLocalScope, value: [] });
  const [cache, setCache] = useState<CoverCacheStatus | null>(null);
  const [epubWritebackBackupStatus, setEpubWritebackBackupStatus] =
    useState<EpubWritebackBackupStatus | null>(null);
  const [epubWritebackBackupStatusState, setEpubWritebackBackupStatusState] = useState<
    "loading" | "loaded" | "unavailable"
  >("loading");
  const [status, setStatus] = useState<SettingsLocalStatus | null>(null);
  const archiveImportLoadedRef = useRef(false);
  const archiveImportLoadingRef = useRef(false);
  const coverCacheLoadedRef = useRef(false);
  const coverCacheLoadingRef = useRef(false);
  const epubWritebackBackupStatusLoadedRef = useRef(false);
  const epubWritebackBackupStatusLoadingRef = useRef(false);
  const foldersLoadedRef = useRef(false);
  const foldersLoadingRef = useRef(false);
  const dataLoadGenerationRef = useRef(0);
  const appPreferenceSaveRevisionRef = useRef(0);
  const statusOperationRevisionRef = useRef(0);
  const confirmationOperationLocksRef = useRef(new Set<SettingsConfirmationKey>());
  const [confirmations, setConfirmations] =
    useState<SettingsConfirmationState>(initialConfirmations);
  const [busyConfirmations, setBusyConfirmations] =
    useState<SettingsConfirmationState>(initialBusyConfirmations);
  const archiveScanActive =
    contextualArchiveScanActive ||
    busyConfirmations.rescanArchive ||
    busyConfirmations.reextractMetadata ||
    busyConfirmations.repairMetadata;
  const archiveImport =
    archiveImportState.scope === archiveLocalScope
      ? archiveImportState.value
      : defaultArchiveImportSettings;
  const folders = foldersState.scope === archiveLocalScope ? foldersState.value : emptyFolders;

  const importSettings: ImportSettings = {
    ...preferences.import,
    ...archiveImport,
  };
  const destinationOptions = useMemo(() => createArchiveDestinationOptions(folders), [folders]);
  const importDestinationValue = destinationValueFromFolderPath(
    importSettings.defaultDestinationFolderPath,
  );
  const safeImportDestinationValue = destinationOptions.some(
    (destination) => destination.value === importDestinationValue,
  )
    ? importDestinationValue
    : destinationOptions[0]?.value;
  const selectedArchivePath =
    archiveIdentity?.rootPath ?? (storage && archive.status === "ready" ? archive.path : undefined);

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
    archiveImportLoadedRef.current = false;
    archiveImportLoadingRef.current = false;
    coverCacheLoadedRef.current = false;
    coverCacheLoadingRef.current = false;
    epubWritebackBackupStatusLoadedRef.current = false;
    epubWritebackBackupStatusLoadingRef.current = false;
    foldersLoadedRef.current = false;
    foldersLoadingRef.current = false;
  }, [archiveLocalScope]);

  useEffect(() => {
    if (!archiveMaintenance) return;
    statusOperationRevisionRef.current += 1;
    confirmationOperationLocksRef.current.clear();
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
      !loadArchiveImportSettings ||
      archiveImportLoadedRef.current ||
      archiveImportLoadingRef.current
    ) {
      return;
    }

    const activeStorage = storage;
    const scope = archiveLocalScope;
    const generation = dataLoadGenerationRef.current;
    archiveImportLoadingRef.current = true;
    void activeStorage
      .getArchiveImportSettings()
      .then((loadedImportSettings) => {
        if (
          dataLoadGenerationRef.current !== generation ||
          archiveLocalScopeRef.current !== scope
        ) {
          return;
        }
        archiveImportLoadedRef.current = true;
        setArchiveImportState({ scope, value: loadedImportSettings });
      })
      .catch(() => {
        if (
          dataLoadGenerationRef.current === generation &&
          archiveLocalScopeRef.current === scope
        ) {
          setLocalStatus(
            "Import settings could not be loaded. Close and reopen Settings to try again.",
            "error",
          );
        }
      })
      .finally(() => {
        if (
          dataLoadGenerationRef.current === generation &&
          archiveLocalScopeRef.current === scope
        ) {
          archiveImportLoadingRef.current = false;
        }
      });
  }, [archiveLocalScope, loadArchiveImportSettings, storage, setLocalStatus]);

  useEffect(() => {
    if (!storage || !loadFolders || foldersLoadedRef.current || foldersLoadingRef.current) {
      return;
    }

    const activeStorage = storage;
    const scope = archiveLocalScope;
    const generation = dataLoadGenerationRef.current;
    foldersLoadingRef.current = true;
    void activeStorage
      .listFolders()
      .then((loadedFolders) => {
        if (
          dataLoadGenerationRef.current !== generation ||
          archiveLocalScopeRef.current !== scope
        ) {
          return;
        }
        foldersLoadedRef.current = true;
        setFoldersState({ scope, value: loadedFolders });
      })
      .catch(() => {
        if (
          dataLoadGenerationRef.current === generation &&
          archiveLocalScopeRef.current === scope
        ) {
          setLocalStatus(
            "Folder destinations could not be loaded. Close and reopen Settings to try again.",
            "error",
          );
        }
      })
      .finally(() => {
        if (
          dataLoadGenerationRef.current === generation &&
          archiveLocalScopeRef.current === scope
        ) {
          foldersLoadingRef.current = false;
        }
      });
  }, [archiveLocalScope, loadFolders, storage, setLocalStatus]);

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
    coverCacheLoadingRef.current = true;
    void activeStorage
      .getCoverCacheStatus()
      .then((cacheStatus) => {
        if (dataLoadGenerationRef.current !== generation) return;
        coverCacheLoadedRef.current = true;
        setCache(cacheStatus);
      })
      .catch(() => {
        if (dataLoadGenerationRef.current === generation) {
          setLocalStatus(
            "Cover cache status is unavailable. Close and reopen Settings to try again.",
            "error",
          );
        }
      })
      .finally(() => {
        if (dataLoadGenerationRef.current === generation) {
          coverCacheLoadingRef.current = false;
        }
      });
  }, [loadCoverCacheStatus, storage, setLocalStatus]);

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
    epubWritebackBackupStatusLoadingRef.current = true;
    void activeStorage
      .getEpubWritebackBackupStatus()
      .then((backupStatus) => {
        if (dataLoadGenerationRef.current !== generation) return;
        epubWritebackBackupStatusLoadedRef.current = true;
        setEpubWritebackBackupStatus(backupStatus);
        setEpubWritebackBackupStatusState("loaded");
      })
      .catch(() => {
        if (dataLoadGenerationRef.current === generation) {
          setEpubWritebackBackupStatusState("unavailable");
          setLocalStatus(
            "Backup status is unavailable. Close and reopen Settings to try again.",
            "error",
          );
        }
      })
      .finally(() => {
        if (dataLoadGenerationRef.current === generation) {
          epubWritebackBackupStatusLoadingRef.current = false;
        }
      });
  }, [loadEpubWritebackBackupStatus, storage, setLocalStatus]);

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
    return beginStatusOperation();
  }

  function finishConfirmationOperation(confirmation: SettingsConfirmationKey) {
    confirmationOperationLocksRef.current.delete(confirmation);
    setBusyConfirmations((current) => ({ ...current, [confirmation]: false }));
    setConfirmations((current) => ({ ...current, [confirmation]: false }));
  }

  function beginArchiveScanOperation(
    confirmation: SettingsConfirmationKey,
  ): { claim: ArchiveScanOperationClaim | null; statusOperation: number } | null {
    if (!storage) return null;
    const claim =
      storage === contextualStorage ? tryAcquireArchiveScanOperation(contextualStorage) : null;
    if (storage === contextualStorage && !claim) return null;

    const statusOperation = beginConfirmationOperation(confirmation);
    if (statusOperation === null) {
      if (claim) releaseArchiveScanOperation(claim);
      return null;
    }
    return { claim, statusOperation };
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

  async function updateArchiveImport(changes: Partial<ArchiveImportSettings>): Promise<void> {
    if (!storage) return;
    const activeStorage = storage;
    const scope = archiveLocalScope;
    const next = { ...archiveImport, ...changes };
    const statusOperation = beginStatusOperation();
    try {
      const saved = await activeStorage.saveArchiveImportSettings(next);
      if (archiveLocalScopeRef.current !== scope) return;
      setArchiveImportState({ scope, value: saved });
    } catch {
      if (archiveLocalScopeRef.current !== scope) return;
      publishStatusOperation(
        statusOperation,
        "Import destination could not be saved. The previous destination is unchanged. Try again.",
        "error",
      );
    }
  }

  function updateImportDestination(value: string) {
    void updateArchiveImport({
      defaultDestinationFolderPath: destinationValueToFolderPath(value),
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
    const { claim, statusOperation } = operation;
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
      finishConfirmationOperation("rescanArchive");
      if (claim) releaseArchiveScanOperation(claim);
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
      if (archiveMaintenance) {
        await archiveMaintenance.revealArchiveFolder();
      } else if (
        archive.status !== "ready" ||
        !(await archiveStore.revealArchive(archive.archive.id))
      ) {
        throw new Error("Archive could not be revealed.");
      }
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
    const statusOperation = beginConfirmationOperation("clearCoverCache");
    if (statusOperation === null) return;
    try {
      setCache(await storage.clearCoverCache());
      publishStatusOperation(statusOperation, "Cover cache cleared.", "success");
    } catch {
      publishStatusOperation(
        statusOperation,
        "The cover cache could not be cleared. EPUB files are unchanged. Try again.",
        "error",
      );
    } finally {
      finishConfirmationOperation("clearCoverCache");
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
      finishConfirmationOperation("clearScannerCache");
    }
  }

  async function clearEpubWritebackBackups() {
    if (!storage) return;
    const statusOperation = beginConfirmationOperation("clearEpubWritebackBackups");
    if (statusOperation === null) return;
    try {
      setEpubWritebackBackupStatus(await storage.clearEpubWritebackBackups());
      setEpubWritebackBackupStatusState("loaded");
      publishStatusOperation(statusOperation, "EPUB writeback backups cleared.", "success");
    } catch {
      publishStatusOperation(
        statusOperation,
        "EPUB writeback backups could not be cleared. EPUB files are unchanged. Try again.",
        "error",
      );
    } finally {
      finishConfirmationOperation("clearEpubWritebackBackups");
    }
  }

  async function reextractMetadata() {
    if (!storage) return;
    const operation = beginArchiveScanOperation("reextractMetadata");
    if (!operation) return;
    const { claim, statusOperation } = operation;
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
      finishConfirmationOperation("reextractMetadata");
      if (claim) releaseArchiveScanOperation(claim);
    }
  }

  async function repairMetadata() {
    if (!storage) return;
    const operation = beginArchiveScanOperation("repairMetadata");
    if (!operation) return;
    const { claim, statusOperation } = operation;
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
      finishConfirmationOperation("repairMetadata");
      if (claim) releaseArchiveScanOperation(claim);
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

  async function resetImportDestination() {
    if (!storage) return;
    const activeStorage = storage;
    const scope = archiveLocalScope;
    const statusOperation = beginStatusOperation();
    try {
      const reset = await activeStorage.resetArchiveImportSettings();
      if (archiveLocalScopeRef.current !== scope) return;
      setArchiveImportState({ scope, value: reset });
      publishStatusOperation(statusOperation, "Import destination reset.", "success");
    } catch {
      if (archiveLocalScopeRef.current !== scope) return;
      publishStatusOperation(
        statusOperation,
        "Import destination could not be reset. The previous destination is unchanged. Try again.",
        "error",
      );
    }
  }

  return {
    archiveAvailable: storage !== null,
    archiveScanActive,
    cache,
    busyConfirmations,
    closeConfirmation,
    confirmations,
    destinationOptions,
    dismissStatus: clearLocalStatus,
    epubWritebackBackupStatus,
    epubWritebackBackupStatusState,
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
    resetImportDestination,
    resetLibrary,
    resetReader,
    resetStorage,
    resetWindow,
    revealArchiveFolder,
    revealMetadata,
    refreshThemeCatalog,
    safeImportDestinationValue,
    selectedArchivePath,
    status,
    themeCatalogEntries,
    themeCatalogLoading,
    updateAppearance,
    updateAppPreferences,
    updateFiles,
    updateImportDefaults,
    updateImportDestination,
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

export type SettingsDialogController = ReturnType<typeof useSettingsDialogController>;
