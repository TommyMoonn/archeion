import { SettingsSectionItems } from "../SettingsSectionItems";
import type { SettingsDialogController } from "../useSettingsDialogController";

export function KeyboardSettingsSection({ context }: { context: SettingsDialogController }) {
  return (
    <section className="settings-section">
      <header>
        <h2>Keyboard</h2>
      </header>
      <SettingsSectionItems context={context} sectionId="keyboard" />
    </section>
  );
}
