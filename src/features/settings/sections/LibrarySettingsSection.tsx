import { SettingsSection } from "../components/SettingsSection";
import { SettingsSectionItems } from "../SettingsSectionItems";
import { SettingsSectionHeader } from "../components/SettingsSectionHeader";
import type { SettingsController } from "../useSettingsController";

type LibrarySettingsSectionProps = {
  context: SettingsController;
};

export function LibrarySettingsSection({ context }: LibrarySettingsSectionProps) {
  return (
    <SettingsSection>
      <SettingsSectionHeader title="Library" />
      <SettingsSectionItems context={context} sectionId="library" />
    </SettingsSection>
  );
}
