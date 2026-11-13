import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { configDefaults } from "vitest/config";

import vitestConfig from "../vitest.config";
import {
  allJobs,
  frontendJobs,
  platformJobs,
  classifyChanges,
} from "../scripts/ci-validation-policy.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = fs.readFileSync(path.join(projectRoot, ".github", "workflows", "ci.yml"), "utf8");
const desktopWorkflow = fs.readFileSync(
  path.join(projectRoot, ".github", "workflows", "desktop-build.yml"),
  "utf8",
);
const dependencyReviewWorkflow = fs.readFileSync(
  path.join(projectRoot, ".github", "workflows", "dependency-review.yml"),
  "utf8",
);
const codeqlWorkflow = fs.readFileSync(
  path.join(projectRoot, ".github", "workflows", "codeql.yml"),
  "utf8",
);
const tauriConfig = JSON.parse(
  fs.readFileSync(path.join(projectRoot, "src-tauri", "tauri.conf.json"), "utf8"),
) as { build: { beforeBuildCommand: string } };
const lines = workflow.split(/\r?\n/);
const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
  scripts: { test: string; typecheck: string; build: string };
};

function jobLines(jobId: string): string[] {
  const start = lines.indexOf(`  ${jobId}:`);
  if (start < 0) throw new Error(`Missing CI job: ${jobId}`);

  const end = lines.findIndex((line, index) => index > start && /^ {2}[\w-]+:$/.test(line));
  return lines.slice(start + 1, end < 0 ? undefined : end);
}

function takeWhile<T>(items: T[], predicate: (item: T) => boolean): T[] {
  const end = items.findIndex((item) => !predicate(item));
  return items.slice(0, end < 0 ? undefined : end);
}

const gate = jobLines("ci-gate");
const needsStart = gate.indexOf("    needs:");
const requiredJobIds = takeWhile(gate.slice(needsStart + 1), (line) =>
  line.startsWith("      - "),
).map((line) => line.slice("      - ".length));
function runGate(
  results: Record<string, string>,
  mode = "full",
  event = "pull_request",
  outputs?: Record<string, string>,
) {
  const requiredJobs = Object.fromEntries(
    Object.entries(results).map(([job, result]) => [job, { result, outputs: {} }]),
  );
  requiredJobs["classify-changes"] = {
    result: results["classify-changes"] ?? "success",
    outputs: outputs ?? {
      mode,
      expected_jobs: JSON.stringify(mode === "docs-only" ? frontendJobs : allJobs),
    },
  };
  return spawnSync(process.execPath, ["scripts/ci-validation-policy.mjs", "gate"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: { ...process.env, REQUIRED_JOBS: JSON.stringify(requiredJobs), GITHUB_EVENT_NAME: event },
    windowsHide: true,
  });
}

describe("CI workflow contract", () => {
  it.each([
    ["frontend-static", "ubuntu-latest"],
    ["frontend-build", "ubuntu-latest"],
    ["frontend-tests", "windows-latest"],
    ["browser-contracts", "ubuntu-latest"],
    ["rust-checks", "windows-latest"],
    ["msrv", "windows-latest"],
    ["font-catalog-portability", "ubuntu-latest"],
    ["windows-runtime", "windows-2022"],
    ["windows-updater", "windows-2022"],
  ])("keeps %s on its intended platform", (jobId, runner) => {
    expect(jobLines(jobId)).toContain(`    runs-on: ${runner}`);
  });

  it.each(["windows-runtime", "windows-updater"])(
    "caches and verifies the exact Tauri bridge in %s",
    (jobId) => {
      const job = jobLines(jobId).join("\n");
      expect(workflow).toContain("TAURI_DRIVER_VERSION: 2.0.6");
      expect(job).toMatch(/uses: actions\/cache@[a-f0-9]{40}/);
      expect(job).toContain("path: .scratch/runtime-smoke-tools");
      expect(job).toContain(
        "key: tauri-driver-${{ runner.os }}-${{ runner.arch }}-${{ hashFiles('rust-toolchain.toml') }}-${{ env.TAURI_DRIVER_VERSION }}",
      );
      expect(job).not.toContain("restore-keys:");
      expect(job).toContain("run: node scripts/ensure-tauri-driver.mjs");
      expect(job.indexOf("Cache Tauri WebDriver bridge")).toBeLessThan(
        job.indexOf("run: node scripts/ensure-tauri-driver.mjs"),
      );
      expect(job).not.toContain("cache-hit");
    },
  );
  it("uses exact event classification without filtering workflow events", () => {
    expect(workflow).toMatch(/on:\n {2}pull_request:\n {2}push:\n {4}branches:\n {6}- main/);
    expect(workflow).not.toMatch(/paths(?:-ignore)?:/);
    const classifier = jobLines("classify-changes").join("\n");
    expect(classifier).toContain("fetch-depth: 0");
    expect(classifier).toContain("persist-credentials: false");
    expect(classifier).toContain("run: node scripts/ci-validation-policy.mjs classify");
    expect(classifier).toContain("mode: ${{ steps.classify.outputs.mode }}");
    expect(classifier).toContain("expected_jobs: ${{ steps.classify.outputs.expected_jobs }}");
    expect(allJobs).toEqual(requiredJobIds.filter((job) => job !== "classify-changes"));
    expect(frontendJobs).toEqual([
      "frontend-static",
      "frontend-tests",
      "browser-contracts",
      "frontend-build",
    ]);
    expect(platformJobs).toEqual([
      "rust-checks",
      "font-catalog-portability",
      "windows-runtime",
      "windows-updater",
      "msrv",
    ]);
    for (const job of frontendJobs) {
      expect(jobLines(job).join("\n")).not.toContain("needs: classify-changes");
      expect(jobLines(job).some((line) => line.startsWith("    if:"))).toBe(false);
    }
    const condition = `    if: \${{ always() && !cancelled() && (github.event_name != 'pull_request' || needs.classify-changes.result != 'success' || needs.classify-changes.outputs.mode != 'docs-only' || needs.classify-changes.outputs.expected_jobs != '${JSON.stringify(frontendJobs)}') }}`;
    for (const job of platformJobs) {
      expect(jobLines(job)).toContain("    needs: classify-changes");
      expect(jobLines(job)).toContain(condition);
    }
    expect(gate).toContain("        run: node scripts/ci-validation-policy.mjs gate");
    expect(gate.join("\n")).toContain("uses: actions/checkout@");
    expect(gate.join("\n")).toContain("node-version-file: .node-version");
  });

  it("cancels stale PR runs while giving each main push its own concurrency group", () => {
    expect(workflow).toContain(
      "group: ci-${{ github.event_name == 'pull_request' && github.ref || github.run_id }}",
    );
    expect(workflow).toContain("cancel-in-progress: ${{ github.event_name == 'pull_request' }}");
  });

  it("makes CI Gate depend on every validation job and run after failures", () => {
    const jobsStart = lines.indexOf("jobs:");
    const jobIds = lines
      .slice(jobsStart + 1)
      .flatMap((line) => /^ {2}([\w-]+):$/.exec(line)?.[1] ?? []);

    expect(needsStart).toBeGreaterThanOrEqual(0);
    expect([...requiredJobIds].sort()).toEqual(
      jobIds.filter((jobId) => jobId !== "ci-gate").sort(),
    );
    expect(gate).toContain("    if: ${{ always() }}");
    expect(gate).toContain("          REQUIRED_JOBS: ${{ toJSON(needs) }}");
  });

  it("keeps the cheap frontend checks identifiable while tests and build stay separate", () => {
    const staticChecks = jobLines("frontend-static").join("\n");

    expect(staticChecks).toContain(
      "- name: Check architecture\n        run: pnpm run architecture:check",
    );
    expect(staticChecks).toContain("- name: Check formatting\n        run: pnpm run fmt");
    expect(staticChecks).toContain("- name: Lint frontend\n        run: pnpm run lint");
    expect(staticChecks).toContain("- name: Typecheck frontend\n        run: pnpm run typecheck");
    expect(jobLines("frontend-tests")).toContain("        run: pnpm run test");
    expect(jobLines("frontend-build")).toContain("        run: pnpm exec vite build");
    expect(jobLines("frontend-build")).toContain("        run: pnpm run test:inter-assets");
    const browserContracts = jobLines("browser-contracts");
    expect(browserContracts).toContain("    runs-on: ubuntu-latest");
    expect(browserContracts).toContain(
      "        run: pnpm exec playwright install --with-deps chromium --only-shell",
    );
    expect(browserContracts).toContain(
      "        run: pnpm run test:browser --shard=${{ matrix.shard }}/2",
    );
    expect(browserContracts).toContain(
      "          name: browser-contract-failure-${{ matrix.shard }}",
    );
    const windowsRuntime = jobLines("windows-runtime");
    expect(windowsRuntime).toContain("    runs-on: windows-2022");
    expect(windowsRuntime).toContain("        run: pnpm run test:runtime:windows");
    expect(windowsRuntime).toContain("          name: windows-runtime-smoke-failure");
    expect(requiredJobIds).toContain("windows-runtime");
    const windowsUpdater = jobLines("windows-updater");
    expect(windowsUpdater).toContain("    runs-on: windows-2022");
    expect(windowsUpdater).toContain("        run: pnpm run test:updater:windows");
    expect(windowsUpdater).toContain("          name: windows-updater-smoke");
    expect(windowsUpdater.join("\n")).not.toContain("secrets.");
    expect(requiredJobIds).toContain("windows-updater");
  });

  it("runs release regression tests once through the full Windows Vitest suite", () => {
    expect(jobLines("frontend-tests")).toContain("    runs-on: windows-latest");
    expect(jobLines("frontend-tests")).toContain("        run: pnpm run test");
    expect(packageJson.scripts.test).toBe("vitest run");
    const include = vitestConfig.test?.include ?? configDefaults.include;
    const exclude = vitestConfig.test?.exclude ?? configDefaults.exclude;
    for (const file of ["releaseTooling", "releaseCandidate", "releasePublication"]) {
      const relativePath = `tests/${file}.test.ts`;
      expect(fs.existsSync(path.join(projectRoot, relativePath)), relativePath).toBe(true);
      expect(
        include.some((pattern) => path.matchesGlob(relativePath, pattern)),
        relativePath,
      ).toBe(true);
      expect(
        exclude.some((pattern) => path.matchesGlob(relativePath, pattern)),
        relativePath,
      ).toBe(false);
      expect(workflow).not.toContain(relativePath);
    }
    expect(lines).not.toContain("  release-tooling:");
    expect(requiredJobIds).not.toContain("release-tooling");
    expect(workflow.match(/run: pnpm run test$/gm)).toHaveLength(1);
  });

  it("typechecks once across static and asset jobs while preserving the local build", () => {
    const frontendJobs = [...jobLines("frontend-static"), ...jobLines("frontend-build")].join("\n");
    expect(frontendJobs.match(/run: pnpm run typecheck$/gm)).toHaveLength(1);
    expect(frontendJobs).not.toMatch(/run: (?:pnpm run build|.*tsc)/);
    expect(packageJson.scripts.typecheck).toBe("tsc -b");
    expect(packageJson.scripts.build).toBe("tsc -b && vite build");
  });

  it.each([
    "frontend-static",
    "frontend-tests",
    "browser-contracts",
    "frontend-build",
    "windows-runtime",
    "windows-updater",
  ])("uses pnpm setup, frozen installs and the lockfile cache in %s", (jobId) => {
    const job = jobLines(jobId).join("\n");
    expect(job).toMatch(/uses: pnpm\/action-setup@[a-f0-9]{40}/);
    expect(job).toContain("run_install: false");
    expect(job.indexOf("uses: pnpm/action-setup@")).toBeLessThan(
      job.indexOf("uses: actions/setup-node@"),
    );
    expect(job).toMatch(/uses: actions\/setup-node@[a-f0-9]{40}/);
    expect(job).toContain("node-version-file: .node-version");
    expect(job).toContain("cache: pnpm\n          cache-dependency-path: pnpm-lock.yaml");
    expect(job).toContain("run: pnpm install --frozen-lockfile");
    expect(job).not.toMatch(/\bnpm (?:ci|install|run)\b|cache: npm/);
  });

  it("runs both browser shards independently and reserves time for failure evidence", () => {
    const browserContracts = jobLines("browser-contracts");
    expect(browserContracts).toContain("      fail-fast: false");
    expect(browserContracts).toContain("        shard: [1, 2]");
    const testStep = browserContracts.indexOf("      - name: Run browser contracts");
    const uploadStep = browserContracts.indexOf("      - name: Upload browser failure evidence");
    const jobTimeout = Number(
      browserContracts.find((line) => line.startsWith("    timeout-minutes:"))?.split(":")[1],
    );
    const testTimeout = Number(
      browserContracts
        .slice(testStep + 1, uploadStep)
        .find((line) => line.startsWith("        timeout-minutes:"))
        ?.split(":")[1],
    );
    expect(testStep).toBeGreaterThanOrEqual(0);
    expect(uploadStep).toBeGreaterThan(testStep);
    expect(testTimeout).toBeGreaterThan(0);
    expect(jobTimeout - testTimeout).toBeGreaterThanOrEqual(5);
    expect(browserContracts[uploadStep + 1]).toBe("        if: ${{ failure() && !cancelled() }}");
  });

  it("runs production async chunk contracts separately from the source-served browser shards", () => {
    const browserContracts = jobLines("browser-contracts").join("\n");
    expect(browserContracts).toContain(
      "pnpm exec vite build --config tests/browser/async-surfaces-build.config.ts",
    );
    expect(browserContracts).toContain(
      "pnpm exec playwright test --config tests/browser/async-surfaces.config.ts",
    );
    expect(browserContracts).toContain("if: matrix.shard == 1");
    expect(browserContracts).toContain("name: async-surface-contract-failure");
    const config = fs.readFileSync(path.join(projectRoot, "playwright.config.ts"), "utf8");
    const asyncConfig = fs.readFileSync(
      path.join(projectRoot, "tests/browser/async-surfaces.config.ts"),
      "utf8",
    );
    expect(config).toContain('testIgnore: "**/async-surfaces.pw.ts"');
    expect(asyncConfig).toContain("testIgnore: []");
  });

  it("runs Rust formatting inside the Clippy job and retains tests and MSRV", () => {
    const rustChecks = jobLines("rust-checks");
    const formatStep = rustChecks.indexOf("      - name: Check Rust formatting");
    const cacheStep = rustChecks.indexOf("      - name: Cache Rust dependencies");

    expect(rustChecks).toContain("          - name: Clippy");
    expect(rustChecks).toContain("          - name: Tests");
    expect(rustChecks).not.toContain("          - name: Format");
    expect(formatStep).toBeGreaterThanOrEqual(0);
    expect(formatStep).toBeLessThan(cacheStep);
    expect(rustChecks[formatStep + 1]).toBe("        if: matrix.name == 'Clippy'");
    expect(rustChecks[formatStep + 2]).toBe(
      "        run: cargo fmt --manifest-path src-tauri/Cargo.toml -- --check",
    );
    expect(rustChecks).toContain("        run: ${{ matrix.command }}");
    expect(jobLines("msrv")).toContain(
      "        run: cargo +1.90.0 check --locked --all-targets --manifest-path src-tauri/Cargo.toml",
    );
  });

  it("checks Rust 1.90 separately with its own versioned cache", () => {
    const msrv = jobLines("msrv");

    expect(msrv).toContain("    name: Rust 1.90 check");
    expect(msrv).toContain("      - name: Set up Rust 1.90");
    expect(msrv).toContain("          toolchain: 1.90.0");
    expect(msrv).toContain("          shared-key: msrv-1.90");
    expect(jobLines("rust-checks")).toContain("          toolchain: 1.97.1");
  });

  it("lets Tauri build the manual installer frontend once and checks its assets afterward", () => {
    const preflight = desktopWorkflow.indexOf("run: pnpm run check:all");
    const build = desktopWorkflow.indexOf("run: pnpm run tauri:build:windows");
    const assetCheck = desktopWorkflow.indexOf("run: pnpm run test:inter-assets");

    expect(preflight).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThan(preflight);
    expect(assetCheck).toBeGreaterThan(build);
    expect(desktopWorkflow).not.toContain("run: pnpm run verify");
    expect(desktopWorkflow).not.toContain("run: pnpm run build");
    expect(tauriConfig.build.beforeBuildCommand).toBe("pnpm run build");
  });

  it("keeps unsigned manual packaging explicit and separate from signed release staging", () => {
    expect(desktopWorkflow).toContain(
      "-BundleRoot ./src-tauri/target/x86_64-pc-windows-msvc/release/bundle\n          --installers-only",
    );
    expect(desktopWorkflow).toContain(
      "./scripts/verify-windows-release.ps1 --artifacts-dir artifacts/windows --installers-only",
    );
    expect(desktopWorkflow).not.toContain("TAURI_SIGNING_PRIVATE_KEY");
    expect(
      fs.readFileSync(path.join(projectRoot, ".github/workflows/release.yml"), "utf8"),
    ).not.toContain("--installers-only");
  });

  it("smoke tests the same staged NSIS installer before either workflow uploads it", () => {
    const releaseWorkflow = fs.readFileSync(
      path.join(projectRoot, ".github", "workflows", "release.yml"),
      "utf8",
    );
    const smokeCommand =
      "./scripts/smoke-windows-installer.ps1 --installer artifacts/windows/Archeion-Setup-x64.exe";

    for (const [name, source, upload] of [
      ["manual", desktopWorkflow, "Upload Windows installers"],
      ["automatic release", releaseWorkflow, "Upload candidate artifact"],
    ]) {
      expect(source, name).toContain(smokeCommand);
      expect(source.indexOf("Verify staged installers and checksums"), name).toBeLessThan(
        source.indexOf("Smoke test staged NSIS installer"),
      );
      expect(source.indexOf("Smoke test staged NSIS installer"), name).toBeLessThan(
        source.indexOf(upload),
      );
    }
  });

  it("reviews high severity dependency changes without withholding a check from ordinary PRs", () => {
    expect(dependencyReviewWorkflow).toContain("name: Dependency Review");
    expect(dependencyReviewWorkflow).toMatch(/\bon:\r?\n {2}pull_request:/);
    expect(dependencyReviewWorkflow).not.toMatch(/\bpaths(?:-ignore)?:/);
    expect(dependencyReviewWorkflow).toMatch(/permissions:\r?\n {2}contents: read/);
    expect(dependencyReviewWorkflow).toMatch(
      /uses: actions\/dependency-review-action@[a-f0-9]{40}/,
    );
    expect(dependencyReviewWorkflow).toContain("fail-on-severity: high");
    expect(dependencyReviewWorkflow).toContain("fail-on-scopes: runtime, development, unknown");
    expect(dependencyReviewWorkflow).toContain("license-check: false");
    expect(dependencyReviewWorkflow).not.toContain("warn-only: true");
  });

  it("runs SHA-pinned default CodeQL scans for both languages weekly or on manual dispatch", () => {
    expect(codeqlWorkflow).toContain("name: CodeQL");
    expect(codeqlWorkflow).toMatch(
      /\bon:\r?\n {2}workflow_dispatch:\r?\n {2}schedule:\r?\n {4}- cron: "17 6 \* \* 2"/,
    );
    expect(codeqlWorkflow).not.toMatch(/^ {2}(?:pull_request|push):/m);
    expect(workflow).not.toContain("CodeQL");
    expect(codeqlWorkflow).toContain("name: CodeQL (${{ matrix.language }})");
    expect(codeqlWorkflow).toContain(
      "- language: javascript-typescript\n            runner: ubuntu-latest",
    );
    expect(codeqlWorkflow).toContain("- language: rust\n            runner: windows-latest");
    expect(codeqlWorkflow.match(/^ {10}- language:/gm)).toHaveLength(2);
    expect(codeqlWorkflow).toContain("security-events: write");
    expect(codeqlWorkflow).toContain("build-mode: none");
    const actionReferences = [...codeqlWorkflow.matchAll(/^\s+uses: ([^\s#]+)/gm)].map(
      ([, reference]) => reference,
    );
    expect(actionReferences).toHaveLength(4);
    for (const reference of actionReferences) {
      expect(reference).toMatch(/^[^@]+@[a-f0-9]{40}$/);
    }
    expect(actionReferences[2]).toMatch(/^github\/codeql-action\/init@/);
    expect(actionReferences[3]).toMatch(/^github\/codeql-action\/analyze@/);
    expect(actionReferences[2].split("@")[1]).toBe(actionReferences[3].split("@")[1]);
    expect(codeqlWorkflow).not.toMatch(/\b(?:queries|packs|config-file|continue-on-error):/);
  });
});

describe("CI Gate result check", () => {
  const successfulJobs = Object.fromEntries(requiredJobIds.map((jobId) => [jobId, "success"]));

  it("passes when all required jobs succeed", () => {
    const result = runGate(successfulJobs);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("frontend-static: success");
  });

  it.each(["failure", "cancelled", "skipped"])("fails when a required job is %s", (status) => {
    const result = runGate({ ...successfulJobs, "rust-checks": status });

    expect(result.status).not.toBe(0);
    expect(result.stdout).toContain(`rust-checks: ${status}`);
  });

  it("fails when no validation jobs are supplied", () => {
    const result = runGate({});

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("CI Gate is missing validation jobs");
  });

  const docsJobs = {
    ...successfulJobs,
    ...Object.fromEntries(platformJobs.map((job: string) => [job, "skipped"])),
  };

  it("accepts only the five intentional platform skips for a docs-only PR", () => {
    expect(runGate(docsJobs, "docs-only").status).toBe(0);
    expect(runGate(successfulJobs, "docs-only").status).toBe(0);
    expect(runGate(docsJobs, "docs-only", "push").status).not.toBe(0);
    expect(runGate(docsJobs, "full", "push").status).not.toBe(0);
    expect(runGate(successfulJobs, "full", "push").status).toBe(0);
  });

  it.each(["failure", "cancelled", "skipped", "unknown"])("rejects classifier %s", (result) => {
    expect(runGate({ ...successfulJobs, "classify-changes": result }).status).not.toBe(0);
  });

  it.each(["failure", "cancelled", "unknown"])(
    "rejects an excluded platform job that reports %s",
    (result) => {
      expect(runGate({ ...docsJobs, "rust-checks": result }, "docs-only").status).not.toBe(0);
    },
  );

  it.each(frontendJobs)("rejects unexpectedly skipped or missing %s", (job: string) => {
    expect(runGate({ ...docsJobs, [job]: "skipped" }, "docs-only").status).not.toBe(0);
    const missing = { ...docsJobs };
    delete missing[job];
    expect(runGate(missing, "docs-only").status).not.toBe(0);
  });

  it("rejects a missing excluded job and unknown dependencies", () => {
    const missing = { ...docsJobs };
    delete missing["rust-checks"];
    expect(runGate(missing, "docs-only").status).not.toBe(0);
    expect(runGate({ ...successfulJobs, extra: "success" }).status).not.toBe(0);
  });

  it.each([
    {},
    { mode: "docs-only", expected_jobs: "not JSON" },
    { mode: "docs-only", expected_jobs: "[]" },
    { mode: "docs-only", expected_jobs: "null" },
    { mode: "docs-only", expected_jobs: JSON.stringify(frontendJobs.slice(1)) },
    { mode: "docs-only", expected_jobs: JSON.stringify([...frontendJobs, "unknown"]) },
    {
      mode: "docs-only",
      expected_jobs: JSON.stringify([...frontendJobs.slice(1), frontendJobs[1]]),
    },
    { mode: "full", expected_jobs: JSON.stringify(frontendJobs) },
    { mode: "unknown", expected_jobs: JSON.stringify(allJobs) },
  ])("rejects malformed classifier output %j", (outputs) => {
    expect(runGate(successfulJobs, "full", "pull_request", outputs).status).not.toBe(0);
  });
});

describe("CI change classifier", () => {
  const base = "a".repeat(40);
  const head = "b".repeat(40);
  const event = { pull_request: { base: { sha: base }, head: { sha: head } } };
  function classify(diff: string, eventName = "pull_request", payload: unknown = event, fail = "") {
    const commands: string[][] = [];
    const result = classifyChanges(eventName, payload, (args: string[]) => {
      commands.push(args);
      if (args[0] === fail) throw new Error("controlled Git failure");
      if (args[0] === "rev-parse") return "false\n";
      if (args[0] === "merge-base") return `${"c".repeat(40)}\n`;
      return args[0] === "diff" ? diff : "";
    });
    return { ...result, commands };
  }

  it.each([
    "docs/DEVELOPMENT.md",
    "docs/nested/guide.md",
    "docs/documentation/index.html",
    "docs/documentation/guides/reader/index.html",
    "docs/documentation/page-registry.json",
  ])("allows authored documentation %s", (file) => {
    for (const status of ["A", "M"]) {
      const result = classify(`${status}\0${file}\0`);
      expect(result.mode).toBe("docs-only");
      expect(JSON.parse(result.expected_jobs)).toEqual(frontendJobs);
    }
  });

  it.each([
    "README.md",
    "unknown/file",
    "docs/documentation/assets/docs.js",
    "docs/documentation/assets/README.md",
    "docs/documentation/assets/docs-search-index.json",
    "docs/documentation/changelog/index.html",
    "docs/image.png",
    "release-notes/v1.md",
    "src/main.tsx",
    "tests/example.test.ts",
    "tests/fixtures/example.json",
    "package.json",
    "pnpm-lock.yaml",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
    ".github/workflows/ci.yml",
    "scripts/build.mjs",
    "src/types/appSettings.ts",
    "docs/../package.json",
    "docs/guide.MD",
  ])("keeps %s in full validation", (file) => {
    expect(classify(`M\0${file}\0`).mode).toBe("full");
    expect(classify(`M\0docs/guide.md\0M\0${file}\0`).mode).toBe("full");
  });

  it.each([
    "",
    "M\0docs/guide.md",
    "M\0",
    "D\0docs/guide.md\0",
    "R100\0docs/old.md\0docs/new.md\0",
    "T\0docs/guide.md\0",
    "C100\0docs/old.md\0docs/new.md\0",
    "M\0docs/guide.md\0M\0",
  ])("fails open for empty, renamed, deleted or incomplete diffs %j", (diff) => {
    expect(classify(diff).mode).toBe("full");
  });

  it("uses the exact event revisions rather than the merge base for its complete diff", () => {
    const result = classify("M\0docs/guide.md\0");
    expect(result.commands).toContainEqual(["fetch", "--no-tags", "origin", base, head]);
    expect(result.commands).toContainEqual(["merge-base", base, head]);
    expect(result.commands).toContainEqual([
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--name-status",
      "-z",
      "--find-renames",
      base,
      head,
      "--",
    ]);
  });

  it.each(["fetch", "merge-base", "cat-file", "diff", "rev-parse"])(
    "fails open on %s errors",
    (command) => {
      expect(classify("M\0docs/guide.md\0", "pull_request", event, command).mode).toBe("full");
    },
  );

  it.each([
    {},
    null,
    { pull_request: { base: {}, head: {} } },
    { pull_request: { base: { sha: "HEAD~1" }, head: { sha: head } } },
  ])("fails open for missing or invalid revisions %j", (payload) => {
    expect(classify("M\0docs/guide.md\0", "pull_request", payload).mode).toBe("full");
  });

  it("fails open for shallow history and missing merge-base output", () => {
    for (const response of ["true\n", ""]) {
      expect(classifyChanges("pull_request", event, () => response).mode).toBe("full");
    }
    expect(
      classifyChanges("pull_request", event, (args: string[]) =>
        args[0] === "rev-parse" ? "false" : "",
      ).mode,
    ).toBe("full");
  });

  it("always selects full validation for pushes and unknown events, without inspecting paths", () => {
    for (const eventName of ["push", "workflow_dispatch", "unknown"]) {
      const result = classify("M\0docs/guide.md\0", eventName);
      expect(result.mode).toBe("full");
      expect(JSON.parse(result.expected_jobs)).toEqual(allJobs);
      expect(result.commands).toEqual([]);
    }
  });

  it("examines the entire path set, including a code change after many docs paths", () => {
    const docs = Array.from({ length: 5000 }, (_, index) => `M\0docs/guide-${index}.md\0`).join("");
    expect(classify(docs).mode).toBe("docs-only");
    expect(classify(`${docs}M\0src/main.tsx\0`).mode).toBe("full");
  });

  describe("classifier CLI with real Git history", () => {
    let directory: string;
    let revisions: Record<string, string>;
    function git(...args: string[]) {
      const result = spawnSync("git", args, {
        cwd: directory,
        encoding: "utf8",
        windowsHide: true,
      });
      if (result.status !== 0) throw new Error(result.stderr);
      return result.stdout.trim();
    }
    function write(file: string, content: string) {
      const target = path.join(directory, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    }
    function commit() {
      git("add", ".");
      git(
        "-c",
        "user.name=CI test",
        "-c",
        "user.email=ci@example.invalid",
        "commit",
        "-m",
        "fixture",
      );
      return git("rev-parse", "HEAD");
    }

    beforeAll(() => {
      directory = fs.mkdtempSync(path.join(os.tmpdir(), "archeion-ci-policy-"));
      git("init");
      git("remote", "add", "origin", directory);
      write("docs/guide.md", "Original guide\n");
      const initial = commit();
      write("docs/guide.md", "Updated guide\n");
      const docs = commit();
      git("mv", "docs/guide.md", "docs/renamed.md");
      const renamed = commit();
      git("rm", "docs/renamed.md");
      const deleted = commit();
      git("checkout", "-b", "base-side", initial);
      write("src/main.tsx", "base-only code\n");
      const divergentBase = commit();
      revisions = { initial, docs, renamed, deleted, divergentBase, unavailable: "f".repeat(40) };
    });

    afterAll(() => {
      if (directory) fs.rmSync(directory, { recursive: true, force: true });
    });

    function run(event: string) {
      const eventPath = path.join(directory, ".git", "event.json");
      const outputPath = path.join(directory, ".git", "output");
      fs.writeFileSync(eventPath, event);
      fs.writeFileSync(outputPath, "");
      const result = spawnSync(
        process.execPath,
        [path.join(projectRoot, "scripts/ci-validation-policy.mjs"), "classify"],
        {
          cwd: directory,
          encoding: "utf8",
          windowsHide: true,
          env: {
            ...process.env,
            GITHUB_EVENT_NAME: "pull_request",
            GITHUB_EVENT_PATH: eventPath,
            GITHUB_OUTPUT: outputPath,
          },
        },
      );
      expect(result.status, result.stderr).toBe(0);
      return fs.readFileSync(outputPath, "utf8");
    }

    // Each case has its own timeout; fixture construction and seven CLI runs must not
    // share one five-second budget when release tests compete for subprocess time.
    it.each([
      ["authored docs", "initial", "docs", "docs-only"],
      ["empty diff", "docs", "docs", "full"],
      ["rename", "docs", "renamed", "full"],
      ["deletion", "renamed", "deleted", "full"],
      // A merge-base diff would miss the code deletion from the exact event base.
      ["divergent base", "divergentBase", "docs", "full"],
      ["unavailable revision", "initial", "unavailable", "full"],
    ])("classifies %s", (_scenario, baseKey, headKey, mode) => {
      const output = run(
        JSON.stringify({
          pull_request: { base: { sha: revisions[baseKey] }, head: { sha: revisions[headKey] } },
        }),
      );
      expect(output).toBe(
        `mode=${mode}\nexpected_jobs=${JSON.stringify(mode === "docs-only" ? frontendJobs : allJobs)}\n`,
      );
    });

    it("defaults to full validation on malformed event JSON", () => {
      expect(run("invalid JSON")).toBe(`mode=full\nexpected_jobs=${JSON.stringify(allJobs)}\n`);
    });
  });
});
