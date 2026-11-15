import { describe, expect, it } from "vitest";
import { articleLinks, documents, sidebarGroups } from "./documentationMdxTestSupport";

describe("Docusaurus documentation navigation source", () => {
  it("orders every document exactly once in the six approved groups", () => {
    const groups = sidebarGroups();
    expect(groups.map((group) => group.label)).toEqual([
      "Overview",
      "Getting started",
      "Using Archeion",
      "Customization",
      "Reference",
      "Changelog",
    ]);
    const ids = groups.flatMap((group) => group.items);
    expect(ids).toHaveLength(24);
    expect([...ids].sort()).toEqual(documents.map((doc) => doc.metadata.id).sort());
    expect(ids[0]).toBe("overview");
    expect(ids.at(-1)).toBe("changelog");
    expect(groups[1].items).toEqual(["installing", "archives", "adding-books"]);
    expect(groups[3].items).toEqual(["appearance", "custom-themes", "theme-manager"]);
    expect(groups[2].items).toEqual([
      "library",
      "archive-health",
      "quick-actions",
      "metadata-covers",
      "series",
      "reading",
      "reader-navigation",
      "reader-media",
      "file-management",
      "settings",
      "dictionaries",
      "keyboard-shortcuts",
    ]);
    expect(groups[4].items).toEqual([
      "archive-storage",
      "troubleshooting",
      "annotation-export",
      "about-resources",
    ]);
  });
  it("keeps every article reachable from the authored overview in sidebar order", () => {
    const ids = sidebarGroups()
      .flatMap((group) => group.items)
      .slice(1);
    const routes = ids.map((id) => {
      const doc = documents.find((item) => item.metadata.id === id);
      if (!doc) throw new Error(`Missing ${id}`);
      return `/archeion/docs${doc.metadata.slug}`;
    });
    expect(articleLinks("").filter((href) => href.startsWith("/archeion/docs/"))).toEqual(routes);
  });
  it("keeps all authored article links and fragments inside the framework corpus", () => {
    for (const doc of documents) {
      for (const href of articleLinks(doc.metadata.slug)) {
        if (!href.startsWith("/archeion/docs/") && !href.startsWith("#")) continue;
        const url = new URL(href, `https://archeion.test/archeion/docs${doc.metadata.slug}`);
        const destination = documents.find(
          (item) => `/archeion/docs${item.metadata.slug}` === url.pathname,
        );
        expect(destination, `${doc.metadata.id}: ${href}`).toBeDefined();
        if (url.hash) {
          const id = decodeURIComponent(url.hash.slice(1));
          expect(destination?.body, href).toMatch(new RegExp(`(?:\\{#${id}\\}|id="${id}")`));
        }
      }
    }
  });
});
