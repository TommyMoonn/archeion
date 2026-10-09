import fs from "node:fs";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import { LIBRARY_SMART_VIEW_DEFINITIONS } from "../src/types/librarySmartViews";

const windows: Window[] = [];
afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.abort()));
});
function article(route: string) {
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  windows.push(window);
  window.document.write(fs.readFileSync(`docs/documentation/${route}/index.html`, "utf8"));
  return window.document.querySelector("[data-doc-article]")!;
}
function text(route: string) {
  return article(route).textContent.replace(/\s+/g, " ");
}
function link(route: string, href: string) {
  expect(article(route).querySelector(`a[href="${href}"]`), `${route} -> ${href}`).not.toBeNull();
}

describe("released behavior documentation depth", () => {
  it("explains the manual updater bootstrap and explicit download/restart decisions", () => {
    const copy = text("getting-started/installing");
    for (const term of [
      "1.5.x",
      "1.6.0",
      "manually",
      "Update now",
      "Restart now",
      "24 hours",
      "What's new",
      "Library",
      "About",
      "Automatically check for updates",
    ])
      expect(copy).toContain(term);
    link("getting-started/installing", "../../guides/settings/#automatic-updates");
    link("getting-started/installing", "../../changelog/");
    expect(text("guides/settings")).toContain("enabled by default");
    expect(text("reference/about-resources")).toContain("Changelog");
  });
  it("explains density and both owners of motion permission", () => {
    const copy = text("customization/appearance");
    for (const term of [
      "Display density",
      "Compact",
      "Comfortable",
      "Animations",
      "operating system",
      "reduced motion",
      "subtle application transitions",
      "Reader content",
    ])
      expect(copy).toContain(term);
    expect(copy).toMatch(/only when.*Animations.*operating system.*not requesting reduced motion/i);
    expect(copy).toContain("Settings → Reader");
    link("customization/appearance", "../theme-manager/");
  });
  it("covers every shipped Smart View and describes scrolling without hardware promises", () => {
    const copy = text("guides/library");
    for (const view of LIBRARY_SMART_VIEW_DEFINITIONS) expect(copy).toContain(view.label);
    expect(copy).toContain("visible area");
    expect(copy).toContain("nearby covers");
    link("guides/library", "../archive-health/");
    link("guides/library", "../metadata-covers/");
    link("guides/library", "../quick-actions/");
  });
  it("sets first-scan, cached reopening, watcher, and maintenance expectations", () => {
    const copy = text("reference/archive-storage");
    for (const term of [
      "first scan",
      "cached",
      "watching",
      "Rescan archive",
      "Re-extract metadata",
      "Clear cover cache",
      "take time",
    ])
      expect(copy.toLowerCase()).toContain(term.toLowerCase());
    expect(copy).not.toMatch(/worker count|benchmark median|\d+,\d+ books per second/i);
  });
  it("explains Settings synchronization, ownership, and section consequences", () => {
    const copy = text("guides/settings");
    for (const term of [
      "other open windows",
      "active archive",
      "application-wide",
      "Retry",
      "General",
      "Appearance",
      "Library",
      "Reader",
      "Archives",
      "Storage",
      "Dictionaries",
      "Keyboard",
    ])
      expect(copy).toContain(term);
    link("guides/settings", "../../reference/troubleshooting/");
  });
  it("explains dictionary ordering, import compatibility, offline limits, and recovery", () => {
    const copy = text("guides/dictionaries");
    for (const term of [
      "All",
      "Installed",
      "Not installed",
      "StarDict",
      ".ifo",
      ".idx",
      ".dict",
      "Enable",
      "Move earlier",
      "Move later",
      "Remove",
      "Download again",
      "Rebuild index",
      "offline",
      "inflected",
      "exact",
      "Source",
      "No definitions found",
      "Try again",
    ])
      expect(copy).toContain(term);
    expect(copy).toContain("original import files");
  });
  it("documents binding capture, cancellation, conflict handling, and both reset scopes", () => {
    const copy = text("guides/keyboard-shortcuts");
    for (const term of [
      "Change",
      "Save shortcut",
      "Cancel",
      "Clear",
      "Unassigned",
      "Reset",
      "Reset all",
      "Restore default shortcuts",
      "conflict",
      "Fixed Interaction Keys",
    ])
      expect(copy).toContain(term);
    link("guides/keyboard-shortcuts", "../quick-actions/");
  });
  it("explains temporary theme previews, warning acknowledgement, update and reload failures", () => {
    const copy = text("customization/theme-manager");
    for (const term of [
      "Preview",
      "Revert",
      "Escape",
      "contrast warning",
      "Use theme",
      "Update theme",
      "Remove theme",
      "Reload themes",
      "Retry",
      "imported",
    ])
      expect(copy).toContain(term);
    link("customization/theme-manager", "../custom-themes/");
    link("customization/custom-themes", "../theme-manager/");
  });
  it("keeps focused recovery, export, and onboarding links reachable", () => {
    link("guides/reading", "../../reference/annotation-export/");
    link("guides/file-management", "../../reference/archive-storage/");
    link("guides/file-management", "../../reference/troubleshooting/");
    link("getting-started/archives", "../../reference/archive-storage/");
    link("getting-started/adding-books", "../../reference/troubleshooting/#failed-scan");
    expect(text("guides/reader-navigation")).toContain("seek immediately");
    expect(text("guides/reader-navigation")).toContain("committed reading position");
  });
  it("identifies supported builds without inventing an About build hash", () => {
    const copy = text("reference/about-resources");
    for (const term of ["Version", "Windows 11", "64-bit", "local build", "local-first"])
      expect(copy).toContain(term);
    link("reference/about-resources", "https://github.com/TommyMoonn/archeion/issues");
    link("reference/about-resources", "../archive-storage/#ownership");
  });
});
