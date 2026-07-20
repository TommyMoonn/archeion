import { FolderOpen } from "@phosphor-icons/react";

import { AppSelect } from "../../components/AppSelect";
import { Button } from "../../components/Button";
import { SegmentedControl } from "../../components/SegmentedControl";
import { Toggle } from "../../components/Toggle";
import type { CollectionCardSize, FolderSort, LibrarySort, SeriesSort } from "../../types/library";
import { LIBRARY_SMART_VIEW_DEFINITIONS, LIBRARY_SMART_VIEWS } from "../../types/librarySmartViews";
import type { ReaderSettings } from "../../types/reader";
import {
  archiveImportConflictOptions,
  archiveImportModeOptions,
} from "../filesystem/archiveImport";
import { SettingsRow, SliderRow } from "./SettingsRow";
import type { SettingsDeferredDataRequirement, SettingsItem } from "./settingsItemTypes";
import { storageSettingsItems } from "./settingsItems/storageSettingsItems";
import { appearanceSettingsItems } from "./settingsItems/appearanceSettingsItems";
import { keyboardSettingsItems } from "./settingsItems/keyboardSettingsItems";
import {
  cardSizeOptions,
  defaultLibrarySortOptions,
  folderSortOptions,
  folderViewOptions,
  progressPlacementOptions,
  seriesSortOptions,
  startupOptions,
  typefaceOptions,
  viewOptions,
} from "./settingsOptions";
import type { SettingsSection } from "./settingsSections";
import type { SettingsDialogController } from "./useSettingsDialogController";

export type {
  SettingsDeferredDataRequirement,
  SettingsItem,
  SettingsItemGroupStyle,
} from "./settingsItemTypes";

function updateReader(context: SettingsDialogController, changes: Partial<ReaderSettings>) {
  context.updateReader(changes);
}

function updateSmartViewVisibility(
  context: SettingsDialogController,
  smartView: (typeof LIBRARY_SMART_VIEWS)[number],
  visible: boolean,
) {
  const requested = new Set(context.library.smartViews.visible);
  if (visible) requested.add(smartView);
  else requested.delete(smartView);
  context.updateLibrary({
    smartViews: {
      ...context.library.smartViews,
      visible: LIBRARY_SMART_VIEWS.filter((candidate) => requested.has(candidate)),
    },
  });
}

export const settingsItems: readonly SettingsItem[] = [
  {
    description: "Choose what opens when Archeion starts.",
    id: "general.startup-behavior",
    label: "Startup behavior",
    render: (context) => (
      <SettingsRow description="Choose what opens when Archeion starts." label="Startup behavior">
        <AppSelect
          ariaLabel="Startup behavior"
          onChange={(startupBehavior) => void context.updateAppPreferences({ startupBehavior })}
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
          onChange={(restoreLastReader) => void context.updateAppPreferences({ restoreLastReader })}
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
    description: "Used for Library, Favorites, Smart Views, and books inside folders.",
    groupLabel: "Books",
    id: "library.books.default-view",
    label: "Default book view",
    render: (context) => (
      <SettingsRow
        description="Used for Library, Favorites, Smart Views, and books inside folders."
        label="Default book view"
      >
        <SegmentedControl
          label="Default book view"
          onChange={(viewMode) => context.updateLibraryCollection("books", { viewMode })}
          options={viewOptions}
          value={context.library.collections.books.viewMode}
        />
      </SettingsRow>
    ),
    searchTerms: ["books", "book view", "library view", "grid", "list"],
    sectionId: "library",
  },
  {
    description: "Used for Library, Favorites, Smart Views, and books inside folders.",
    groupLabel: "Books",
    id: "library.books.default-sort",
    label: "Default book sort",
    render: (context) => (
      <SettingsRow
        description="Used for Library, Favorites, Smart Views, and books inside folders."
        label="Default book sort"
      >
        <AppSelect<LibrarySort>
          ariaLabel="Default book sort"
          onChange={(sortBy) => context.updateLibraryCollection("books", { sortBy })}
          options={defaultLibrarySortOptions}
          value={context.library.collections.books.sortBy}
        />
      </SettingsRow>
    ),
    searchTerms: ["books", "book sort", "title", "author", "recently opened"],
    sectionId: "library",
  },
  {
    description: "Changes book cover size in grid view.",
    groupLabel: "Books",
    id: "library.books.card-size",
    label: "Book card size",
    render: (context) => (
      <SettingsRow description="Changes book cover size in grid view." label="Book card size">
        <AppSelect<CollectionCardSize>
          ariaLabel="Book card size"
          onChange={(cardSize) => context.updateLibraryCollection("books", { cardSize })}
          options={cardSizeOptions}
          value={context.library.collections.books.cardSize}
        />
      </SettingsRow>
    ),
    searchTerms: ["books", "book card size", "cover size", "small", "medium", "large"],
    sectionId: "library",
  },
  {
    description: "Used when browsing the folders collection.",
    groupLabel: "Folders",
    id: "library.folders.default-view",
    label: "Default folder view",
    render: (context) => (
      <SettingsRow
        description="Used when browsing the folders collection."
        label="Default folder view"
      >
        <SegmentedControl
          label="Default folder view"
          onChange={(viewMode) => context.updateLibraryCollection("folders", { viewMode })}
          options={folderViewOptions}
          value={context.library.collections.folders.viewMode}
        />
      </SettingsRow>
    ),
    searchTerms: ["folders", "folder view", "cards", "list"],
    sectionId: "library",
  },
  {
    description: "Sets the ordering of folder summaries.",
    groupLabel: "Folders",
    id: "library.folders.default-sort",
    label: "Default folder sort",
    render: (context) => (
      <SettingsRow description="Sets the ordering of folder summaries." label="Default folder sort">
        <AppSelect<FolderSort>
          ariaLabel="Default folder sort"
          onChange={(sortBy) => context.updateLibraryCollection("folders", { sortBy })}
          options={folderSortOptions}
          value={context.library.collections.folders.sortBy}
        />
      </SettingsRow>
    ),
    searchTerms: ["folders", "folder sort", "name", "path", "book count", "most books"],
    sectionId: "library",
  },
  {
    description: "Changes folder card density without affecting list view.",
    groupLabel: "Folders",
    id: "library.folders.card-size",
    label: "Folder card size",
    render: (context) => (
      <SettingsRow
        description="Changes folder card density without affecting list view."
        label="Folder card size"
      >
        <AppSelect<CollectionCardSize>
          ariaLabel="Folder card size"
          onChange={(cardSize) => context.updateLibraryCollection("folders", { cardSize })}
          options={cardSizeOptions}
          value={context.library.collections.folders.cardSize}
        />
      </SettingsRow>
    ),
    searchTerms: ["folders", "folder card size", "small", "medium", "large"],
    sectionId: "library",
  },
  {
    description: "Used when browsing series summaries.",
    groupLabel: "Series",
    id: "library.series.default-view",
    label: "Default series view",
    render: (context) => (
      <SettingsRow description="Used when browsing series summaries." label="Default series view">
        <SegmentedControl
          label="Default series view"
          onChange={(viewMode) => context.updateLibraryCollection("series", { viewMode })}
          options={viewOptions}
          value={context.library.collections.series.viewMode}
        />
      </SettingsRow>
    ),
    searchTerms: ["series", "series view", "grid", "list"],
    sectionId: "library",
  },
  {
    description: "Sets the ordering of series summaries without changing volume order.",
    groupLabel: "Series",
    id: "library.series.default-sort",
    label: "Default series sort",
    render: (context) => (
      <SettingsRow
        description="Sets the ordering of series summaries without changing volume order."
        label="Default series sort"
      >
        <AppSelect<SeriesSort>
          ariaLabel="Default series sort"
          onChange={(sortBy) => context.updateLibraryCollection("series", { sortBy })}
          options={seriesSortOptions}
          value={context.library.collections.series.sortBy}
        />
      </SettingsRow>
    ),
    searchTerms: ["series", "series sort", "recently opened", "volume count", "most volumes"],
    sectionId: "library",
  },
  {
    description: "Changes series overview cover size and card density.",
    groupLabel: "Series",
    id: "library.series.card-size",
    label: "Series card size",
    render: (context) => (
      <SettingsRow
        description="Changes series overview cover size and card density."
        label="Series card size"
      >
        <AppSelect<CollectionCardSize>
          ariaLabel="Series card size"
          onChange={(cardSize) => context.updateLibraryCollection("series", { cardSize })}
          options={cardSizeOptions}
          value={context.library.collections.series.cardSize}
        />
      </SettingsRow>
    ),
    searchTerms: ["series", "series card size", "cover size", "small", "medium", "large"],
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
    description: "Show selected built-in views in Library navigation.",
    groupLabel: "Smart Views",
    id: "library.smart-views.enabled",
    label: "Show Smart Views",
    render: (context) => (
      <SettingsRow
        description="Show selected built-in views in Library navigation."
        label="Show Smart Views"
      >
        <Toggle
          checked={context.library.smartViews.enabled}
          label="Show Smart Views"
          onChange={(enabled) =>
            context.updateLibrary({
              smartViews: { ...context.library.smartViews, enabled },
            })
          }
        />
      </SettingsRow>
    ),
    searchTerms: ["smart views", "navigation views", "built-in views"],
    sectionId: "library",
  },
  ...LIBRARY_SMART_VIEW_DEFINITIONS.map((definition): SettingsItem => ({
    description: "Choose whether this view appears when Smart Views are shown.",
    groupLabel: "Smart Views",
    id: `library.smart-views.${definition.id}`,
    label: definition.label,
    render: (context) => {
      const preferences = context.library.smartViews;
      const checked = preferences.visible.includes(definition.id);
      const isLastVisible = checked && preferences.visible.length === 1;
      const disabledReason = !preferences.enabled
        ? "Turn on Show Smart Views to choose visible views."
        : isLastVisible
          ? "At least one Smart View must remain selected. Turn off Show Smart Views instead."
          : undefined;
      return (
        <SettingsRow
          description="Choose whether this view appears when Smart Views are shown."
          label={definition.label}
        >
          <Toggle
            checked={checked}
            disabled={Boolean(disabledReason)}
            disabledReason={disabledReason}
            label={`Show ${definition.label} Smart View`}
            onChange={(visible) => updateSmartViewVisibility(context, definition.id, visible)}
          />
        </SettingsRow>
      );
    },
    searchTerms: [definition.id, ...definition.searchTerms],
    sectionId: "library",
  })),
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
      <SettingsRow description="Sets the default reader typeface." label="Font family">
        <AppSelect
          ariaLabel="Reader font family"
          onChange={(fontFamily) => updateReader(context, { fontFamily })}
          options={typefaceOptions}
          value={context.reader.fontFamily}
        />
      </SettingsRow>
    ),
    searchTerms: ["font", "typeface", "serif", "sans", "literata", "atkinson", "hyperlegible"],
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
  ...appearanceSettingsItems,
  {
    description: "Chooses where reading progress appears.",
    id: "reader.progress-placement",
    label: "Progress placement",
    render: (context) => (
      <SettingsRow description="Chooses where reading progress appears." label="Progress placement">
        <SegmentedControl
          label="Reader progress placement"
          onChange={(progressPlacement) => updateReader(context, { progressPlacement })}
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
          icon={<FolderOpen aria-hidden="true" />}
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
  ...storageSettingsItems,
  {
    description: "Chooses how new EPUB files are added.",
    id: "import.default-import-mode",
    label: "Default import mode",
    render: (context) => (
      <SettingsRow description="Chooses how new EPUB files are added." label="Default import mode">
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
  ...keyboardSettingsItems,
] as const;

export function getSettingsItemsForSection(sectionId: SettingsSection) {
  return settingsItems.filter((item) => item.sectionId === sectionId);
}

export function getSettingsItemsDataRequirements(
  items: readonly SettingsItem[],
): ReadonlySet<SettingsDeferredDataRequirement> {
  return new Set(items.flatMap((item) => [...(item.deferredData ?? [])]));
}
