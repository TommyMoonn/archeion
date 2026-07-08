import { SettingsSectionItems } from "../SettingsSectionItems";
import type { SettingsDialogController } from "../useSettingsDialogController";

type ImportSettingsSectionProps = {
  context: SettingsDialogController;
};

export function ImportSettingsSection({
  context,
}: ImportSettingsSectionProps) {
  return (
    <section className="settings-section">
      <header>
        <h2>Import</h2>
      </header>
      <SettingsSectionItems context={context} sectionId="import" />
    </section>
  );
}
