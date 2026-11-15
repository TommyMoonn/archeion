import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkWebsiteBuild } from "../scripts/check-website-build.mjs";

const workflow = fs.readFileSync(".github/workflows/website-deploy.yml", "utf8");

describe("production Pages deployment boundary", () => {
  it("deploys only main and keeps PR validation in CI", () => {
    expect(workflow).toContain("branches: [main]");
    expect(workflow).not.toMatch(/pull_request|release:|workflow_run/);
    expect(workflow.match(/if: github.ref == 'refs\/heads\/main'/g)).toHaveLength(2);
    expect(workflow).toContain("needs: build");
    expect(workflow).toContain("name: github-pages");
    expect(workflow).toContain("group: website-pages-production");
    expect(workflow).toContain("cancel-in-progress: false");
  });

  it("pins actions, isolates write permissions, and uploads only the checked website output", () => {
    for (const [, action] of workflow.matchAll(/uses: ([^\s]+)/g)) {
      if (action.startsWith("./")) continue;
      expect(action).toMatch(/^[\w/-]+@[a-f0-9]{40}$/);
    }
    const [build, deploy] = workflow.split("  deploy:");
    expect(build).toContain("permissions:\n  contents: read");
    expect(build).not.toMatch(/pages: write|id-token: write/);
    expect(deploy).toContain("pages: write");
    expect(deploy).toContain("id-token: write");
    expect(deploy).not.toMatch(/contents: write|checkout@|pnpm /);
    expect(build).toContain("persist-credentials: false");
    expect(build).toContain("node-version-file: .node-version");
    expect(build).toContain("pnpm install --filter @archeion/website... --frozen-lockfile");
    const validation = build.indexOf("run: node scripts/check-website-build.mjs");
    const upload = build.indexOf("uses: actions/upload-pages-artifact@");
    expect(validation).toBeGreaterThan(0);
    expect(upload).toBeGreaterThan(validation);
    expect(build.slice(upload)).toContain("path: website/build");
    expect(workflow).not.toMatch(/enablement:|build_type:|gh api|release\.yml/);
    expect(fs.readFileSync(".github/workflows/ci.yml", "utf8")).toContain(
      "run: node scripts/check-website-build.mjs",
    );
  });
});

describe("Pages artifact validation", () => {
  function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "archeion-pages-"));
    const write = (file: string, value: string) => {
      const target = path.join(root, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, value);
    };
    write(
      "website/docs/overview.mdx",
      `---\nid: "overview"\ntitle: "Overview"\nsidebar_label: "Overview"\ndescription: "Introduction"\nslug: "/"\ndoc_type: "Overview"\n---\nHello.\n`,
    );
    write("website/sidebars.ts", 'items: ["overview"]');
    write("website/static/resource.txt", "exact public bytes");
    write("website/build/resource.txt", "exact public bytes");
    const base = "https://tommymoonn.github.io/archeion/";
    write(
      "website/build/docs/index.html",
      `<link rel="canonical" href="${base}docs/"><meta property="og:url" content="${base}docs/">og:title og:description og:image twitter:card apple-touch-icon theme-color`,
    );
    write(
      "website/build/sitemap.xml",
      `<urlset><url><loc>${base}</loc></url><url><loc>${base}docs/</loc></url></urlset>`,
    );
    write("website/build/robots.txt", `Sitemap: ${base}sitemap.xml`);
    write(
      "website/build/404.html",
      'Page not found <a href="/archeion/">Home</a><a href="/archeion/docs/">Documentation</a>',
    );
    return { root, write };
  }

  it("accepts a complete static artifact and rejects resource drift before upload", () => {
    const { root, write } = fixture();
    try {
      expect(() => checkWebsiteBuild(root)).not.toThrow();
      write("website/build/resource.txt", "changed");
      expect(() => checkWebsiteBuild(root)).toThrow("resource.txt");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    "docs/MAINTAINER.md",
    ".plans/internal.json",
    ".scratch/internal.json",
    ".agent-work/internal.json",
    "assets/source.js.map",
    "latest.json",
    "docs/page-registry.json",
    "__docs-dev.html",
  ])("rejects internal or release output %s", (file) => {
    const { root, write } = fixture();
    try {
      write(`website/build/${file}`, "must not publish");
      expect(() => checkWebsiteBuild(root)).toThrow(file);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects development URLs in the sitemap", () => {
    const { root, write } = fixture();
    try {
      write("website/build/sitemap.xml", "<loc>http://localhost:3000/archeion/docs/</loc>");
      expect(() => checkWebsiteBuild(root)).toThrow("Sitemap");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
