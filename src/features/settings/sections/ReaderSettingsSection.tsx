import { SettingsSectionItems } from "../SettingsSectionItems";
import type { SettingsDialogController } from "../useSettingsDialogController";

type ReaderSettingsSectionProps = {
  context: SettingsDialogController;
  hidden: boolean;
};

export function ReaderSettingsSection({
  context,
  hidden,
}: ReaderSettingsSectionProps) {
  return (
    <section hidden={hidden} className="settings-section">
      <header>
        <h2>Reader</h2>
      </header>
      <SettingsSectionItems context={context} sectionId="reader" />
    </section>
  );
}
