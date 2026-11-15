import { describe, expect, it } from "vitest";
import { documents, documentForRoute } from "./documentationMdxTestSupport";

describe("MDX documentation articles", () => {
  it("contains exactly 24 unique public identities and routes", () => {
    expect(documents).toHaveLength(24);
    for (const field of ["id", "slug"]) {
      expect(new Set(documents.map((doc) => doc.metadata[field])).size).toBe(24);
    }
  });
  it.each(documents)("$metadata.id has factual metadata and semantic authored content", (doc) => {
    for (const key of ["id", "title", "sidebar_label", "description", "slug", "doc_type"])
      expect(doc.metadata[key], key).toBeTruthy();
    expect(doc.source).not.toMatch(/dangerouslySetInnerHTML|<html|<body|<article|<script/i);
    expect(doc.body).not.toMatch(/^# /m);
    expect(doc.body).toMatch(/^## .+ \{#[\w-]+\}$/m);
  });
  it("preserves onboarding, nonheading fragments, tables and exact JSON examples", () => {
    const install = documentForRoute("getting-started/installing").body;
    expect(install.match(/^1\. /gm)).toHaveLength(3);
    expect(install).toContain('<DocsAnchor id="after-installing" />');
    const themes = documentForRoute("customization/custom-themes").body;
    expect(themes.match(/^```\w/gm)).toHaveLength(4);
    expect(themes.match(/^\|\s*-+/gm)).toHaveLength(3);
    expect(themes).toContain("    └── theme.json");
    for (const example of themes.matchAll(/```json\n([\s\S]*?)```/g))
      expect(JSON.parse(example[1])).toHaveProperty("schemaVersion", 1);
  });
});
