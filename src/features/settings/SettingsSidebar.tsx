import {
  Archive,
  BookOpenText,
  BrushCleaning,
  Database,
  Download,
  Keyboard,
  Search,
  Palette,
  SlidersHorizontal,
} from "lucide-react";

import { Input } from "../../components/Input";
import type { Ref } from "react";
import type { SettingsSection } from "./settingsSections";

type SettingsSidebarSection = {
  id: SettingsSection;
  label: string;
};

type SettingsSidebarProps = {
  onQueryChange: (query: string) => void;
  searchAriaKeyShortcuts?: string;
  searchInputRef?: Ref<HTMLInputElement>;
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
    case "keyboard":
      return <Keyboard aria-hidden="true" size={16} />;
    case "appearance":
      return <Palette aria-hidden="true" size={16} />;
    case "archives":
      return <Archive aria-hidden="true" size={16} />;
    case "storage":
      return <BrushCleaning aria-hidden="true" size={16} />;
    case "import":
      return <Download aria-hidden="true" size={16} />;
  }
}

export function SettingsSidebar({
  onQueryChange,
  onSectionChange,
  query,
  searchAriaKeyShortcuts,
  searchInputRef,
  sections,
  selectedSection,
}: SettingsSidebarProps) {
  return (
    <aside aria-label="Settings navigation" className="settings-sidebar">
      <div className="settings-sidebar__header">
        <p>Archeion</p>
        <h1 id="settings-title">Settings</h1>
      </div>
      <div aria-label="Settings search" className="settings-search-landmark" role="search">
        <Input
          className="settings-search"
          icon={<Search aria-hidden="true" />}
          aria-keyshortcuts={searchAriaKeyShortcuts}
          autoCapitalize="none"
          autoComplete="off"
          autoCorrect="off"
          label="Search settings"
          ref={searchInputRef}
          name="archeion-settings-search"
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          placeholder="Search settings"
          spellCheck={false}
          type="search"
          value={query}
        />
      </div>
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
