import { SettingsSectionItems } from "../SettingsSectionItems";
import { SettingsSectionHeader } from "../components/SettingsSectionHeader";
import type { SettingsController } from "../useSettingsController";

type StorageSettingsSectionProps = {
  context: SettingsController;
};

export function StorageSettingsSection({ context }: StorageSettingsSectionProps) {
  return (
    <section className="settings-section">
      <SettingsSectionHeader title="Storage" />
      <SettingsSectionItems context={context} sectionId="storage" />
    </section>
  );
}
