import { SettingsSection } from "../components/SettingsSection";
import { SettingsSectionItems } from "../SettingsSectionItems";
import { SettingsSectionHeader } from "../components/SettingsSectionHeader";
import type { SettingsController } from "../useSettingsController";

type AppearanceSettingsSectionProps = {
  context: SettingsController;
};

export function AppearanceSettingsSection({ context }: AppearanceSettingsSectionProps) {
  return (
    <SettingsSection>
      <SettingsSectionHeader title="Appearance" />
      <SettingsSectionItems context={context} sectionId="appearance" />
    </SettingsSection>
  );
}
