import fs from "node:fs/promises";
import path from "node:path";
import type { LoadContext, Plugin } from "@docusaurus/types";
import type { LoadedContent } from "@docusaurus/plugin-content-docs";
import { releaseSearchSections } from "./releaseSearch";
import { extractSections } from "./searchContent";
import type { DocsSearchData, SearchPage } from "../src/search/types";

export default function docsSearchPlugin(context: LoadContext): Plugin {
  return {
    name: "archeion-docs-search",
    async allContentLoaded({ allContent, actions }) {
      // The docs plugin owns both the canonical sequence and document metadata.
      const content = allContent["docusaurus-plugin-content-docs"].default as LoadedContent;
      const version = content.loadedVersions[0];
      const data: DocsSearchData = { pages: [], entries: [] };
      const sources: { source: string; page: SearchPage }[] = [];
      for (const category of version.sidebars.documentation) {
        if (category.type !== "category") throw new Error("Documentation needs category groups");
        for (const item of category.items) {
          if (item.type !== "doc") throw new Error("Documentation groups need document entries");
          const doc = version.docs.find(({ id }) => id === item.id);
          if (!doc) throw new Error(`Missing document ${item.id}`);
          const page: SearchPage = {
            id: doc.id,
            title:
              typeof doc.frontMatter.sidebar_label === "string"
                ? doc.frontMatter.sidebar_label
                : doc.title,
            heading: doc.title,
            description: doc.description,
            overviewTitle:
              typeof doc.frontMatter.overview_title === "string"
                ? doc.frontMatter.overview_title
                : doc.title,
            overviewDescription:
              typeof doc.frontMatter.overview_description === "string"
                ? doc.frontMatter.overview_description
                : doc.description,
            group: category.label,
            href: doc.permalink,
          };
          data.pages.push(page);
          const source = await fs.readFile(
            path.resolve(context.siteDir, doc.source.replace(/^@site\//, "")),
            "utf8",
          );
          sources.push({ source, page });
        }
      }
      for (const { source, page } of sources) {
        data.entries.push(...(await extractSections(source, page, data.pages)));
        if (page.id === "changelog") data.entries.push(...releaseSearchSections(page));
      }
      actions.setGlobalData(data);
    },
  };
}
