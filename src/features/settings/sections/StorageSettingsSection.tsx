import { SettingsSectionItems } from "../SettingsSectionItems";
import type { SettingsDialogController } from "../useSettingsDialogController";

type StorageSettingsSectionProps = {
  context: SettingsDialogController;
  hidden: boolean;
};

export function StorageSettingsSection({
  context,
  hidden,
}: StorageSettingsSectionProps) {
  return (
    <section hidden={hidden} className="settings-section">
      <header>
        <h2>Storage</h2>
      </header>
      <SettingsSectionItems context={context} sectionId="storage" />
    </section>
  );
}
