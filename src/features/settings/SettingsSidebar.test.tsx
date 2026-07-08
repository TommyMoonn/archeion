import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SettingsSidebar } from "./SettingsSidebar";
import { settingsSections } from "./settingsSections";

describe("SettingsSidebar", () => {
  it("renders the provided settings sections and active marker", () => {
    const markup = renderToStaticMarkup(
      <SettingsSidebar
        onQueryChange={vi.fn()}
        onSectionChange={vi.fn()}
        query=""
        sections={settingsSections}
        selectedSection="appearance"
      />,
    );

    expect(markup).toContain("Search settings");
    expect(markup).toContain('autoComplete="off"');
    expect(markup).toContain('autoCorrect="off"');
    expect(markup).toContain('autoCapitalize="none"');
    expect(markup).toContain('name="archeion-settings-search"');
    expect(markup).toContain('spellCheck="false"');
    expect(markup).toContain("General");
    expect(markup).toContain("Appearance");
    expect(markup).toContain("Storage");
    expect(markup).toContain('aria-current="page"');
  });
});
