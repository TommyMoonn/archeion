import { SettingsSectionItems } from "../SettingsSectionItems";
import type { SettingsDialogController } from "../useSettingsDialogController";

type GeneralSettingsSectionProps = {
  context: SettingsDialogController;
};

export function GeneralSettingsSection({
  context,
}: GeneralSettingsSectionProps) {
  return (
    <section className="settings-section">
      <header>
        <h2>General</h2>
      </header>
      <SettingsSectionItems context={context} sectionId="general" />
    </section>
  );
}
