// @vitest-environment happy-dom

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

    const content = new DOMParser().parseFromString(markup, "text/html");
    const input = content.querySelector('input[type="search"]');
    expect(input?.closest("label")?.textContent).toBe("Search settings");
    expect(input?.getAttribute("aria-keyshortcuts")).toBe("Control+F");
    expect(input?.getAttribute("autocomplete")).toBe("off");
    expect(input?.getAttribute("autocorrect")).toBe("off");
    expect(input?.getAttribute("autocapitalize")).toBe("none");
    expect(input?.getAttribute("spellcheck")).toBe("false");
    expect(input?.getAttribute("name")).toBe("archeion-settings-search");
    const sectionsNav = content.querySelector('nav[aria-label="Settings sections"]');
    expect(
      [...sectionsNav!.querySelectorAll("button")].map((button) => button.textContent),
    ).toEqual(["Primary", "Visual"]);
    expect(sectionsNav?.querySelector('[aria-current="page"]')?.textContent).toBe("Visual");
  });
});
