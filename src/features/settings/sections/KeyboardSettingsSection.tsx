import { SettingsSectionItems } from "../SettingsSectionItems";
import { SettingsSectionHeader } from "../components/SettingsSectionHeader";
import type { SettingsController } from "../useSettingsController";

export function KeyboardSettingsSection({ context }: { context: SettingsController }) {
  return (
    <section className="settings-section settings-section--keyboard">
      <SettingsSectionHeader title="Keyboard" />
      <SettingsSectionItems context={context} sectionId="keyboard" />
    </section>
  );
}
