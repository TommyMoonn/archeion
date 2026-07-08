import { AppSelect, type AppSelectOption } from "../../../components/AppSelect";
import { Button } from "../../../components/Button";
import { SegmentedControl } from "../../../components/SegmentedControl";
import type {
  ArchiveImportConflictAction,
  ArchiveImportMode,
} from "../../../storage/LibraryStorage";
import type { ImportSettings } from "../../../types/settings";
import {
  archiveImportConflictOptions,
  archiveImportModeOptions,
} from "../../filesystem/archiveImport";
import { SettingsRow } from "../SettingsRow";

type ImportSettingsSectionProps = {
  destinationOptions: Array<AppSelectOption<string>>;
  hidden: boolean;
  importSettings: ImportSettings;
  onConflictActionChange: (value: ArchiveImportConflictAction) => void;
  onDestinationChange: (value: string) => void;
  onImportModeChange: (value: ArchiveImportMode) => void;
  onReset: () => void;
  safeDestinationValue: string;
};

export function ImportSettingsSection({
  destinationOptions,
  hidden,
  importSettings,
  onConflictActionChange,
  onDestinationChange,
  onImportModeChange,
  onReset,
  safeDestinationValue,
}: ImportSettingsSectionProps) {
  return (
    <section hidden={hidden} className="settings-section">
      <header>
        <h2>Import</h2>
      </header>
      <SettingsRow
        description="Chooses how new EPUB files are added."
        label="Default import mode"
      >
        <SegmentedControl
          label="Default import mode"
          onChange={onImportModeChange}
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
          onChange={onConflictActionChange}
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
          onChange={onDestinationChange}
          options={destinationOptions}
          value={safeDestinationValue}
        />
      </SettingsRow>
      <SettingsRow label="Reset import settings">
        <Button onClick={onReset} variant="secondary">
          Reset
        </Button>
      </SettingsRow>
    </section>
  );
}
