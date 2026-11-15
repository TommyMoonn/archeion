import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseReleaseChanges, releaseInlineText } from "../scripts/release-history-markdown.mjs";
import { readAllReleaseNotes } from "../scripts/release-notes.mjs";

describe("canonical React release timeline vocabulary", () => {
  it("preserves all current release bullets and supported inline values", () => {
    for (const note of readAllReleaseNotes(process.cwd())) {
      const items = parseReleaseChanges(note.changes);
      expect(items).toHaveLength(note.changes.match(/^[-*] /gm)?.length);
      expect(items.map(releaseInlineText).join(" ")).not.toContain("**");
    }
    const items = parseReleaseChanges(
      "* Use **bold `code`** and [help](https://example.com/?a=1&b=2).\n  Continued prose with <script>text</script>.",
    );
    expect(releaseInlineText(items[0])).toBe(
      "Use bold code and help. Continued prose with <script>text</script>.",
    );
    expect(items[0]).toContainEqual({
      type: "link",
      href: "https://example.com/?a=1&b=2",
      children: [{ type: "text", value: "help" }],
    });
  });
  it.each([
    "- Item\n\nParagraph",
    "- Item\n### Heading",
    "- Item\n  - Nested",
    "- Item\n  1. Nested",
    "- Item\n  > Quote",
    "- Item\n  ```code",
    "- Item\n  | table |",
    "- Item\n  <div>block</div>",
    "- [unsafe](javascript:alert)",
    "- [unsafe](data:text/html,hello)",
    "- [relative](/help)",
    "- [protocol relative](//example.com)",
    "- [broken](https://)",
    "- ![image](https://example.com/a)",
    "- `unclosed",
    "- **unclosed",
    "- [unclosed",
    "- ``double``",
  ])("rejects unsupported or unsafe changes: %s", (changes) => {
    expect(() => parseReleaseChanges(changes)).toThrow();
  });
  it("keeps MDX composition thin and root tooling independent of website runtime", () => {
    const source = fs.readFileSync("website/docs/changelog.mdx", "utf8");
    expect(source).toContain("<ReleaseTimeline />");
    expect(source).not.toMatch(/^## v/m);
    const scripts = JSON.parse(fs.readFileSync("package.json", "utf8")).scripts;
    expect(scripts["docs:sync"]).toBe("node scripts/sync-documentation-changelog.mjs --write");
    expect(scripts["docs:check"]).toContain("check-documentation-sources.mjs");
    expect(scripts["docs:check"]).not.toMatch(/docusaurus|search|navigation|changelog-page/);
  });
});
