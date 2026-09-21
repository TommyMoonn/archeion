import fs from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();
const documentationRoot = path.join(projectRoot, "docs/documentation");
const pages = {
  about: path.join(documentationRoot, "reference/about-resources/index.html"),
  dictionaries: path.join(documentationRoot, "guides/dictionaries/index.html"),
  keyboard: path.join(documentationRoot, "guides/keyboard-shortcuts/index.html"),
  settings: path.join(documentationRoot, "guides/settings/index.html"),
  storage: path.join(documentationRoot, "reference/archive-storage/index.html"),
  themeManager: path.join(documentationRoot, "customization/theme-manager/index.html"),
};

function read(filePath: string): string {
  return fs.readFileSync(filePath, "utf8");
}

function text(filePath: string): string {
  const window = new Window();
  window.document.write(read(filePath));
  return window.document.body.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function documentationPages(): string[] {
  const result: string[] = [];
  const visit = (directory: string) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile() && entry.name === "index.html") result.push(absolute);
    }
  };
  visit(documentationRoot);
  return result.sort();
}

function resolveLocalPage(
  sourceFile: string,
  href: string,
): { file: string; fragment?: string } | null {
  if (
    /^(?:[a-z]+:)?\/\//i.test(href) ||
    href.startsWith("mailto:") ||
    href.startsWith("javascript:")
  ) {
    return null;
  }
  const [withoutQuery] = href.split("?");
  const [pathname, fragment] = withoutQuery.split("#");
  let target = pathname ? path.resolve(path.dirname(sourceFile), pathname) : sourceFile;
  if (pathname.endsWith("/") || (fs.existsSync(target) && fs.statSync(target).isDirectory())) {
    target = path.join(target, "index.html");
  }
  return { file: target, ...(fragment ? { fragment } : {}) };
}

describe("Settings, dictionaries, theme, and About documentation coverage", () => {
  it("adds focused end-user guides for global utility features", () => {
    for (const [name, filePath] of Object.entries(pages)) {
      expect(fs.existsSync(filePath), `${name} guide should exist`).toBe(true);
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

    const customThemes = read(
      path.join(documentationRoot, "customization/custom-themes/index.html"),
    );
    const appearance = read(path.join(documentationRoot, "customization/appearance/index.html"));
    const combined = `${customThemes}\n${appearance}`;
    expect(combined).not.toMatch(/themes are stored with the archive/i);
    expect(combined).not.toMatch(/custom themes are kept in\s*<code>\.archeion\/themes\//i);
    expect(combined).toMatch(/application data/i);
  });

  it("exposes utility guides from every documentation sidebar and the documentation home", () => {
    const expectedLabels = [
      "Settings",
      "Dictionaries and Define",
      "Keyboard shortcuts",
      "Theme Manager",
      "About and resources",
    ];
    for (const page of documentationPages()) {
      const window = new Window();
      window.document.write(read(page));
      const sidebar = window.document.querySelector("[data-sidebar]");
      expect(sidebar, `${path.relative(projectRoot, page)} should have a sidebar`).not.toBeNull();
      const labels = Array.from(
        sidebar?.querySelectorAll<HTMLAnchorElement>("[data-doc-link]") ?? [],
      ).map((link) => link.textContent?.replace(/\s+/g, " ").trim());
      for (const label of expectedLabels) expect(labels).toContain(label);
      expect(sidebar?.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    }

    const home = text(path.join(documentationRoot, "index.html"));
    for (const label of expectedLabels) expect(home).toContain(label);
  });

  it("updates README and landing feature copy for offline dictionaries and standalone utility windows", () => {
    const readme = read(path.join(projectRoot, "README.md"));
    expect(readme).toMatch(/Dictionar.*Define/is);
    expect(readme).toMatch(/Settings.*Theme Manager.*About/is);
    expect(readme).toMatch(/application data/i);

    const landing = text(path.join(projectRoot, "docs/index.html"));
    expect(landing).toMatch(/Dictionar.*Define/is);
    expect(landing).toContain("Theme Manager");
    expect(landing).toContain("Settings");
    expect(landing).toContain("About");
  });

  it("keeps every local documentation link and fragment valid", () => {
    for (const page of documentationPages()) {
      const window = new Window();
      window.document.write(read(page));
      for (const anchor of window.document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
        const href = anchor.getAttribute("href") ?? "";
        const target = resolveLocalPage(page, href);
        if (!target) continue;
        expect(
          fs.existsSync(target.file),
          `${path.relative(projectRoot, page)} -> ${href} should resolve`,
        ).toBe(true);
        if (!target.fragment) continue;
        const targetWindow = new Window();
        targetWindow.document.write(read(target.file));
        expect(
          targetWindow.document.getElementById(decodeURIComponent(target.fragment)),
          `${path.relative(projectRoot, page)} -> ${href} fragment should exist`,
        ).not.toBeNull();
      }
    }
  });
});
