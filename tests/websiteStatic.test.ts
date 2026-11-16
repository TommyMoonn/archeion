import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { documents } from "./documentationMdxTestSupport";

const read = (file: string) => fs.readFileSync(file);
const text = (file: string) => new TextDecoder("utf-8", { fatal: true }).decode(read(file));
const files = (directory: string): string[] =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? files(file) : [file];
  });

describe("public site resources and React homepage ownership", () => {
  it("uses the React homepage and canonical public resources", () => {
    expect(fs.existsSync("website/static/index.html")).toBe(false);
    expect(fs.existsSync("website/plugins/staticHomepage.ts")).toBe(false);
    expect(fs.existsSync("website/static/css/styles.css")).toBe(false);
    expect(fs.existsSync("website/static/js/main.js")).toBe(false);
    expect(fs.existsSync("website/src/pages/index.tsx")).toBe(true);
    expect(text("README.md")).toContain('src="website/static/assets/archeion-preview.png"');
  });

  it("gives every legacy article one static destination with a visible no-JS fallback", () => {
    const redirects = files("website/static/documentation").filter((file) =>
      file.endsWith(".html"),
    );
    expect(redirects).toHaveLength(documents.length);
    for (const { metadata: page } of documents) {
      const html = text(`website/static/documentation${page.slug}index.html`);
      expect(html).toContain(`href="/archeion/docs${page.slug}"`);
      expect(html).toContain(`href="https://tommymoonn.github.io/archeion/docs${page.slug}"`);
      expect(html).toContain('id="documentation-destination"');
      expect(html).toContain('<script src="/archeion/documentation/redirect.js" defer></script>');
      expect(html).not.toContain("http-equiv");
    }
  });

  it("excludes maintainer and temporary implementation sources from the static artifact input", () => {
    expect(text("website/docusaurus.config.ts")).not.toMatch(/pages: false|staticHomepage/);
    for (const file of ["components/FoundationNotice.tsx", "components/FoundationControls.tsx"]) {
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
