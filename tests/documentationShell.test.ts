import fs from "node:fs";
import path from "node:path";
import { Window } from "happy-dom";
import { afterEach, describe, expect, it } from "vitest";
import registry from "../docs/documentation/page-registry.json";

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

const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, " ").trim();
const destination = (sourcePath: string, link: Element | null) =>
  path.resolve(path.dirname(sourcePath), link!.getAttribute("href")!, "index.html");

describe("documentation shell", () => {
  it.each(registry.pages)("$id publishes the simplified static chrome", (page) => {
    const document = readPage(page.sourcePath);
    const header = document.querySelector(".docs-header")!;
    const brand = header.querySelector(".docs-brand");
    expect(text(brand)).toBe("Archeion Docs");
    expect(destination(page.sourcePath, brand)).toBe(path.resolve("docs/documentation/index.html"));
    const home = header.querySelector(".docs-home-link");
    expect(text(home)).toBe("Home ↗");
    expect(destination(page.sourcePath, home)).toBe(path.resolve("docs/index.html"));
    expect(
      document.querySelector(".breadcrumbs, .article-header .eyebrow, .docs-sidebar__footer"),
    ).toBeNull();
    expect(document.querySelectorAll('[data-sidebar] [aria-current="page"]')).toHaveLength(1);
    expect(document.querySelector('a[href="#main-content"]')?.textContent).toBe("Skip to content");
    expect(document.querySelectorAll("main")).toHaveLength(1);
    expect(
      [...header.querySelectorAll("a")].some((link) => /release notes/i.test(link.textContent)),
    ).toBe(false);
  });

  it("does not repeat a header summary as the immediate article lead", () => {
    for (const page of registry.pages) {
      const document = readPage(page.sourcePath);
      const summary = document.querySelector(".article-header > p:last-child");
      const lead = document.querySelector(".doc-article > .lead");
      if (lead) expect(text(lead), page.id).not.toBe(text(summary));
    }
  });

  it("uses one callout surface without deleting meaningful labels or advice", () => {
    const labels: string[] = [];
    for (const page of registry.pages) {
      const document = readPage(page.sourcePath);
      for (const notice of document.querySelectorAll(".notice")) {
        expect(notice.className).toBe("notice");
        expect(text(notice.querySelector("p"))).toBeTruthy();
        labels.push(text(notice.querySelector("strong"))!);
      }
    }
    expect(labels).toEqual([
      "Supported platform",
      "Use the official release page",
      "Your folders stay in place",
      "Check the destination before moving files",
      "Copy the complete archive",
      "Themes are application-wide",
    ]);
  });
});
