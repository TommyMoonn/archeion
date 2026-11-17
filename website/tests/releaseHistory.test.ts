import { describe, expect, it } from "vitest";
import projection from "../src/generated/release-history.json";
import { releases, releaseHeadings } from "../src/data/releaseHistory";
import { releaseSearchSections } from "../plugins/releaseSearch";
import { releaseInlineText } from "../../scripts/release-history-markdown.mjs";
import type { SearchPage } from "../src/search/types";

const page: SearchPage = {
  id: "changelog",
  title: "Changelog",
  heading: "Changelog",
  description: "Release history",
  overviewTitle: "Changelog",
  overviewDescription: "Release history",
  group: "Changelog",
  href: "/archeion/docs/changelog/",
};

describe("canonical history adapters", () => {
  it("retains every release, stable fragment, date and supported prose in search order", () => {
    const sections = releaseSearchSections(page);
    expect(sections).toHaveLength(projection.entries.length);
    expect(releases.some(({ version }) => version === "1.8.0")).toBe(true);
    expect(releaseHeadings.map(({ id }) => id)).toEqual(sections.map(({ sectionId }) => sectionId));
    for (const [index, section] of sections.entries()) {
      const release = releases[index];
      expect(section.sectionHeading).toBe(`v${projection.entries[index].version}`);
      expect(section.href).toBe(page.href);
      expect(section.text).toContain(release.dateLabel);
      for (const item of release.items) expect(section.text).toContain(releaseInlineText(item));
      expect(section.excerpt.length).toBeLessThanOrEqual(240);
    }
    expect(sections[0].sectionId).toBe(
      `release-${projection.entries[0].version.replaceAll(".", "-")}`,
    );
    expect(sections.at(-1)?.sectionId).toBe("release-0-1-0");
  });
});
