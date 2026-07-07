import {
  Archive,
  ArrowsClockwise,
  BookOpenText,
  Broom,
  Database,
  DownloadSimple,
  FolderOpen,
  MagnifyingGlass,
  Palette,
  SlidersHorizontal,
  X,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

import { AppSelect } from "../../components/AppSelect";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { IconButton } from "../../components/IconButton";
import { Input } from "../../components/Input";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Toggle } from "../../components/Toggle";
import type { CoverCacheStatus } from "../../storage/LibraryStorage";
import { useLibraryStorage } from "../../storage/useLibraryStorage";
import {
  appPreferencesStore,
  useAppPreferences,
  useAppPreferencesPersistenceStatus,
} from "../../stores/appPreferencesStore";
import { archiveStore } from "../../stores/archiveStore";
import type {
  AppThemePreset,
  BookCardSize,
  InterfaceDensity,
  StartupBehavior,
  WindowFrameStyle,
} from "../../types/appSettings";
import { defaultAppPreferences } from "../../types/appSettings";
import type { Folder } from "../../types/folder";
import type { LibrarySort } from "../../types/library";
import { defaultArchiveImportSettings } from "../../storage/metadataFiles";
import type {
  ArchiveImportSettings,
  ImportSettings,
} from "../../types/settings";
import {
  type ReaderProgressPlacement,
  type ReaderTheme,
} from "../../types/reader";
import {
  archiveImportConflictOptions,
  archiveImportModeOptions,
  createArchiveDestinationOptions,
  destinationValueFromFolderPath,
  destinationValueToFolderPath,
} from "../filesystem/archiveImport";
import { useArchive } from "../archive/useArchive";
import type { LibraryView } from "../library/LibraryToolbar";
import { librarySortOptions } from "../library/librarySortOptions";

const sections = [
  "General",
  "Library",
  "Reader",
  "Appearance",
  "Archives",
  "Storage",
  "Import",
] as const;
type SettingsSection = (typeof sections)[number];

type SettingsDialogProps = {
  onClose: () => void;
};

type SettingsRowProps = {
  children: ReactNode;
  description?: ReactNode;
  label: string;
  note?: ReactNode;
};

const searchIndex: Record<SettingsSection, string[]> = {
  General: [
    "general",
    "startup behavior",
    "startup",
    "open last archive",
    "archive manager",
    "destructive",
    "confirm destructive file actions",
    "confirm",
    "restore last reader route",
    "restore reader",
    "reopen last book route",
  ],
  Library: [
    "library",
    "grid",
    "list",
    "sort",
    "default view",
    "default sort",
    "title",
    "author",
    "recently opened",
    "book card size",
    "card size",
    "show continue reading",
    "continue reading",
    "cover size",
  ],
  Reader: [
    "reader",
    "font family",
    "font size",
    "font",
    "typeface",
    "line height",
    "page margin",
    "margin",
    "reader theme",
    "theme",
    "progress placement",
    "progress",
    "wheel",
    "reading position",
    "epub reader",
  ],
  Appearance: [
    "appearance",
    "appearance",
    "app theme preset",
    "theme",
    "interface density",
    "density",
    "accent",
    "compact",
    "window",
    "window frame style",
    "frame",
    "hidden",
    "archeion",
    "native",
    "size",
    "position",
    "remember window size and position",
    "chrome",
  ],
  Archives: [
    "archives",
    "archive folder",
    "current archive folder",
    "current archive",
    "manager",
    "archive manager",
    "reveal folder",
  ],
  Storage: [
    "storage",
    "files",
    "metadata",
    "scan on startup",
    "scan",
    "rescan archive",
    "rescan",
    "scanner cache",
    "cache",
    "cover cache status",
    "cover",
    "live filesystem watcher",
    "watcher",
    "live refresh",
    "re-extract epub source metadata",
    "re-extract source metadata",
    "source metadata",
    ".archeion",
    ".archeion folder",
    "archeion folder",
  ],
  Import: [
    "import",
    "default import mode",
    "copy",
    "move",
    "default conflict handling",
    "conflict",
    "default destination folder",
    "destination",
    "epub",
  ],
};

const typefaceOptions = [
  { label: "Book serif", value: "serif" },
  { label: "Clean sans", value: "sans" },
  { label: "System", value: "system" },
];

const themeOptions: Array<{ label: string; value: ReaderTheme }> = [
  { label: "Light", value: "light" },
  { label: "Sepia", value: "sepia" },
  { label: "Dark", value: "dark" },
];

const progressPlacementOptions: Array<{
  label: string;
  value: ReaderProgressPlacement;
}> = [
  { label: "Top", value: "top" },
  { label: "Side", value: "side" },
];

const densityOptions: Array<{ label: string; value: InterfaceDensity }> = [
  { label: "Comfortable", value: "comfortable" },
  { label: "Compact", value: "compact" },
];

const cardSizeOptions: Array<{ label: string; value: BookCardSize }> = [
  { label: "Small", value: "small" },
  { label: "Medium", value: "medium" },
  { label: "Large", value: "large" },
];

const frameOptions: Array<{ label: string; value: WindowFrameStyle }> = [
  { label: "Hidden", value: "hidden" },
  { label: "Archeion", value: "archeion" },
  { label: "Native", value: "native" },
];

const startupOptions: Array<{ label: string; value: StartupBehavior }> = [
  { label: "Open last archive", value: "open-last-archive" },
  { label: "Show Archive Manager", value: "show-archive-manager" },
];

const appThemeOptions: Array<{ label: string; value: AppThemePreset }> = [
  { label: "System", value: "system" },
  { label: "Dark", value: "dark" },
  { label: "Light", value: "light" },
];

const viewOptions: Array<{ label: string; value: LibraryView }> = [
  { label: "Grid", value: "grid" },
  { label: "List", value: "list" },
];

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function sectionMatches(section: SettingsSection, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return searchIndex[section].some((entry) => entry.includes(normalized));
}

function SectionIcon({ section }: { section: SettingsSection }) {
  switch (section) {
    case "General":
      return <SlidersHorizontal aria-hidden="true" size={16} />;
    case "Archives":
      return <Archive aria-hidden="true" size={16} />;
    case "Library":
      return <Database aria-hidden="true" size={16} />;
    case "Reader":
      return <BookOpenText aria-hidden="true" size={16} />;
    case "Appearance":
      return <Palette aria-hidden="true" size={16} />;
    case "Storage":
      return <Broom aria-hidden="true" size={16} />;
    case "Import":
      return <DownloadSimple aria-hidden="true" size={16} />;
  }
}

function SettingsRow({ children, description, label, note }: SettingsRowProps) {
  return (
    <div className="settings-row">
      <div className="settings-row__meta">
        <strong>{label}</strong>
        {description ? (
          <span className="settings-row__description">{description}</span>
        ) : null}
        {note ? <span className="settings-row__note">{note}</span> : null}
      </div>
      <div className="settings-row__control">{children}</div>
    </div>
  );
}

function SliderRow({
  description,
  label,
  max,
  min,
  onChange,
  step,
  suffix = "",
  value,
}: {
  description?: ReactNode;
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  step?: number;
  suffix?: string;
  value: number;
}) {
  return (
    <SettingsRow
      description={description}
      label={label}
      note={`${value}${suffix}`}
    >
      <input
        aria-label={label}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
        step={step}
        type="range"
        value={value}
      />
    </SettingsRow>
  );
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
    useState<SettingsSection>("General");
  const [query, setQuery] = useState("");

  const visibleSections = useMemo(
    () => sections.filter((section) => sectionMatches(section, query)),
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

  function showSection(section: SettingsSection) {
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

  function updateArchiveImport(changes: Partial<ArchiveImportSettings>) {
    const next = { ...archiveImport, ...changes };
    setArchiveImport(next);
    setStatus(null);
    void storage
      .saveArchiveImportSettings(next)
      .then(setArchiveImport)
      .catch(() => setStatus("Import destination could not be saved."));
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
    const opened = await archiveStore.openArchiveManagerWindow();
    if (!opened) setStatus("Archive Manager could not be opened.");
  }

  async function revealArchiveFolder() {
    if (archive.status !== "ready") return;
    const revealed = await archiveStore.revealArchive(archive.archive.id);
    if (!revealed) setStatus("The archive folder could not be opened.");
  }

  async function revealMetadata() {
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

  const selectedSection = visibleSections.includes(activeSection)
    ? activeSection
    : (visibleSections[0] ?? activeSection);
  const sectionHidden = (section: SettingsSection) =>
    selectedSection !== section;

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
                aria-current={selectedSection === section ? "page" : undefined}
                key={section}
                onClick={() => showSection(section)}
                type="button"
              >
                <SectionIcon section={section} />
                {section}
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
          <section
            hidden={sectionHidden("General")}
            className="settings-section"
          >
            <header>
              <h2>General</h2>
            </header>
            <SettingsRow
              description="Choose what opens when Archeion starts."
              label="Startup behavior"
            >
              <AppSelect
                ariaLabel="Startup behavior"
                onChange={(startupBehavior) =>
                  updateAppPreferences({ startupBehavior })
                }
                options={startupOptions}
                value={preferences.startupBehavior}
              />
            </SettingsRow>
            <SettingsRow
              description="Ask before deleting or replacing real files."
              label="Confirm destructive file actions"
            >
              <Toggle
                checked={preferences.confirmDestructiveFileActions}
                label="Confirm destructive file actions"
                onChange={(confirmDestructiveFileActions) =>
                  updateAppPreferences({ confirmDestructiveFileActions })
                }
              />
            </SettingsRow>
            <SettingsRow
              description="Reopen the last book route when the file is still available."
              label="Restore last reader route"
            >
              <Toggle
                checked={preferences.restoreLastReader}
                label="Restore last reader route"
                onChange={(restoreLastReader) =>
                  updateAppPreferences({ restoreLastReader })
                }
              />
            </SettingsRow>
            <SettingsRow label="Reset general settings">
              <Button
                onClick={() =>
                  updateAppPreferences({
                    confirmDestructiveFileActions:
                      defaultAppPreferences.confirmDestructiveFileActions,
                    restoreLastReader: defaultAppPreferences.restoreLastReader,
                    startupBehavior: defaultAppPreferences.startupBehavior,
                  })
                }
                variant="secondary"
              >
                Reset
              </Button>
            </SettingsRow>
          </section>

          <section
            hidden={sectionHidden("Archives")}
            className="settings-section"
          >
            <header>
              <h2>Archives</h2>
            </header>
            <SettingsRow
              description="The active archive root on disk."
              label="Current archive folder"
              note={
                archive.status === "ready" ? (
                  <code>{archive.path}</code>
                ) : (
                  "No archive selected"
                )
              }
            >
              <Button
                icon={<FolderOpen aria-hidden="true" size={17} />}
                onClick={() => void revealArchiveFolder()}
                variant="secondary"
              >
                Reveal in folder
              </Button>
            </SettingsRow>
            <SettingsRow
              description="Manage archive switching, naming, and removal."
              label="Archive Manager"
            >
              <Button
                onClick={() => void openArchiveManager()}
                variant="secondary"
              >
                Open Archive Manager
              </Button>
            </SettingsRow>
          </section>

          <section
            hidden={sectionHidden("Library")}
            className="settings-section"
          >
            <header>
              <h2>Library</h2>
            </header>
            <SettingsRow
              description="Used when browsing an archive."
              label="Default view"
            >
              <SegmentedControl
                label="Default library view"
                onChange={(viewMode) => updateLibrary({ viewMode })}
                options={viewOptions}
                value={library.viewMode}
              />
            </SettingsRow>
            <SettingsRow
              description="Used for Library, Favorites, and folder views."
              label="Default sort"
            >
              <AppSelect<LibrarySort>
                ariaLabel="Default library sort"
                onChange={(sortBy) => updateLibrary({ sortBy })}
                options={librarySortOptions}
                value={library.sortBy}
              />
            </SettingsRow>
            <SettingsRow
              description="Changes cover size in grid view."
              label="Book card size"
            >
              <AppSelect
                ariaLabel="Book card size"
                onChange={(bookCardSize) =>
                  updateAppPreferences({ bookCardSize })
                }
                options={cardSizeOptions}
                value={preferences.bookCardSize}
              />
            </SettingsRow>
            <SettingsRow
              description="Shows started books on the Library page."
              label="Show Continue Reading"
            >
              <Toggle
                checked={preferences.showContinueReading}
                label="Show Continue Reading"
                onChange={(showContinueReading) =>
                  updateAppPreferences({ showContinueReading })
                }
              />
            </SettingsRow>
            <SettingsRow label="Reset library display settings">
              <Button onClick={() => void resetLibrary()} variant="secondary">
                Reset
              </Button>
            </SettingsRow>
          </section>

          <section
            hidden={sectionHidden("Reader")}
            className="settings-section"
          >
            <header>
              <h2>Reader</h2>
            </header>
            <SettingsRow
              description="Sets the default reader typeface."
              label="Font family"
            >
              <AppSelect
                ariaLabel="Reader font family"
                onChange={(fontFamily) => updateReader({ fontFamily })}
                options={typefaceOptions}
                value={reader.fontFamily}
              />
            </SettingsRow>
            <SliderRow
              description="Sets the default text size in the reader."
              label="Font size"
              max={28}
              min={14}
              onChange={(fontSize) => updateReader({ fontSize })}
              suffix="px"
              value={reader.fontSize}
            />
            <SliderRow
              description="Adjusts spacing between lines in the reader."
              label="Line height"
              max={2}
              min={1.4}
              onChange={(lineHeight) => updateReader({ lineHeight })}
              step={0.1}
              value={Number(reader.lineHeight.toFixed(1))}
            />
            <SliderRow
              description="Adjusts page padding inside the reader."
              label="Page margin"
              max={72}
              min={24}
              onChange={(margin) => updateReader({ margin })}
              step={8}
              suffix="px"
              value={reader.margin}
            />
            <SettingsRow
              description="Applies inside the EPUB reader."
              label="Reader theme"
            >
              <SegmentedControl
                label="Reader theme"
                onChange={(theme) => updateReader({ theme })}
                options={themeOptions}
                value={reader.theme}
              />
            </SettingsRow>
            <SettingsRow
              description="Chooses where reading progress appears."
              label="Progress placement"
            >
              <SegmentedControl
                label="Reader progress placement"
                onChange={(progressPlacement) =>
                  updateReader({ progressPlacement })
                }
                options={progressPlacementOptions}
                value={reader.progressPlacement}
              />
            </SettingsRow>
            <SettingsRow label="Reset reader settings">
              <Button onClick={() => void resetReader()} variant="secondary">
                Reset
              </Button>
            </SettingsRow>
          </section>

          <section
            hidden={sectionHidden("Appearance")}
            className="settings-section"
          >
            <header>
              <h2>Appearance</h2>
            </header>
            <div className="settings-section__group">
              <h3>App appearance</h3>
              <SettingsRow
                description="Sets the app interface theme."
                label="App theme preset"
              >
                <AppSelect
                  ariaLabel="App theme preset"
                  onChange={(appThemePreset) =>
                    updateAppPreferences({ appThemePreset })
                  }
                  options={appThemeOptions}
                  value={preferences.appThemePreset}
                />
              </SettingsRow>
              <SettingsRow
                description="Adjusts spacing across the app."
                label="Interface density"
              >
                <SegmentedControl
                  label="Interface density"
                  onChange={(density) => updateAppPreferences({ density })}
                  options={densityOptions}
                  value={preferences.density}
                />
              </SettingsRow>
            </div>

            <div className="settings-section__group">
              <h3>Window behavior</h3>
              <SettingsRow
                description="Controls the desktop window chrome."
                label="Window frame style"
              >
                <AppSelect
                  ariaLabel="Window frame style"
                  onChange={(windowFrameStyle) =>
                    updateAppPreferences({ windowFrameStyle })
                  }
                  options={frameOptions}
                  value={preferences.windowFrameStyle}
                />
              </SettingsRow>
              <SettingsRow
                description="Restores the previous window layout when supported."
                label="Remember window size and position"
              >
                <Toggle
                  checked={preferences.rememberWindowState}
                  label="Remember window size and position"
                  onChange={(rememberWindowState) =>
                    updateAppPreferences({ rememberWindowState })
                  }
                />
              </SettingsRow>
            </div>

            <div className="settings-section__group settings-section__group--actions">
              <h3>Reset</h3>
              <SettingsRow label="Reset appearance settings">
                <Button
                  onClick={() =>
                    updateAppPreferences({
                      appThemePreset: defaultAppPreferences.appThemePreset,
                      density: defaultAppPreferences.density,
                    })
                  }
                  variant="secondary"
                >
                  Reset
                </Button>
              </SettingsRow>
              <SettingsRow label="Reset window settings">
                <Button
                  onClick={() =>
                    updateAppPreferences({
                      rememberWindowState:
                        defaultAppPreferences.rememberWindowState,
                      windowFrameStyle: defaultAppPreferences.windowFrameStyle,
                    })
                  }
                  variant="secondary"
                >
                  Reset
                </Button>
              </SettingsRow>
            </div>
          </section>

          <section
            hidden={sectionHidden("Storage")}
            className="settings-section"
          >
            <header>
              <h2>Storage</h2>
            </header>
            <div className="settings-section__group">
              <h3>Scanning</h3>
              <SettingsRow
                description="Checks the active archive when it opens."
                label="Scan on startup"
              >
                <Toggle
                  checked={files.scanOnStartup}
                  label="Scan on startup"
                  onChange={(scanOnStartup) => updateFiles({ scanOnStartup })}
                />
              </SettingsRow>
              <SettingsRow
                description="Refreshes the archive when files change on disk."
                label="Live filesystem watcher"
              >
                <Toggle
                  checked={files.liveWatcherEnabled}
                  label="Live filesystem watcher"
                  onChange={(liveWatcherEnabled) =>
                    updateFiles({ liveWatcherEnabled })
                  }
                />
              </SettingsRow>
            </div>

            <div className="settings-section__group settings-section__group--actions">
              <h3>Maintenance</h3>
              <SettingsRow
                description="Checks the active archive without changing EPUB files."
                label="Rescan archive"
              >
                <Button
                  icon={<ArrowsClockwise aria-hidden="true" size={17} />}
                  onClick={() => setRescanOpen(true)}
                  variant="secondary"
                >
                  Rescan archive
                </Button>
              </SettingsRow>
              <SettingsRow
                description="Forces EPUB files to be checked again later."
                label="Scanner cache"
              >
                <Button
                  onClick={() => setClearScannerOpen(true)}
                  variant="secondary"
                >
                  Clear scanner cache
                </Button>
              </SettingsRow>
              <SettingsRow
                description="Rebuilds parsed EPUB title and author data."
                label="Re-extract EPUB source metadata"
              >
                <Button
                  onClick={() => setReextractOpen(true)}
                  variant="secondary"
                >
                  Re-extract source metadata
                </Button>
              </SettingsRow>
              <SettingsRow
                description="Shows extracted covers stored for this archive."
                label="Cover cache status"
                note={
                  cache
                    ? `${cache.fileCount} covers, ${formatBytes(cache.totalBytes)}`
                    : "Unavailable"
                }
              >
                <Button
                  icon={<Broom aria-hidden="true" size={17} />}
                  onClick={() => setClearCacheOpen(true)}
                  variant="secondary"
                >
                  Clear cover cache
                </Button>
              </SettingsRow>
              <SettingsRow
                description="Opens the active archive metadata folder."
                label=".archeion folder"
              >
                <Button
                  onClick={() => void revealMetadata()}
                  variant="secondary"
                >
                  Reveal .archeion folder
                </Button>
              </SettingsRow>
            </div>

            <div className="settings-section__group settings-section__group--actions">
              <h3>Reset</h3>
              <SettingsRow label="Reset storage settings">
                <Button onClick={() => void resetFiles()} variant="secondary">
                  Reset
                </Button>
              </SettingsRow>
            </div>
          </section>

          <section
            hidden={sectionHidden("Import")}
            className="settings-section"
          >
            <header>
              <h2>Import</h2>
            </header>
            <SettingsRow
              description="Chooses how new EPUB files are added."
              label="Default import mode"
            >
              <SegmentedControl
                label="Default import mode"
                onChange={(defaultMode) =>
                  updateImportDefaults({ defaultMode })
                }
                options={archiveImportModeOptions}
                value={importSettings.defaultMode}
              />
            </SettingsRow>
            <SettingsRow
              description="Chooses what happens when a file name already exists."
              label="Default conflict handling"
            >
              <AppSelect
                ariaLabel="Default conflict handling"
                onChange={(defaultConflictAction) =>
                  updateImportDefaults({ defaultConflictAction })
                }
                options={archiveImportConflictOptions}
                value={importSettings.defaultConflictAction}
              />
            </SettingsRow>
            <SettingsRow
              description="Stored per archive because folders differ."
              label="Default destination folder"
            >
              <AppSelect
                ariaLabel="Default import destination folder"
                onChange={(value) =>
                  updateArchiveImport({
                    defaultDestinationFolderPath:
                      destinationValueToFolderPath(value),
                  })
                }
                options={destinationOptions}
                value={safeImportDestinationValue}
              />
            </SettingsRow>
            <SettingsRow label="Reset import settings">
              <Button onClick={() => void resetImport()} variant="secondary">
                Reset
              </Button>
            </SettingsRow>
          </section>

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
