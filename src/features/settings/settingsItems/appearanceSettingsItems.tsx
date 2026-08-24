import { Palette } from "lucide-react";

import { AppSelect } from "../../../components/AppSelect";
import { Button } from "../../../components/Button";
import { IconButton } from "../../../components/IconButton";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { Toggle } from "../../../components/Toggle";
import type { InterfaceDensity } from "../../../types/appSettings";
import { ReaderThemeSelect } from "../../themes/ReaderThemeSelect";
import {
  applicationThemeOptions,
  applicationThemeValue,
  decodeApplicationTheme,
} from "../../themes/themeSelectionOptions";
import {
  FeatureSettingsRow,
  SettingsActionRow,
  StandardSettingsRow,
} from "../components/SettingsRows";
import { densityOptions } from "../settingsOptions";
import type { SettingsItem } from "../settingsItemTypes";

export const appearanceSettingsItems = [
  {
    deferredData: ["themeCatalog"],
    description: "Choose the colors used while reading.",
    id: "reader.theme",
    label: "Reader theme",
    render: (context) => (
      <StandardSettingsRow description="Choose the colors used while reading." label="Reader theme">
        <ReaderThemeSelect
          entries={context.themeCatalogEntries}
          onChange={(readerTheme) => void context.updateAppearance({ readerTheme })}
          onOpen={() => void context.refreshThemeCatalog()}
          selection={context.preferences.readerTheme}
        />
      </StandardSettingsRow>
    ),
    searchTerms: ["theme", "light", "sepia", "dark", "epub reader", "custom reader theme"],
    sectionId: "reader",
  },
  {
    deferredData: ["themeCatalog"],
    description: "Choose the theme used across Archeion.",
    groupLabel: "App appearance",
    id: "appearance.app-themes",
    label: "App themes",
    render: (context) => (
      <FeatureSettingsRow description="Choose the theme used across Archeion." label="App themes">
        <div className="settings-theme-control">
          <AppSelect
            ariaLabel="App themes"
            onChange={(value) =>
              void context.updateAppearance({ appTheme: decodeApplicationTheme(value) })
            }
            onOpen={() => void context.refreshThemeCatalog()}
            options={applicationThemeOptions(
              context.themeCatalogEntries,
              context.preferences.appTheme,
            )}
            value={applicationThemeValue(context.preferences.appTheme)}
          />
          <IconButton
            className="settings-theme-control__manage"
            disabled={context.themeCatalogLoading}
            disabledReason="Themes are loading."
            label="Manage themes"
            onClick={context.openThemeManager}
            size="standard"
            tooltip="Manage themes"
          >
            <Palette aria-hidden="true" />
          </IconButton>
        </div>
      </FeatureSettingsRow>
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
      <StandardSettingsRow description="Enable subtle app transitions." label="Animations">
        <Toggle
          checked={context.preferences.appearance.animationsEnabled}
          label="Animations"
          onChange={(animationsEnabled) =>
            void context.updateAppPreferences({ appearance: { animationsEnabled } })
          }
        />
      </StandardSettingsRow>
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
      <StandardSettingsRow description="Adjusts spacing across the app." label="Display density">
        <SegmentedControl<InterfaceDensity>
          label="Display density"
          onChange={(density) => void context.updateAppPreferences({ density })}
          options={densityOptions}
          value={context.preferences.density}
        />
      </StandardSettingsRow>
    ),
    searchTerms: ["density", "comfortable", "compact", "app appearance"],
    sectionId: "appearance",
  },
  {
    groupLabel: "Reset",
    groupStyle: "actions",
    id: "appearance.reset-appearance",
    label: "Reset appearance settings",
    render: (context) => (
      <SettingsActionRow label="Reset appearance settings">
        <Button onClick={() => void context.resetAppearance()} variant="secondary">
          Reset appearance
        </Button>
      </SettingsActionRow>
    ),
    searchTerms: ["reset", "app appearance"],
    sectionId: "appearance",
  },
] as const satisfies readonly SettingsItem[];
