import { AppSelect } from "../../../components/AppSelect";
import { Button } from "../../../components/Button";
import { Toggle } from "../../../components/Toggle";
import type { StartupBehavior } from "../../../types/appSettings";
import { SettingsRow } from "../SettingsRow";
import { startupOptions } from "../settingsOptions";

type GeneralSettingsSectionProps = {
  confirmDestructiveFileActions: boolean;
  hidden: boolean;
  onConfirmDestructiveFileActionsChange: (value: boolean) => void;
  onReset: () => void;
  onRestoreLastReaderChange: (value: boolean) => void;
  onStartupBehaviorChange: (value: StartupBehavior) => void;
  restoreLastReader: boolean;
  startupBehavior: StartupBehavior;
};

export function GeneralSettingsSection({
  confirmDestructiveFileActions,
  hidden,
  onConfirmDestructiveFileActionsChange,
  onReset,
  onRestoreLastReaderChange,
  onStartupBehaviorChange,
  restoreLastReader,
  startupBehavior,
}: GeneralSettingsSectionProps) {
  return (
    <section hidden={hidden} className="settings-section">
      <header>
        <h2>General</h2>
      </header>
      <SettingsRow
        description="Choose what opens when Archeion starts."
        label="Startup behavior"
      >
        <AppSelect
          ariaLabel="Startup behavior"
          onChange={onStartupBehaviorChange}
          options={startupOptions}
          value={startupBehavior}
        />
      </SettingsRow>
      <SettingsRow
        description="Ask before deleting or replacing real files."
        label="Confirm destructive file actions"
      >
        <Toggle
          checked={confirmDestructiveFileActions}
          label="Confirm destructive file actions"
          onChange={onConfirmDestructiveFileActionsChange}
        />
      </SettingsRow>
      <SettingsRow
        description="Reopen the last book route when the file is still available."
        label="Restore last reader route"
      >
        <Toggle
          checked={restoreLastReader}
          label="Restore last reader route"
          onChange={onRestoreLastReaderChange}
        />
      </SettingsRow>
      <SettingsRow label="Reset general settings">
        <Button onClick={onReset} variant="secondary">
          Reset
        </Button>
      </SettingsRow>
    </section>
  );
}
