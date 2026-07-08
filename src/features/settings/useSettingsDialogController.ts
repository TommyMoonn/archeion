import { useEffect, useMemo, useState } from "react";

import type { CoverCacheStatus } from "../../storage/LibraryStorage";
import { defaultArchiveImportSettings } from "../../storage/metadataFiles";
import { useLibraryStorage } from "../../storage/useLibraryStorage";
import {
  appPreferencesStore,
  useAppPreferences,
  useAppPreferencesPersistenceStatus,
} from "../../stores/appPreferencesStore";
import { archiveStore } from "../../stores/archiveStore";
import { defaultAppPreferences, type AppPreferences } from "../../types/appSettings";
import type { Folder } from "../../types/folder";
import type { ArchiveImportSettings, ImportSettings } from "../../types/settings";
import { useArchive } from "../archive/useArchive";
import {
  createArchiveDestinationOptions,
  destinationValueFromFolderPath,
  destinationValueToFolderPath,
} from "../filesystem/archiveImport";
import type {
  SettingsConfirmationKey,
  SettingsConfirmationState,
} from "./SettingsConfirmations";

const initialConfirmations: SettingsConfirmationState = {
  clearCoverCache: false,
  clearScannerCache: false,
  reextractMetadata: false,
  rescanArchive: false,
};

export function useSettingsDialogController() {
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
  const [folders, setFolders] = useState<Folder[]>([]);
  const [cache, setCache] = useState<CoverCacheStatus | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [confirmations, setConfirmations] =
    useState<SettingsConfirmationState>(initialConfirmations);

  const importSettings: ImportSettings = {
    ...preferences.import,
    ...archiveImport,
  };
  const destinationOptions = useMemo(
    () => createArchiveDestinationOptions(folders),
    [folders],
  );
  const importDestinationValue = destinationValueFromFolderPath(
    importSettings.defaultDestinationFolderPath,
  );
  const safeImportDestinationValue = destinationOptions.some(
    (destination) => destination.value === importDestinationValue,
  )
    ? importDestinationValue
    : destinationOptions[0]?.value;
  const selectedArchivePath =
    archive.status === "ready" ? archive.path : undefined;

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      storage.getArchiveImportSettings(),
      storage.listFolders(),
      storage.getCoverCacheStatus(),
    ])
      .then(([loadedImportSettings, loadedFolders, cacheStatus]) => {
        if (cancelled) return;
        setArchiveImport(loadedImportSettings);
        setFolders(loadedFolders);
        setCache(cacheStatus);
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("Settings could not be loaded.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [storage]);

  function openConfirmation(confirmation: SettingsConfirmationKey) {
    setConfirmations((current) => ({ ...current, [confirmation]: true }));
  }

  function closeConfirmation(confirmation: SettingsConfirmationKey) {
    setConfirmations((current) => ({ ...current, [confirmation]: false }));
  }

  async function updateAppPreferences(
    changes: Partial<AppPreferences>,
  ): Promise<boolean> {
    setStatus(null);
    try {
      await appPreferencesStore.update(changes);
      return true;
    } catch (error) {
      setStatus(
        error instanceof Error
          ? error.message
          : "App settings could not be saved.",
      );
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

  async function updateArchiveImport(
    changes: Partial<ArchiveImportSettings>,
  ): Promise<void> {
    const next = { ...archiveImport, ...changes };
    setStatus(null);
    try {
      setArchiveImport(await storage.saveArchiveImportSettings(next));
    } catch {
      setStatus("Import destination could not be saved.");
    }
  }

  function updateImportDestination(value: string) {
    void updateArchiveImport({
      defaultDestinationFolderPath: destinationValueToFolderPath(value),
    });
  }

  async function rescan() {
    closeConfirmation("rescanArchive");
    setStatus("Rescanning archive");
    try {
      await storage.rescan();
      setStatus("Archive scan complete.");
    } catch {
      setStatus("The archive could not be scanned.");
    }
  }

  async function openArchiveManager() {
    setStatus(null);
    const opened = await archiveStore.openArchiveManagerWindow();
    if (!opened) setStatus("Archive Manager could not be opened.");
  }

  async function revealArchiveFolder() {
    setStatus(null);
    if (archive.status !== "ready") return;
    const revealed = await archiveStore.revealArchive(archive.archive.id);
    if (!revealed) setStatus("The archive folder could not be opened.");
  }

  async function revealMetadata() {
    setStatus(null);
    try {
      await storage.revealMetadataFolder();
    } catch {
      setStatus("The .archeion folder could not be opened.");
    }
  }

  async function clearCache() {
    try {
      setCache(await storage.clearCoverCache());
      setStatus("Cover cache cleared.");
    } catch {
      setStatus("The cover cache could not be cleared.");
    } finally {
      closeConfirmation("clearCoverCache");
    }
  }

  async function clearScannerCache() {
    try {
      await storage.clearScannerCache();
      setStatus("Scanner cache cleared.");
    } catch {
      setStatus("The scanner cache could not be cleared.");
    } finally {
      closeConfirmation("clearScannerCache");
    }
  }

  async function reextractMetadata() {
    try {
      await storage.clearScannerCache();
      await storage.rescan();
      setStatus("Source metadata re-extracted.");
    } catch {
      setStatus("Source metadata could not be re-extracted.");
    } finally {
      closeConfirmation("reextractMetadata");
    }
  }

  async function resetGeneral() {
    if (
      await updateAppPreferences({
        confirmDestructiveFileActions:
          defaultAppPreferences.confirmDestructiveFileActions,
        restoreLastReader: defaultAppPreferences.restoreLastReader,
        startupBehavior: defaultAppPreferences.startupBehavior,
      })
    ) {
      setStatus("General settings reset.");
    }
  }

  async function resetReader() {
    if (await updateAppPreferences({ reader: defaultAppPreferences.reader })) {
      setStatus("Reader settings reset.");
    }
  }

  async function resetLibrary() {
    const saved = await updateAppPreferences({
      bookCardSize: defaultAppPreferences.bookCardSize,
      library: defaultAppPreferences.library,
      showContinueReading: defaultAppPreferences.showContinueReading,
    });
    if (saved) {
      setStatus("Library settings reset.");
    }
  }

  async function resetAppearance() {
    if (
      await updateAppPreferences({
        appThemePreset: defaultAppPreferences.appThemePreset,
        density: defaultAppPreferences.density,
      })
    ) {
      setStatus("Appearance settings reset.");
    }
  }

  async function resetWindow() {
    if (
      await updateAppPreferences({
        rememberWindowState: defaultAppPreferences.rememberWindowState,
        windowFrameStyle: defaultAppPreferences.windowFrameStyle,
      })
    ) {
      setStatus("Window settings reset.");
    }
  }

  async function resetStorage() {
    if (
      await updateAppPreferences({
        filesAndMetadata: defaultAppPreferences.filesAndMetadata,
      })
    ) {
      setStatus("Storage settings reset.");
    }
  }

  async function resetImport() {
    if (
      !(await updateAppPreferences({ import: defaultAppPreferences.import }))
    ) {
      return;
    }

    try {
      setArchiveImport(await storage.resetArchiveImportSettings());
      setStatus("Import settings reset.");
    } catch {
      setStatus("Import destination could not be reset.");
    }
  }

  return {
    cache,
    closeConfirmation,
    confirmations,
    destinationOptions,
    files,
    importSettings,
    library,
    openArchiveManager,
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
    safeImportDestinationValue,
    selectedArchivePath,
    status,
    updateAppPreferences,
    updateFiles,
    updateImportDefaults,
    updateImportDestination,
    updateLibrary,
    updateReader,
    confirmClearCoverCache: () => void clearCache(),
    confirmClearScannerCache: () => void clearScannerCache(),
    confirmReextractMetadata: () => void reextractMetadata(),
    confirmRescanArchive: () => void rescan(),
  };
}
