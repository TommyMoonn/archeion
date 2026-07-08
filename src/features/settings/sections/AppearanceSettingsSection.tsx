import { SettingsSectionItems } from "../SettingsSectionItems";
import type { SettingsDialogController } from "../useSettingsDialogController";

type AppearanceSettingsSectionProps = {
  context: SettingsDialogController;
};

export function AppearanceSettingsSection({
  context,
}: AppearanceSettingsSectionProps) {
  return (
    <section className="settings-section">
      <header>
        <h2>Appearance</h2>
      </header>
      <SettingsSectionItems context={context} sectionId="appearance" />
    </section>
  );
}
