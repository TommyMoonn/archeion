import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import registry from "../docs/documentation/page-registry.json";
import {
  pageTypes,
  syncDocumentationNavigation,
  validateRegistry,
} from "../scripts/sync-documentation-navigation.mjs";

const projectRoot = process.cwd();
const registryPath = path.join(projectRoot, "docs/documentation/page-registry.json");
const windows: Window[] = [];
const fixtureRoots: string[] = [];

afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.abort()));
  for (const root of fixtureRoots.splice(0)) {
    if (
      path.dirname(root) !== path.resolve(os.tmpdir()) ||
      !path.basename(root).startsWith("archeion-doc-nav-")
    )
      throw new Error("Unsafe fixture cleanup path.");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function parseHtml(html: string) {
  const window = new Window({ settings: { disableJavaScriptEvaluation: true } });
  windows.push(window);
  window.document.write(html);
  return window.document;
}

function documentFor(route: string) {
  return parseHtml(
    fs.readFileSync(path.join(projectRoot, "docs/documentation", route, "index.html"), "utf8"),
  );
}

function createFixture(data = registry) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archeion-doc-nav-"));
  fixtureRoots.push(root);
  for (const sourcePath of [
    ...data.pages.map((page) => page.sourcePath),
    "docs/documentation/page-registry.json",
    ".prettierrc.json",
  ]) {
    fs.mkdirSync(path.dirname(path.join(root, sourcePath)), { recursive: true });
    fs.copyFileSync(path.join(projectRoot, sourcePath), path.join(root, sourcePath));
  }
  fs.writeFileSync(path.join(root, "docs/documentation/page-registry.json"), JSON.stringify(data));
  return root;
}

function sourceBytes(root: string, pages = registry.pages) {
  return pages.map((page) => fs.readFileSync(path.join(root, page.sourcePath), "utf8"));
}

async function createRepairFixture() {
  // Link repair needs adjacent pages and multiple groups, not repeated full-site formatting.
  // The committed-output and new-page tests retain the complete registry contract.
  const data = structuredClone(registry);
  data.pages = data.pages.filter((page) =>
    ["overview", "settings", "dictionaries"].includes(page.id),
  );
  data.groups = data.groups.filter((group) => data.pages.some((page) => page.group === group.id));
  data.sequence = { first: data.pages[0].id, last: data.pages.at(-1)!.id };
  const root = createFixture(data);
  await syncDocumentationNavigation(root, { check: false });
  return { root, pages: data.pages };
}

describe("documentation navigation contract", () => {
  it("has a canonical page registry rather than independently maintained navigation", () => {
    expect(fs.existsSync(registryPath)).toBe(true);
  });

  it.each([
    ["guides/file-management", "../reader-media/", "../settings/"],
    ["guides/settings", "../file-management/", "../dictionaries/"],
    ["guides/dictionaries", "../settings/", "../keyboard-shortcuts/"],
    ["guides/keyboard-shortcuts", "../dictionaries/", "../../customization/appearance/"],
    ["customization/theme-manager", "../custom-themes/", "../../reference/archive-storage/"],
    ["reference/archive-storage", "../../customization/theme-manager/", "../troubleshooting/"],
    ["reference/troubleshooting", "../archive-storage/", "../annotation-export/"],
    ["reference/annotation-export", "../troubleshooting/", "../about-resources/"],
    ["reference/about-resources", "../annotation-export/", null],
    ["", null, "getting-started/installing/"],
  ])("%s links to its immediate sequence neighbors", (route, previous, next) => {
    const document = documentFor(route!);
    const pager = document.querySelector('nav[aria-label="Documentation pages"]');
    expect(pager).not.toBeNull();
    for (const [direction, href] of [
      ["previous", previous],
      ["next", next],
    ]) {
      expect(
        pager?.querySelector(`.article-pager__item--${direction}`)?.getAttribute("href") ?? null,
      ).toBe(href);
    }
  });

  it("publishes an explicit page type alongside static article content", () => {
    expect(
      documentFor("guides/settings")
        .querySelector("[data-doc-article]")
        ?.getAttribute("data-page-type"),
    ).toBe("guide");
  });

  it("publishes every group, page, type, and adjacent pager from the registry", () => {
    const { groups, pages } = validateRegistry(registry);
    expect(pageTypes).toEqual([
      "overview",
      "getting-started",
      "guide",
      "reference",
      "troubleshooting",
      "changelog",
    ]);
    for (const [index, page] of pages.entries()) {
      const document = documentFor(page.route.slice(1));
      const sidebar = document.querySelector("[data-sidebar]")!;
      const links = Array.from(sidebar.querySelectorAll("[data-doc-link]"));
      expect(links.map((link) => link.textContent?.trim())).toEqual(
        pages.map((item: (typeof registry.pages)[number]) => item.title),
      );
      expect(
        Array.from(sidebar.querySelectorAll("[data-sidebar-group-toggle] span")).map(
          (span) => span.textContent,
        ),
      ).toEqual(groups.map((group: (typeof registry.groups)[number]) => group.title));
      expect(links.filter((link) => link.getAttribute("aria-current") === "page")).toEqual([
        links[index],
      ]);
      for (const [linkIndex, link] of links.entries()) {
        const target = path.resolve(
          path.dirname(path.join(projectRoot, page.sourcePath)),
          link.getAttribute("href")!,
          "index.html",
        );
        expect(target).toBe(path.join(projectRoot, pages[linkIndex].sourcePath));
        expect(link.getAttribute("data-search")).toContain(pages[linkIndex].title.toLowerCase());
      }
      for (const button of sidebar.querySelectorAll("[data-sidebar-group-toggle]")) {
        expect(
          sidebar.querySelector(`[id="${button.getAttribute("aria-controls")}"]`),
        ).not.toBeNull();
        expect(button.getAttribute("aria-expanded")).toBe("true");
      }
      expect(document.querySelector("[data-doc-article]")?.getAttribute("data-page-type")).toBe(
        page.type,
      );
      for (const [direction, neighbor] of [
        ["prev", pages[index - 1]],
        ["next", pages[index + 1]],
      ] as const) {
        const link = document.querySelector(`.article-pager a[rel="${direction}"]`);
        if (!neighbor) expect(link).toBeNull();
        else {
          expect(link?.querySelector("strong")?.textContent).toBe(neighbor.title);
          expect(
            path.resolve(
              path.dirname(path.join(projectRoot, page.sourcePath)),
              link!.getAttribute("href")!,
              "index.html",
            ),
          ).toBe(path.join(projectRoot, neighbor.sourcePath));
        }
      }
    }
  });

  it("checks committed output without writing and is already reproducible", async () => {
    const before = sourceBytes(projectRoot);
    expect(await syncDocumentationNavigation(projectRoot)).toEqual({
      pageCount: registry.pages.length,
      changedPaths: [],
    });
    expect(sourceBytes(projectRoot)).toEqual(before);
  });

  it.each([
    [
      "schema",
      (data: typeof registry) => {
        data.schemaVersion = 2;
      },
      /schema version/,
    ],
    [
      "duplicate ID",
      (data: typeof registry) => {
        data.pages[1].id = data.pages[0].id;
      },
      /duplicate ID/,
    ],
    [
      "duplicate route",
      (data: typeof registry) => {
        data.pages[1].route = data.pages[0].route;
      },
      /duplicate route/,
    ],
    [
      "unsafe route",
      (data: typeof registry) => {
        data.pages[0].route = "/../outside/";
      },
      /invalid or duplicate route/,
    ],
    [
      "unsafe source",
      (data: typeof registry) => {
        data.pages[0].sourcePath = "../outside/index.html";
      },
      /source path/,
    ],
    [
      "unknown group",
      (data: typeof registry) => {
        data.pages[0].group = "missing";
      },
      /unknown navigation group/,
    ],
    [
      "unknown type",
      (data: typeof registry) => {
        data.pages[0].type = "directory-guess";
      },
      /unsupported page type/,
    ],
    [
      "duplicate order",
      (data: typeof registry) => {
        data.pages[2].order = data.pages[1].order;
      },
      /duplicate order/,
    ],
    [
      "invalid order",
      (data: typeof registry) => {
        data.groups[0].order = -1;
      },
      /non-negative integer/,
    ],
    [
      "endpoint drift",
      (data: typeof registry) => {
        data.sequence.last = "archive-storage";
      },
      /first\/last/,
    ],
    [
      "extra content",
      (data: typeof registry) => {
        Object.assign(data.pages[0], { article: "Duplicated prose" });
      },
      /must contain only/,
    ],
  ] as const)("rejects %s in the registry", (_name, mutate, error) => {
    const data = structuredClone(registry);
    mutate(data);
    expect(() => validateRegistry(data)).toThrow(error);
  });

  it("uses explicit order rather than the registry's array position", () => {
    const data = structuredClone(registry);
    data.groups.reverse();
    data.pages.reverse();
    expect(
      validateRegistry(data).pages.map((page: (typeof registry.pages)[number]) => page.id),
    ).toEqual(registry.pages.map((page) => page.id));
  });

  it("detects drift without writing, repairs only generated markup, and is idempotent", async () => {
    const { root, pages } = await createRepairFixture();
    const sourcePath = pages.find((page) => page.id === "settings")!.sourcePath;
    const file = path.join(root, sourcePath);
    const original = fs.readFileSync(file, "utf8");
    fs.writeFileSync(file, original.replace('href="../dictionaries/"', 'href="../reading/"'));
    const before = sourceBytes(root, pages);
    expect((await syncDocumentationNavigation(root)).changedPaths).toEqual([sourcePath]);
    expect(sourceBytes(root, pages)).toEqual(before);
    expect((await syncDocumentationNavigation(root, { check: false })).changedPaths).toEqual([
      sourcePath,
    ]);
    expect(fs.readFileSync(file, "utf8")).toBe(original);
    expect((await syncDocumentationNavigation(root, { check: false })).changedPaths).toEqual([]);
  });

  it("detects header destination drift without writing and restores generated native links", async () => {
    const { root, pages } = await createRepairFixture();
    const sourcePath = pages[0].sourcePath;
    const source = path.join(root, sourcePath);
    const original = fs.readFileSync(source, "utf8");
    fs.writeFileSync(
      source,
      original.replace('class="docs-brand" href="./"', 'class="docs-brand" href="../"'),
    );
    const before = sourceBytes(root, pages);
    expect((await syncDocumentationNavigation(root)).changedPaths).toEqual([sourcePath]);
    expect(sourceBytes(root, pages)).toEqual(before);
    await syncDocumentationNavigation(root, { check: false });
    expect(fs.readFileSync(source, "utf8")).toBe(original);
  });

  it.each(["permalink", "source link", "report link"])(
    "repairs generated %s drift without modifying authored headings or prose",
    async (kind) => {
      const { root, pages } = await createRepairFixture();
      const sourcePath = pages[1].sourcePath;
      const file = path.join(root, sourcePath);
      const original = fs.readFileSync(file, "utf8");
      const patterns = {
        permalink: 'aria-label="Link to section: Open the standalone Settings window"',
        "source link": `https://github.com/TommyMoonn/archeion/edit/main/${sourcePath}`,
        "report link": "https://github.com/TommyMoonn/archeion/issues",
      };
      expect(original).toContain(patterns[kind]);
      fs.writeFileSync(file, original.replace(patterns[kind], "incorrect-destination"));
      const before = sourceBytes(root, pages);
      expect((await syncDocumentationNavigation(root)).changedPaths).toEqual([sourcePath]);
      expect(sourceBytes(root, pages)).toEqual(before);
      await syncDocumentationNavigation(root, { check: false });
      expect(fs.readFileSync(file, "utf8")).toBe(original);
    },
  );

  it.each(["missing", "duplicate"])("rejects %s heading IDs before writing", async (mode) => {
    const { root, pages } = await createRepairFixture();
    const file = path.join(root, pages[1].sourcePath);
    const source = fs.readFileSync(file, "utf8");
    fs.writeFileSync(
      file,
      source.replace('id="sections"', mode === "missing" ? "" : 'id="ownership"'),
    );
    const before = sourceBytes(root, pages);
    await expect(syncDocumentationNavigation(root, { check: false })).rejects.toThrow(
      /unique stable IDs/,
    );
    expect(sourceBytes(root, pages)).toEqual(before);
  });

  it("derives permalink names from edited inline heading content without duplicating that content", async () => {
    const { root, pages } = await createRepairFixture();
    const file = path.join(root, pages[1].sourcePath);
    fs.writeFileSync(
      file,
      fs
        .readFileSync(file, "utf8")
        .replace(
          '<h2 id="sections">Settings sections</h2>',
          '<h2 id="sections">Settings &amp; <code>Reader</code> “defaults”</h2>',
        ),
    );
    await syncDocumentationNavigation(root, { check: false });
    const document = parseHtml(fs.readFileSync(file, "utf8"));
    const heading = document.querySelector("#sections")!;
    expect(heading.querySelector("code")?.textContent).toBe("Reader");
    expect(heading.querySelector("a")).toBeNull();
    expect(heading.nextElementSibling?.getAttribute("aria-label")).toBe(
      "Link to section: Settings & Reader “defaults”",
    );
    expect((await syncDocumentationNavigation(root)).changedPaths).toEqual([]);
  });

  it.each(["unregistered page", "missing page", "malformed region", "malformed header"])(
    "rejects %s before writing any HTML",
    async (mode) => {
      const root = createFixture();
      const first = path.join(root, registry.pages[0].sourcePath);
      fs.writeFileSync(first, fs.readFileSync(first, "utf8").replace('rel="next"', 'rel="prev"'));
      if (mode === "unregistered page") {
        const extra = path.join(root, "docs/documentation/unregistered/index.html");
        fs.mkdirSync(path.dirname(extra), { recursive: true });
        fs.copyFileSync(first, extra);
      } else if (mode === "missing page") {
        fs.rmSync(path.join(root, registry.pages.at(-1)!.sourcePath));
      } else {
        const last = path.join(root, registry.pages.at(-1)!.sourcePath);
        fs.writeFileSync(
          last,
          fs
            .readFileSync(last, "utf8")
            .replace(
              mode === "malformed header" ? "<!-- docs-header:end -->" : "<!-- docs-pager:end -->",
              "<!-- broken marker -->",
            ),
        );
      }
      const before = fs.readFileSync(first, "utf8");
      await expect(syncDocumentationNavigation(root, { check: false })).rejects.toThrow(
        mode.startsWith("malformed") ? /markers/ : /coverage mismatch/,
      );
      expect(fs.readFileSync(first, "utf8")).toBe(before);
    },
  );

  it("integrates a new registered page into every sidebar and both adjacent pagers", async () => {
    const root = createFixture();
    const data = structuredClone(registry);
    const page = {
      id: "new-guide",
      route: "/guides/new-guide/",
      title: "New guide & details",
      group: "using-archeion",
      order:
        Math.max(
          ...data.pages
            .filter((entry) => entry.group === "using-archeion")
            .map((entry) => entry.order),
        ) + 1,
      type: "troubleshooting",
      sourcePath: "docs/documentation/guides/new-guide/index.html",
    };
    data.pages.push(page);
    const source = path.join(root, page.sourcePath);
    fs.mkdirSync(path.dirname(source), { recursive: true });
    fs.copyFileSync(path.join(root, "docs/documentation/guides/settings/index.html"), source);
    fs.writeFileSync(
      path.join(root, "docs/documentation/page-registry.json"),
      JSON.stringify(data),
    );
    const article = fs
      .readFileSync(source, "utf8")
      .match(/<article[\s\S]*?<\/article>/)![0]
      .replace(/ data-page-type="[^"]*"/, "");
    expect((await syncDocumentationNavigation(root, { check: false })).changedPaths).toHaveLength(
      data.pages.length,
    );
    expect((await syncDocumentationNavigation(root)).changedPaths).toEqual([]);
    const html = fs.readFileSync(source, "utf8");
    const generatedDocument = parseHtml(html);
    expect(generatedDocument.querySelector(".docs-brand")?.getAttribute("href")).toBe("../../");
    expect(generatedDocument.querySelector(".docs-home-link")?.getAttribute("href")).toBe(
      "../../../",
    );
    expect(
      html.match(/<article[\s\S]*?<\/article>/)![0].replace(/ data-page-type="[^"]*"/, ""),
    ).toBe(article);
    expect(html).toContain('data-page-type="troubleshooting"');
    expect(generatedDocument.querySelectorAll('script[src$="docs-copy.js"]')).toHaveLength(1);
    expect(
      generatedDocument.querySelector('script[src$="docs-copy.js"]')?.getAttribute("src"),
    ).toBe("../../assets/docs-copy.js");
    expect(html).toContain("New guide &amp; details");
    expect(html).toContain('href="../keyboard-shortcuts/"');
    expect(html).toContain('href="../../customization/appearance/"');
    const preceding = fs.readFileSync(
      path.join(root, "docs/documentation/guides/keyboard-shortcuts/index.html"),
      "utf8",
    );
    const following = fs.readFileSync(
      path.join(root, "docs/documentation/customization/appearance/index.html"),
      "utf8",
    );
    expect(
      parseHtml(preceding).querySelector('.article-pager a[rel="next"]')?.getAttribute("href"),
    ).toBe("../new-guide/");
    expect(
      parseHtml(following).querySelector('.article-pager a[rel="prev"]')?.getAttribute("href"),
    ).toBe("../../guides/new-guide/");
  }, 30_000);

  it.each(["source", "registry"])(
    "refuses to apply stale output after a concurrent %s edit",
    async (owner) => {
      const root = createFixture();
      const first = path.join(root, registry.pages[0].sourcePath);
      fs.writeFileSync(first, fs.readFileSync(first, "utf8").replace('rel="next"', 'rel="prev"'));
      const operation = syncDocumentationNavigation(root, { check: false });
      const editedFile =
        owner === "source" ? first : path.join(root, "docs/documentation/page-registry.json");
      fs.appendFileSync(editedFile, "\n");
      const before = sourceBytes(root);
      await expect(operation).rejects.toThrow(/changed during navigation sync/);
      expect(sourceBytes(root)).toEqual(before);
    },
    30_000,
  );
});
