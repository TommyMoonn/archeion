import { describe, expect, it } from "vitest";
import { boundedExcerpt, extractSections } from "../plugins/searchContent";
import { resultAnnouncement, searchEntries, searchRank } from "../src/search/match";
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
    expect(entries[0].text).toBe("introduction opening prose.");
    expect(entries[1].text).toBe("body words, with punctuation. one item two items");
    expect(entries[2]).toMatchObject({
      sectionHeading: "Child heading",
      aliases: ["colour scheme", "palette"],
    });
    expect(entries[2].text).toBe(
      "one two cell one cell two code example local files keep a backup.",
    );
    expect(JSON.stringify(entries)).not.toMatch(/poison|never-execute|Final body.*first/);
  }, 15_000);

  it("rejects ambiguous section IDs and invalid aliases; bounds excerpts", async () => {
    const code = await extractSections(
      "```md\n## Code {#literal}\n```\n\n## Section {#section}",
      page,
    );
    expect(code[0].text).toContain("## code {#literal}");
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

  it("announces singular/plural/bounded/empty counts independently of details", () => {
    expect(resultAnnouncement("", 24, 10)).toBe("");
    expect(resultAnnouncement("   ", 24, 10)).toBe("");
    expect(resultAnnouncement("topic", 0, 0)).toBe("No matching results.");
    expect(resultAnnouncement("topic", 1, 1)).toBe("1 result found.");
    expect(resultAnnouncement("topic", 12, 10)).toBe("12 results found. Showing first 10.");
  });
});
