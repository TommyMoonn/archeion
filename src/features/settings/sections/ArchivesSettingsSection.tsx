import { SettingsSectionItems } from "../SettingsSectionItems";
import { SettingsSectionHeader } from "../components/SettingsSectionHeader";
import type { SettingsDialogController } from "../useSettingsDialogController";

type ArchivesSettingsSectionProps = {
  context: SettingsDialogController;
};

export function ArchivesSettingsSection({ context }: ArchivesSettingsSectionProps) {
  return (
    <section className="settings-section">
      <SettingsSectionHeader title="Archives" />
      <SettingsSectionItems context={context} sectionId="archives" />
    </section>
  );
}
