import { SettingsSectionItems } from "../SettingsSectionItems";
import { SettingsSectionHeader } from "../components/SettingsSectionHeader";
import type { SettingsDialogController } from "../useSettingsDialogController";

type LibrarySettingsSectionProps = {
  context: SettingsDialogController;
};

export function LibrarySettingsSection({ context }: LibrarySettingsSectionProps) {
  return (
    <section className="settings-section">
      <SettingsSectionHeader title="Library" />
      <SettingsSectionItems context={context} sectionId="library" />
    </section>
  );
}
