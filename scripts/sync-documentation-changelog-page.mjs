import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import { readAllReleaseNotes } from "./release-notes.mjs";
import { syncDocumentationChangelog } from "./sync-documentation-changelog.mjs";

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dataPath = "docs/documentation/assets/docs-changelog-data.json";
const pagePath = "docs/documentation/changelog/index.html";
const region = /<!-- docs-changelog:start -->[\s\S]*?<!-- docs-changelog:end -->/g;
const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const escapeHtml = (text) =>
  text.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character],
  );

// Release-note Changes currently use flat bullets and these inline constructs.
// Reject unsupported blocks rather than silently omitting historical prose.
function renderInline(text) {
  const tokens = /`([^`\n]+)`|\*\*([^*\n]+)\*\*|\[([^\]\n]+)\]\(([^\s)]+)\)/g;
  let html = "";
  let offset = 0;
  for (const match of text.matchAll(tokens)) {
    html += escapeHtml(text.slice(offset, match.index));
    const [, code, strong, label, href] = match;
    if (code !== undefined) html += `<code>${escapeHtml(code)}</code>`;
    else if (strong !== undefined) html += `<strong>${renderInline(strong)}</strong>`;
    else {
      let url;
      try {
        url = new URL(href);
      } catch {
        throw new Error(`Release-note links must use an absolute HTTP(S) URL: ${href}`);
      }
      if (!["https:", "http:"].includes(url.protocol))
        throw new Error(`Unsafe release-note link: ${href}`);
      html += `<a href="${escapeHtml(href)}">${renderInline(label)}</a>`;
    }
    offset = match.index + match[0].length;
  }
  return html + escapeHtml(text.slice(offset));
}

function renderChanges(markdown) {
  const items = [];
  for (const line of markdown.replace(/\r\n/g, "\n").split("\n")) {
    if (!line.trim()) continue;
    const bullet = line.match(/^[-*] (.+)$/);
    if (bullet) items.push(bullet[1]);
    else if (/^ {2,}\S/.test(line) && !/^\s+[-*+]|^\s+\d+[.)]/.test(line) && items.length)
      items[items.length - 1] += ` ${line.trim()}`;
    else
      throw new Error(
        `Unsupported release-note Changes block: ${line}. Use flat bullets or extend the timeline renderer.`,
      );
  }
  if (!items.length) throw new Error("Release timeline requires a non-empty Changes list.");
  return `<ul>${items.map((item) => `<li>${renderInline(item)}</li>`).join("\n")}</ul>`;
}

// Input is the validated, sorted projection owned by sync-documentation-changelog.
export function renderReleaseTimeline(entries) {
  return `<ol class="changelog-timeline" role="list" aria-label="Releases, newest first">${entries
    .map(({ version, date, changes }) => {
      const id = `release-${version.replaceAll(".", "-")}`;
      const [year, month, day] = date.split("-");
      return `<li class="changelog-entry">
      <div class="release-metadata">
        <div class="article-heading"><h2 id="${id}">v${escapeHtml(version)}</h2><a class="heading-permalink" href="#${id}" aria-label="Link to section: v${escapeHtml(version)}"><span aria-hidden="true">#</span></a></div>
        <time datetime="${date}">${months[Number(month) - 1]} ${Number(day)}, ${year}</time>
      </div>
      <div class="release-changes">${renderChanges(changes)}
        <p><a class="release-notes-link" href="https://github.com/TommyMoonn/archeion/releases/tag/v${escapeHtml(version)}">Full release notes for v${escapeHtml(version)} <span aria-hidden="true">↗</span></a></p>
      </div>
    </li>`;
    })
    .join("\n")}</ol>`;
}

export async function syncDocumentationChangelogPage(
  projectRoot = defaultProjectRoot,
  { check = true } = {},
) {
  const notesBefore = JSON.stringify(readAllReleaseNotes(projectRoot));
  if ((await syncDocumentationChangelog(projectRoot)).changed)
    throw new Error(
      "Changelog data is stale. Run npm run docs:changelog:sync before generating the timeline.",
    );
  const dataFile = path.join(projectRoot, dataPath);
  const target = path.join(projectRoot, pagePath);
  const dataBefore = fs.readFileSync(dataFile, "utf8");
  const before = fs.readFileSync(target, "utf8");
  const { entries } = JSON.parse(dataBefore);
  if (
    [...before.matchAll(region)].length !== 1 ||
    before.split("<!-- docs-changelog:start -->").length !== 2 ||
    before.split("<!-- docs-changelog:end -->").length !== 2
  )
    throw new Error(`${pagePath} must contain exactly one docs-changelog region.`);
  const options = await prettier.resolveConfig(path.join(projectRoot, ".prettierrc.json"));
  const output = await prettier.format(
    before.replace(
      region,
      () =>
        `<!-- docs-changelog:start -->\n${renderReleaseTimeline(entries)}\n<!-- docs-changelog:end -->`,
    ),
    { ...options, parser: "html" },
  );
  const changed = before.replace(/\r\n/g, "\n") !== output;
  if (
    JSON.stringify(readAllReleaseNotes(projectRoot)) !== notesBefore ||
    fs.readFileSync(target, "utf8") !== before ||
    fs.readFileSync(dataFile, "utf8") !== dataBefore
  )
    throw new Error("Changelog sources changed during timeline sync; retry after finishing edits.");
  if (!check && changed) {
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, output, { encoding: "utf8", flag: "wx" });
      fs.renameSync(temporary, target);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  return { changed, entryCount: entries.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, option, root, ...extra] = process.argv.slice(2);
    if (
      !["--check", "--write"].includes(mode) ||
      (option !== undefined && (option !== "--project" || !root)) ||
      extra.length
    )
      throw new Error(
        "Usage: node scripts/sync-documentation-changelog-page.mjs --check|--write [--project PATH]",
      );
    const check = mode === "--check";
    const result = await syncDocumentationChangelogPage(root ?? defaultProjectRoot, { check });
    if (check && result.changed) {
      console.error(
        "Documentation changelog timeline drift. Run npm run docs:sync and commit the generated HTML.",
      );
      process.exitCode = 1;
    } else
      console.log(
        `Documentation timeline ${check ? "checked" : "synced"}: ${result.entryCount} releases, ${result.changed ? 1 : 0} changed.`,
      );
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
