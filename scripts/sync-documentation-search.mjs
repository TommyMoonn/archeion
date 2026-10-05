import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import * as prettier from "prettier";
import { validateRegistry } from "./sync-documentation-navigation.mjs";

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const registryPath = "docs/documentation/page-registry.json";
const outputPath = "docs/documentation/assets/docs-search-index.js";
const excluded = [
  "[hidden]",
  "[inert]",
  '[aria-hidden="true"]',
  ".sr-only",
  "script",
  "style",
  "svg",
  "button",
  "nav",
  "footer",
  ".mobile-outline",
  ".heading-permalink",
  "[data-doc-copy-controls]",
  "[data-doc-copy-status]",
].join(",");
const blockTags = new Set([
  "ARTICLE",
  "HEADER",
  "SECTION",
  "DIV",
  "P",
  "UL",
  "OL",
  "LI",
  "TABLE",
  "TR",
  "TD",
  "TH",
  "PRE",
  "BLOCKQUOTE",
  "FIGURE",
  "FIGCAPTION",
  "BR",
  "HR",
]);
const cleanText = (text) => text.replace(/\s+/g, " ").trim();

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function aliasesFor(element) {
  const value = element.getAttribute("data-search-aliases");
  if (!value) return [];
  const aliases = value.split("|").map((alias) => cleanText(alias).toLowerCase());
  requireCondition(
    aliases.every(Boolean) && new Set(aliases).size === aliases.length,
    "Search aliases must be non-empty and unique, separated by |.",
  );
  return aliases;
}

function boundedExcerpt(text) {
  if (text.length <= 240) return text;
  const prefix = text.slice(0, 239);
  const lastSpace = prefix.lastIndexOf(" ");
  return `${prefix.slice(0, lastSpace > 0 ? lastSpace : 238).trimEnd()}…`;
}

export async function extractSearchEntries(html, page, groupTitle) {
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  try {
    window.document.write(html);
    const articles = window.document.querySelectorAll("[data-doc-article]");
    requireCondition(
      articles.length === 1,
      `${page.sourcePath} must contain exactly one documentation article.`,
    );
    const article = articles[0].cloneNode(true);
    for (const element of article.querySelectorAll("*")) {
      if (
        element.matches(excluded) ||
        element.style.display === "none" ||
        element.style.visibility === "hidden"
      )
        element.remove();
    }
    const title = article.querySelector(".article-header h1");
    requireCondition(
      title && cleanText(title.textContent),
      `${page.sourcePath} needs an article title.`,
    );
    const common = {
      pageId: page.id,
      title: page.title,
      pageHeading: cleanText(title.textContent),
      route: page.route,
      group: page.group,
      groupTitle,
      pageType: page.type,
    };
    const sections = [
      { sectionId: "", sectionHeading: "", aliases: aliasesFor(article), parts: [] },
    ];
    let current = sections[0];
    function visit(node) {
      if (node.nodeType === 3) {
        current.parts.push(node.textContent);
        return;
      }
      if (node.nodeType !== 1) return;
      if (node.tagName === "H1") return;
      if (node.tagName === "H2" || node.tagName === "H3") {
        requireCondition(
          /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(node.id) &&
            window.document.querySelectorAll(`[id="${node.id}"]`).length === 1,
          `${page.sourcePath} needs unique stable IDs on every article h2/h3.`,
        );
        current = {
          sectionId: node.id,
          sectionHeading: cleanText(node.textContent),
          aliases: aliasesFor(node),
          parts: [],
        };
        sections.push(current);
        return;
      }
      const isBlock = blockTags.has(node.tagName);
      if (isBlock) current.parts.push(" ");
      for (const child of node.childNodes) visit(child);
      if (isBlock) current.parts.push(" ");
    }
    visit(article);
    return sections.map(({ parts, ...section }) => {
      const text = cleanText(parts.join(""));
      return { ...common, ...section, text: text.toLowerCase(), excerpt: boundedExcerpt(text) };
    });
  } finally {
    await window.happyDOM.abort();
  }
}

export async function syncDocumentationSearch(
  projectRoot = defaultProjectRoot,
  { check = true } = {},
) {
  const registrySource = fs.readFileSync(path.join(projectRoot, registryPath), "utf8");
  const { groups, pages } = validateRegistry(JSON.parse(registrySource));
  const groupTitles = new Map(groups.map((group) => [group.id, group.title]));
  const originals = new Map(
    pages.map((page) => [
      page.sourcePath,
      fs.readFileSync(path.join(projectRoot, page.sourcePath), "utf8"),
    ]),
  );
  const entries = [];
  for (const page of pages)
    entries.push(
      ...(await extractSearchEntries(
        originals.get(page.sourcePath),
        page,
        groupTitles.get(page.group),
      )),
    );
  const options = await prettier.resolveConfig(path.join(projectRoot, ".prettierrc.json"));
  const output = await prettier.format(
    `// Generated by npm run docs:search:sync. Do not edit.\nwindow.ArcheionDocumentationIndex = ${JSON.stringify({ schemaVersion: 1, entries })};\n`,
    { ...options, parser: "babel" },
  );
  const target = path.join(projectRoot, outputPath);
  const before = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  const changed = before?.replace(/\r\n/g, "\n") !== output;
  if (!check && changed) {
    requireCondition(
      fs.readFileSync(path.join(projectRoot, registryPath), "utf8") === registrySource,
      "Registry changed during search sync; retry after finishing edits.",
    );
    for (const [source, html] of originals)
      requireCondition(
        fs.readFileSync(path.join(projectRoot, source), "utf8") === html,
        `Source changed during search sync: ${source}. Retry after finishing edits.`,
      );
    requireCondition(
      (fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null) === before,
      "Search index changed during sync; retry after finishing edits.",
    );
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, output, "utf8");
  }
  return { pageCount: pages.length, entryCount: entries.length, changed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireCondition(
      process.argv.length === 3 && ["--check", "--write"].includes(process.argv[2]),
      "Usage: node scripts/sync-documentation-search.mjs --check|--write",
    );
    const check = process.argv[2] === "--check";
    const result = await syncDocumentationSearch(defaultProjectRoot, { check });
    if (check && result.changed) {
      console.error(
        "Documentation search index drift. Run npm run docs:search:sync and commit the generated index.",
      );
      process.exitCode = 1;
    } else
      console.log(
        `Documentation search ${check ? "checked" : "synced"}: ${result.pageCount} pages, ${result.entryCount} entries, ${result.changed ? 1 : 0} changed.`,
      );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
