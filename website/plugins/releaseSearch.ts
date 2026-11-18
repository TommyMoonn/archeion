import { releases } from "../src/data/releaseHistory";
import { releaseInlineText } from "../../scripts/release-history-markdown.mjs";
import { boundedExcerpt } from "./searchContent";
import type { SearchEntry, SearchPage } from "../src/search/types";

// The canonical data adapter supplies sections without executing the React component.
export function releaseSearchSections(page: SearchPage): SearchEntry[] {
  return releases.map((release) => {
    const text =
      `${release.dateLabel} ${release.items.map(releaseInlineText).join(" ")} Full release notes for v${release.version}`
        .replace(/\s+/g, " ")
        .trim();
    return {
      ...page,
      sectionId: release.id,
      sectionHeading: `v${release.version}`,
      aliases: [],
      text,
      excerpt: boundedExcerpt(text),
    };
  });
}
