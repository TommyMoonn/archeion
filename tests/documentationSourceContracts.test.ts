import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkDocumentationSources } from "../scripts/check-documentation-sources.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== path.resolve(os.tmpdir()) ||
      !path.basename(root).startsWith("archeion-docs-source-")
    )
      throw new Error("Unsafe source fixture cleanup path");
    fs.rmSync(root, { recursive: true, force: true });
  }
});
function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archeion-docs-source-"));
  roots.push(root);
  fs.cpSync("website/docs", path.join(root, "website/docs"), { recursive: true });
  fs.copyFileSync("website/sidebars.ts", path.join(root, "website/sidebars.ts"));
  fs.cpSync("release-notes", path.join(root, "release-notes"), { recursive: true });
  return root;
}

describe("Node-only documentation source contracts", () => {
  it("checks sources in isolation without a website install, build or projection", () => {
    const root = fixture();
    expect(checkDocumentationSources(root)).toEqual({ pageCount: 24 });
    expect(fs.existsSync(path.join(root, "website/src/generated"))).toBe(false);
    expect(fs.existsSync(path.join(root, "node_modules"))).toBe(false);
  });
  it.each([
    ["missing title", 'title: "Changelog"', 'title: ""'],
    ["duplicate route", 'slug: "/changelog/"', 'slug: "/"'],
    ["malformed metadata", 'title: "Changelog"', "title: Changelog"],
    ["authored history", "<ReleaseTimeline />", "## v1.8.0 {#release-1-8-0}"],
    [
      "unknown route",
      "<ReleaseTimeline />",
      "<ReleaseTimeline />\n[missing](/archeion/docs/missing/)",
    ],
    ["unknown fragment", "<ReleaseTimeline />", "<ReleaseTimeline />\n[missing](#missing)"],
    ["unstable heading", "<ReleaseTimeline />", "<ReleaseTimeline />\n## Missing ID"],
  ])("rejects %s without writing", (_name, before, after) => {
    const root = fixture();
    const file = path.join(root, "website/docs/changelog.mdx");
    const source = fs.readFileSync(file, "utf8").replace(before, after);
    fs.writeFileSync(file, source);
    expect(() => checkDocumentationSources(root)).toThrow();
    expect(fs.readFileSync(file, "utf8")).toBe(source);
  });
  it("rejects sidebar omissions and duplicate membership", () => {
    const root = fixture();
    const file = path.join(root, "website/sidebars.ts");
    const source = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, source.replace('"changelog"', '"overview"'));
    expect(() => checkDocumentationSources(root)).toThrow(/Sidebar/);
  });
});
