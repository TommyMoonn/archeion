import { SettingsSectionItems } from "../SettingsSectionItems";
import type { SettingsDialogController } from "../useSettingsDialogController";

type ArchivesSettingsSectionProps = {
  context: SettingsDialogController;
};

export function ArchivesSettingsSection({
  context,
}: ArchivesSettingsSectionProps) {
  return (
    <section className="settings-section">
      <header>
        <h2>Archives</h2>
      </header>
      <SettingsSectionItems context={context} sectionId="archives" />
    </section>
  );
}
