import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/coverage.yml"), "utf8");
const ci = fs.readFileSync(path.join(root, ".github/workflows/ci.yml"), "utf8");
const rustScript = fs.readFileSync(path.join(root, "scripts/coverage-rust.ps1"), "utf8");
const vitestConfig = fs.readFileSync(path.join(root, "vitest.config.ts"), "utf8");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};

describe("diagnostic coverage workflow", () => {
  it("runs on a bounded cadence and stays outside the required CI gate", () => {
    expect(workflow).toContain("  workflow_dispatch:");
    expect(workflow).toContain("  schedule:");
    expect(workflow).toMatch(/ {2}pull_request:\r?\n {4}paths:/);
    expect(workflow).not.toContain("  push:");
    expect(workflow).not.toContain("package-lock.json");
    expect(workflow).toMatch(/permissions:\r?\n {2}contents: read/);
    expect(ci).not.toContain("coverage-diagnostics");
    expect(ci).not.toContain("test:coverage:");
  });

  it("limits PR paths to coverage tooling and configuration, excluding lockfile-only updates", () => {
    const paths = workflow
      .split("  pull_request:")[1]
      .split("  workflow_dispatch:")[0]
      .split(/\r?\n/)
      .filter((line) => line.startsWith("      - "))
      .map((line) => line.slice("      - ".length));

    // package.json owns the coverage commands and the pinned V8 provider dependency.
    expect(paths).toEqual([
      ".github/actions/setup-pnpm/**",
      ".github/workflows/coverage.yml",
      "package.json",
      "vitest.config.ts",
      "scripts/coverage-rust.ps1",
    ]);
    expect(workflow).toContain('    - cron: "0 7 * * 1"');
  });

  it("generates and uploads HTML plus machine-readable reports without thresholds", () => {
    expect(packageJson.devDependencies["@vitest/coverage-v8"]).toBe(
      packageJson.devDependencies.vitest,
    );
    expect(packageJson.scripts["test:coverage:frontend"]).toBe(
      "vitest run --coverage --maxWorkers=4",
    );
    expect(packageJson.scripts["test:coverage:rust"]).toContain("scripts/coverage-rust.ps1");
    expect(workflow).toContain("run: pnpm run test:coverage:frontend");
    expect(workflow).toContain("run: ./scripts/coverage-rust.ps1");
    expect(workflow).toContain("components: llvm-tools-preview");
    expect(workflow).toContain("cargo install cargo-llvm-cov --version 0.9.0 --locked");
    expect(workflow).toContain("path: coverage/frontend/");
    expect(workflow).toContain("path: coverage/rust/");
    expect(workflow.match(/retention-days: 7/g)).toHaveLength(2);
    expect(workflow.match(/if: \$\{\{ always\(\) && !cancelled\(\) \}\}/g)).toHaveLength(2);
    expect(workflow.match(/if-no-files-found: ignore/g)).toHaveLength(2);
    expect(workflow).not.toContain("continue-on-error:");
    expect(workflow).not.toMatch(/fail-under|threshold|codecov/i);
    expect(vitestConfig).toContain('reportsDirectory: "coverage/frontend"');
    expect(vitestConfig).toContain('reporter: ["text-summary", "html", "lcov"]');
    expect(rustScript).toContain("--html --output-dir $reportRoot");
    expect(rustScript).toContain("--lcov --output-path $lcovPath");
  });
});
