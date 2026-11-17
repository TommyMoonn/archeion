import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { boundedExcerpt, extractSections } from "../plugins/searchContent";
import {
  resultAnnouncement,
  searchContextExcerpt,
  searchEntries,
  searchRank,
} from "../src/search/match";
import { SearchHighlight } from "../src/components/docs/SearchHighlight";
import type { SearchEntry, SearchPage } from "../src/search/types";

const page: SearchPage = {
  id: "guide",
  title: "Guide",
  heading: "A guide",
  group: "Reference",
  href: "/archeion/docs/guide/",
  description: "Introduction",
  overviewTitle: "Guide",
  overviewDescription: "Short summary",
};
const entry = (fields: Partial<SearchEntry>): SearchEntry => ({
  ...page,
  sectionId: "",
  sectionHeading: "",
  aliases: [],
  text: "",
  excerpt: "",
  ...fields,
});

describe("MDX local search", () => {
  // Cold MDX/GFM ESM startup can exceed Vitest's 5s default on Windows.
  it("parses exclusive introduction and h2/h3 bodies, tables, code, notes and aliases without executing MDX", async () => {
    const entries = await extractSections(
      `---
id: "guide"
---
import Secret from "never-execute";

Opening prose.

## First heading {#first}

Body **words**, with punctuation.

- One item
- Two items

<span hidden>hidden poison</span>
<span aria-hidden="true">decorative poison</span>
<span className="sr-only">helper poison</span>
<button>control poison</button>
<DocsAnchor id="anchor" />

### Child heading {#child}

<span data-search-aliases="colour scheme|palette" />

| One | Two |
| --- | --- |
| Cell one | Cell two |

\`\`\`text
code example
\`\`\`

<DocsNotice title="Local files">

Keep a backup.

</DocsNotice>

## Last {#last}

Final body`,
      page,
    );
    expect(entries.map((item) => item.sectionId)).toEqual(["", "first", "child", "last"]);
    expect(entries[0].text).toBe("Introduction Opening prose.");
    expect(entries[1].text).toBe("Body words, with punctuation. One item Two items");
    expect(entries[2]).toMatchObject({
      sectionHeading: "Child heading",
      aliases: ["colour scheme", "palette"],
    });
    expect(entries[2].text).toBe(
      "One Two Cell one Cell two code example Local files Keep a backup.",
    );
    expect(JSON.stringify(entries)).not.toMatch(/poison|never-execute|Final body.*first/);
    expect(entries[1].excerpt).toContain("Body words");
  }, 15_000);

  it("rejects ambiguous section IDs and invalid aliases; bounds excerpts", async () => {
    const code = await extractSections(
      "```md\n## Code {#literal}\n```\n\n## Section {#section}",
      page,
    );
    expect(code[0].text).toContain("## Code {#literal}");
    expect(code.map((entry) => entry.sectionId)).toEqual(["", "section"]);
    await expect(extractSections("## First {#same}\n\n### Second {#same}", page)).rejects.toThrow(
      /unique stable/,
    );
    await expect(extractSections("## Missing ID", page)).rejects.toThrow(/unique stable/);
    await expect(extractSections('<span data-search-aliases="same|same" />', page)).rejects.toThrow(
      /unique/,
    );
    expect(boundedExcerpt("word ".repeat(100)).length).toBeLessThanOrEqual(240);
    expect(boundedExcerpt("x".repeat(300))).toHaveLength(239);
    expect(boundedExcerpt("short")).toBe("short");
  });

  it("ranks title, section, alias and body, with canonical order ties before bounding", () => {
    const entries = [
      entry({ text: "needle" }),
      entry({ aliases: ["needle"] }),
      entry({ sectionId: "needle", sectionHeading: "Needle" }),
      entry({ title: "Needle" }),
      entry({ title: "Needle two" }),
    ];
    expect(searchEntries(entries, " NEEDLE ", 3)).toEqual({
      total: 5,
      entries: [entries[3], entries[4], entries[2]],
    });
    expect(searchRank(entry({ sectionId: "other", title: "Needle" }), "needle")).toBe(-1);
    expect(searchEntries(entries, "").entries).toEqual([
      entries[0],
      entries[1],
      entries[3],
      entries[4],
    ]);
    expect(searchRank(entry({ text: "first intervening second" }), "second first")).toBe(3);
    expect(searchRank(entry({ group: "Using Archeion" }), "using archeion")).toBe(3);
    expect(searchRank(entry({ description: "Useful summary" }), "useful summary")).toBe(3);
  });

  it("shows a bounded, case-preserving excerpt for body matches without changing ranked results", () => {
    const opening = "Start of the section. ".repeat(18);
    const body = `${opening}The Reader supports MATCHING DIGEST verification, with safe file handling. ${"Additional details. ".repeat(15)}`;
    const match = entry({
      sectionId: "details",
      sectionHeading: "Details",
      text: body,
      excerpt: opening.slice(0, 239) + "…",
    });
    const title = entry({ title: "Matching digest" });
    const alias = entry({ aliases: ["matching digest"] });
    const heading = entry({ sectionId: "name", sectionHeading: "Matching digest" });
    const results = searchEntries([match, alias, heading, title], "MATCHING DIGEST");
    expect(results.entries).toEqual([title, heading, alias, match]);
    for (const result of [title, heading, alias])
      expect(searchContextExcerpt(result, "matching digest")).toBeNull();
    const snippet = searchContextExcerpt(match, "matching digest");
    if (!snippet) throw new Error("Missing body-match excerpt");
    expect(snippet.length).toBeLessThanOrEqual(160);
    expect(snippet).toContain("MATCHING DIGEST verification");
    expect(snippet).toMatch(/^…/);
    expect(snippet).toMatch(/…$/);
    const markup = renderToStaticMarkup(
      createElement(SearchHighlight, { text: snippet!, query: "matching digest" }),
    );
    expect(markup).toContain("<mark");
    expect(markup).toContain("MATCHING");
    expect(markup).toContain("DIGEST");
  });

  it("keeps short generated excerpts and handles punctuation, HTML-like text, and group matches safely", () => {
    const short = entry({
      sectionId: "intro",
      sectionHeading: "Introduction",
      text: "Use Ctrl+K to find <script>alert('x')</script> safely.",
      excerpt: "Use Ctrl+K to find <script>alert('x')</script> safely.",
    });
    expect(searchContextExcerpt(short, "CTRL+K")).toBe(short.excerpt);
    const snippet = searchContextExcerpt(short, "script");
    if (!snippet) throw new Error("Missing HTML-like excerpt");
    const markup = renderToStaticMarkup(
      createElement(SearchHighlight, { text: snippet!, query: "script" }),
    );
    expect(markup).toContain("&lt;");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("<mark");
    expect(searchContextExcerpt(entry({ group: "Using Archeion" }), "using archeion")).toBeNull();
    expect(searchContextExcerpt(short, "")).toBeNull();
    expect(searchContextExcerpt(short, "missing")).toBeNull();
  });

  it("finds a highlighted excerpt from a real Archive Health body section", async () => {
    const source = await readFile(new URL("../docs/archive-health.mdx", import.meta.url), "utf8");
    const sections = await extractSections(source, {
      ...page,
      id: "archive-health",
      title: "Archive health",
    });
    const found = searchEntries(sections, "matching digest");
    expect(found.total).toBe(1);
    expect(found.entries[0].sectionId).toBe("duplicates");
    const snippet = searchContextExcerpt(found.entries[0], "matching digest");
    if (!snippet) throw new Error("Missing Archive Health excerpt");
    expect(snippet.toLowerCase()).toContain("matching digest");
    expect(snippet.length).toBeLessThanOrEqual(160);
  });

  it("announces singular/plural/bounded/empty counts independently of details", () => {
    expect(resultAnnouncement("", 24, 10)).toBe("");
    expect(resultAnnouncement("   ", 24, 10)).toBe("");
    expect(resultAnnouncement("topic", 0, 0)).toBe("No matching results.");
    expect(resultAnnouncement("topic", 1, 1)).toBe("1 result found.");
    expect(resultAnnouncement("topic", 12, 10)).toBe("12 results found. Showing first 10.");
  });
});
