import { AppSelect } from "../../../components/AppSelect";
import { Button } from "../../../components/Button";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { Toggle } from "../../../components/Toggle";
import type {
  AppThemePreset,
  InterfaceDensity,
  WindowFrameStyle,
} from "../../../types/appSettings";
import { SettingsRow } from "../SettingsRow";
import {
  appThemeOptions,
  densityOptions,
  frameOptions,
} from "../settingsOptions";

type AppearanceSettingsSectionProps = {
  appThemePreset: AppThemePreset;
  density: InterfaceDensity;
  hidden: boolean;
  onAppThemePresetChange: (value: AppThemePreset) => void;
  onDensityChange: (value: InterfaceDensity) => void;
  onRememberWindowStateChange: (value: boolean) => void;
  onResetAppearance: () => void;
  onResetWindow: () => void;
  onWindowFrameStyleChange: (value: WindowFrameStyle) => void;
  rememberWindowState: boolean;
  windowFrameStyle: WindowFrameStyle;
};

export function AppearanceSettingsSection({
  appThemePreset,
  density,
  hidden,
  onAppThemePresetChange,
  onDensityChange,
  onRememberWindowStateChange,
  onResetAppearance,
  onResetWindow,
  onWindowFrameStyleChange,
  rememberWindowState,
  windowFrameStyle,
}: AppearanceSettingsSectionProps) {
  return (
    <section hidden={hidden} className="settings-section">
      <header>
        <h2>Appearance</h2>
      </header>
      <div className="settings-section__group">
        <h3>App appearance</h3>
        <SettingsRow
          description="Sets the app theme."
          label="App theme preset"
        >
          <AppSelect
            ariaLabel="App theme preset"
            onChange={onAppThemePresetChange}
            options={appThemeOptions}
            value={appThemePreset}
          />
        </SettingsRow>
        <SettingsRow
          description="Adjusts spacing across the app."
          label="Display density"
        >
          <SegmentedControl
            label="Display density"
            onChange={onDensityChange}
            options={densityOptions}
            value={density}
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
            onChange={onWindowFrameStyleChange}
            options={frameOptions}
            value={windowFrameStyle}
          />
        </SettingsRow>
        <SettingsRow
          description="Restores the previous window layout when supported."
          label="Remember window size and position"
        >
          <Toggle
            checked={rememberWindowState}
            label="Remember window size and position"
            onChange={onRememberWindowStateChange}
          />
        </SettingsRow>
      </div>

      <div className="settings-section__group settings-section__group--actions">
        <h3>Reset</h3>
        <SettingsRow label="Reset appearance settings">
          <Button onClick={onResetAppearance} variant="secondary">
            Reset
          </Button>
        </SettingsRow>
        <SettingsRow label="Reset window settings">
          <Button onClick={onResetWindow} variant="secondary">
            Reset
          </Button>
        </SettingsRow>
      </div>
    </section>
  );
}
