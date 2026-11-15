import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readAllReleaseNotes } from "./release-notes.mjs";

const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Source contracts only: no MDX evaluation, website dependencies, or generated build input.
export function checkDocumentationSources(root = defaultRoot) {
  const directory = path.join(root, "website/docs");
  const docs = fs
    .readdirSync(directory)
    .filter((name) => name.endsWith(".mdx"))
    .map((name) => {
      const source = fs.readFileSync(path.join(directory, name), "utf8");
      const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(source);
      if (!front) throw new Error(`${name}: missing front matter`);
      const metadata = {};
      for (const line of front[1].split(/\r?\n/)) {
        const field = /^(\w+): (.+)$/.exec(line);
        if (!field || Object.hasOwn(metadata, field[1]))
          throw new Error(`${name}: invalid metadata`);
        metadata[field[1]] = JSON.parse(field[2]);
      }
      for (const key of ["id", "title", "sidebar_label", "description", "slug", "doc_type"])
        if (typeof metadata[key] !== "string" || !metadata[key].trim())
          throw new Error(`${name}: missing ${key}`);
      if (name !== `${metadata.id}.mdx` || !/^\/(?:[a-z0-9-]+\/)*$/.test(metadata.slug))
        throw new Error(`${name}: invalid identity or route`);
      const body = source.slice(front[0].length).replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm, "");
      const anchors = [...body.matchAll(/\{#([\w-]+)\}|<DocsAnchor id="([\w-]+)"/g)].map(
        (match) => match[1] || match[2],
      );
      if (metadata.id === "changelog") {
        if (!body.includes("<ReleaseTimeline />") || /^## /m.test(body))
          throw new Error("Changelog must compose canonical history, never an authored snapshot");
        anchors.push(
          ...readAllReleaseNotes(root).map(
            ({ version }) => `release-${version.replaceAll(".", "-")}`,
          ),
        );
      }
      if (new Set(anchors).size !== anchors.length) throw new Error(`${name}: duplicate anchor`);
      for (const heading of body.matchAll(/^#{2,3} (.+)$/gm))
        if (!/ \{#[\w-]+\}$/.test(heading[1]))
          throw new Error(`${name}: heading needs a stable ID`);
      return { metadata, body, anchors };
    });
  for (const key of ["id", "slug"])
    if (new Set(docs.map((doc) => doc.metadata[key])).size !== docs.length)
      throw new Error(`Duplicate documentation ${key}`);
  const sidebar = fs.readFileSync(path.join(root, "website/sidebars.ts"), "utf8");
  const ids = [...sidebar.matchAll(/items:\s*(\[[\s\S]*?\])/g)].flatMap(([, items]) =>
    JSON.parse(items.replace(/,\s*]/g, "]")),
  );
  if (
    ids.length !== docs.length ||
    new Set(ids).size !== ids.length ||
    docs.some(({ metadata }) => !ids.includes(metadata.id))
  )
    throw new Error("Sidebar must include every document exactly once");
  for (const doc of docs) {
    for (const [, href] of doc.body.matchAll(/\]\(([^\s)]+)\)/g)) {
      if (!href.startsWith("/archeion/docs/") && !href.startsWith("#")) continue;
      const url = new URL(href, `https://example.invalid/archeion/docs${doc.metadata.slug}`);
      const target = docs.find(({ metadata }) => `/archeion/docs${metadata.slug}` === url.pathname);
      if (!target || (url.hash && !target.anchors.includes(url.hash.slice(1))))
        throw new Error(`${doc.metadata.id}: unresolved documentation link ${href}`);
    }
  }
  return { pageCount: docs.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = checkDocumentationSources();
    console.log(`Documentation sources checked: ${result.pageCount} pages.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
