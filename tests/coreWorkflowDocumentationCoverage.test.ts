import { articleText as mdxText, articleLinks } from "./documentationMdxTestSupport";
import { describe, expect, it } from "vitest";
import {
  commandDefinitions,
  formatKeyboardBinding,
} from "../src/features/commands/commandBindings";

const articleText = (id: string) => mdxText(`guides/${id}`);

describe("core workflow documentation", () => {
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
    for (const [route, target] of [
      ["guides/library", "quick-actions"],
      ["guides/library", "metadata-covers"],
      ["guides/file-management", "metadata-covers"],
      ["guides/keyboard-shortcuts", "quick-actions"],
      ["reference/archive-storage", "metadata-covers"],
    ]) {
      expect(articleLinks(route)).toContain(`/archeion/docs/guides/${target}/`);
    }
  });
});
