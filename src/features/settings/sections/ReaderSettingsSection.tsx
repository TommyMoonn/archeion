import { SettingsSection } from "../components/SettingsSection";
import { SettingsSectionItems } from "../SettingsSectionItems";
import { SettingsSectionHeader } from "../components/SettingsSectionHeader";
import type { SettingsController } from "../useSettingsController";

type ReaderSettingsSectionProps = {
  context: SettingsController;
};

export function ReaderSettingsSection({ context }: ReaderSettingsSectionProps) {
  return (
    <SettingsSection>
      <SettingsSectionHeader title="Reader" />
      <SettingsSectionItems context={context} sectionId="reader" />
    </SettingsSection>
  );
}
