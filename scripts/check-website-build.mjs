import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkDocumentationSources } from "./check-documentation-sources.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const production = "https://tommymoonn.github.io/archeion/";

function files(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    assert(!entry.isSymbolicLink(), `Artifact must not contain links: ${entry.name}`);
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });
}

export function checkWebsiteBuild(root = projectRoot) {
  checkDocumentationSources(root);
  const build = path.join(root, "website/build");
  const read = (relative) => fs.readFileSync(path.join(build, relative), "utf8");
  const source = path.join(root, "website/static");
  for (const file of files(source)) {
    const relative = path.relative(source, file);
    assert(fs.readFileSync(path.join(build, relative)).equals(fs.readFileSync(file)), relative);
  }
  for (const file of files(build)) {
    const relative = path.relative(build, file).replaceAll("\\", "/");
    assert(
      !/(?:^|\/)(?:node_modules|\.git|\.plans|\.project|\.dev|\.scratch|\.agent-work|\.docusaurus|test-results|__docs-dev\.html)(?:\/|$)/.test(
        relative,
      ),
      relative,
    );
    assert(!/\.(?:md|mdx|tsx?|rs|exe|msi|sig|map)$/.test(relative), relative);
    assert(
      !/(?:^|\/)(?:latest\.json|page-registry\.json|docs-search-index\.js|docs-changelog-data\.json)$/.test(
        relative,
      ),
      relative,
    );
  }
  const docs = fs
    .readdirSync(path.join(root, "website/docs"))
    .filter((file) => file.endsWith(".mdx"));
  const expectedUrls = [production];
  for (const file of docs) {
    const mdx = fs.readFileSync(path.join(root, "website/docs", file), "utf8");
    const slug = JSON.parse(/^slug: (.+)$/m.exec(mdx)[1]);
    const url = `${production}docs${slug}`;
    expectedUrls.push(url);
    const html = read(`docs${slug}index.html`);
    assert(html.includes(`href="${url}"`), `${file}: canonical URL`);
    assert(html.includes(`content="${url}"`), `${file}: social URL`);
    for (const contract of [
      "og:title",
      "og:description",
      "og:image",
      "twitter:card",
      "apple-touch-icon",
      "theme-color",
    ])
      assert(html.includes(contract), `${file}: ${contract}`);
  }
  const urls = [...read("sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
  assert.deepEqual(
    urls.sort(),
    expectedUrls.sort(),
    "Sitemap must contain only homepage and canonical docs",
  );
  assert(read("robots.txt").includes(`Sitemap: ${production}sitemap.xml`));
  assert(read("404.html").includes("Page not found"));
  assert(read("404.html").includes('href="/archeion/docs/"'));
  assert(read("404.html").includes('href="/archeion/"'));
  console.log(
    `Pages artifact checked: ${docs.length} docs, homepage, 404, sitemap, and exact static bytes.`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkWebsiteBuild();
}
