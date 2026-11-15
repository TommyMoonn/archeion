import fs from "node:fs";
import { expect, it } from "vitest";

it("keeps the React search result count separate from the result navigation", () => {
  const dialog = fs.readFileSync("website/src/components/docs/DocsSearchDialog.tsx", "utf8");
  expect(dialog.match(/role="status"/g)).toHaveLength(1);
  expect(dialog).toContain('aria-live="polite"');
  expect(dialog).toContain('aria-label="Documentation search results"');
  expect(dialog).toContain("aria-labelledby=");
  // Results expose title/context names; the retired details view has no description target.
  expect(dialog).not.toContain("aria-describedby=");
  expect(dialog).not.toContain("Show details");
  // Runtime announcement, identity, keyboard and focus contracts run in the website browser suite.
  expect(dialog).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
});
