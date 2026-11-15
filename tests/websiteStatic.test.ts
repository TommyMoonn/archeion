import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import registry from "../docs/documentation/page-registry.json";

const read = (file: string) => fs.readFileSync(file);
const text = (file: string) => new TextDecoder("utf-8", { fatal: true }).decode(read(file));
const files = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });

describe("temporary public site preservation", () => {
  it("retains exact resource/runtime bytes and changes only the landing documentation target", () => {
    const resources = ["assets", "schemas", "examples", "dictionaries/packages"].flatMap(
      (directory) => files(`docs/${directory}`),
    );
    resources.push("docs/css/styles.css", "docs/js/main.js", "docs/dictionaries/catalog-v1.json");
    for (const source of resources) {
      expect(read(`website/static/${source.slice(5)}`).equals(read(source)), source).toBe(true);
    }
    expect(text("website/static/index.html")).toBe(
      text("docs/index.html").replaceAll('href="documentation/"', 'href="/archeion/docs/"'),
    );
    expect(text("README.md")).toContain('src="website/static/assets/archeion-preview.png"');
  });

  it("gives every legacy article one static destination with a visible no-JS fallback", () => {
    const redirects = files("website/static/documentation").filter((file) =>
      file.endsWith(".html"),
    );
    expect(redirects).toHaveLength(registry.pages.length);
    for (const page of registry.pages) {
      const html = text(`website/static/documentation${page.route}index.html`);
      expect(html).toContain(`href="/archeion/docs${page.route}"`);
      expect(html).toContain(`href="https://tommymoonn.github.io/archeion/docs${page.route}"`);
      expect(html).toContain('id="documentation-destination"');
      expect(html).toContain('<script src="/archeion/documentation/redirect.js" defer></script>');
      expect(html).not.toContain("http-equiv");
    }
  });

  it("excludes maintainer and temporary implementation sources from the static artifact input", () => {
    expect(text("website/docusaurus.config.ts")).toContain("pages: false");
    for (const file of [
      "pages/index.tsx",
      "components/FoundationNotice.tsx",
      "components/FoundationControls.tsx",
    ]) {
      expect(fs.existsSync(`website/src/${file}`), file).toBe(false);
    }
    const published = files("website/static").map((file) => file.replaceAll("\\", "/"));
    expect(published.filter((file) => /\.(?:md|mdx|exe|msi|sig)$/.test(file))).toEqual([]);
    expect(
      published.some((file) =>
        /(?:^|\/)(?:docs|\.plans|\.project|test-results|node_modules)\//.test(file),
      ),
    ).toBe(false);
  });
});
