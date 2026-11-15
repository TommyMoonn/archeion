import fs from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import registry from "../docs/documentation/page-registry.json";
import { verifyDocumentationLinks } from "./documentationLinkTestSupport";

const windows: Window[] = [];
afterEach(async () => {
  await Promise.all(windows.splice(0).map((window) => window.happyDOM.abort()));
});

function readPage(sourcePath: string) {
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  windows.push(window);
  window.document.write(fs.readFileSync(sourcePath, "utf8"));
  return window.document;
}

const text = (element: Element) => element.textContent?.replace(/\s+/g, " ").trim();

describe("semantic documentation articles", () => {
  it("checks the full link corpus with one source read per page, including same-page permalinks", async () => {
    const reads = vi.spyOn(fs, "readFileSync");
    try {
      await verifyDocumentationLinks(registry.pages.map((page) => page.sourcePath));
      expect(reads.mock.calls.map(([file]) => path.resolve(String(file))).sort()).toEqual(
        registry.pages.map((page) => path.resolve(page.sourcePath)).sort(),
      );
    } finally {
      reads.mockRestore();
    }
  });
  it.each(registry.pages)("$id has static named permalinks and canonical source links", (page) => {
    const document = readPage(page.sourcePath);
    const article = document.querySelector("[data-doc-article]")!;
    expect(article.getAttribute("data-page-type")).toBe(page.type);
    expect(article.querySelectorAll("h1")).toHaveLength(1);
    expect(article.querySelector(".doc-card, .doc-card-grid, .feature-list, .steps")).toBeNull();
    expect(article.querySelector("ol li > span")).toBeNull();
    for (const callout of article.querySelectorAll(".notice")) {
      expect(callout.getAttribute("role")).toBe("note");
      expect(text(callout.querySelector("strong")!)).toBeTruthy();
    }
    for (const instruction of article.querySelectorAll("ol li > strong:first-child")) {
      // Inline labels may end a sentence; punctuation separates words just as whitespace does.
      expect(instruction.nextSibling?.textContent).toMatch(/^(?:\s|[.,:;!?])/);
    }
    let level = 1;
    for (const heading of article.querySelectorAll("h2, h3")) {
      const nextLevel = Number(heading.tagName.slice(1));
      expect(nextLevel - level).toBeLessThanOrEqual(1);
      level = nextLevel;
      expect(heading.id).toBeTruthy();
      expect(document.querySelectorAll(`[id="${heading.id}"]`)).toHaveLength(1);
      const link = heading.nextElementSibling!;
      expect(link.className).toBe("heading-permalink");
      expect(link.getAttribute("href")).toBe(`#${heading.id}`);
      expect(link.getAttribute("aria-label")).toBe(`Link to section: ${text(heading)}`);
      expect(link.querySelector('[aria-hidden="true"]')).not.toBeNull();
      expect(link.hasAttribute("aria-hidden")).toBe(false);
      expect(heading.querySelector("a")).toBeNull();
    }
    const footer = document.querySelector(".docs-footer")!;
    const edit = footer.querySelector("[data-doc-edit]")!;
    expect(edit.getAttribute("href")).toBe(
      page.type === "changelog"
        ? "https://github.com/TommyMoonn/archeion/blob/main/release-notes/README.md"
        : `https://github.com/TommyMoonn/archeion/edit/main/${page.sourcePath}`,
    );
    expect(text(edit)).toBe(
      page.type === "changelog" ? "Release-note authoring ↗" : "Edit this page ↗",
    );
    expect(footer.querySelector("[data-doc-report]")?.getAttribute("href")).toBe(
      "https://github.com/TommyMoonn/archeion/issues",
    );
    expect(article.contains(footer)).toBe(false);
  });

  it("routes to every published article through compact overview lists", () => {
    const sourcePath = "docs/documentation/index.html";
    const article = readPage(sourcePath).querySelector("[data-doc-article]")!;
    const links = [...article.querySelectorAll("li > a")];
    expect(
      links.map((link) =>
        path.resolve(path.dirname(sourcePath), link.getAttribute("href")!, "index.html"),
      ),
    ).toEqual(registry.pages.slice(1).map((page) => path.resolve(page.sourcePath)));
    expect([...article.querySelectorAll("h2")].map(text)).toEqual([
      "Getting started",
      "Using Archeion",
      "Customization",
      "Reference",
      "Changelog",
    ]);
    expect(article.textContent).toContain("Changelog");
  });

  it("keeps onboarding ordered, reference tables consultable, and code examples intact", () => {
    const installing = readPage("docs/documentation/getting-started/installing/index.html");
    const orderedSteps = [...installing.querySelectorAll("[data-doc-article] ol")];
    expect(orderedSteps).toHaveLength(3);
    expect(orderedSteps.map((list) => list.querySelectorAll("li").length)).toEqual([3, 3, 3]);
    expect(text(orderedSteps[2])).toContain("Update now");
    expect(text(orderedSteps[2])).toContain("Restart now");
    expect(installing.querySelector("#after-installing")?.tagName).toBe("P");
    expect(text(installing.querySelector("[data-doc-article]")!)).toContain(
      "Archive Manager opens",
    );
    const themes = readPage("docs/documentation/customization/custom-themes/index.html");
    expect(themes.querySelectorAll("[data-doc-article] table")).toHaveLength(3);
    expect(themes.querySelectorAll("[data-doc-article] pre code")).toHaveLength(4);
    const storage = readPage("docs/documentation/reference/archive-storage/index.html");
    expect(storage.querySelector("#archive-data")).not.toBeNull();
    expect(storage.querySelector("#application-data")).not.toBeNull();
    expect(storage.querySelector("#maintenance")).not.toBeNull();
  });
});
