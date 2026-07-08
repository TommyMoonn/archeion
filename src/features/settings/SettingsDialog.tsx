import {
  Archive,
  BookOpenText,
  Broom,
  Database,
  DownloadSimple,
  MagnifyingGlass,
  Palette,
  SlidersHorizontal,
  X,
} from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { IconButton } from "../../components/IconButton";
import { Input } from "../../components/Input";
import type { CoverCacheStatus } from "../../storage/LibraryStorage";
import { defaultArchiveImportSettings } from "../../storage/metadataFiles";
import { useLibraryStorage } from "../../storage/useLibraryStorage";
import {
  appPreferencesStore,
  useAppPreferences,
  useAppPreferencesPersistenceStatus,
} from "../../stores/appPreferencesStore";
import { archiveStore } from "../../stores/archiveStore";
import { defaultAppPreferences } from "../../types/appSettings";
import type { Folder } from "../../types/folder";
import type { ArchiveImportSettings, ImportSettings } from "../../types/settings";
import { useArchive } from "../archive/useArchive";
import {
  createArchiveDestinationOptions,
  destinationValueFromFolderPath,
  destinationValueToFolderPath,
} from "../filesystem/archiveImport";
import {
  sectionMatches,
  settingsSections,
  type SettingsSection as SettingsSectionId,
} from "./settingsSections";
import { AppearanceSettingsSection } from "./sections/AppearanceSettingsSection";
import { ArchivesSettingsSection } from "./sections/ArchivesSettingsSection";
import { StorageSettingsSection } from "./sections/StorageSettingsSection";
import { GeneralSettingsSection } from "./sections/GeneralSettingsSection";
import { ImportSettingsSection } from "./sections/ImportSettingsSection";
import { LibrarySettingsSection } from "./sections/LibrarySettingsSection";
import { ReaderSettingsSection } from "./sections/ReaderSettingsSection";

type SettingsDialogProps = {
  onClose: () => void;
};

function SectionIcon({ section }: { section: SettingsSectionId }) {
  switch (section) {
    case "general":
      return <SlidersHorizontal aria-hidden="true" size={16} />;
    case "archives":
      return <Archive aria-hidden="true" size={16} />;
    case "library":
      return <Database aria-hidden="true" size={16} />;
    case "reader":
      return <BookOpenText aria-hidden="true" size={16} />;
    case "appearance":
      return <Palette aria-hidden="true" size={16} />;
    case "storage":
      return <Broom aria-hidden="true" size={16} />;
    case "import":
      return <DownloadSimple aria-hidden="true" size={16} />;
  }
}

function statusMessage(
  status: ReturnType<typeof appPreferencesStore.getPersistenceSnapshot>,
) {
  if (status.status === "saving") return "Saving settings.";
  if (status.status === "saved") return "Settings saved.";
  if (status.status === "loading") return "Loading settings.";
  if (status.status === "error") return status.error;
  return null;
}

export function SettingsDialog({ onClose }: SettingsDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const contentRef = useRef<HTMLElement>(null);
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
  const importSettings: ImportSettings = {
    ...preferences.import,
    ...archiveImport,
  };
  const [folders, setFolders] = useState<Folder[]>([]);
  const [cache, setCache] = useState<CoverCacheStatus | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [clearCacheOpen, setClearCacheOpen] = useState(false);
  const [clearScannerOpen, setClearScannerOpen] = useState(false);
  const [reextractOpen, setReextractOpen] = useState(false);
  const [rescanOpen, setRescanOpen] = useState(false);
  const [activeSection, setActiveSection] =
    useState<SettingsSectionId>("general");
  const [query, setQuery] = useState("");

  const visibleSections = useMemo(
    () =>
      settingsSections.filter((section) => sectionMatches(section.id, query)),
    [query],
  );
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

  function showSection(section: SettingsSectionId) {
    setActiveSection(section);
    contentRef.current?.scrollTo({ top: 0 });
  }

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (dialog?.open) {
        dialog.close();
      }
    };
  }, []);

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

  async function updateAppPreferences(
    changes: Parameters<typeof appPreferencesStore.update>[0],
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

  function updateReader(changes: Partial<typeof preferences.reader>) {
    void updateAppPreferences({ reader: { ...reader, ...changes } });
  }

  function updateLibrary(changes: Partial<typeof preferences.library>) {
    void updateAppPreferences({ library: { ...library, ...changes } });
  }

  function updateFiles(changes: Partial<typeof preferences.filesAndMetadata>) {
    void updateAppPreferences({
      filesAndMetadata: { ...files, ...changes },
    });
  }

  function updateImportDefaults(changes: Partial<typeof preferences.import>) {
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

  async function rescan() {
    setRescanOpen(false);
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
      setClearCacheOpen(false);
    }
  }

  async function clearScannerCache() {
    try {
      await storage.clearScannerCache();
      setStatus("Scanner cache cleared.");
    } catch {
      setStatus("The scanner cache could not be cleared.");
    } finally {
      setClearScannerOpen(false);
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
      setReextractOpen(false);
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

  async function resetFiles() {
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

  const selectedSection = visibleSections.some(
    (section) => section.id === activeSection,
  )
    ? activeSection
    : (visibleSections[0]?.id ?? activeSection);
  const sectionHidden = (section: SettingsSectionId) =>
    selectedSection !== section;
  const selectedArchivePath =
    archive.status === "ready" ? archive.path : undefined;

  return (
    <dialog
      aria-labelledby="settings-title"
      aria-modal="true"
      className="settings-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      ref={dialogRef}
    >
      <div className="settings-window">
        <aside className="settings-sidebar">
          <div className="settings-sidebar__header">
            <p>Archeion</p>
            <h1 id="settings-title">Settings</h1>
          </div>
          <Input
            className="settings-search"
            icon={<MagnifyingGlass aria-hidden="true" size={16} />}
            label="Search settings"
            onChange={(event) => setQuery(event.currentTarget.value)}
            placeholder="Search settings"
            type="search"
            value={query}
          />
          <nav aria-label="Settings sections">
            {visibleSections.map((section) => (
              <button
                aria-current={
                  selectedSection === section.id ? "page" : undefined
                }
                key={section.id}
                onClick={() => showSection(section.id)}
                type="button"
              >
                <SectionIcon section={section.id} />
                {section.label}
              </button>
            ))}
          </nav>
        </aside>

        <IconButton
          autoFocus
          className="settings-close"
          label="Close settings"
          onClick={onClose}
        >
          <X aria-hidden="true" size={18} />
        </IconButton>

        <main className="settings-content" ref={contentRef}>
          <GeneralSettingsSection
            confirmDestructiveFileActions={preferences.confirmDestructiveFileActions}
            hidden={sectionHidden("general")}
            onConfirmDestructiveFileActionsChange={(confirmDestructiveFileActions) =>
              void updateAppPreferences({ confirmDestructiveFileActions })
            }
            onReset={() => void resetGeneral()}
            onRestoreLastReaderChange={(restoreLastReader) =>
              void updateAppPreferences({ restoreLastReader })
            }
            onStartupBehaviorChange={(startupBehavior) =>
              void updateAppPreferences({ startupBehavior })
            }
            restoreLastReader={preferences.restoreLastReader}
            startupBehavior={preferences.startupBehavior}
          />

          <ArchivesSettingsSection
            archivePath={selectedArchivePath}
            hidden={sectionHidden("archives")}
            onOpenArchiveManager={() => void openArchiveManager()}
            onRevealArchiveFolder={() => void revealArchiveFolder()}
          />

          <LibrarySettingsSection
            bookCardSize={preferences.bookCardSize}
            hidden={sectionHidden("library")}
            library={library}
            onBookCardSizeChange={(bookCardSize) =>
              void updateAppPreferences({ bookCardSize })
            }
            onReset={() => void resetLibrary()}
            onShowContinueReadingChange={(showContinueReading) =>
              void updateAppPreferences({ showContinueReading })
            }
            onSortByChange={(sortBy) => updateLibrary({ sortBy })}
            onViewModeChange={(viewMode) => updateLibrary({ viewMode })}
            showContinueReading={preferences.showContinueReading}
          />

          <ReaderSettingsSection
            hidden={sectionHidden("reader")}
            onChange={updateReader}
            onReset={() => void resetReader()}
            reader={reader}
          />

          <AppearanceSettingsSection
            appThemePreset={preferences.appThemePreset}
            density={preferences.density}
            hidden={sectionHidden("appearance")}
            onAppThemePresetChange={(appThemePreset) =>
              void updateAppPreferences({ appThemePreset })
            }
            onDensityChange={(density) => void updateAppPreferences({ density })}
            onRememberWindowStateChange={(rememberWindowState) =>
              void updateAppPreferences({ rememberWindowState })
            }
            onResetAppearance={() => void resetAppearance()}
            onResetWindow={() => void resetWindow()}
            onWindowFrameStyleChange={(windowFrameStyle) =>
              void updateAppPreferences({ windowFrameStyle })
            }
            rememberWindowState={preferences.rememberWindowState}
            windowFrameStyle={preferences.windowFrameStyle}
          />

          <StorageSettingsSection
            cache={cache}
            files={files}
            hidden={sectionHidden("storage")}
            onClearCoverCache={() => setClearCacheOpen(true)}
            onClearScannerCache={() => setClearScannerOpen(true)}
            onLiveWatcherEnabledChange={(liveWatcherEnabled) =>
              updateFiles({ liveWatcherEnabled })
            }
            onReextractMetadata={() => setReextractOpen(true)}
            onRescan={() => setRescanOpen(true)}
            onReset={() => void resetFiles()}
            onRevealMetadataFolder={() => void revealMetadata()}
            onScanOnStartupChange={(scanOnStartup) =>
              updateFiles({ scanOnStartup })
            }
          />

          <ImportSettingsSection
            destinationOptions={destinationOptions}
            hidden={sectionHidden("import")}
            importSettings={importSettings}
            onConflictActionChange={(defaultConflictAction) =>
              updateImportDefaults({ defaultConflictAction })
            }
            onDestinationChange={(value) =>
              void updateArchiveImport({
                defaultDestinationFolderPath: destinationValueToFolderPath(value),
              })
            }
            onImportModeChange={(defaultMode) =>
              updateImportDefaults({ defaultMode })
            }
            onReset={() => void resetImport()}
            safeDestinationValue={safeImportDestinationValue}
          />

          {status || persistenceStatus.status !== "idle" ? (
            <p
              className="settings-status"
              data-error={persistenceStatus.status === "error" || undefined}
              role={persistenceStatus.status === "error" ? "alert" : "status"}
            >
              {status ?? statusMessage(persistenceStatus)}
            </p>
          ) : null}
        </main>

        {clearCacheOpen ? (
          <Dialog
            title="Clear cover cache?"
            description="Covers will be extracted again when needed."
            onClose={() => setClearCacheOpen(false)}
            footer={
              <>
                <Button
                  variant="secondary"
                  onClick={() => setClearCacheOpen(false)}
                >
                  Cancel
                </Button>
                <Button variant="danger" onClick={() => void clearCache()}>
                  Clear cover cache
                </Button>
              </>
            }
          />
        ) : null}
        {clearScannerOpen ? (
          <Dialog
            title="Clear scanner cache?"
            description="EPUB files, favorites, and reading progress will not be deleted."
            onClose={() => setClearScannerOpen(false)}
            footer={
              <>
                <Button
                  variant="secondary"
                  onClick={() => setClearScannerOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  variant="danger"
                  onClick={() => void clearScannerCache()}
                >
                  Clear scanner cache
                </Button>
              </>
            }
          />
        ) : null}
        {reextractOpen ? (
          <Dialog
            title="Re-extract source metadata?"
            description="EPUB files, favorites, and reading progress will not be deleted."
            onClose={() => setReextractOpen(false)}
            footer={
              <>
                <Button
                  variant="secondary"
                  onClick={() => setReextractOpen(false)}
                >
                  Cancel
                </Button>
                <Button autoFocus onClick={() => void reextractMetadata()}>
                  Re-extract
                </Button>
              </>
            }
          />
        ) : null}
        {rescanOpen ? (
          <Dialog
            title="Rescan archive?"
            description="EPUB files are not changed."
            onClose={() => setRescanOpen(false)}
            footer={
              <>
                <Button
                  onClick={() => setRescanOpen(false)}
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button autoFocus onClick={() => void rescan()}>
                  Rescan archive
                </Button>
              </>
            }
          />
        ) : null}
      </div>
    </dialog>
  );
}
