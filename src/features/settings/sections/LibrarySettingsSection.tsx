import { SettingsSectionItems } from "../SettingsSectionItems";
import type { SettingsDialogController } from "../useSettingsDialogController";

type LibrarySettingsSectionProps = {
  context: SettingsDialogController;
  hidden: boolean;
};

export function LibrarySettingsSection({
  context,
  hidden,
}: LibrarySettingsSectionProps) {
  return (
    <section hidden={hidden} className="settings-section">
      <header>
        <h2>Library</h2>
      </header>
      <SettingsSectionItems context={context} sectionId="library" />
    </section>
  );
}
