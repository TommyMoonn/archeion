import { describe, expect, it } from "vitest";

import { sectionMatches, settingsSections } from "./settingsSections";

describe("settingsSections", () => {
  it("keeps the sidebar labels in the accepted order", () => {
    expect(settingsSections.map((section) => section.label)).toEqual([
      "General",
      "Library",
      "Reader",
      "Dictionaries",
      "Keyboard",
      "Appearance",
      "Archives",
      "Storage",
      "Import",
    ]);
  });

  it("uses stable lowercase ids that are independent from labels", () => {
    expect(settingsSections.map((section) => section.id)).toEqual([
      "general",
      "library",
      "reader",
      "dictionaries",
      "keyboard",
      "appearance",
      "archives",
      "storage",
      "import",
    ]);
    expect(settingsSections.every((section) => section.id === section.id.toLocaleLowerCase())).toBe(
      true,
    );
    expect(
      settingsSections.every(
        (section) => Object.hasOwn(section, "id") && Object.hasOwn(section, "label"),
      ),
    ).toBe(true);
  });

  it("does not match removed composite search labels", () => {
    expect(sectionMatches("appearance", "appearance and window")).toBe(false);
    expect(sectionMatches("storage", "archive maintenance")).toBe(false);
    expect(sectionMatches("storage", "files and maintenance")).toBe(false);
    expect(sectionMatches("storage", "scan preferences")).toBe(false);
    expect(sectionMatches("appearance", "interface")).toBe(false);
  });

  it("matches current section labels and group terms", () => {
    expect(sectionMatches("appearance", "appearance")).toBe(true);
    expect(sectionMatches("appearance", "app appearance")).toBe(true);
    expect(sectionMatches("appearance", "window behavior")).toBe(true);
    expect(sectionMatches("storage", "storage")).toBe(true);
    expect(sectionMatches("storage", "file monitoring")).toBe(true);
    expect(sectionMatches("storage", "archive scanning")).toBe(true);
    expect(sectionMatches("storage", "generated cover cache")).toBe(true);
    expect(sectionMatches("storage", "epub writeback backups")).toBe(true);
    expect(sectionMatches("storage", "archive metadata and recovery")).toBe(true);
    expect(sectionMatches("appearance", "display density")).toBe(true);
    expect(sectionMatches("appearance", "animations")).toBe(true);
  });

  it("matches settings search aliases", () => {
    expect(sectionMatches("storage", "cover")).toBe(true);
    expect(sectionMatches("keyboard", "shortcut")).toBe(true);
    expect(sectionMatches("keyboard", "quick actions")).toBe(true);
    expect(sectionMatches("appearance", " window ")).toBe(true);
    expect(sectionMatches("import", "destination")).toBe(true);
    expect(sectionMatches("reader", "destination")).toBe(false);
    expect(sectionMatches("dictionaries", "stardict")).toBe(true);
  });

  it("shows all sections for empty search", () => {
    expect(settingsSections.every((section) => sectionMatches(section.id, ""))).toBe(true);
  });
});
