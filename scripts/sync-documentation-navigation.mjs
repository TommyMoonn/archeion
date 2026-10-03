import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";
import * as prettier from "prettier";

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const documentationDirectory = "docs/documentation";
export const pageTypes = Object.freeze([
  "overview",
  "getting-started",
  "guide",
  "reference",
  "troubleshooting",
  "changelog",
]);

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function requireFields(value, fields, label) {
  requireCondition(
    value && typeof value === "object" && !Array.isArray(value),
    `${label} must be an object.`,
  );
  requireCondition(
    Object.keys(value).length === fields.length &&
      fields.every((field) => Object.hasOwn(value, field)),
    `${label} must contain only: ${fields.join(", ")}.`,
  );
}

function validateEntries(entries, fields, label) {
  requireCondition(Array.isArray(entries) && entries.length > 0, `${label} must be non-empty.`);
  const ids = new Set();
  const orders = new Set();
  for (const entry of entries) {
    requireFields(entry, fields, label);
    requireCondition(
      typeof entry.id === "string" &&
        /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(entry.id) &&
        !ids.has(entry.id),
      `${label} has an invalid or duplicate ID: ${entry.id}.`,
    );
    requireCondition(
      typeof entry.title === "string" &&
        entry.title.trim() === entry.title &&
        entry.title.length > 0,
      `${entry.id} needs a non-empty title.`,
    );
    requireCondition(
      Number.isSafeInteger(entry.order) && entry.order >= 0,
      `${entry.id} needs a non-negative integer order.`,
    );
    const orderKey = `${entry.group ?? ""}:${entry.order}`;
    requireCondition(!orders.has(orderKey), `${label} has a duplicate order: ${orderKey}.`);
    ids.add(entry.id);
    orders.add(orderKey);
  }
}

export function validateRegistry(registry) {
  requireFields(registry, ["schemaVersion", "sequence", "groups", "pages"], "Registry");
  requireCondition(
    registry.schemaVersion === 1,
    "Unsupported documentation registry schema version.",
  );
  requireFields(registry.sequence, ["first", "last"], "Sequence");
  validateEntries(registry.groups, ["id", "title", "order"], "Groups");
  validateEntries(
    registry.pages,
    ["id", "route", "title", "group", "order", "type", "sourcePath"],
    "Pages",
  );
  const groups = [...registry.groups].sort((a, b) => a.order - b.order);
  const groupOrders = new Map(groups.map((group) => [group.id, group.order]));
  const routes = new Set();
  const sources = new Set();
  for (const page of registry.pages) {
    requireCondition(groupOrders.has(page.group), `${page.id} has an unknown navigation group.`);
    requireCondition(
      pageTypes.includes(page.type),
      `${page.id} has an unsupported page type: ${page.type}.`,
    );
    requireCondition(
      typeof page.route === "string" &&
        /^\/(?:[a-z0-9-]+\/)*$/.test(page.route) &&
        !routes.has(page.route),
      `${page.id} has an invalid or duplicate route.`,
    );
    requireCondition(
      page.sourcePath === `${documentationDirectory}${page.route}index.html` &&
        !sources.has(page.sourcePath),
      `${page.id} has an invalid or duplicate source path.`,
    );
    routes.add(page.route);
    sources.add(page.sourcePath);
  }
  requireCondition(
    groups.every((group) => registry.pages.some((page) => page.group === group.id)),
    "Navigation groups must not be empty.",
  );
  const pages = [...registry.pages].sort(
    (a, b) => groupOrders.get(a.group) - groupOrders.get(b.group) || a.order - b.order,
  );
  requireCondition(
    pages[0].id === registry.sequence.first && pages.at(-1).id === registry.sequence.last,
    "Sequence first/last must match the ordered registry endpoints.",
  );
  return { groups, pages };
}

function documentationSources(projectRoot) {
  const sources = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(path.join(projectRoot, directory), {
      withFileTypes: true,
    })) {
      const relative = `${directory}/${entry.name}`;
      if (entry.isDirectory()) visit(relative);
      else if (entry.isFile() && entry.name === "index.html") sources.push(relative);
    }
  }
  visit(documentationDirectory);
  return sources.sort();
}

const escapeHtml = (text) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );
const relativeHref = (from, to) =>
  `${path.posix.relative(path.posix.dirname(from.sourcePath), path.posix.dirname(to.sourcePath)) || "."}/`;

async function searchText(html, page) {
  const window = new Window({
    settings: {
      disableJavaScriptEvaluation: true,
      disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true,
    },
  });
  try {
    window.document.write(html);
    requireCondition(
      window.document.querySelectorAll("[data-doc-article]").length === 1,
      `${page.sourcePath} must contain exactly one documentation article.`,
    );
    const header = window.document.querySelector("[data-doc-article] .article-header");
    requireCondition(header?.querySelector("h1"), `${page.sourcePath} needs an article title.`);
    const summary = [...header.querySelectorAll("p")]
      .filter((paragraph) => !paragraph.classList.contains("eyebrow"))
      .map((paragraph) => paragraph.textContent);
    return [page.title, header.querySelector("h1").textContent, ...summary]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  } finally {
    await window.happyDOM.abort();
  }
}

function renderSidebar(current, groups, pages, searches) {
  return `<nav data-doc-navigation="" aria-label="Documentation sidebar">${groups
    .map((group) => {
      const panelId = `sidebar-group-${group.order}`;
      return `<section class="sidebar-group" data-sidebar-group="">
      <h2><button aria-controls="${panelId}" aria-expanded="true" class="sidebar-group__toggle" data-sidebar-group-toggle="" type="button">
        <span>${escapeHtml(group.title)}</span><svg aria-hidden="true"><use href="#icon-chevron"></use></svg>
      </button></h2>
      <div class="sidebar-group__items" data-sidebar-group-items="" id="${panelId}">${pages
        .filter((page) => page.group === group.id)
        .map(
          (page) =>
            `<a ${page.id === current.id ? 'aria-current="page" ' : ""}data-doc-link="" data-search="${escapeHtml(searches.get(page.id))}" href="${relativeHref(current, page)}"><span>${escapeHtml(page.title)}</span></a>`,
        )
        .join("")}</div>
    </section>`;
    })
    .join("")}</nav>`;
}

function renderPager(current, pages) {
  const index = pages.findIndex((page) => page.id === current.id);
  const neighbors = [
    ["previous", pages[index - 1]],
    ["next", pages[index + 1]],
  ].filter(([, page]) => page);
  if (neighbors.length === 0) return "";
  return `<nav aria-label="Documentation pages" class="article-pager${neighbors.length === 1 ? " article-pager--single" : ""}">${neighbors.map(([direction, page]) => `<a class="article-pager__item article-pager__item--${direction}" rel="${direction === "previous" ? "prev" : "next"}" href="${relativeHref(current, page)}"><span>${direction === "previous" ? "Previous" : "Next"}</span><strong>${escapeHtml(page.title)}</strong></a>`).join("")}</nav>`;
}

function replaceRegion(html, name, content, legacyPattern) {
  const start = `<!-- docs-${name}:start -->`;
  const end = `<!-- docs-${name}:end -->`;
  const replacement = `${start}\n${content}\n${end}`;
  if (html.includes(start) || html.includes(end)) {
    requireCondition(
      html.split(start).length === 2 &&
        html.split(end).length === 2 &&
        html.indexOf(start) < html.indexOf(end),
      `Invalid ${name} generated-region markers.`,
    );
    return (
      html.slice(0, html.indexOf(start)) + replacement + html.slice(html.indexOf(end) + end.length)
    );
  }
  const matches = [...html.matchAll(legacyPattern)];
  requireCondition(matches.length <= 1, `Ambiguous legacy ${name} region.`);
  if (matches.length === 1) return html.replace(legacyPattern, replacement);
  requireCondition(name === "pager", "Documentation sidebar navigation region is missing.");
  const footer = /<footer\b[^>]*class="[^"]*\bdocs-footer\b[^"]*"[^>]*>/g;
  requireCondition(
    [...html.matchAll(footer)].length === 1,
    "Documentation pager insertion needs exactly one article footer.",
  );
  return html.replace(footer, `${replacement}\n$&`);
}

export async function syncDocumentationNavigation(
  projectRoot = defaultProjectRoot,
  { check = true } = {},
) {
  const registryPath = path.join(projectRoot, documentationDirectory, "page-registry.json");
  const registryText = fs.readFileSync(registryPath, "utf8");
  const registry = JSON.parse(registryText);
  const { groups, pages } = validateRegistry(registry);
  const sources = documentationSources(projectRoot);
  const registered = new Set(pages.map((page) => page.sourcePath));
  const discovered = new Set(sources);
  const missing = [...registered].filter((source) => !discovered.has(source));
  const unregistered = sources.filter((source) => !registered.has(source));
  requireCondition(
    missing.length === 0 && unregistered.length === 0,
    `Documentation registry/source coverage mismatch. Missing: ${missing.join(", ") || "none"}. Unregistered: ${unregistered.join(", ") || "none"}.`,
  );
  const originals = new Map(
    pages.map((page) => [
      page.id,
      fs.readFileSync(path.join(projectRoot, page.sourcePath), "utf8"),
    ]),
  );
  const searches = new Map();
  for (const page of pages) searches.set(page.id, await searchText(originals.get(page.id), page));
  const formatOptions = await prettier.resolveConfig(path.join(projectRoot, "package.json"));
  const updates = [];
  // Validate and render every page before changing any source file.
  for (const page of pages) {
    let html = originals.get(page.id);
    html = replaceRegion(
      html,
      "navigation",
      renderSidebar(page, groups, pages, searches),
      /<nav\b[^>]*>\s*(?=<section\b[^>]*\bdata-sidebar-group\b)[\s\S]*?<\/nav>/g,
    );
    html = replaceRegion(
      html,
      "pager",
      renderPager(page, pages),
      /<nav\b[^>]*class="[^"]*\barticle-pager\b[^"]*"[^>]*>[\s\S]*?<\/nav>/g,
    );
    html = html.replace(/<article\b[^>]*\bdata-doc-article(?:="[^"]*")?[^>]*>/, (tag) =>
      tag.replace(/\sdata-page-type="[^"]*"/g, "").replace(/>$/, ` data-page-type="${page.type}">`),
    );
    html = await prettier.format(html, { ...formatOptions, parser: "html" });
    if (html !== originals.get(page.id).replace(/\r\n/g, "\n"))
      updates.push({ sourcePath: page.sourcePath, html });
  }
  if (!check) {
    requireCondition(
      fs.readFileSync(registryPath, "utf8") === registryText,
      "Registry changed during navigation sync; retry after finishing edits.",
    );
    for (const page of pages) {
      requireCondition(
        fs.readFileSync(path.join(projectRoot, page.sourcePath), "utf8") === originals.get(page.id),
        `Source changed during navigation sync: ${page.sourcePath}. Retry after finishing edits.`,
      );
    }
    for (const update of updates)
      fs.writeFileSync(path.join(projectRoot, update.sourcePath), update.html, "utf8");
  }
  return { pageCount: pages.length, changedPaths: updates.map((update) => update.sourcePath) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireCondition(
      process.argv.length === 3 && ["--check", "--write"].includes(process.argv[2]),
      "Usage: node scripts/sync-documentation-navigation.mjs --check|--write",
    );
    const check = process.argv[2] === "--check";
    const result = await syncDocumentationNavigation(defaultProjectRoot, { check });
    if (check && result.changedPaths.length > 0) {
      console.error(
        `Documentation navigation drift:\n${result.changedPaths.join("\n")}\nRun npm run docs:sync and commit the generated HTML.`,
      );
      process.exitCode = 1;
    } else {
      console.log(
        `Documentation navigation ${check ? "checked" : "synced"}: ${result.pageCount} pages, ${result.changedPaths.length} changed.`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
