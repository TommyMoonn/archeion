import { describe, expect, it } from "vitest";
import { documents } from "./documentationMdxTestSupport";

describe("documentation article shell content", () => {
  it("preserves named notices and their advice", () => {
    const labels = documents.flatMap((doc) => [
      ...doc.body.matchAll(/<DocsNotice title="([^"]+)">([\s\S]*?)<\/DocsNotice>/g),
    ]);
    expect(labels.map((match) => match[1]).sort()).toEqual(
      [
        "Supported platform",
        "Use the official release page",
        "Your folders stay in place",
        "Check the destination before moving files",
        "Copy the complete archive",
        "Themes are application-wide",
        "Preserve the sidecars",
      ].sort(),
    );
    for (const [, , body] of labels) expect(body.trim().length).toBeGreaterThan(20);
  });
  it.each(documents)("$metadata.id has one summary and correct edit ownership", (doc) => {
    expect(doc.body.trim().startsWith(doc.metadata.description)).toBe(false);
    if (doc.metadata.id === "changelog") {
      expect(doc.metadata.custom_edit_url).toBe(
        "https://github.com/TommyMoonn/archeion/blob/main/release-notes/README.md",
      );
    } else expect(doc.metadata.custom_edit_url).toBeUndefined();
  });
});
