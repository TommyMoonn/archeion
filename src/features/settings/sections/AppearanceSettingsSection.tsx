import { SettingsSectionItems } from "../SettingsSectionItems";
import type { SettingsDialogController } from "../useSettingsDialogController";

type AppearanceSettingsSectionProps = {
  context: SettingsDialogController;
  hidden: boolean;
};

export function AppearanceSettingsSection({
  context,
  hidden,
}: AppearanceSettingsSectionProps) {
  return (
    <section hidden={hidden} className="settings-section">
      <header>
        <h2>Appearance</h2>
      </header>
      <SettingsSectionItems context={context} sectionId="appearance" />
    </section>
  );
}
