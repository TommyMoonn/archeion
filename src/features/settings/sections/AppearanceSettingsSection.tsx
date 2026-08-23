import { SettingsSectionItems } from "../SettingsSectionItems";
import { SettingsSectionHeader } from "../components/SettingsSectionHeader";
import type { SettingsDialogController } from "../useSettingsDialogController";

type AppearanceSettingsSectionProps = {
  context: SettingsDialogController;
};

export function AppearanceSettingsSection({ context }: AppearanceSettingsSectionProps) {
  return (
    <section className="settings-section">
      <SettingsSectionHeader title="Appearance" />
      <SettingsSectionItems context={context} sectionId="appearance" />
    </section>
  );
}
