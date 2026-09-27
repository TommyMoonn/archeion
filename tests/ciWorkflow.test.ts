import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workflow = fs.readFileSync(path.join(projectRoot, ".github", "workflows", "ci.yml"), "utf8");
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
    const needsStart = gate.indexOf("    needs:");
    const needs = takeWhile(gate.slice(needsStart + 1), (line) => line.startsWith("      - ")).map(
      (line) => line.slice("      - ".length),
    );

    expect(needsStart).toBeGreaterThanOrEqual(0);
    expect(needs.sort()).toEqual(jobIds.filter((jobId) => jobId !== "ci-gate").sort());
    expect(gate).toContain("    if: ${{ always() }}");
    expect(gate).toContain("          REQUIRED_JOBS: ${{ toJSON(needs) }}");
  });
});

(hasPowerShell ? describe : describe.skip)("CI Gate result check", () => {
  const successfulJobs = {
    "frontend-checks": "success",
    "frontend-build": "success",
    "release-tooling": "success",
    "rust-checks": "success",
    msrv: "success",
  };

  it("passes when all required jobs succeed", () => {
    const result = runGate(successfulJobs);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("frontend-checks: success");
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
