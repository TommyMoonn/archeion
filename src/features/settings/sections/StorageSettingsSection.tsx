import { SettingsSectionItems } from "../SettingsSectionItems";
import type { SettingsDialogController } from "../useSettingsDialogController";

type StorageSettingsSectionProps = {
  context: SettingsDialogController;
};

export function StorageSettingsSection({
  context,
}: StorageSettingsSectionProps) {
  return (
    <section className="settings-section">
      <header>
        <h2>Storage</h2>
      </header>
      <SettingsSectionItems context={context} sectionId="storage" />
    </section>
  );
}
