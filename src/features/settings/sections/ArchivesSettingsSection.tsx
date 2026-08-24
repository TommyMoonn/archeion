import { SettingsSectionItems } from "../SettingsSectionItems";
import { SettingsSectionHeader } from "../components/SettingsSectionHeader";
import type { SettingsController } from "../useSettingsController";

type ArchivesSettingsSectionProps = {
  context: SettingsController;
};

export function ArchivesSettingsSection({ context }: ArchivesSettingsSectionProps) {
  return (
    <section className="settings-section">
      <SettingsSectionHeader title="Archives" />
      <SettingsSectionItems context={context} sectionId="archives" />
    </section>
  );
}
