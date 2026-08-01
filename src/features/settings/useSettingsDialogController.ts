import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CoverCacheStatus, EpubWritebackBackupStatus } from "../../storage/LibraryStorage";
import { defaultArchiveImportSettings } from "../../storage/metadataFiles";
import { useLibraryStorage } from "../../storage/useLibraryStorage";
import {
  appPreferencesStore,
  useAppPreferences,
  useAppPreferencesPersistenceStatus,
} from "../../stores/appPreferencesStore";
import { archiveStore } from "../../stores/archiveStore";
import type { AppearancePreviewContext } from "../../themes/AppearanceRuntime";
import { appearanceRuntime } from "../../themes/appearanceRuntimeInstance";
import { ArchiveThemeRepository } from "../../themes/ArchiveThemeRepository";
import type { ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";
import { defaultAppPreferences, type AppPreferences } from "../../types/appSettings";
import type { Folder } from "../../types/folder";
import type {
  ArchiveAppearanceSettings,
  ArchiveImportSettings,
  ImportSettings,
} from "../../types/settings";
import {
  isArchiveScanActive,
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

export type SettingsDialogControllerOptions = {
  committedArchiveAppearance?: AppearancePreviewContext | null;
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
  committedArchiveAppearance = null,
  loadArchiveImportSettings = false,
  loadCoverCacheStatus = false,
  loadEpubWritebackBackupStatus = false,
  loadFolders = false,
  onOpenThemeManager,
  refreshThemeCatalog = async () => false,
  themeCatalogEntries = [],
  themeCatalogLoading = false,
}: SettingsDialogControllerOptions = {}) {
  const storage = useLibraryStorage();
  const archiveScanActive = useArchiveScanActivity(storage);
  const archive = useArchive();
  const preferences = useAppPreferences();
  const persistenceStatus = useAppPreferencesPersistenceStatus();
  const reader = preferences.reader;
  const library = preferences.library;
  const files = preferences.filesAndMetadata;
  const [archiveImport, setArchiveImport] = useState<ArchiveImportSettings>({
    ...defaultArchiveImportSettings,
  });
  const [folders, setFolders] = useState<Folder[]>([]);
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
  const selectedArchivePath = archive.status === "ready" ? archive.path : undefined;
  const archiveAppearance =
    selectedArchivePath && committedArchiveAppearance?.archive.rootPath === selectedArchivePath
      ? committedArchiveAppearance.settings
      : null;

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
  }, [storage]);

  useEffect(() => {
    if (
      !loadArchiveImportSettings ||
      archiveImportLoadedRef.current ||
      archiveImportLoadingRef.current
    ) {
      return;
    }

    const generation = dataLoadGenerationRef.current;
    archiveImportLoadingRef.current = true;
    void storage
      .getArchiveImportSettings()
      .then((loadedImportSettings) => {
        if (dataLoadGenerationRef.current !== generation) return;
        archiveImportLoadedRef.current = true;
        setArchiveImport(loadedImportSettings);
      })
      .catch(() => {
        if (dataLoadGenerationRef.current === generation) {
          setLocalStatus(
            "Import settings could not be loaded. Close and reopen Settings to try again.",
            "error",
          );
        }
      })
      .finally(() => {
        if (dataLoadGenerationRef.current === generation) {
          archiveImportLoadingRef.current = false;
        }
      });
  }, [loadArchiveImportSettings, storage, setLocalStatus]);

  useEffect(() => {
    if (!loadFolders || foldersLoadedRef.current || foldersLoadingRef.current) {
      return;
    }

    const generation = dataLoadGenerationRef.current;
    foldersLoadingRef.current = true;
    void storage
      .listFolders()
      .then((loadedFolders) => {
        if (dataLoadGenerationRef.current !== generation) return;
        foldersLoadedRef.current = true;
        setFolders(loadedFolders);
      })
      .catch(() => {
        if (dataLoadGenerationRef.current === generation) {
          setLocalStatus(
            "Folder destinations could not be loaded. Close and reopen Settings to try again.",
            "error",
          );
        }
      })
      .finally(() => {
        if (dataLoadGenerationRef.current === generation) {
          foldersLoadingRef.current = false;
        }
      });
  }, [loadFolders, storage, setLocalStatus]);

  useEffect(() => {
    if (!loadCoverCacheStatus || coverCacheLoadedRef.current || coverCacheLoadingRef.current) {
      return;
    }

    const generation = dataLoadGenerationRef.current;
    coverCacheLoadingRef.current = true;
    void storage
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
      !loadEpubWritebackBackupStatus ||
      epubWritebackBackupStatusLoadedRef.current ||
      epubWritebackBackupStatusLoadingRef.current
    ) {
      return;
    }

    const generation = dataLoadGenerationRef.current;
    epubWritebackBackupStatusLoadingRef.current = true;
    void storage
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
    if (archiveScanConfirmationKeys.has(confirmation) && isArchiveScanActive(storage)) return;
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
  ): { claim: ArchiveScanOperationClaim; statusOperation: number } | null {
    const claim = tryAcquireArchiveScanOperation(storage);
    if (!claim) return null;

    const statusOperation = beginConfirmationOperation(confirmation);
    if (statusOperation === null) {
      releaseArchiveScanOperation(claim);
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
    const next = { ...archiveImport, ...changes };
    const statusOperation = beginStatusOperation();
    try {
      setArchiveImport(await storage.saveArchiveImportSettings(next));
    } catch {
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

  async function updateArchiveAppearance(
    changes: Partial<ArchiveAppearanceSettings>,
  ): Promise<boolean> {
    const statusOperation = beginStatusOperation();
    const previewContext = appearanceRuntime.getPreviewContext();
    if (
      !previewContext ||
      !selectedArchivePath ||
      previewContext.archive.rootPath !== selectedArchivePath
    ) {
      publishStatusOperation(
        statusOperation,
        "Archive appearance is unavailable. Reopen Settings from an active archive.",
        "error",
      );
      return false;
    }

    try {
      await appearanceRuntime.updateArchiveAppearanceSettings(previewContext.archive, changes);
      publishStatusOperation(statusOperation, "Archive appearance saved.", "success");
      return true;
    } catch {
      publishStatusOperation(
        statusOperation,
        "Archive appearance could not be saved. Try changing the appearance again.",
        "error",
      );
      return false;
    }
  }

  function openThemeManager() {
    const statusOperation = beginStatusOperation();
    if (!selectedArchivePath || !onOpenThemeManager) {
      publishStatusOperation(
        statusOperation,
        "Theme Manager requires an active archive. Open an archive, then try again.",
        "error",
      );
      return;
    }
    onOpenThemeManager();
  }

  async function openThemesFolder(): Promise<boolean> {
    const statusOperation = beginStatusOperation();
    if (!selectedArchivePath) {
      publishStatusOperation(
        statusOperation,
        "Themes require an active archive. Open an archive, then try again.",
        "error",
      );
      return false;
    }
    try {
      await new ArchiveThemeRepository(selectedArchivePath).revealThemesRoot();
      return true;
    } catch {
      publishStatusOperation(
        statusOperation,
        "The themes folder could not be opened. Check that the archive is available and try again.",
        "error",
      );
      return false;
    }
  }

  async function rescan() {
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
      releaseArchiveScanOperation(claim);
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
    if (archive.status !== "ready") return;
    const revealed = await archiveStore.revealArchive(archive.archive.id);
    if (!revealed) {
      publishStatusOperation(
        statusOperation,
        "The archive folder could not be opened. Check that the folder still exists.",
        "error",
      );
    }
  }

  async function revealMetadata() {
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
      releaseArchiveScanOperation(claim);
    }
  }

  async function repairMetadata() {
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
      releaseArchiveScanOperation(claim);
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
      { reader: defaultAppPreferences.reader },
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

  async function resetImport() {
    const statusOperation = beginStatusOperation();
    if (
      !(await persistAppPreferences(
        () => appPreferencesStore.update({ import: defaultAppPreferences.import }),
        { statusOperation, successMessage: false },
      ))
    ) {
      return;
    }

    try {
      setArchiveImport(await storage.resetArchiveImportSettings());
      publishStatusOperation(statusOperation, "Import settings reset.", "success");
    } catch {
      publishStatusOperation(
        statusOperation,
        "Import destination could not be reset. The previous destination is unchanged. Try again.",
        "error",
      );
    }
  }

  return {
    archiveAppearance,
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
    openThemesFolder,
    openConfirmation,
    persistenceStatus,
    preferences,
    reader,
    resetAppearance,
    resetGeneral,
    resetImport,
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
    updateArchiveAppearance,
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
