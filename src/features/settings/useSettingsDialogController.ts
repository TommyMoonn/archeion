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
import type { ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";
import { defaultAppPreferences, type AppPreferences } from "../../types/appSettings";
import type { Folder } from "../../types/folder";
import type {
  ArchiveAppearanceSettings,
  ArchiveImportSettings,
  ImportSettings,
} from "../../types/settings";
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

const LOCAL_STATUS_AUTO_DISMISS_MS = 2500;

export type SettingsDialogControllerOptions = {
  committedArchiveAppearance?: AppearancePreviewContext | null;
  loadArchiveAppearanceSettings?: boolean;
  loadArchiveImportSettings?: boolean;
  loadCoverCacheStatus?: boolean;
  loadEpubWritebackBackupStatus?: boolean;
  loadFolders?: boolean;
  onOpenThemeManager?: () => void;
  themeCatalogEntries?: readonly ThemeCatalogEntry[];
  themeCatalogError?: string | null;
  themeCatalogLoading?: boolean;
};

export function useSettingsDialogController({
  committedArchiveAppearance = null,
  loadArchiveAppearanceSettings = false,
  loadArchiveImportSettings = false,
  loadCoverCacheStatus = false,
  loadEpubWritebackBackupStatus = false,
  loadFolders = false,
  onOpenThemeManager,
  themeCatalogEntries = [],
  themeCatalogError = null,
  themeCatalogLoading = false,
}: SettingsDialogControllerOptions = {}) {
  const storage = useLibraryStorage();
  const archive = useArchive();
  const preferences = useAppPreferences();
  const persistenceStatus = useAppPreferencesPersistenceStatus();
  const reader = preferences.reader;
  const library = preferences.library;
  const files = preferences.filesAndMetadata;
  const [archiveImport, setArchiveImport] = useState<ArchiveImportSettings>({
    ...defaultArchiveImportSettings,
  });
  const [archiveAppearance, setArchiveAppearance] = useState<ArchiveAppearanceSettings | null>(
    null,
  );
  const [folders, setFolders] = useState<Folder[]>([]);
  const [cache, setCache] = useState<CoverCacheStatus | null>(null);
  const [epubWritebackBackupStatus, setEpubWritebackBackupStatus] =
    useState<EpubWritebackBackupStatus | null>(null);
  const [epubWritebackBackupStatusState, setEpubWritebackBackupStatusState] = useState<
    "loading" | "loaded" | "unavailable"
  >("loading");
  const [status, setStatus] = useState<SettingsLocalStatus | null>(null);
  const statusDismissTimerRef = useRef<number | null>(null);
  const archiveImportLoadedRef = useRef(false);
  const archiveImportLoadingRef = useRef(false);
  const archiveAppearanceLoadedRef = useRef(false);
  const archiveAppearanceLoadingRef = useRef(false);
  const archiveAppearanceRef = useRef<ArchiveAppearanceSettings | null>(null);
  const archiveAppearanceSaveRevisionRef = useRef(0);
  const committedAppearanceArchiveRef = useRef<AppearancePreviewContext["archive"] | null>(null);
  const coverCacheLoadedRef = useRef(false);
  const coverCacheLoadingRef = useRef(false);
  const epubWritebackBackupStatusLoadedRef = useRef(false);
  const epubWritebackBackupStatusLoadingRef = useRef(false);
  const foldersLoadedRef = useRef(false);
  const foldersLoadingRef = useRef(false);
  const dataLoadGenerationRef = useRef(0);
  const statusRevisionRef = useRef(0);
  const appPreferenceSaveRevisionRef = useRef(0);
  const [confirmations, setConfirmations] =
    useState<SettingsConfirmationState>(initialConfirmations);

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

  const clearStatusDismissTimer = useCallback(() => {
    if (statusDismissTimerRef.current === null) return;
    window.clearTimeout(statusDismissTimerRef.current);
    statusDismissTimerRef.current = null;
  }, []);

  const clearLocalStatus = useCallback(() => {
    statusRevisionRef.current += 1;
    clearStatusDismissTimer();
    setStatus(null);
  }, [clearStatusDismissTimer]);

  const setLocalStatus = useCallback(
    (message: string, tone: SettingsStatusTone, options?: { autoDismiss?: boolean }) => {
      statusRevisionRef.current += 1;
      const revision = statusRevisionRef.current;
      const autoDismiss = options?.autoDismiss ?? tone !== "error";

      clearStatusDismissTimer();
      setStatus({ message, tone });

      if (!autoDismiss) return;

      statusDismissTimerRef.current = window.setTimeout(() => {
        if (statusRevisionRef.current !== revision) return;
        statusDismissTimerRef.current = null;
        setStatus(null);
      }, LOCAL_STATUS_AUTO_DISMISS_MS);
    },
    [clearStatusDismissTimer],
  );

  const setNeutralStatus = useCallback(
    (message: string, options?: { autoDismiss?: boolean }) => {
      setLocalStatus(message, "neutral", options);
    },
    [setLocalStatus],
  );

  const setSuccessStatus = useCallback(
    (message: string) => {
      setLocalStatus(message, "success");
    },
    [setLocalStatus],
  );

  const setErrorStatus = useCallback(
    (message: string) => {
      setLocalStatus(message, "error");
    },
    [setLocalStatus],
  );

  useEffect(() => {
    return () => {
      dataLoadGenerationRef.current += 1;
      clearStatusDismissTimer();
    };
  }, [clearStatusDismissTimer]);

  useEffect(() => {
    dataLoadGenerationRef.current += 1;
    archiveAppearanceLoadedRef.current = false;
    archiveAppearanceLoadingRef.current = false;
    archiveAppearanceRef.current = null;
    archiveAppearanceSaveRevisionRef.current += 1;
    const resetGeneration = dataLoadGenerationRef.current;
    queueMicrotask(() => {
      if (dataLoadGenerationRef.current === resetGeneration) setArchiveAppearance(null);
    });
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
    const previousArchive = committedAppearanceArchiveRef.current;
    const nextArchive = committedArchiveAppearance?.archive ?? null;
    committedAppearanceArchiveRef.current = nextArchive;
    if (previousArchive && !sameAppearanceArchive(previousArchive, nextArchive)) {
      const generation = dataLoadGenerationRef.current + 1;
      dataLoadGenerationRef.current = generation;
      archiveAppearanceSaveRevisionRef.current += 1;
      archiveAppearanceLoadedRef.current = false;
      archiveAppearanceLoadingRef.current = false;
      archiveAppearanceRef.current = null;
      queueMicrotask(() => {
        if (dataLoadGenerationRef.current === generation) setArchiveAppearance(null);
      });
    }

    if (
      !loadArchiveAppearanceSettings ||
      !selectedArchivePath ||
      committedArchiveAppearance?.archive.rootPath !== selectedArchivePath
    ) {
      return;
    }

    const next = cloneArchiveAppearance(committedArchiveAppearance.settings);
    const generation = dataLoadGenerationRef.current + 1;
    dataLoadGenerationRef.current = generation;
    archiveAppearanceSaveRevisionRef.current += 1;
    archiveAppearanceLoadedRef.current = true;
    archiveAppearanceLoadingRef.current = false;
    archiveAppearanceRef.current = next;
    queueMicrotask(() => {
      if (dataLoadGenerationRef.current === generation) setArchiveAppearance(next);
    });
  }, [committedArchiveAppearance, loadArchiveAppearanceSettings, selectedArchivePath]);

  useEffect(() => {
    if (
      !loadArchiveAppearanceSettings ||
      archiveAppearanceLoadedRef.current ||
      archiveAppearanceLoadingRef.current
    ) {
      return;
    }

    const generation = dataLoadGenerationRef.current;
    archiveAppearanceLoadingRef.current = true;
    void storage
      .getArchiveAppearanceSettings()
      .then((settings) => {
        if (dataLoadGenerationRef.current !== generation) return;
        const next = cloneArchiveAppearance(settings);
        archiveAppearanceLoadedRef.current = true;
        archiveAppearanceRef.current = next;
        setArchiveAppearance(next);
      })
      .catch(() => {
        if (dataLoadGenerationRef.current === generation) {
          setErrorStatus("Archive appearance could not be loaded.");
        }
      })
      .finally(() => {
        if (dataLoadGenerationRef.current === generation) {
          archiveAppearanceLoadingRef.current = false;
        }
      });
  }, [loadArchiveAppearanceSettings, storage, setErrorStatus]);

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
          setErrorStatus("Settings could not be loaded.");
        }
      })
      .finally(() => {
        if (dataLoadGenerationRef.current === generation) {
          archiveImportLoadingRef.current = false;
        }
      });
  }, [loadArchiveImportSettings, storage, setErrorStatus]);

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
          setErrorStatus("Settings could not be loaded.");
        }
      })
      .finally(() => {
        if (dataLoadGenerationRef.current === generation) {
          foldersLoadingRef.current = false;
        }
      });
  }, [loadFolders, storage, setErrorStatus]);

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
          setErrorStatus("Settings could not be loaded.");
        }
      })
      .finally(() => {
        if (dataLoadGenerationRef.current === generation) {
          coverCacheLoadingRef.current = false;
        }
      });
  }, [loadCoverCacheStatus, storage, setErrorStatus]);

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
          setErrorStatus("Settings could not be loaded.");
        }
      })
      .finally(() => {
        if (dataLoadGenerationRef.current === generation) {
          epubWritebackBackupStatusLoadingRef.current = false;
        }
      });
  }, [loadEpubWritebackBackupStatus, storage, setErrorStatus]);

  function openConfirmation(confirmation: SettingsConfirmationKey) {
    setConfirmations((current) => ({ ...current, [confirmation]: true }));
  }

  function closeConfirmation(confirmation: SettingsConfirmationKey) {
    setConfirmations((current) => ({ ...current, [confirmation]: false }));
  }

  async function updateAppPreferences(
    changes: Partial<AppPreferences>,
    options?: { successMessage?: string | false },
  ): Promise<boolean> {
    appPreferenceSaveRevisionRef.current += 1;
    const saveRevision = appPreferenceSaveRevisionRef.current;
    clearLocalStatus();

    try {
      await appPreferencesStore.update(changes);
      if (appPreferenceSaveRevisionRef.current !== saveRevision) {
        return true;
      }

      const successMessage = options?.successMessage ?? "Settings saved.";
      if (successMessage) {
        setSuccessStatus(successMessage);
      }
      return true;
    } catch (error) {
      if (appPreferenceSaveRevisionRef.current === saveRevision) {
        setErrorStatus(error instanceof Error ? error.message : "App settings could not be saved.");
      }
      return false;
    }
  }

  function updateReader(changes: Partial<AppPreferences["reader"]>) {
    void updateAppPreferences({ reader: { ...reader, ...changes } });
  }

  function updateLibrary(changes: Partial<AppPreferences["library"]>) {
    void updateAppPreferences({ library: { ...library, ...changes } });
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
    clearLocalStatus();
    try {
      setArchiveImport(await storage.saveArchiveImportSettings(next));
    } catch {
      setErrorStatus("Import destination could not be saved.");
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
    const current = archiveAppearanceRef.current;
    const previewContext = appearanceRuntime.getPreviewContext();
    if (!current || !previewContext) {
      setErrorStatus("Archive appearance is unavailable.");
      return false;
    }

    const next = cloneArchiveAppearance({ ...current, ...changes });
    archiveAppearanceSaveRevisionRef.current += 1;
    const revision = archiveAppearanceSaveRevisionRef.current;
    archiveAppearanceRef.current = next;
    setArchiveAppearance(next);
    clearLocalStatus();

    try {
      const saved = await appearanceRuntime.saveArchiveAppearanceSettings(
        previewContext.archive,
        next,
      );
      if (archiveAppearanceSaveRevisionRef.current !== revision) return true;
      const normalized = cloneArchiveAppearance(saved);
      archiveAppearanceRef.current = normalized;
      setArchiveAppearance(normalized);
      setSuccessStatus("Archive appearance saved.");
      return true;
    } catch (error) {
      if (archiveAppearanceSaveRevisionRef.current === revision) {
        const active = appearanceRuntime.getPreviewContext()?.settings;
        const restored = active ? cloneArchiveAppearance(active) : current;
        archiveAppearanceRef.current = restored;
        setArchiveAppearance(restored);
        setErrorStatus(
          error instanceof Error ? error.message : "Archive appearance could not be saved.",
        );
      }
      return false;
    }
  }

  async function refreshArchiveAppearance(): Promise<void> {
    archiveAppearanceSaveRevisionRef.current += 1;
    const active = appearanceRuntime.getPreviewContext()?.settings;
    if (active) {
      const next = cloneArchiveAppearance(active);
      archiveAppearanceLoadedRef.current = true;
      archiveAppearanceRef.current = next;
      setArchiveAppearance(next);
      return;
    }

    try {
      const next = cloneArchiveAppearance(await storage.getArchiveAppearanceSettings());
      archiveAppearanceLoadedRef.current = true;
      archiveAppearanceRef.current = next;
      setArchiveAppearance(next);
    } catch {
      setErrorStatus("Archive appearance could not be refreshed.");
    }
  }

  function openThemeManager() {
    if (!selectedArchivePath || !onOpenThemeManager) {
      setErrorStatus("Theme Manager requires an active archive.");
      return;
    }
    onOpenThemeManager();
  }

  async function rescan() {
    closeConfirmation("rescanArchive");
    setNeutralStatus("Rescanning archive", { autoDismiss: false });
    try {
      await storage.rescan();
      setSuccessStatus("Archive scan complete.");
    } catch {
      setErrorStatus("The archive could not be scanned.");
    }
  }

  async function openArchiveManager() {
    clearLocalStatus();
    const opened = await archiveStore.openArchiveManagerWindow();
    if (!opened) setErrorStatus("Archive Manager could not be opened.");
  }

  async function revealArchiveFolder() {
    clearLocalStatus();
    if (archive.status !== "ready") return;
    const revealed = await archiveStore.revealArchive(archive.archive.id);
    if (!revealed) setErrorStatus("The archive folder could not be opened.");
  }

  async function revealMetadata() {
    clearLocalStatus();
    try {
      await storage.revealMetadataFolder();
    } catch {
      setErrorStatus("The .archeion folder could not be opened.");
    }
  }

  async function clearCache() {
    try {
      setCache(await storage.clearCoverCache());
      setSuccessStatus("Cover cache cleared.");
    } catch {
      setErrorStatus("The cover cache could not be cleared.");
    } finally {
      closeConfirmation("clearCoverCache");
    }
  }

  async function clearScannerCache() {
    try {
      await storage.clearScannerCache();
      setSuccessStatus("Scanner cache cleared.");
    } catch {
      setErrorStatus("The scanner cache could not be cleared.");
    } finally {
      closeConfirmation("clearScannerCache");
    }
  }

  async function clearEpubWritebackBackups() {
    try {
      setEpubWritebackBackupStatus(await storage.clearEpubWritebackBackups());
      setEpubWritebackBackupStatusState("loaded");
      setSuccessStatus("EPUB writeback backups cleared.");
    } catch {
      setErrorStatus("EPUB writeback backups could not be cleared.");
    } finally {
      closeConfirmation("clearEpubWritebackBackups");
    }
  }

  async function reextractMetadata() {
    try {
      await storage.clearScannerCache();
      await storage.rescan();
      setSuccessStatus("Source metadata re-extracted.");
    } catch {
      setErrorStatus("Source metadata could not be re-extracted.");
    } finally {
      closeConfirmation("reextractMetadata");
    }
  }

  async function repairMetadata() {
    try {
      await storage.repairArchiveMetadata();
      setSuccessStatus("Archive metadata repaired.");
    } catch {
      setErrorStatus("Archive metadata could not be repaired.");
    } finally {
      closeConfirmation("repairMetadata");
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
        bookCardSize: defaultAppPreferences.bookCardSize,
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
        windowFrameStyle: defaultAppPreferences.windowFrameStyle,
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
    if (
      !(await updateAppPreferences(
        { import: defaultAppPreferences.import },
        { successMessage: false },
      ))
    ) {
      return;
    }

    try {
      setArchiveImport(await storage.resetArchiveImportSettings());
      setSuccessStatus("Import settings reset.");
    } catch {
      setErrorStatus("Import destination could not be reset.");
    }
  }

  return {
    archiveAppearance,
    cache,
    closeConfirmation,
    confirmations,
    destinationOptions,
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
    resetImport,
    resetLibrary,
    resetReader,
    resetStorage,
    resetWindow,
    refreshArchiveAppearance,
    revealArchiveFolder,
    revealMetadata,
    safeImportDestinationValue,
    selectedArchivePath,
    status,
    themeCatalogEntries,
    themeCatalogError,
    themeCatalogLoading,
    updateArchiveAppearance,
    updateAppPreferences,
    updateFiles,
    updateImportDefaults,
    updateImportDestination,
    updateLibrary,
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

function cloneArchiveAppearance(
  settings: Readonly<ArchiveAppearanceSettings>,
): ArchiveAppearanceSettings {
  return {
    appTheme: { ...settings.appTheme },
    readerTheme: { ...settings.readerTheme },
  };
}

function sameAppearanceArchive(
  left: AppearancePreviewContext["archive"],
  right: AppearancePreviewContext["archive"] | null,
): boolean {
  return (
    right !== null &&
    left.generation === right.generation &&
    left.id === right.id &&
    left.rootPath === right.rootPath
  );
}
