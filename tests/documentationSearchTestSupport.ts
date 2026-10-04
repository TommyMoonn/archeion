import fs from "node:fs";
import vm from "node:vm";

export interface DocumentationSearchEntry {
  pageId: string;
  title: string;
  pageHeading: string;
  route: string;
  group: string;
  groupTitle: string;
  pageType: string;
  sectionId: string;
  sectionHeading: string;
  aliases: string[];
  text: string;
  excerpt: string;
}

export function documentationSearchEntries(): DocumentationSearchEntry[] {
  const context = { window: { ArcheionDocumentationIndex: { entries: [] } } };
  vm.runInNewContext(
    fs.readFileSync("docs/documentation/assets/docs-search-index.js", "utf8"),
    context,
  );
  return context.window.ArcheionDocumentationIndex.entries;
}
