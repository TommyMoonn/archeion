import { SettingsSectionItems } from "../SettingsSectionItems";
import type { SettingsDialogController } from "../useSettingsDialogController";

type LibrarySettingsSectionProps = {
  context: SettingsDialogController;
};

export function LibrarySettingsSection({ context }: LibrarySettingsSectionProps) {
  return (
    <section className="settings-section">
      <header>
        <h2>Library</h2>
      </header>
      <SettingsSectionItems context={context} sectionId="library" />
    </section>
  );
}
