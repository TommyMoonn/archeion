import fs from "node:fs";
import path from "node:path";

export const documentationRoot = path.resolve("website/docs");

export function readDocument(id: string) {
  const sourcePath = path.join(documentationRoot, `${id}.mdx`);
  const source = fs.readFileSync(sourcePath, "utf8");
  const metadata = Object.fromEntries(
    [...source.split("---")[1].matchAll(/^(\w+): (.+)$/gm)].map(([, key, value]) => [
      key,
      JSON.parse(value),
    ]),
  ) as Record<string, string>;
  return { sourcePath, source, metadata, body: source.split("---").slice(2).join("---") };
}

export const documents = fs
  .readdirSync(documentationRoot)
  .filter((name) => name.endsWith(".mdx"))
  .map((name) => readDocument(name.slice(0, -4)));

export function documentForRoute(route: string) {
  const slug = `/${route.replace(/^\/+|\/+$/g, "")}/`.replace("//", "/");
  const document = documents.find((doc) => doc.metadata.slug === slug);
  if (!document) throw new Error(`Missing MDX route ${route}`);
  return document;
}

// Factual assertions inspect authored MDX; rendered semantics are covered by Playwright.
export function articleText(route: string) {
  const doc = documentForRoute(route);
  return `${doc.metadata.title} ${doc.metadata.description} ${doc.body}`
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*`]/g, "")
    .replace(/<\/?kbd>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function articleLinks(route: string) {
  return [...documentForRoute(route).body.matchAll(/\]\(([^)]+)\)/g)].map((match) => match[1]);
}

export function sidebarGroups() {
  const source = fs.readFileSync("website/sidebars.ts", "utf8");
  return [...source.matchAll(/label:\s*"([^"]+)"\s*,\s*items:\s*(\[[\s\S]*?\])/g)].map(
    ([, label, items]) => ({ label, items: JSON.parse(items.replace(/,\s*]/g, "]")) as string[] }),
  );
}
