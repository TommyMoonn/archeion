import fs from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import registry from "../docs/documentation/page-registry.json";
import {
  commandDefinitions,
  formatKeyboardBinding,
} from "../src/features/commands/commandBindings";
import { resolveLocalPage } from "./documentationLinkTestSupport";

const guides = [
  { id: "quick-actions", title: "Quick Actions", search: "command" },
  { id: "metadata-covers", title: "Metadata and covers", search: "embedded cover" },
] as const;
const windows: Window[] = [];
afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.abort()));
});

function documentFor(sourcePath: string) {
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  windows.push(window);
  window.document.write(fs.readFileSync(sourcePath, "utf8"));
  return window.document;
}

function articleText(id: string) {
  return documentFor(`docs/documentation/guides/${id}/index.html`)
    .querySelector("[data-doc-article]")!
    .textContent.replace(/\s+/g, " ")
    .trim();
}

describe("core workflow documentation", () => {
  it.each(guides)("publishes $title as a searchable, ordered guide on every page", (guide) => {
    const sourcePath = `docs/documentation/guides/${guide.id}/index.html`;
    expect(registry.pages.find((page) => page.id === guide.id)).toMatchObject({
      route: `/guides/${guide.id}/`,
      title: guide.title,
      group: "using-archeion",
      type: "guide",
      sourcePath,
    });
    expect(fs.existsSync(sourcePath)).toBe(true);
    for (const page of registry.pages) {
      const document = documentFor(page.sourcePath);
      const link = [...document.querySelectorAll("[data-sidebar] [data-doc-link]")].find(
        (link) => link.textContent.trim() === guide.title,
      )!;
      expect(link, page.sourcePath).toBeDefined();
      expect(resolveLocalPage(page.sourcePath, link.getAttribute("href")!)?.file).toBe(
        path.resolve(sourcePath),
      );
      expect(link.getAttribute("data-search")).toContain(guide.search);
      expect(link.getAttribute("aria-current")).toBe(page.id === guide.id ? "page" : null);
    }
    const home = documentFor("docs/documentation/index.html");
    expect(
      [...home.querySelectorAll("[data-doc-article] li > a")].some(
        (link) => link.getAttribute("href") === `guides/${guide.id}/`,
      ),
    ).toBe(true);
  });

  it("documents the current shortcut, context, fixed palette keys, and nested confirmation", () => {
    const text = articleText("quick-actions");
    expect(text).toContain(
      formatKeyboardBinding(commandDefinitions.quickActions.defaultBinding!, "windows-linux")
        .split("+")
        .join(" + "),
    );
    for (const term of [
      "Open Quick Actions",
      "Search Quick Actions",
      "Up Arrow",
      "Down Arrow",
      "Home",
      "End",
      "Page Up",
      "Page Down",
      "Enter",
      "Escape",
      "Backspace",
      "Change theme",
      "Change display density",
      "Change view",
      "Change sort",
      "Change card size",
      "Switch archive",
      "Open Settings",
      "Search books",
      "Go to Library",
      "Settings window",
      "Settings → Keyboard",
    ])
      expect(text).toContain(term);
    expect(text).toMatch(/unavailable[^.]*reason/i);
    expect(text).toMatch(/Escape[^.]*returns[^.]*command list/i);
    expect(text).toMatch(/preview[^.]*not[^.]*saved/i);
    expect(text).toMatch(/contrast warnings/i);
    expect(text).toMatch(/shortcut[^.]*works in standalone Settings/i);
    expect(text).toMatch(/Library and Reader commands are absent/i);
    expect(text).toMatch(
      /Reading-history and page-turn controls stay in the Reader rather than palette results/i,
    );
    expect(text).not.toMatch(/search (?:inside|the text of) all books|full-text search/i);
  });

  it("distinguishes individual metadata, bulk edits, embedded cover writes, and safe recovery", () => {
    const text = articleText("metadata-covers");
    for (const term of [
      "Details",
      "Edit metadata",
      "Edit EPUB metadata",
      "Core metadata",
      "Publishing metadata",
      "Series metadata",
      "Tags and description",
      "Identifier",
      "Pending changes",
      "Write metadata to EPUB",
      "Select books",
      "Review changes",
      "Review metadata changes",
      "Replace",
      "Add",
      "Remove",
      "File unavailable",
      "Replace cover",
      "Replace embedded cover",
      "Choose image",
      "Crop",
      "Fit",
      "2:3",
      "Write cover to EPUB",
      "Keep EPUB writeback backup",
      "EPUB writeback backups",
    ])
      expect(text).toContain(term);
    expect(text).toMatch(/each EPUB[^.]*independently/i);
    expect(text).toMatch(/unchecked[^.]*untouched/i);
    expect(text).toMatch(/Identifier[^.]*read-only/i);
    expect(text).toMatch(/changed[^.]*refuses[^.]*replace/i);
    expect(text).toMatch(/off by default/i);
    expect(text).not.toMatch(/always restores|all[- ]or[- ]nothing|app-only cover override/i);
  });

  it("links related tasks to their canonical workflow home", () => {
    for (const [sourcePath, targetId] of [
      ["docs/documentation/guides/library/index.html", "quick-actions"],
      ["docs/documentation/guides/library/index.html", "metadata-covers"],
      ["docs/documentation/guides/file-management/index.html", "metadata-covers"],
      ["docs/documentation/guides/keyboard-shortcuts/index.html", "quick-actions"],
      ["docs/documentation/reference/archive-storage/index.html", "metadata-covers"],
    ]) {
      const article = documentFor(sourcePath).querySelector("[data-doc-article]")!;
      expect(
        [...article.querySelectorAll("a[href]")].some(
          (link) =>
            resolveLocalPage(sourcePath, link.getAttribute("href")!)?.file ===
            path.resolve(`docs/documentation/guides/${targetId}/index.html`),
        ),
        sourcePath,
      ).toBe(true);
    }
  });
});
