import { SettingsSectionItems } from "../SettingsSectionItems";
import { SettingsSectionHeader } from "../components/SettingsSectionHeader";
import type { SettingsDialogController } from "../useSettingsDialogController";

type ReaderSettingsSectionProps = {
  context: SettingsDialogController;
};

export function ReaderSettingsSection({ context }: ReaderSettingsSectionProps) {
  return (
    <section className="settings-section">
      <SettingsSectionHeader title="Reader" />
      <SettingsSectionItems context={context} sectionId="reader" />
    </section>
  );
}
