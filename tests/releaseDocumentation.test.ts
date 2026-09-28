import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath: string) =>
  fs.readFileSync(path.join(projectRoot, relativePath), "utf8");

const workflows = [
  ".github/workflows/ci.yml",
  ".github/workflows/desktop-build.yml",
  ".github/workflows/release.yml",
  ".github/workflows/codeql.yml",
];

describe("tracked release documentation and toolchain sources", () => {
  it("keeps every setup-node step on the shared major-version file", () => {
    const major = read(".node-version").trim();
    const engine = JSON.parse(read("package.json")) as { engines: { node: string } };
    expect(major).toBe("22");
    expect(engine.engines.node).toMatch(/^>=22\./);

    const setupSteps = workflows.flatMap((file) => [
      ...read(file).matchAll(
        /uses: actions\/setup-node@[a-f0-9]{40}(?:[^\r\n]*)\r?\n {8}with:\r?\n((?: {10}.+\r?\n)+)/g,
      ),
    ]);
    expect(setupSteps).toHaveLength(8);
    for (const [, inputs] of setupSteps) {
      expect(inputs).toContain("node-version-file: .node-version");
      expect(inputs).not.toMatch(/\bnode-version:/);
    }
  });

  it("keeps the normal Rust pin distinct from the checked MSRV", () => {
    const toolchain = /channel = "([^"]+)"/.exec(read("rust-toolchain.toml"))?.[1];
    const msrv = /rust-version = "([^"]+)"/.exec(read("src-tauri/Cargo.toml"))?.[1];
    expect(toolchain).toBe("1.97.1");
    expect(msrv).toBe("1.88");

    const rustSteps = workflows.flatMap((file) => [
      ...read(file).matchAll(
        /uses: dtolnay\/rust-toolchain@[a-f0-9]{40}(?:[^\r\n]*)\r?\n {8}with:\r?\n {10}toolchain: ([^\r\n]+)/g,
      ),
    ]);
    expect(rustSteps).toHaveLength(6);
    const versions = rustSteps.map(([, version]) => version);
    expect(versions.filter((version) => version === toolchain)).toHaveLength(5);
    expect(versions.filter((version) => version === `${msrv}.0`)).toHaveLength(1);
    expect(read(".github/workflows/ci.yml")).toContain(
      `run: cargo +${msrv}.0 check --locked --all-targets --manifest-path src-tauri/Cargo.toml`,
    );
  });

  it("makes the tracked guide reachable and keeps its repository links valid", () => {
    const guide = read("docs/RELEASING.md");
    expect(read("docs/DEVELOPMENT.md")).toContain("[release operator guide](RELEASING.md)");
    expect(read("scripts/README.md")).toContain("[release operator guide](../docs/RELEASING.md)");
    const relativeLinks = [...guide.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)]
      .map(([, target]) => target)
      .filter((target) => !/^https?:\/\//.test(target));
    expect(relativeLinks.length).toBeGreaterThan(0);
    for (const target of relativeLinks) {
      expect(fs.existsSync(path.resolve(projectRoot, "docs", target))).toBe(true);
    }
  });

  it("documents creation-allowed release tags without restoring the bypass requirement", () => {
    const guide = read("docs/RELEASING.md").replace(/\s+/g, " ");
    expect(guide).toContain("allows creation of new `v*` tags");
    expect(guide).toContain(
      "blocks updates, deletions, and non-fast-forward pushes to existing `v*` tags through the normal protected path",
    );
    expect(guide).toContain("no GitHub Actions/App bypass is required for release-tag creation");
    expect(guide).toContain(
      "any actor with ordinary tag-creation permission to create a new version-shaped tag manually",
    );
    expect(guide).toContain("fails closed on a conflict instead of moving or deleting it");
    expect(guide).not.toContain("protects creation");
    expect(guide).not.toContain("integration bypass needed");
  });
});
