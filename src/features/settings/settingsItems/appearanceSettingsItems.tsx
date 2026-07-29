import { FolderOpen } from "@phosphor-icons/react";

import { AppSelect } from "../../../components/AppSelect";
import { Button } from "../../../components/Button";
import { IconButton } from "../../../components/IconButton";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { Toggle } from "../../../components/Toggle";
import type { InterfaceDensity } from "../../../types/appSettings";
import { ArchiveReaderThemeSelect } from "../../themes/ArchiveReaderThemeSelect";
import {
  applicationThemeOptions,
  applicationThemeValue,
  decodeApplicationTheme,
} from "../../themes/archiveThemeSelectionOptions";
import { SettingsRow } from "../SettingsRow";
import { densityOptions } from "../settingsOptions";
import type { SettingsItem } from "../settingsItemTypes";

export const appearanceSettingsItems = [
  {
    deferredData: ["archiveAppearanceSettings"],
    description: "Choose the colors used while reading.",
    id: "reader.theme",
    label: "Reader theme",
    render: (context) => (
      <SettingsRow description="Choose the colors used while reading." label="Reader theme">
        {context.archiveAppearance ? (
          <ArchiveReaderThemeSelect
            entries={context.themeCatalogEntries}
            fallback={context.reader.theme}
            onChange={(readerTheme) => void context.updateArchiveAppearance({ readerTheme })}
            selection={context.archiveAppearance.readerTheme}
          />
        ) : (
          <span className="settings-row__unavailable">Unavailable</span>
        )}
      </SettingsRow>
    ),
    searchTerms: ["theme", "light", "sepia", "dark", "epub reader", "custom reader theme"],
    sectionId: "reader",
  },
  {
    deferredData: ["archiveAppearanceSettings"],
    description: "Choose the theme used across Archeion.",
    groupLabel: "App appearance",
    id: "appearance.app-themes",
    label: "App themes",
    render: (context) => (
      <SettingsRow description="Choose the theme used across Archeion." label="App themes">
        <div className="settings-theme-control">
          <IconButton
            disabled={!context.selectedArchivePath}
            label="Open themes folder"
            onClick={() => void context.openThemesFolder()}
            size="standard"
          >
            <FolderOpen aria-hidden="true" />
          </IconButton>
          {context.archiveAppearance ? (
            <AppSelect
              ariaLabel="App themes"
              onChange={(value) =>
                void context.updateArchiveAppearance({
                  appTheme: decodeApplicationTheme(value),
                })
              }
              options={applicationThemeOptions(
                context.themeCatalogEntries,
                context.archiveAppearance.appTheme,
              )}
              value={applicationThemeValue(
                context.archiveAppearance.appTheme,
                context.preferences.appThemePreset,
              )}
            />
          ) : (
            <span className="settings-row__unavailable">Unavailable</span>
          )}
          <Button
            className="settings-theme-control__manage"
            disabled={!context.selectedArchivePath || context.themeCatalogLoading}
            onClick={context.openThemeManager}
            size="standard"
            variant="secondary"
          >
            Manage themes
          </Button>
        </div>
      </SettingsRow>
    ),
    searchTerms: ["theme", "system", "dark", "light", "custom themes", "manage themes"],
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
          Reset appearance
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
          Reset window
        </Button>
      </SettingsRow>
    ),
    searchTerms: ["reset", "window behavior"],
    sectionId: "appearance",
  },
] as const satisfies readonly SettingsItem[];
