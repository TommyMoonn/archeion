import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const reviewScript = path.join(projectRoot, "scripts/review-changes.ps1");
const cleanScript = path.join(projectRoot, "scripts/clean-generated.ps1");
const temporaryRoots: string[] = [];
const scriptTimeout = 30_000;
const scriptTestOptions = { timeout: scriptTimeout };

function run(command: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
    timeout: scriptTimeout,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result;
}

function runPowerShell(script: string, args: string[]) {
  return run(
    "pwsh",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
    undefined,
    { NO_COLOR: "1" },
  );
}

function tempRepository(files: Record<string, string>) {
  const root = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "archeion-maintenance-script-")),
  );
  temporaryRoots.push(root);

  for (const [relativePath, content] of Object.entries(files)) {
    const file = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }

  expect(run("git", ["init", "--initial-branch=main", root]).status).toBe(0);
  expect(run("git", ["-C", root, "add", "."]).status).toBe(0);
  const committed = run("git", [
    "-C",
    root,
    "-c",
    "user.name=Maintenance Script Test",
    "-c",
    "user.email=maintenance-script@example.test",
    "commit",
    "-m",
    "fixture",
  ]);
  expect(committed.status, committed.stderr).toBe(0);
  return root;
}

function writeBytes(root: string, relativePath: string, bytes: number) {
  const file = path.join(root, relativePath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.alloc(bytes, 0x61));
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("change review feedback", scriptTestOptions, () => {
  it("reports project context, zero counts, and an explicit clean-tree success state", () => {
    const root = tempRepository({ "README.md": "clean\n" });

    const result = runPowerShell(reviewScript, ["--project", root]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Change review");
    expect(result.stdout).toContain("Project");
    expect(result.stdout).toContain(root);
    expect(result.stdout).toContain("Branch");
    expect(result.stdout).toContain("main");
    expect(result.stdout).toContain("Summary");
    expect(result.stdout).toMatch(/Staged\s+0/);
    expect(result.stdout).toMatch(/Unstaged\s+0/);
    expect(result.stdout).toMatch(/Total\s+0/);
    expect(result.stdout).toContain("✓ Working tree is clean");
  });

  it("preserves review flags and keeps changed paths opt-in", () => {
    const root = tempRepository({ "src/app.ts": "export const value = 1;\n" });
    fs.writeFileSync(path.join(root, "src/app.ts"), "export const value = 2;\n");

    const summary = runPowerShell(reviewScript, ["--project", root]);
    expect(summary.status, summary.stderr).toBe(0);
    expect(summary.stdout).toContain("Review flags");
    expect(summary.stdout).toContain("! Source changed without any test file changes.");
    expect(summary.stdout).not.toContain("src/app.ts");
    expect(summary.stdout).toContain("Use --files to list every changed path.");

    const detailed = runPowerShell(reviewScript, ["--project", root, "--files"]);
    expect(detailed.status, detailed.stderr).toBe(0);
    expect(detailed.stdout).toContain("Files");
    expect(detailed.stdout).toContain("Modified");
    expect(detailed.stdout).toContain("src/app.ts");
  });

  it("uses an explicit positive state when a changed tree has no review flags", () => {
    const root = tempRepository({ "README.md": "before\n" });
    fs.writeFileSync(path.join(root, "README.md"), "after\n");

    const result = runPowerShell(reviewScript, ["--project", root]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Review flags");
    expect(result.stdout).toContain("✓ No review flags detected");
  });
});

describe("generated-output cleanup feedback", scriptTestOptions, () => {
  it("previews every selected target with shared binary sizes without deleting anything", () => {
    const root = tempRepository({
      ".gitignore": "dist/\ncoverage/\nnode_modules/\nsrc-tauri/target/\n",
      "README.md": "fixture\n",
    });
    writeBytes(root, "dist/app.js", 1024);
    writeBytes(root, "coverage/coverage.json", 2048);
    writeBytes(root, "node_modules/package/data.bin", 512);
    writeBytes(root, "src-tauri/target/release/bundle/Archeion.exe", 512);

    const result = runPowerShell(cleanScript, ["--project", root, "--dry-run"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Generated output cleanup");
    expect(result.stdout).toContain("Scope");
    expect(result.stdout).toContain("WOULD REMOVE");
    expect(result.stdout).toContain("dist (1.0 KiB)");
    expect(result.stdout).toContain("coverage (2.0 KiB)");
    expect(result.stdout).toContain("PRESERVE");
    expect(result.stdout).toContain("src-tauri/target (use --rust to remove)");
    expect(result.stdout).toContain("node_modules (use --deps to remove)");
    expect(result.stdout).toContain("src-tauri/target/release/bundle (use --installers to remove)");
    expect(result.stdout).toContain("✓ Cleanup preview complete");
    expect(result.stdout).toMatch(/Would remove\s+2 target\(s\)/);
    expect(result.stdout).toMatch(/Would free\s+3\.0 KiB/);
    expect(fs.existsSync(path.join(root, "dist/app.js"))).toBe(true);
    expect(fs.existsSync(path.join(root, "coverage/coverage.json"))).toBe(true);
  });

  it("reports only completed removals and summarizes reclaimed space", () => {
    const root = tempRepository({
      ".gitignore": "dist/\ncoverage/\n",
      "README.md": "fixture\n",
    });
    writeBytes(root, "dist/app.js", 1024);
    writeBytes(root, "coverage/coverage.json", 2048);

    const result = runPowerShell(cleanScript, ["--project", root]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("REMOVE");
    expect(result.stdout).toContain("dist (1.0 KiB)");
    expect(result.stdout).toContain("coverage (2.0 KiB)");
    expect(result.stdout).toContain("✓ Cleanup complete");
    expect(result.stdout).toMatch(/Removed\s+2 target\(s\)/);
    expect(result.stdout).toMatch(/Freed\s+3\.0 KiB/);
    expect(fs.existsSync(path.join(root, "dist"))).toBe(false);
    expect(fs.existsSync(path.join(root, "coverage"))).toBe(false);
  });

  it("keeps tracked-file protection by default and makes --force conspicuous", () => {
    const root = tempRepository({
      "dist/tracked.txt": "tracked\n",
      "README.md": "fixture\n",
    });

    const protectedResult = runPowerShell(cleanScript, ["--project", root, "--dry-run"]);
    expect(protectedResult.status).not.toBe(0);
    expect(`${protectedResult.stdout}\n${protectedResult.stderr}`).toContain(
      "Refusing to remove 'dist' because it contains tracked files.",
    );
    expect(fs.existsSync(path.join(root, "dist/tracked.txt"))).toBe(true);

    const forcedPreview = runPowerShell(cleanScript, ["--project", root, "--dry-run", "--force"]);
    expect(forcedPreview.status, forcedPreview.stderr).toBe(0);
    expect(forcedPreview.stdout).toContain("! Tracked-file protection is disabled by --force.");
    expect(forcedPreview.stdout).toContain("WOULD REMOVE");
    expect(forcedPreview.stdout).toContain("dist");
    expect(fs.existsSync(path.join(root, "dist/tracked.txt"))).toBe(true);
  });
});
