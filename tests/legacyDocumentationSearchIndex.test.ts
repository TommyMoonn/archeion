import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import registry from "../docs/documentation/page-registry.json";
import {
  extractSearchEntries,
  syncDocumentationSearch,
} from "../scripts/sync-documentation-search.mjs";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (path.dirname(root) !== os.tmpdir() || !path.basename(root).startsWith("archeion-search-"))
      throw new Error("Unsafe search fixture cleanup path.");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("documentation search corpus", () => {
  it("extracts exclusive section bodies and excludes chrome and hidden helpers", async () => {
    const entries = await extractSearchEntries(
      `<nav>outside navigation</nav><article data-doc-article>
        <header class="article-header"><h1>Visible title</h1><p>Introduction</p></header>
        <details class="mobile-outline"><summary>On this page</summary>outline poison</details>
        <div class="article-heading"><h2 id="first">First heading</h2>
          <a class="heading-permalink">permalink poison</a></div>
        <p>Body <strong>words</strong>, with punctuation.</p>
        <ul><li>One item</li><li>Two items</li></ul>
        <span hidden>hidden poison</span><span aria-hidden="true">decorative poison</span>
        <span class="sr-only">helper poison</span><span style="display:none">style poison</span>
        <script>script poison</script><style>css poison</style>
        <h3 id="child" data-search-aliases="colour scheme">Child heading</h3>
        <table><tr><td>Cell one</td><td>Cell two</td></tr></table><pre><code>code example</code></pre>
        <nav>Previous Next navigation poison</nav><footer>Edit this page footer poison</footer>
        <h2 id="last">Last heading</h2><p>Final body</p></article>`,
      registry.pages[0],
      "Overview",
    );
    expect(entries.map((entry) => entry.sectionId)).toEqual(["", "first", "child", "last"]);
    expect(entries[0]).toMatchObject({
      title: "Overview",
      pageHeading: "Visible title",
      text: "introduction",
      route: "/",
      group: "overview",
      groupTitle: "Overview",
      pageType: "overview",
    });
    expect(entries[1].text).toBe("body words, with punctuation. one item two items");
    expect(entries[2]).toMatchObject({
      text: "cell one cell two code example",
      aliases: ["colour scheme"],
    });
    expect(JSON.stringify(entries)).not.toContain("poison");
    expect(entries[1].text).not.toContain("final body");
  });

  it("bounds excerpts and rejects ambiguous section destinations", async () => {
    const entries = await extractSearchEntries(
      `<article data-doc-article><header class="article-header"><h1>Title</h1></header><h2 id="long">Long</h2><p>${"useful words ".repeat(80)}</p></article>`,
      registry.pages[0],
      "Overview",
    );
    expect(entries[1].excerpt.length).toBeLessThanOrEqual(240);
    expect(entries[1].excerpt).toMatch(/…$/);
    await expect(
      extractSearchEntries(
        `<article data-doc-article><header class="article-header"><h1>Title</h1></header><h2 id="same">A</h2><h3 id="same">B</h3></article>`,
        registry.pages[0],
        "Overview",
      ),
    ).rejects.toThrow(/unique stable/);
  });

  it("reproduces the committed corpus without writing", async () => {
    const target = "docs/documentation/assets/docs-search-index.js";
    const before = fs.readFileSync(target, "utf8");
    expect(await syncDocumentationSearch()).toMatchObject({
      changed: false,
      pageCount: registry.pages.length,
    });
    expect(fs.readFileSync(target, "utf8")).toBe(before);
  }, 30_000);

  it("generates from a source-only clone deterministically and detects stale article text", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "archeion-search-"));
    roots.push(root);
    for (const source of [
      "docs/documentation/page-registry.json",
      ".prettierrc.json",
      ...registry.pages.map((page) => page.sourcePath),
    ]) {
      fs.mkdirSync(path.dirname(path.join(root, source)), { recursive: true });
      fs.copyFileSync(source, path.join(root, source));
    }
    const target = path.join(root, "docs/documentation/assets/docs-search-index.js");
    // Registry array order is not canonical order, even in a freshly populated checkout.
    fs.writeFileSync(
      path.join(root, "docs/documentation/page-registry.json"),
      JSON.stringify({
        ...registry,
        groups: [...registry.groups].reverse(),
        pages: [...registry.pages].reverse(),
      }),
    );
    expect(await syncDocumentationSearch(root)).toMatchObject({ changed: true });
    expect(fs.existsSync(target)).toBe(false);
    await syncDocumentationSearch(root, { check: false });
    const before = fs.readFileSync(target, "utf8");
    expect(before).toBe(fs.readFileSync("docs/documentation/assets/docs-search-index.js", "utf8"));
    expect(await syncDocumentationSearch(root, { check: false })).toMatchObject({ changed: false });
    const source = path.join(root, registry.pages[0].sourcePath);
    fs.writeFileSync(
      source,
      fs
        .readFileSync(source, "utf8")
        .replace("</article>", "<p>New searchable body term</p></article>"),
    );
    expect(await syncDocumentationSearch(root)).toMatchObject({ changed: true });
    expect(fs.readFileSync(target, "utf8")).toBe(before);
  }, 30_000);
});
