import { SettingsSectionItems } from "../SettingsSectionItems";
import { SettingsSectionHeader } from "../components/SettingsSectionHeader";
import type { SettingsDialogController } from "../useSettingsDialogController";

type GeneralSettingsSectionProps = {
  context: SettingsDialogController;
};

export function GeneralSettingsSection({ context }: GeneralSettingsSectionProps) {
  return (
    <section className="settings-section">
      <SettingsSectionHeader title="General" />
      <SettingsSectionItems context={context} sectionId="general" />
    </section>
  );
}
