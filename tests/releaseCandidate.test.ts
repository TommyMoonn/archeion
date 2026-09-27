import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { detectReleaseCandidate } from "../scripts/detect-release-candidate.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const releaseWorkflow = fs.readFileSync(
  path.join(projectRoot, ".github", "workflows", "release.yml"),
  "utf8",
);
const workflowLines = releaseWorkflow.split(/\r?\n/);

function releaseJob(jobId: string): string {
  const start = workflowLines.indexOf(`  ${jobId}:`);
  if (start < 0) throw new Error(`Missing release job: ${jobId}`);
  const end = workflowLines.findIndex((line, index) => index > start && /^ {2}[\w-]+:$/.test(line));
  return workflowLines.slice(start, end < 0 ? undefined : end).join("\n");
}
const commit = "a".repeat(40);
const otherCommit = "b".repeat(40);
const temporaryRoots: string[] = [];
const itWithPowerShell =
  spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
    encoding: "utf8",
    windowsHide: true,
  }).status === 0
    ? it
    : it.skip;

type Scenario = {
  commitSha?: string;
  currentVersion?: string;
  parentVersion?: string;
  mainSha?: string;
  headSha?: string;
  firstValidationError?: string;
  releaseValidationError?: string;
  remoteTagSha?: string;
  release?: { tag_name: string; draft: boolean };
  releaseError?: string;
  realValidation?: "valid" | "partial" | "missingNote";
};

function scenario(options: Scenario = {}) {
  const candidateSha = options.commitSha ?? commit;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archeion-release-candidate-"));
  temporaryRoots.push(root);
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ version: options.currentVersion ?? "1.5.5" }),
  );
  if (options.realValidation) {
    fs.mkdirSync(path.join(root, "src-tauri"));
    fs.mkdirSync(path.join(root, "release-notes"));
    fs.writeFileSync(
      path.join(root, "package-lock.json"),
      JSON.stringify({
        version: options.realValidation === "partial" ? "1.5.4" : "1.5.5",
        packages: { "": { version: options.realValidation === "partial" ? "1.5.4" : "1.5.5" } },
      }),
    );
    fs.writeFileSync(
      path.join(root, "src-tauri", "Cargo.toml"),
      '[package]\nname = "archeion"\nversion = "1.5.5"\n',
    );
    fs.writeFileSync(
      path.join(root, "src-tauri", "Cargo.lock"),
      '[[package]]\nname = "archeion"\nversion = "1.5.5"\n',
    );
    fs.writeFileSync(
      path.join(root, "src-tauri", "tauri.conf.json"),
      JSON.stringify({ version: "1.5.5" }),
    );
    fs.writeFileSync(
      path.join(root, "CHANGELOG.md"),
      "# Changelog\n\n## [1.5.5] - 2026-09-27\n\n- Fixture.\n\n[1.5.5]: https://example.com/compare\n",
    );
    if (options.realValidation !== "missingNote") {
      fs.writeFileSync(
        path.join(root, "release-notes", "v1.5.5.md"),
        "<!-- release-note: v1.5.5; date: 2026-09-27 -->\n\n## Changes\n\n- Fixture release.\n",
      );
    }
  }
  const calls: string[] = [];
  let validationCount = 0;

  const run = (command: string, args: string[]) => {
    calls.push(`${command} ${args.join(" ")}`);
    if (command === "git" && args[0] === "rev-parse") {
      return {
        status: 0,
        stdout: `${args[1] === "HEAD" ? (options.headSha ?? candidateSha) : (options.mainSha ?? candidateSha)}\n`,
        stderr: "",
      };
    }
    if (command === "git" && args[0] === "show") {
      return {
        status: 0,
        stdout: JSON.stringify({ version: options.parentVersion ?? "1.5.4" }),
        stderr: "",
      };
    }
    if (command === "pwsh") {
      if (options.realValidation) {
        return spawnSync(command, args, { cwd: root, encoding: "utf8", windowsHide: true });
      }
      validationCount += 1;
      const error =
        validationCount === 1 ? options.firstValidationError : options.releaseValidationError;
      return { status: error ? 1 : 0, stdout: "", stderr: error ?? "" };
    }
    if (command === "git" && args[0] === "ls-remote") {
      const tag = "refs/tags/v1.5.5";
      return {
        status: 0,
        stdout: options.remoteTagSha ? `${options.remoteTagSha}\t${tag}\n` : "",
        stderr: "",
      };
    }
    if (command === "gh") {
      if (options.releaseError) return { status: 1, stdout: "", stderr: options.releaseError };
      return options.release
        ? { status: 0, stdout: JSON.stringify(options.release), stderr: "" }
        : { status: 1, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
    }
    throw new Error(`Unexpected command: ${command} ${args.join(" ")}`);
  };

  return {
    calls,
    detect: () =>
      detectReleaseCandidate({
        projectRoot: root,
        commit: candidateSha,
        repository: "TommyMoonn/archeion",
        run,
      }),
  };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("release-candidate workflow", () => {
  it("runs only after successful push CI on the exact main SHA, with read-only permission", () => {
    expect(releaseWorkflow).toContain("workflow_run:");
    expect(releaseWorkflow).toContain("workflows: [CI]");
    expect(releaseWorkflow).toContain("types: [completed]");
    expect(releaseWorkflow).toContain("branches: [main]");
    expect(releaseWorkflow).toContain("workflow_run.conclusion == 'success'");
    expect(releaseWorkflow).toContain("workflow_run.event == 'push'");
    expect(releaseWorkflow).toContain(
      "workflow_run.head_repository.full_name == github.repository",
    );
    expect(releaseWorkflow).toContain("ref: ${{ github.event.workflow_run.head_sha }}");
    expect(releaseWorkflow).toContain("CI_HEAD_SHA: ${{ github.event.workflow_run.head_sha }}");
    expect(releaseWorkflow).toContain("contents: read");
    expect(releaseWorkflow).not.toContain("contents: write");
    expect(releaseWorkflow).not.toContain("tags:");
    expect(releaseWorkflow).not.toContain("gh release create");
  });

  it("builds only a validated candidate from its exact SHA, before any tag can exist", () => {
    const detection = releaseJob("detect-candidate");
    const build = releaseJob("build-windows");
    expect(detection).toContain("candidate: ${{ steps.candidate.outputs.candidate }}");
    expect(detection).toContain("version: ${{ steps.candidate.outputs.version }}");
    expect(detection).toContain("sha: ${{ steps.candidate.outputs.sha }}");
    expect(build).toContain("needs: detect-candidate");
    expect(build).toContain("if: needs.detect-candidate.outputs.candidate == 'true'");
    expect(build).toContain("ref: ${{ needs.detect-candidate.outputs.sha }}");
    expect(build).toContain("CANDIDATE_SHA: ${{ needs.detect-candidate.outputs.sha }}");
    expect(build).toContain("--require-changelog");
    expect(build.indexOf("Verify candidate source and release metadata")).toBeLessThan(
      build.indexOf("Build NSIS and MSI installers"),
    );
    expect(build.indexOf("Build NSIS and MSI installers")).toBeLessThan(
      build.indexOf("Stage installers and checksums"),
    );
    expect(build.indexOf("Stage installers and checksums")).toBeLessThan(
      build.indexOf("Verify staged installers and checksums"),
    );
    expect(build.indexOf("Verify staged installers and checksums")).toBeLessThan(
      build.indexOf("Upload candidate artifact"),
    );
    expect(releaseWorkflow).not.toContain("contents: write");
    expect(releaseWorkflow).not.toMatch(/\b(?:git tag|gh release|gh api -X POST)\b/);
  });

  it("verifies the SHA-named downloaded artifact and permits an artifact-only rerun", () => {
    const build = releaseJob("build-windows");
    const verification = releaseJob("verify-candidate");
    const artifactName =
      "archeion-v${{ needs.detect-candidate.outputs.version }}-${{ needs.detect-candidate.outputs.sha }}-windows-x64";
    expect(build).toContain(`name: ${artifactName}`);
    expect(build).toContain("overwrite: true");
    expect(build).toContain("if-no-files-found: error");
    expect(verification).toContain("needs: [detect-candidate, build-windows]");
    expect(verification).toContain(`name: ${artifactName}`);
    expect(verification).toContain("ref: ${{ needs.detect-candidate.outputs.sha }}");
    expect(verification.indexOf("Download candidate artifact")).toBeLessThan(
      verification.indexOf("Verify candidate SHA and checksums"),
    );
    expect(verification).toContain(
      "./scripts/verify-windows-release.ps1 --artifacts-dir artifacts/windows",
    );
  });
});

describe("release-candidate detection", () => {
  it.each(["ordinary source commit", "lockfile-only dependency update"])(
    "ignores %s without an application-version change",
    () => {
      const fixture = scenario({ currentVersion: "1.5.4", parentVersion: "1.5.4" });
      expect(fixture.detect()).toEqual({
        candidate: false,
        reason: "Application version is unchanged.",
      });
      expect(fixture.calls.filter((call) => call.startsWith("pwsh"))).toHaveLength(1);
      expect(fixture.calls.some((call) => call.startsWith("gh"))).toBe(false);
    },
  );

  it("emits exactly one version for a validated application-version increase", () => {
    const fixture = scenario();
    expect(fixture.detect()).toEqual({ candidate: true, version: "1.5.5", sha: commit });
    expect(fixture.calls.filter((call) => call.startsWith("pwsh"))).toHaveLength(2);
    expect(fixture.calls.filter((call) => call.startsWith("gh"))).toHaveLength(1);
  });

  itWithPowerShell(
    "uses the real release validator for complete metadata and rejects incomplete preparation",
    () => {
      expect(scenario({ realValidation: "valid" }).detect()).toEqual({
        candidate: true,
        version: "1.5.5",
        sha: commit,
      });
      expect(() => scenario({ realValidation: "partial" }).detect()).toThrow(
        "Release versions are not aligned",
      );
      expect(() => scenario({ realValidation: "missingNote" }).detect()).toThrow(
        "release note is missing",
      );
    },
    30_000,
  );

  it("fails closed for incomplete version sources and missing release notes", () => {
    expect(() =>
      scenario({ firstValidationError: "Release versions are not aligned" }).detect(),
    ).toThrow("Release versions are not aligned");
    expect(() => scenario({ releaseValidationError: "release note is missing" }).detect()).toThrow(
      "release note is missing",
    );
  });

  it("refuses a version decrease or malformed version transition", () => {
    expect(() => scenario({ currentVersion: "1.5.3" }).detect()).toThrow("version decreased");
    expect(() => scenario({ currentVersion: "1.5.5-beta" }).detect()).toThrow(
      "must use stable X.Y.Z versions",
    );
  });

  it("fails closed for a conflicting tag or release", () => {
    expect(() => scenario({ remoteTagSha: otherCommit }).detect()).toThrow("points to");
    expect(() => scenario({ release: { tag_name: "v1.5.5", draft: true } }).detect()).toThrow(
      "without a matching remote tag",
    );
    expect(() => scenario({ releaseError: "gh: Forbidden (HTTP 403)" }).detect()).toThrow(
      "Could not inspect existing release",
    );
  });

  it("allows a matching draft for a later idempotent phase but skips a published release", () => {
    expect(
      scenario({ remoteTagSha: commit, release: { tag_name: "v1.5.5", draft: true } }).detect(),
    ).toEqual({ candidate: true, version: "1.5.5", sha: commit });
    expect(
      scenario({ remoteTagSha: commit, release: { tag_name: "v1.5.5", draft: false } }).detect(),
    ).toEqual({ candidate: false, reason: "v1.5.5 is already published." });
  });

  it("keeps the exact green version bump when main advances, without duplicating it on the next commit", () => {
    const releasePreparation = scenario({ mainSha: otherCommit });
    expect(releasePreparation.detect()).toEqual({ candidate: true, version: "1.5.5", sha: commit });

    const laterOrdinaryCommit = scenario({
      commitSha: otherCommit,
      currentVersion: "1.5.5",
      parentVersion: "1.5.5",
      mainSha: otherCommit,
    });
    expect(laterOrdinaryCommit.detect()).toEqual({
      candidate: false,
      reason: "Application version is unchanged.",
    });
    expect(laterOrdinaryCommit.calls.some((call) => call.startsWith("gh"))).toBe(false);
  });

  it("refuses a checkout that differs from the exact green CI SHA", () => {
    expect(() => scenario({ headSha: otherCommit }).detect()).toThrow(
      "does not match green CI commit",
    );
  });
});
