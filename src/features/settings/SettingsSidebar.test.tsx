import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SettingsSidebar } from "./SettingsSidebar";

describe("SettingsSidebar", () => {
  it("renders the provided settings sections and active marker", () => {
    const sections = [
      { id: "general" as const, label: "Primary" },
      { id: "appearance" as const, label: "Visual" },
    ];
    const markup = renderToStaticMarkup(
      <SettingsSidebar
        onQueryChange={vi.fn()}
        onSectionChange={vi.fn()}
        query=""
        searchAriaKeyShortcuts="Control+F"
        sections={sections}
        selectedSection="appearance"
      />,
    );

    expect(markup).toContain("Search settings");
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain('autoCorrect="off"');
    expect(markup).toContain('autoCapitalize="none"');
    expect(markup).toContain('name="archeion-settings-search"');
    expect(markup).toContain('aria-keyshortcuts="Control+F"');
    expect(markup).toContain('spellCheck="false"');
    expect(markup).toContain("Primary");
    expect(markup).toContain("Visual");
    expect(markup).toContain('aria-current="page"');
  });
});
