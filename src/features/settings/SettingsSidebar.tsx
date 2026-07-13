import {
  Archive,
  BookOpenText,
  Broom,
  Database,
  DownloadSimple,
  MagnifyingGlass,
  Palette,
  SlidersHorizontal,
} from "@phosphor-icons/react";

import { Input } from "../../components/Input";
import type { SettingsSection } from "./settingsSections";

type SettingsSidebarSection = {
  id: SettingsSection;
  label: string;
};

type SettingsSidebarProps = {
  onQueryChange: (query: string) => void;
  onSectionChange: (section: SettingsSection) => void;
  query: string;
  sections: readonly SettingsSidebarSection[];
  selectedSection: SettingsSection;
};

function SectionIcon({ section }: { section: SettingsSection }) {
  switch (section) {
    case "general":
      return <SlidersHorizontal aria-hidden="true" size={16} />;
    case "library":
      return <Database aria-hidden="true" size={16} />;
    case "reader":
      return <BookOpenText aria-hidden="true" size={16} />;
    case "appearance":
      return <Palette aria-hidden="true" size={16} />;
    case "archives":
      return <Archive aria-hidden="true" size={16} />;
    case "storage":
      return <Broom aria-hidden="true" size={16} />;
    case "import":
      return <DownloadSimple aria-hidden="true" size={16} />;
  }
}

export function SettingsSidebar({
  onQueryChange,
  onSectionChange,
  query,
  sections,
  selectedSection,
}: SettingsSidebarProps) {
  return (
    <aside className="settings-sidebar">
      <div className="settings-sidebar__header">
        <p>Archeion</p>
        <h1 id="settings-title">Settings</h1>
      </div>
      <Input
        className="settings-search"
        icon={<MagnifyingGlass aria-hidden="true" />}
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect="off"
        label="Search settings"
        name="archeion-settings-search"
        onChange={(event) => onQueryChange(event.currentTarget.value)}
        placeholder="Search settings"
        spellCheck={false}
        type="search"
        value={query}
      />
      <nav aria-label="Settings sections">
        {sections.map((section) => (
          <button
            aria-current={selectedSection === section.id ? "page" : undefined}
            key={section.id}
            onClick={() => onSectionChange(section.id)}
            type="button"
          >
            <SectionIcon section={section.id} />
            {section.label}
          </button>
        ))}
      </nav>
    </aside>
  );
}
