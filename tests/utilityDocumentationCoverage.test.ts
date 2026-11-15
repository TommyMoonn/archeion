import { articleText, documentForRoute } from "./documentationMdxTestSupport";
import fs from "node:fs";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

const pages = {
  about: "reference/about-resources",
  dictionaries: "guides/dictionaries",
  keyboard: "guides/keyboard-shortcuts",
  settings: "guides/settings",
  storage: "reference/archive-storage",
  themeManager: "customization/theme-manager",
};

function read(route: string): string {
  return documentForRoute(route).source;
}
function text(route: string): string {
  return articleText(route);
}

describe("Settings, dictionaries, theme, and About documentation coverage", () => {
  it("adds focused end-user guides for global utility features", () => {
    for (const [name, filePath] of Object.entries(pages)) {
      expect(Boolean(documentForRoute(filePath)), `${name} guide should exist`).toBe(true);
    }

    const settings = text(pages.settings);
    for (const section of [
      "General",
      "Appearance",
      "Library",
      "Reader",
      "Archives",
      "Storage",
      "Dictionaries",
      "Keyboard",
    ]) {
      expect(settings).toContain(section);
    }
    expect(settings).toMatch(/standalone Settings window/i);
    expect(settings).toMatch(/application-wide|across archives/i);

    const dictionaries = text(pages.dictionaries);
    for (const label of [
      "All",
      "Installed",
      "Not installed",
      "Refresh",
      "Import",
      "Download",
      "Define",
    ]) {
      expect(dictionaries).toContain(label);
    }
    expect(dictionaries).toMatch(/installed local dictionar/i);

    const keyboard = text(pages.keyboard);
    expect(keyboard).toContain("Search shortcuts");
    expect(keyboard).toContain("Reset all keyboard shortcuts");
    expect(keyboard).toContain("Fixed Interaction Keys");

    const themeManager = text(pages.themeManager);
    expect(themeManager).toContain("Theme Manager");
    expect(themeManager).toContain("Import");
    expect(themeManager).toContain("Reload themes");
    expect(themeManager).toContain("Use theme");
    expect(themeManager).toMatch(/application data/i);
    expect(themeManager).toMatch(/legacy.*archive|older archive/i);

    const about = text(pages.about);
    expect(about).toContain("About Archeion");
    expect(about).toContain("Website");
    expect(about).toContain("Documentation");
    expect(about).toContain("Source code");
    expect(about).toMatch(/standalone/i);
  });

  it("documents archive versus application-global ownership and current storage maintenance", () => {
    const storage = text(pages.storage);
    expect(storage).toContain("Scan on startup");
    expect(storage).toContain("Live filesystem watcher");
    expect(storage).toContain("Archive scan");
    expect(storage).toContain("Scanner cache");
    expect(storage).toContain("Source metadata");
    expect(storage).toContain("Generated cover cache");
    expect(storage).toContain("EPUB writeback backups");
    expect(storage).toContain("Archive metadata");
    expect(storage).toContain("Metadata folder");
    expect(storage).toMatch(/application data/i);
    expect(storage).toMatch(/\.archeion/i);

    const customThemes = read("customization/custom-themes");
    const appearance = read("customization/appearance");
    const combined = `${customThemes}\n${appearance}`;
    expect(combined).not.toMatch(/themes are stored with the archive/i);
    expect(combined).not.toMatch(/custom themes are kept in\s*<code>\.archeion\/themes\//i);
    expect(combined).toMatch(/application data/i);
  });

  it("documents offline dictionaries and standalone utility windows on the landing page", () => {
    const landingWindow = new Window();
    landingWindow.document.write(fs.readFileSync("docs/index.html", "utf8"));
    const readerNotes = landingWindow.document.querySelector("#reader .reader-notes")?.textContent;
    expect(readerNotes).toMatch(/\bDefine\b/i);
    expect(readerNotes).toMatch(/\bdictionar(?:y|ies)\b/i);

    const landing = landingWindow.document.body.textContent ?? "";
    expect(landing).toContain("Theme Manager");
    expect(landing).toContain("Settings");
    expect(landing).toContain("About");
  });
});
