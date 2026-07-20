import { SettingsSectionItems } from "../SettingsSectionItems";
import type { SettingsDialogController } from "../useSettingsDialogController";

export function KeyboardSettingsSection({ context }: { context: SettingsDialogController }) {
  return (
    <section className="settings-section">
      <header>
        <h2>Keyboard</h2>
        <p>Configure application shortcuts and review fixed reader interaction keys.</p>
      </header>
      <SettingsSectionItems context={context} sectionId="keyboard" />
    </section>
  );
}
