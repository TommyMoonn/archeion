import { ArrowsClockwise, Broom, FolderOpen } from "@phosphor-icons/react";
import { type ReactNode } from "react";

import { AppSelect } from "../../components/AppSelect";
import { Button } from "../../components/Button";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Toggle } from "../../components/Toggle";
import type {
  AppThemePreset,
  BookCardSize,
  InterfaceDensity,
  WindowFrameStyle,
} from "../../types/appSettings";
import type { LibrarySort } from "../../types/library";
import type { ReaderSettings } from "../../types/reader";
import {
  archiveImportConflictOptions,
  archiveImportModeOptions,
} from "../filesystem/archiveImport";
import { SettingsRow, SliderRow } from "./SettingsRow";
import {
  appThemeOptions,
  cardSizeOptions,
  defaultLibrarySortOptions,
  densityOptions,
  frameOptions,
  progressPlacementOptions,
  readerThemeOptions,
  startupOptions,
  typefaceOptions,
  viewOptions,
} from "./settingsOptions";
import type { SettingsSection } from "./settingsSections";
import type { SettingsDialogController } from "./useSettingsDialogController";

export type SettingsItemGroupStyle = "standard" | "actions";

export type SettingsDeferredDataRequirement =
  | "archiveImportSettings"
  | "coverCacheStatus"
  | "folders";

export type SettingsItem = {
  deferredData?: readonly SettingsDeferredDataRequirement[];
  description?: string;
  groupLabel?: string;
  groupStyle?: SettingsItemGroupStyle;
  id: string;
  label: string;
  render: (context: SettingsDialogController) => ReactNode;
  searchTerms?: readonly string[];
  sectionId: SettingsSection;
};

function updateReader(
  context: SettingsDialogController,
  changes: Partial<ReaderSettings>,
) {
  context.updateReader(changes);
}

export const settingsItems: readonly SettingsItem[] = [
  {
    description: "Choose what opens when Archeion starts.",
    id: "general.startup-behavior",
    label: "Startup behavior",
    render: (context) => (
      <SettingsRow
        description="Choose what opens when Archeion starts."
        label="Startup behavior"
      >
        <AppSelect
          ariaLabel="Startup behavior"
          onChange={(startupBehavior) =>
            void context.updateAppPreferences({ startupBehavior })
          }
          options={startupOptions}
          value={context.preferences.startupBehavior}
        />
      </SettingsRow>
    ),
    searchTerms: ["startup", "open last archive", "show archive manager"],
    sectionId: "general",
  },
  {
    description: "Ask before deleting or replacing real files.",
    id: "general.confirm-destructive-file-actions",
    label: "Confirm destructive file actions",
    render: (context) => (
      <SettingsRow
        description="Ask before deleting or replacing real files."
        label="Confirm destructive file actions"
      >
        <Toggle
          checked={context.preferences.confirmDestructiveFileActions}
          label="Confirm destructive file actions"
          onChange={(confirmDestructiveFileActions) =>
            void context.updateAppPreferences({ confirmDestructiveFileActions })
          }
        />
      </SettingsRow>
    ),
    searchTerms: ["confirm", "destructive", "delete", "replace"],
    sectionId: "general",
  },
  {
    description: "Reopen the last book route when the file is still available.",
    id: "general.restore-last-reader-route",
    label: "Restore last reader route",
    render: (context) => (
      <SettingsRow
        description="Reopen the last book route when the file is still available."
        label="Restore last reader route"
      >
        <Toggle
          checked={context.preferences.restoreLastReader}
          label="Restore last reader route"
          onChange={(restoreLastReader) =>
            void context.updateAppPreferences({ restoreLastReader })
          }
        />
      </SettingsRow>
    ),
    searchTerms: ["restore reader", "last reader", "reopen last book route"],
    sectionId: "general",
  },
  {
    id: "general.reset",
    label: "Reset general settings",
    render: (context) => (
      <SettingsRow label="Reset general settings">
        <Button onClick={() => void context.resetGeneral()} variant="secondary">
          Reset
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["reset"],
    sectionId: "general",
  },
  {
    description: "Used when browsing an archive.",
    id: "library.default-view",
    label: "Default view",
    render: (context) => (
      <SettingsRow description="Used when browsing an archive." label="Default view">
        <SegmentedControl
          label="Default library view"
          onChange={(viewMode) => context.updateLibrary({ viewMode })}
          options={viewOptions}
          value={context.library.viewMode}
        />
      </SettingsRow>
    ),
    searchTerms: ["library view", "grid", "list"],
    sectionId: "library",
  },
  {
    description: "Used for Library, Favorites, and folder views.",
    id: "library.default-sort",
    label: "Default sort",
    render: (context) => (
      <SettingsRow
        description="Used for Library, Favorites, and folder views."
        label="Default sort"
      >
        <AppSelect<LibrarySort>
          ariaLabel="Default library sort"
          onChange={(sortBy) => context.updateLibrary({ sortBy })}
          options={defaultLibrarySortOptions}
          value={context.library.sortBy}
        />
      </SettingsRow>
    ),
    searchTerms: ["sort", "title", "author", "recently opened"],
    sectionId: "library",
  },
  {
    description: "Changes cover size in grid view.",
    id: "library.book-card-size",
    label: "Book card size",
    render: (context) => (
      <SettingsRow description="Changes cover size in grid view." label="Book card size">
        <AppSelect<BookCardSize>
          ariaLabel="Book card size"
          onChange={(bookCardSize) =>
            void context.updateAppPreferences({ bookCardSize })
          }
          options={cardSizeOptions}
          value={context.preferences.bookCardSize}
        />
      </SettingsRow>
    ),
    searchTerms: ["card size", "cover size", "small", "medium", "large"],
    sectionId: "library",
  },
  {
    description: "Shows started books on the Library page.",
    id: "library.show-continue-reading",
    label: "Show Continue Reading",
    render: (context) => (
      <SettingsRow
        description="Shows started books on the Library page."
        label="Show Continue Reading"
      >
        <Toggle
          checked={context.preferences.showContinueReading}
          label="Show Continue Reading"
          onChange={(showContinueReading) =>
            void context.updateAppPreferences({ showContinueReading })
          }
        />
      </SettingsRow>
    ),
    searchTerms: ["continue reading", "started books"],
    sectionId: "library",
  },
  {
    id: "library.reset",
    label: "Reset library display settings",
    render: (context) => (
      <SettingsRow label="Reset library display settings">
        <Button onClick={() => void context.resetLibrary()} variant="secondary">
          Reset
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["reset"],
    sectionId: "library",
  },
  {
    description: "Sets the default reader typeface.",
    id: "reader.font-family",
    label: "Font family",
    render: (context) => (
      <SettingsRow
        description="Sets the default reader typeface."
        label="Font family"
      >
        <AppSelect
          ariaLabel="Reader font family"
          onChange={(fontFamily) => updateReader(context, { fontFamily })}
          options={typefaceOptions}
          value={context.reader.fontFamily}
        />
      </SettingsRow>
    ),
    searchTerms: ["font", "typeface", "serif", "sans"],
    sectionId: "reader",
  },
  {
    description: "Sets the default text size in the reader.",
    id: "reader.font-size",
    label: "Font size",
    render: (context) => (
      <SliderRow
        description="Sets the default text size in the reader."
        label="Font size"
        max={28}
        min={14}
        onChange={(fontSize) => updateReader(context, { fontSize })}
        suffix="px"
        value={context.reader.fontSize}
      />
    ),
    searchTerms: ["font", "text size"],
    sectionId: "reader",
  },
  {
    description: "Adjusts spacing between lines in the reader.",
    id: "reader.line-height",
    label: "Line height",
    render: (context) => (
      <SliderRow
        description="Adjusts spacing between lines in the reader."
        label="Line height"
        max={2}
        min={1.4}
        onChange={(lineHeight) => updateReader(context, { lineHeight })}
        step={0.1}
        value={Number(context.reader.lineHeight.toFixed(1))}
      />
    ),
    searchTerms: ["spacing", "lines"],
    sectionId: "reader",
  },
  {
    description: "Adjusts page padding inside the reader.",
    id: "reader.page-margin",
    label: "Page margin",
    render: (context) => (
      <SliderRow
        description="Adjusts page padding inside the reader."
        label="Page margin"
        max={72}
        min={24}
        onChange={(margin) => updateReader(context, { margin })}
        step={8}
        suffix="px"
        value={context.reader.margin}
      />
    ),
    searchTerms: ["margin", "padding"],
    sectionId: "reader",
  },
  {
    description: "Applies inside the EPUB reader.",
    id: "reader.theme",
    label: "Reader theme",
    render: (context) => (
      <SettingsRow description="Applies inside the EPUB reader." label="Reader theme">
        <SegmentedControl
          label="Reader theme"
          onChange={(theme) => updateReader(context, { theme })}
          options={readerThemeOptions}
          value={context.reader.theme}
        />
      </SettingsRow>
    ),
    searchTerms: ["theme", "light", "sepia", "dark", "epub reader"],
    sectionId: "reader",
  },
  {
    description: "Chooses where reading progress appears.",
    id: "reader.progress-placement",
    label: "Progress placement",
    render: (context) => (
      <SettingsRow
        description="Chooses where reading progress appears."
        label="Progress placement"
      >
        <SegmentedControl
          label="Reader progress placement"
          onChange={(progressPlacement) =>
            updateReader(context, { progressPlacement })
          }
          options={progressPlacementOptions}
          value={context.reader.progressPlacement}
        />
      </SettingsRow>
    ),
    searchTerms: ["progress", "reading position", "top", "side"],
    sectionId: "reader",
  },
  {
    id: "reader.reset",
    label: "Reset reader settings",
    render: (context) => (
      <SettingsRow label="Reset reader settings">
        <Button onClick={() => void context.resetReader()} variant="secondary">
          Reset
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["reset"],
    sectionId: "reader",
  },
  {
    description: "Sets the app theme.",
    groupLabel: "App appearance",
    id: "appearance.app-theme-preset",
    label: "App theme preset",
    render: (context) => (
      <SettingsRow description="Sets the app theme." label="App theme preset">
        <AppSelect<AppThemePreset>
          ariaLabel="App theme preset"
          onChange={(appThemePreset) =>
            void context.updateAppPreferences({ appThemePreset })
          }
          options={appThemeOptions}
          value={context.preferences.appThemePreset}
        />
      </SettingsRow>
    ),
    searchTerms: ["theme", "system", "dark", "light"],
    sectionId: "appearance",
  },
  {
    description: "Enable subtle app transitions.",
    groupLabel: "App appearance",
    id: "appearance.animations",
    label: "Animations",
    render: (context) => (
      <SettingsRow
        description="Enable subtle app transitions."
        label="Animations"
      >
        <Toggle
          checked={context.preferences.appearance.animationsEnabled}
          label="Animations"
          onChange={(animationsEnabled) =>
            void context.updateAppPreferences({
              appearance: { animationsEnabled },
            })
          }
        />
      </SettingsRow>
    ),
    searchTerms: ["animations", "motion", "transitions", "app appearance"],
    sectionId: "appearance",
  },
  {
    description: "Adjusts spacing across the app.",
    groupLabel: "App appearance",
    id: "appearance.display-density",
    label: "Display density",
    render: (context) => (
      <SettingsRow
        description="Adjusts spacing across the app."
        label="Display density"
      >
        <SegmentedControl<InterfaceDensity>
          label="Display density"
          onChange={(density) => void context.updateAppPreferences({ density })}
          options={densityOptions}
          value={context.preferences.density}
        />
      </SettingsRow>
    ),
    searchTerms: ["density", "comfortable", "compact", "app appearance"],
    sectionId: "appearance",
  },
  {
    description: "Controls the desktop window chrome.",
    groupLabel: "Window behavior",
    id: "appearance.window-frame-style",
    label: "Window frame style",
    render: (context) => (
      <SettingsRow
        description="Controls the desktop window chrome."
        label="Window frame style"
      >
        <AppSelect<WindowFrameStyle>
          ariaLabel="Window frame style"
          onChange={(windowFrameStyle) =>
            void context.updateAppPreferences({ windowFrameStyle })
          }
          options={frameOptions}
          value={context.preferences.windowFrameStyle}
        />
      </SettingsRow>
    ),
    searchTerms: ["window", "frame", "chrome", "hidden", "archeion", "native"],
    sectionId: "appearance",
  },
  {
    description: "Restores the previous window layout when supported.",
    groupLabel: "Window behavior",
    id: "appearance.remember-window-state",
    label: "Remember window size and position",
    render: (context) => (
      <SettingsRow
        description="Restores the previous window layout when supported."
        label="Remember window size and position"
      >
        <Toggle
          checked={context.preferences.rememberWindowState}
          label="Remember window size and position"
          onChange={(rememberWindowState) =>
            void context.updateAppPreferences({ rememberWindowState })
          }
        />
      </SettingsRow>
    ),
    searchTerms: ["window", "size", "position", "window behavior"],
    sectionId: "appearance",
  },
  {
    groupLabel: "Reset",
    groupStyle: "actions",
    id: "appearance.reset-appearance",
    label: "Reset appearance settings",
    render: (context) => (
      <SettingsRow label="Reset appearance settings">
        <Button onClick={() => void context.resetAppearance()} variant="secondary">
          Reset
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["reset", "app appearance"],
    sectionId: "appearance",
  },
  {
    groupLabel: "Reset",
    groupStyle: "actions",
    id: "appearance.reset-window",
    label: "Reset window settings",
    render: (context) => (
      <SettingsRow label="Reset window settings">
        <Button onClick={() => void context.resetWindow()} variant="secondary">
          Reset
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["reset", "window behavior"],
    sectionId: "appearance",
  },
  {
    description: "The active archive root on disk.",
    id: "archives.current-archive-folder",
    label: "Current archive folder",
    render: (context) => (
      <SettingsRow
        description="The active archive root on disk."
        label="Current archive folder"
        note={
          context.selectedArchivePath ? (
            <code>{context.selectedArchivePath}</code>
          ) : (
            "No archive selected"
          )
        }
      >
        <Button
          disabled={!context.selectedArchivePath}
          icon={<FolderOpen aria-hidden="true" size={17} />}
          onClick={() => void context.revealArchiveFolder()}
          variant="secondary"
        >
          Reveal in folder
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["archive folder", "current archive", "reveal folder"],
    sectionId: "archives",
  },
  {
    description: "Manage archive switching, naming, and removal.",
    id: "archives.archive-manager",
    label: "Archive Manager",
    render: (context) => (
      <SettingsRow
        description="Manage archive switching, naming, and removal."
        label="Archive Manager"
      >
        <Button onClick={() => void context.openArchiveManager()} variant="secondary">
          Open Archive Manager
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["archive manager", "switching", "naming", "removal"],
    sectionId: "archives",
  },
  {
    description: "Checks the active archive when it opens.",
    groupLabel: "Scan preferences",
    id: "storage.scan-on-startup",
    label: "Scan on startup",
    render: (context) => (
      <SettingsRow
        description="Checks the active archive when it opens."
        label="Scan on startup"
      >
        <Toggle
          checked={context.files.scanOnStartup}
          label="Scan on startup"
          onChange={(scanOnStartup) => context.updateFiles({ scanOnStartup })}
        />
      </SettingsRow>
    ),
    searchTerms: ["scan", "startup", "scan preferences"],
    sectionId: "storage",
  },
  {
    description: "Refreshes the archive when files change on disk.",
    groupLabel: "Scan preferences",
    id: "storage.live-filesystem-watcher",
    label: "Live filesystem watcher",
    render: (context) => (
      <SettingsRow
        description="Refreshes the archive when files change on disk."
        label="Live filesystem watcher"
      >
        <Toggle
          checked={context.files.liveWatcherEnabled}
          label="Live filesystem watcher"
          onChange={(liveWatcherEnabled) =>
            context.updateFiles({ liveWatcherEnabled })
          }
        />
      </SettingsRow>
    ),
    searchTerms: ["live refresh", "filesystem", "watcher", "scan preferences"],
    sectionId: "storage",
  },
  {
    description: "Checks the active archive without changing EPUB files.",
    groupLabel: "Archive maintenance",
    groupStyle: "actions",
    id: "storage.rescan-archive",
    label: "Rescan archive",
    render: (context) => (
      <SettingsRow
        description="Checks the active archive without changing EPUB files."
        label="Rescan archive"
      >
        <Button
          icon={<ArrowsClockwise aria-hidden="true" size={17} />}
          onClick={() => context.openConfirmation("rescanArchive")}
          variant="secondary"
        >
          Rescan archive
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["rescan", "scan", "archive maintenance"],
    sectionId: "storage",
  },
  {
    description: "Forces EPUB files to be checked again later.",
    groupLabel: "Archive maintenance",
    groupStyle: "actions",
    id: "storage.scanner-cache",
    label: "Scanner cache",
    render: (context) => (
      <SettingsRow
        description="Forces EPUB files to be checked again later."
        label="Scanner cache"
      >
        <Button
          onClick={() => context.openConfirmation("clearScannerCache")}
          variant="secondary"
        >
          Clear scanner cache
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["clear scanner cache", "cache", "archive maintenance"],
    sectionId: "storage",
  },
  {
    description: "Rebuilds parsed EPUB title and author data.",
    groupLabel: "Archive maintenance",
    groupStyle: "actions",
    id: "storage.reextract-source-metadata",
    label: "Re-extract EPUB source metadata",
    render: (context) => (
      <SettingsRow
        description="Rebuilds parsed EPUB title and author data."
        label="Re-extract EPUB source metadata"
      >
        <Button
          onClick={() => context.openConfirmation("reextractMetadata")}
          variant="secondary"
        >
          Re-extract source metadata
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["source metadata", "re-extract", "epub metadata", "archive maintenance"],
    sectionId: "storage",
  },
  {
    description: "Shows extracted covers stored for this archive.",
    groupLabel: "Archive maintenance",
    groupStyle: "actions",
    deferredData: ["coverCacheStatus"],
    id: "storage.cover-cache-status",
    label: "Cover cache status",
    render: (context) => (
      <SettingsRow
        description="Shows extracted covers stored for this archive."
        label="Cover cache status"
        note={
          context.cache
            ? `${context.cache.fileCount} covers, ${formatBytes(context.cache.totalBytes)}`
            : "Unavailable"
        }
      >
        <Button
          icon={<Broom aria-hidden="true" size={17} />}
          onClick={() => context.openConfirmation("clearCoverCache")}
          variant="secondary"
        >
          Clear cover cache
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["cover", "cache", "clear cover cache", "archive maintenance"],
    sectionId: "storage",
  },
  {
    description: "Opens the active archive metadata folder.",
    groupLabel: "Archive maintenance",
    groupStyle: "actions",
    id: "storage.metadata-folder",
    label: ".archeion folder",
    render: (context) => (
      <SettingsRow
        description="Opens the active archive metadata folder."
        label=".archeion folder"
      >
        <Button onClick={() => void context.revealMetadata()} variant="secondary">
          Reveal .archeion folder
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["metadata folder", "archeion folder", ".archeion", "archive maintenance"],
    sectionId: "storage",
  },
  {
    groupLabel: "Reset",
    groupStyle: "actions",
    id: "storage.reset",
    label: "Reset storage settings",
    render: (context) => (
      <SettingsRow label="Reset storage settings">
        <Button onClick={() => void context.resetStorage()} variant="secondary">
          Reset
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["reset"],
    sectionId: "storage",
  },
  {
    description: "Chooses how new EPUB files are added.",
    id: "import.default-import-mode",
    label: "Default import mode",
    render: (context) => (
      <SettingsRow
        description="Chooses how new EPUB files are added."
        label="Default import mode"
      >
        <SegmentedControl
          label="Default import mode"
          onChange={(defaultMode) => context.updateImportDefaults({ defaultMode })}
          options={archiveImportModeOptions}
          value={context.importSettings.defaultMode}
        />
      </SettingsRow>
    ),
    searchTerms: ["import mode", "copy", "move", "epub"],
    sectionId: "import",
  },
  {
    description: "Chooses what happens when a file name already exists.",
    id: "import.default-conflict-handling",
    label: "Default conflict handling",
    render: (context) => (
      <SettingsRow
        description="Chooses what happens when a file name already exists."
        label="Default conflict handling"
      >
        <AppSelect
          ariaLabel="Default conflict handling"
          onChange={(defaultConflictAction) =>
            context.updateImportDefaults({ defaultConflictAction })
          }
          options={archiveImportConflictOptions}
          value={context.importSettings.defaultConflictAction}
        />
      </SettingsRow>
    ),
    searchTerms: ["conflict", "file name", "already exists"],
    sectionId: "import",
  },
  {
    description: "Stored per archive because folders differ.",
    deferredData: ["archiveImportSettings", "folders"],
    id: "import.default-destination-folder",
    label: "Default destination folder",
    render: (context) => (
      <SettingsRow
        description="Stored per archive because folders differ."
        label="Default destination folder"
      >
        <AppSelect
          ariaLabel="Default import destination folder"
          onChange={context.updateImportDestination}
          options={context.destinationOptions}
          value={context.safeImportDestinationValue}
        />
      </SettingsRow>
    ),
    searchTerms: ["destination", "folder", "archive folder"],
    sectionId: "import",
  },
  {
    id: "import.reset",
    label: "Reset import settings",
    render: (context) => (
      <SettingsRow label="Reset import settings">
        <Button onClick={() => void context.resetImport()} variant="secondary">
          Reset
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["reset"],
    sectionId: "import",
  },
] as const;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getSettingsItemsForSection(sectionId: SettingsSection) {
  return settingsItems.filter((item) => item.sectionId === sectionId);
}

export function getSettingsItemsDataRequirements(
  items: readonly SettingsItem[],
): ReadonlySet<SettingsDeferredDataRequirement> {
  return new Set(
    items.flatMap((item) => [...(item.deferredData ?? [])]),
  );
}
