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
    expect(markup).toContain("General");
    expect(markup).toContain("Appearance");
    expect(markup).toContain("Storage");
    expect(markup).toContain('aria-current="page"');
  });
});
