import { SettingsSectionItems } from "../SettingsSectionItems";
import { SettingsSectionHeader } from "../components/SettingsSectionHeader";
import type { SettingsDialogController } from "../useSettingsDialogController";

export function KeyboardSettingsSection({ context }: { context: SettingsDialogController }) {
  return (
    <section className="settings-section">
      <SettingsSectionHeader title="Keyboard" />
      <SettingsSectionItems context={context} sectionId="keyboard" />
    </section>
  );
}
