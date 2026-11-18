import type { SearchEntry, SearchPage } from "../src/search/types";
import mdxParser from "./mdxParser.cjs";

const clean = (text: string) => text.replace(/\s+/g, " ").trim();
export function boundedExcerpt(text: string) {
  if (text.length <= 240) return text;
  const prefix = text.slice(0, 239);
  const space = prefix.lastIndexOf(" ");
  return `${prefix.slice(0, space > 0 ? space : 238).trimEnd()}…`;
}

export async function extractSections(
  source: string,
  page: SearchPage,
  pages: SearchPage[] = [],
): Promise<SearchEntry[]> {
  // Parse MDX without evaluating imports or React components, including release rendering.
  const processor = await mdxParser();
  const headingIds = new Map<number, string>();
  let fence: { marker: string; length: number } | null = null;
  const body = source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
  const prepared = body
    .split(/\r?\n/)
    .map((line, index) => {
      const delimiter = /^\s{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      if (delimiter) {
        if (!fence) fence = { marker: delimiter[1][0], length: delimiter[1].length };
        else if (
          delimiter[1][0] === fence.marker &&
          delimiter[1].length >= fence.length &&
          !delimiter[2].trim()
        )
          fence = null;
        return line;
      }
      if (fence) return line;
      const match = /^#{2,3} .+ \{#([a-z0-9-]+)\}$/.exec(line);
      if (!match) return line;
      headingIds.set(index + 1, match[1]);
      return line.replace(/ \{#[a-z0-9-]+\}$/, "");
    })
    .join("\n");
  const tree = processor.parse(prepared);
  type Node = typeof tree | (typeof tree.children)[number];
  const sections = [
    { sectionId: "", sectionHeading: "", aliases: [] as string[], parts: [page.description] },
  ];
  let current = sections[0];
  const seen = new Set<string>();
  function visit(node: Node): void {
    if (node.type === "mdxjsEsm") return;
    if (node.type === "heading" && (node.depth === 2 || node.depth === 3)) {
      const id = headingIds.get(node.position?.start.line ?? 0);
      if (!id || seen.has(id)) throw new Error(`${page.id} needs unique stable h2/h3 IDs`);
      seen.add(id);
      current = { sectionId: id, sectionHeading: "", aliases: [], parts: [] };
      sections.push(current);
      for (const child of node.children) visit(child);
      current.sectionHeading = clean(current.parts.join(""));
      current.parts = [];
      return;
    }
    if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
      if (node.name === "DocsOverview") {
        const group = node.attributes.find(
          (attr) => attr.type === "mdxJsxAttribute" && attr.name === "group",
        );
        if (group?.type === "mdxJsxAttribute")
          current.parts.push(
            ...pages
              .filter((page) => page.group === group.value)
              .map((page) => ` ${page.overviewTitle} ${page.overviewDescription} `),
          );
        return;
      }
      if (
        ["DocsAnchor", "script", "style", "button", "nav", "footer", "svg"].includes(
          node.name ?? "",
        )
      )
        return;
      if (
        node.attributes.some(
          (attr) =>
            attr.type === "mdxJsxAttribute" &&
            (["hidden", "inert"].includes(attr.name) ||
              (attr.name === "aria-hidden" && attr.value === "true") ||
              (attr.name === "className" &&
                typeof attr.value === "string" &&
                attr.value.split(/\s+/).includes("sr-only"))),
        )
      )
        return;
      for (const attr of node.attributes) {
        if (attr.type !== "mdxJsxAttribute" || typeof attr.value !== "string") continue;
        if (attr.name === "data-search-aliases") {
          const aliases = attr.value.split("|").map((value) => clean(value).toLowerCase());
          if (aliases.some((value) => !value) || new Set(aliases).size !== aliases.length)
            throw new Error("Search aliases must be non-empty and unique");
          current.aliases.push(...aliases);
        }
        if (node.name === "DocsNotice" && attr.name === "title")
          current.parts.push(` ${attr.value} `);
      }
    }
    if (
      "value" in node &&
      typeof node.value === "string" &&
      ["text", "inlineCode", "code"].includes(node.type)
    )
      current.parts.push(node.value);
    if ("children" in node) {
      const block = !["emphasis", "strong", "link", "mdxJsxTextElement"].includes(node.type);
      if (block) current.parts.push(" ");
      for (const child of node.children) visit(child);
      if (block) current.parts.push(" ");
    }
  }
  visit(tree);
  return sections.map(({ parts, ...section }) => {
    const text = clean(parts.join(""));
    return { ...page, ...section, text, excerpt: boundedExcerpt(text) };
  });
}
