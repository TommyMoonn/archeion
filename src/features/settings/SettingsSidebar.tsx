import {
  Archive,
  BookOpenText,
  BrushCleaning,
  Database,
  Keyboard,
  Languages,
  Search,
  Palette,
  SlidersHorizontal,
} from "lucide-react";

import { Input } from "../../components/Input";
import { useContext, type Ref } from "react";
import { createPortal } from "react-dom";
import { SettingsSidebarFrame } from "./SettingsWindowLayout";
import { SettingsWindowLayoutContext } from "./settingsWindowLayoutContext";
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
    case "dictionaries":
      return <Languages aria-hidden="true" size={16} />;
    case "keyboard":
      return <Keyboard aria-hidden="true" size={16} />;
    case "appearance":
      return <Palette aria-hidden="true" size={16} />;
    case "archives":
      return <Archive aria-hidden="true" size={16} />;
    case "storage":
      return <BrushCleaning aria-hidden="true" size={16} />;
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
  const layout = useContext(SettingsWindowLayoutContext);
  const content = (
    <>
      <div aria-label="Settings search" className="settings-search-landmark" role="search">
        <Input
          className="settings-search w-full min-h-settings-search [&>input]:min-w-0 [&>input]:text-meta-size [&>input::-webkit-search-cancel-button]:hidden [&>input::-webkit-search-cancel-button]:appearance-none"
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
      <nav
        aria-label="Settings sections"
        className="grid min-h-0 gap-settings-nav-gap overflow-y-auto pe-busy-inset settings-window-mobile:flex settings-window-mobile:gap-settings-small-gap settings-window-mobile:pb-busy-inset settings-window-mobile:overflow-x-auto settings-window-mobile:overflow-y-hidden settings-window-mobile:overscroll-x-contain settings-window-mobile:scrollbar-gutter-auto"
      >
        {sections.map((section) => (
          <button
            aria-current={selectedSection === section.id ? "page" : undefined}
            className="grid settings-nav-columns items-center gap-control-gap min-h-control-standard px-dialog-copy py-control-gap border-0 rounded-control text-muted bg-transparent text-body text-start no-underline transition-colors duration-standard ease-standard hover:text-text hover:bg-surface focus-visible:text-text focus-visible:bg-surface aria-[current=page]:text-text-strong aria-[current=page]:bg-surface-raised settings-window-mobile:min-w-max settings-window-mobile:flex-none"
            key={section.id}
            onClick={() => onSectionChange(section.id)}
            type="button"
          >
            <SectionIcon section={section.id} />
            {section.label}
          </button>
        ))}
      </nav>
    </>
  );
  if (layout) return layout.navigationHost ? createPortal(content, layout.navigationHost) : null;
  return <SettingsSidebarFrame>{content}</SettingsSidebarFrame>;
}
