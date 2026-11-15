import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { documents, sidebarGroups } from "./documentationMdxTestSupport";

describe("MDX search source contract (application-only)", () => {
  it("provides unique explicit section destinations across every canonical document", () => {
    for (const doc of documents) {
      const headings = [...doc.body.matchAll(/^#{2,3} .+$/gm)].map(([line]) => line);
      const ids = headings.map((line) => /\{#([a-z0-9-]+)\}$/.exec(line)?.[1]);
      expect(ids.every(Boolean), doc.metadata.id).toBe(true);
      expect(new Set(ids).size).toBe(ids.length);
    }
    expect(sidebarGroups().flatMap((group) => group.items)).toHaveLength(24);
  });
  it("builds search from framework metadata and parsed MDX independently of release rendering", () => {
    const producer = fs.readFileSync("website/plugins/search.ts", "utf8");
    const parser = fs.readFileSync("website/plugins/searchContent.ts", "utf8");
    expect(producer).toContain('allContent["docusaurus-plugin-content-docs"]');
    expect(producer).toContain("version.sidebars.documentation");
    expect(producer).not.toMatch(/page-registry|release-history|release-notes/);
    expect(parser).toContain(".parse(prepared)");
    expect(parser).not.toMatch(/compile\(|evaluate\(|innerHTML/);
  });
});
