import { Search } from "lucide-react";
import { useState } from "react";

import { Input } from "../../../components/Input";
import { SettingsSectionItems } from "../SettingsSectionItems";
import { SettingsSectionHeader } from "../components/SettingsSectionHeader";
import { getSettingsItemsForSection } from "../settingsItems";
import { settingsItemMatchesQuery } from "../settingsSearch";
import type { SettingsController } from "../useSettingsController";

export function KeyboardSettingsSection({ context }: { context: SettingsController }) {
  const [query, setQuery] = useState("");
  const items = getSettingsItemsForSection("keyboard");
  const filteredItems = query.trim()
    ? items.filter((item) => settingsItemMatchesQuery(item, query))
    : items;

  return (
    <section className="settings-section settings-section--keyboard">
      <SettingsSectionHeader title="Keyboard" />
      <div
        aria-label="Keyboard shortcut search"
        className="keyboard-settings__search"
        role="search"
      >
        <Input
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          className="keyboard-settings__search-input"
          icon={<Search aria-hidden="true" />}
          label="Search shortcuts"
          name="keyboard-shortcut-search"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search shortcuts"
          size="standard"
          spellCheck={false}
          type="search"
          value={query}
        />
      </div>
      {filteredItems.length > 0 ? (
        <SettingsSectionItems context={context} items={filteredItems} sectionId="keyboard" />
      ) : (
        <p className="keyboard-settings__empty" role="status">
          No shortcuts match this search.
        </p>
      )}
    </section>
  );
}
