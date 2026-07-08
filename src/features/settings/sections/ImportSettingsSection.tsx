import { SettingsSectionItems } from "../SettingsSectionItems";
import type { SettingsDialogController } from "../useSettingsDialogController";

type ImportSettingsSectionProps = {
  context: SettingsDialogController;
  hidden: boolean;
};

export function ImportSettingsSection({
  context,
  hidden,
}: ImportSettingsSectionProps) {
  return (
    <section hidden={hidden} className="settings-section">
      <header>
        <h2>Import</h2>
      </header>
      <SettingsSectionItems context={context} sectionId="import" />
    </section>
  );
}
