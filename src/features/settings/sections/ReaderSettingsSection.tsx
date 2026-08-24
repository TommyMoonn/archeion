import { SettingsSectionItems } from "../SettingsSectionItems";
import { SettingsSectionHeader } from "../components/SettingsSectionHeader";
import type { SettingsController } from "../useSettingsController";

type ReaderSettingsSectionProps = {
  context: SettingsController;
};

export function ReaderSettingsSection({ context }: ReaderSettingsSectionProps) {
  return (
    <section className="settings-section">
      <SettingsSectionHeader title="Reader" />
      <SettingsSectionItems context={context} sectionId="reader" />
    </section>
  );
}
