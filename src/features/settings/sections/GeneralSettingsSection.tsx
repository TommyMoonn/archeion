import { SettingsSection } from "../components/SettingsSection";
import { SettingsSectionItems } from "../SettingsSectionItems";
import { SettingsSectionHeader } from "../components/SettingsSectionHeader";
import type { SettingsController } from "../useSettingsController";

type GeneralSettingsSectionProps = {
  context: SettingsController;
};

export function GeneralSettingsSection({ context }: GeneralSettingsSectionProps) {
  return (
    <SettingsSection>
      <SettingsSectionHeader title="General" />
      <SettingsSectionItems context={context} sectionId="general" />
    </SettingsSection>
  );
}
