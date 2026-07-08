import { SettingsSectionItems } from "../SettingsSectionItems";
import type { SettingsDialogController } from "../useSettingsDialogController";

type GeneralSettingsSectionProps = {
  context: SettingsDialogController;
  hidden: boolean;
};

export function GeneralSettingsSection({
  context,
  hidden,
}: GeneralSettingsSectionProps) {
  return (
    <section hidden={hidden} className="settings-section">
      <header>
        <h2>General</h2>
      </header>
      <SettingsSectionItems context={context} sectionId="general" />
    </section>
  );
}
