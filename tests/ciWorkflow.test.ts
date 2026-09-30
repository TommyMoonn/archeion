import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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
const runStart = gate.indexOf("        run: |");
if (runStart < 0) throw new Error("CI Gate is missing its result check");

const gateScript = takeWhile(
  gate.slice(runStart + 1),
  (line) => line === "" || line.startsWith("          "),
)
  .map((line) => line.slice(10))
  .join("\n");

const hasPowerShell =
  spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
    encoding: "utf8",
    windowsHide: true,
  }).status === 0;

function runGate(results: Record<string, string>) {
  const requiredJobs = Object.fromEntries(
    Object.entries(results).map(([job, result]) => [job, { result, outputs: {} }]),
  );

  return spawnSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", gateScript], {
    encoding: "utf8",
    env: { ...process.env, REQUIRED_JOBS: JSON.stringify(requiredJobs) },
    windowsHide: true,
  });
}

describe("CI workflow contract", () => {
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
      "- name: Check architecture\n        run: npm run architecture:check",
    );
    expect(staticChecks).toContain("- name: Check formatting\n        run: npm run fmt");
    expect(staticChecks).toContain("- name: Lint frontend\n        run: npm run lint");
    expect(staticChecks).toContain("- name: Typecheck frontend\n        run: npm run typecheck");
    expect(jobLines("frontend-tests")).toContain("        run: npm run test");
    expect(jobLines("frontend-build")).toContain("        run: npm run build");
    expect(jobLines("frontend-build")).toContain("        run: npm run test:inter-assets");
    const browserContracts = jobLines("browser-contracts");
    expect(browserContracts).toContain("    runs-on: ubuntu-latest");
    expect(browserContracts).toContain(
      "        run: npx playwright install --with-deps chromium --only-shell",
    );
    expect(browserContracts).toContain("        run: npm run test:browser");
    expect(browserContracts).toContain("          name: browser-contract-failure");
    const windowsRuntime = jobLines("windows-runtime");
    expect(windowsRuntime).toContain("    runs-on: windows-2022");
    expect(windowsRuntime).toContain("        run: npm run test:runtime:windows");
    expect(windowsRuntime).toContain("          name: windows-runtime-smoke-failure");
    expect(requiredJobIds).toContain("windows-runtime");
    expect(jobLines("release-tooling")).toContain(
      "        run: npm run test -- tests/releaseTooling.test.ts tests/releaseCandidate.test.ts tests/releasePublication.test.ts",
    );
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
      "        run: cargo +1.88.0 check --locked --all-targets --manifest-path src-tauri/Cargo.toml",
    );
  });

  it("lets Tauri build the manual installer frontend once and checks its assets afterward", () => {
    const preflight = desktopWorkflow.indexOf("run: npm run check:all");
    const build = desktopWorkflow.indexOf("run: npm run tauri:build:windows");
    const assetCheck = desktopWorkflow.indexOf("run: npm run test:inter-assets");

    expect(preflight).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThan(preflight);
    expect(assetCheck).toBeGreaterThan(build);
    expect(desktopWorkflow).not.toContain("run: npm run verify");
    expect(desktopWorkflow).not.toContain("run: npm run build");
    expect(tauriConfig.build.beforeBuildCommand).toBe("npm run build");
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

(hasPowerShell ? describe : describe.skip)("CI Gate result check", () => {
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
    expect(result.stderr).toContain("CI Gate has no validation jobs.");
  });
});
