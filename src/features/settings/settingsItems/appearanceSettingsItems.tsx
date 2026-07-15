import { AppSelect, type AppSelectOption } from "../../../components/AppSelect";
import { Button } from "../../../components/Button";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { Toggle } from "../../../components/Toggle";
import type {
  AppThemePreset,
  InterfaceDensity,
  WindowFrameStyle,
} from "../../../types/appSettings";
import type {
  ArchiveAppThemeSelection,
  ArchiveReaderThemeSelection,
} from "../../../types/settings";
import type { ThemeCatalogEntry } from "../../../themes/themeCatalogReadModel";
import { SettingsRow } from "../SettingsRow";
import {
  appThemeOptions,
  densityOptions,
  frameOptions,
  readerThemeOptions,
} from "../settingsOptions";
import type { SettingsItem } from "../settingsItemTypes";
import type { SettingsDialogController } from "../useSettingsDialogController";

const INHERIT_VALUE = "inherit";
const SYSTEM_VALUE = "system";

export const appearanceSettingsItems = [
  {
    deferredData: ["archiveAppearanceSettings"],
    description: "Used when the active archive does not override its reader colors.",
    id: "reader.theme",
    label: "Default reader theme",
    render: (context) => (
      <SettingsRow
        description="Used when the active archive does not override its reader colors."
        label="Default reader theme"
        note={readerFallbackNote(context)}
      >
        <SegmentedControl
          label="Default reader theme"
          onChange={(theme) => context.updateReader({ theme })}
          options={readerThemeOptions}
          value={context.reader.theme}
        />
      </SettingsRow>
    ),
    searchTerms: ["theme", "light", "sepia", "dark", "epub reader", "fallback"],
    sectionId: "reader",
  },
  {
    deferredData: ["archiveAppearanceSettings"],
    description: "Overrides the default reader theme for this archive only.",
    id: "reader.archive-theme",
    label: "Reader color theme for this archive",
    render: (context) => (
      <SettingsRow
        description="Overrides the default reader theme for this archive only."
        label="Reader color theme for this archive"
        note={catalogNote(context)}
      >
        {context.archiveAppearance ? (
          <AppSelect
            ariaLabel="Reader color theme for this archive"
            onChange={(value) =>
              void context.updateArchiveAppearance({ readerTheme: decodeReaderSelection(value) })
            }
            options={readerArchiveOptions(context)}
            value={encodeSelection(context.archiveAppearance.readerTheme)}
          />
        ) : (
          <span className="settings-row__unavailable">Unavailable</span>
        )}
      </SettingsRow>
    ),
    searchTerms: ["archive reader theme", "reader override", "custom reader theme"],
    sectionId: "reader",
  },
  {
    deferredData: ["archiveAppearanceSettings"],
    description: "Used when the active archive follows the app default.",
    groupLabel: "App appearance",
    id: "appearance.app-theme-preset",
    label: "App theme preset",
    render: (context) => (
      <SettingsRow
        description="Used when the active archive follows the app default."
        label="App theme preset"
        note={appFallbackNote(context)}
      >
        <AppSelect<AppThemePreset>
          ariaLabel="App theme preset"
          onChange={(appThemePreset) => void context.updateAppPreferences({ appThemePreset })}
          options={appThemeOptions}
          value={context.preferences.appThemePreset}
        />
      </SettingsRow>
    ),
    searchTerms: ["theme", "system", "dark", "light", "fallback"],
    sectionId: "appearance",
  },
  {
    description: "Enable subtle app transitions.",
    groupLabel: "App appearance",
    id: "appearance.animations",
    label: "Animations",
    render: (context) => (
      <SettingsRow description="Enable subtle app transitions." label="Animations">
        <Toggle
          checked={context.preferences.appearance.animationsEnabled}
          label="Animations"
          onChange={(animationsEnabled) =>
            void context.updateAppPreferences({ appearance: { animationsEnabled } })
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
      <SettingsRow description="Adjusts spacing across the app." label="Display density">
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
    deferredData: ["archiveAppearanceSettings"],
    description: "Overrides the app default for this archive only.",
    groupLabel: "Archive appearance",
    id: "appearance.archive-app-theme",
    label: "Application theme for this archive",
    render: (context) => (
      <SettingsRow
        description="Overrides the app default for this archive only."
        label="Application theme for this archive"
        note={catalogNote(context)}
      >
        {context.archiveAppearance ? (
          <AppSelect
            ariaLabel="Application theme for this archive"
            onChange={(value) =>
              void context.updateArchiveAppearance({ appTheme: decodeAppSelection(value) })
            }
            options={appArchiveOptions(context)}
            value={encodeSelection(context.archiveAppearance.appTheme)}
          />
        ) : (
          <span className="settings-row__unavailable">Unavailable</span>
        )}
      </SettingsRow>
    ),
    searchTerms: ["archive app theme", "application override", "custom theme"],
    sectionId: "appearance",
  },
  {
    description: "Import, inspect, preview, and maintain themes stored with this archive.",
    groupLabel: "Archive appearance",
    groupStyle: "actions",
    id: "appearance.manage-archive-themes",
    label: "Manage archive themes",
    render: (context) => (
      <SettingsRow
        description="Import, inspect, preview, and maintain themes stored with this archive."
        label="Manage archive themes"
      >
        <Button
          disabled={!context.selectedArchivePath || context.themeCatalogLoading}
          onClick={context.openThemeManager}
          variant="secondary"
        >
          Manage archive themes
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["theme manager", "import theme", "custom themes", "starter theme"],
    sectionId: "appearance",
  },
  {
    description: "Controls the desktop window chrome.",
    groupLabel: "Window behavior",
    id: "appearance.window-frame-style",
    label: "Window frame style",
    render: (context) => (
      <SettingsRow description="Controls the desktop window chrome." label="Window frame style">
        <AppSelect<WindowFrameStyle>
          ariaLabel="Window frame style"
          onChange={(windowFrameStyle) => void context.updateAppPreferences({ windowFrameStyle })}
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
] as const satisfies readonly SettingsItem[];

function appArchiveOptions(context: SettingsDialogController): Array<AppSelectOption<string>> {
  return withUnavailableSelection(
    [
      { label: "Use app default", value: INHERIT_VALUE },
      { label: "System", value: SYSTEM_VALUE },
      { label: "Dark", value: "builtin:dark" },
      { label: "Light", value: "builtin:light" },
      ...customOptions(context.themeCatalogEntries, "application"),
    ],
    context.archiveAppearance?.appTheme,
  );
}

function readerArchiveOptions(context: SettingsDialogController): Array<AppSelectOption<string>> {
  return withUnavailableSelection(
    [
      { label: "Use reader default", value: INHERIT_VALUE },
      { label: "Light", value: "builtin:light" },
      { label: "Sepia", value: "builtin:sepia" },
      { label: "Dark", value: "builtin:dark" },
      ...customOptions(context.themeCatalogEntries, "reader"),
    ],
    context.archiveAppearance?.readerTheme,
  );
}

function customOptions(
  entries: readonly ThemeCatalogEntry[],
  capability: "application" | "reader",
): Array<AppSelectOption<string>> {
  return entries
    .filter(
      (entry) => entry.origin === "custom" && entry.applicable && entry.capabilities[capability],
    )
    .map((entry) => ({ label: entry.name ?? entry.id, value: `custom:${entry.id}` }));
}

function withUnavailableSelection(
  options: Array<AppSelectOption<string>>,
  selection: ArchiveAppThemeSelection | ArchiveReaderThemeSelection | undefined,
): Array<AppSelectOption<string>> {
  if (!selection || selection.kind !== "custom") return options;
  const value = encodeSelection(selection);
  if (options.some((option) => option.value === value)) return options;
  return [...options, { disabled: true, label: `${selection.id} (missing or invalid)`, value }];
}

function encodeSelection(
  selection: ArchiveAppThemeSelection | ArchiveReaderThemeSelection,
): string {
  if (selection.kind === "inherit" || selection.kind === "system") return selection.kind;
  return `${selection.kind}:${selection.id}`;
}

function decodeAppSelection(value: string): ArchiveAppThemeSelection {
  if (value === INHERIT_VALUE) return { kind: "inherit" };
  if (value === SYSTEM_VALUE) return { kind: "system" };
  if (value === "builtin:dark" || value === "builtin:light") {
    return { kind: "builtin", id: value.slice("builtin:".length) as "dark" | "light" };
  }
  return { kind: "custom", id: value.slice("custom:".length) };
}

function decodeReaderSelection(value: string): ArchiveReaderThemeSelection {
  if (value === INHERIT_VALUE) return { kind: "inherit" };
  if (value === "builtin:dark" || value === "builtin:light" || value === "builtin:sepia") {
    return {
      kind: "builtin",
      id: value.slice("builtin:".length) as "dark" | "light" | "sepia",
    };
  }
  return { kind: "custom", id: value.slice("custom:".length) };
}

function appFallbackNote(context: SettingsDialogController): string {
  if (!context.archiveAppearance) return "Archive appearance unavailable.";
  return context.archiveAppearance.appTheme.kind === "inherit"
    ? "The active archive uses this default."
    : "The active archive currently overrides this default.";
}

function readerFallbackNote(context: SettingsDialogController): string {
  if (!context.archiveAppearance) return "Archive appearance unavailable.";
  return context.archiveAppearance.readerTheme.kind === "inherit"
    ? "The active archive uses this default."
    : "The active archive currently overrides this default.";
}

function catalogNote(context: SettingsDialogController): string | undefined {
  if (context.themeCatalogLoading) return "Loading custom themes…";
  if (context.themeCatalogError)
    return "Custom themes could not be listed. Open Theme Manager to retry.";
  return undefined;
}
