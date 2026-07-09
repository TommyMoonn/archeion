import { SettingsSectionItems } from "../SettingsSectionItems";
import type { SettingsDialogController } from "../useSettingsDialogController";

type ReaderSettingsSectionProps = {
  context: SettingsDialogController;
};

export function ReaderSettingsSection({ context }: ReaderSettingsSectionProps) {
  return (
    <section className="settings-section">
      <header>
        <h2>Reader</h2>
      </header>
      <SettingsSectionItems context={context} sectionId="reader" />
    </section>
  );
}
