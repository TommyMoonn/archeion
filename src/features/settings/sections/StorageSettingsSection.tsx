import { SettingsSectionItems } from "../SettingsSectionItems";
import { SettingsSectionHeader } from "../components/SettingsSectionHeader";
import type { SettingsDialogController } from "../useSettingsDialogController";

type StorageSettingsSectionProps = {
  context: SettingsDialogController;
};

export function StorageSettingsSection({ context }: StorageSettingsSectionProps) {
  return (
    <section className="settings-section">
      <SettingsSectionHeader title="Storage" />
      <SettingsSectionItems context={context} sectionId="storage" />
    </section>
  );
}
