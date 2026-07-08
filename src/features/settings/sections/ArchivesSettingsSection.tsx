import { SettingsSectionItems } from "../SettingsSectionItems";
import type { SettingsDialogController } from "../useSettingsDialogController";

type ArchivesSettingsSectionProps = {
  context: SettingsDialogController;
  hidden: boolean;
};

export function ArchivesSettingsSection({
  context,
  hidden,
}: ArchivesSettingsSectionProps) {
  return (
    <section hidden={hidden} className="settings-section">
      <header>
        <h2>Archives</h2>
      </header>
      <SettingsSectionItems context={context} sectionId="archives" />
    </section>
  );
}
