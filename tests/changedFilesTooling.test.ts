import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageScript = path.join(projectRoot, "scripts/package-changes.ps1");
const applyScript = path.join(projectRoot, "scripts/apply-changes.ps1");
const restoreScript = path.join(projectRoot, "scripts/restore-changes.ps1");
const temporaryRoots: string[] = [];
const scriptTimeout = 30_000;
// Native-process integration tests use the same finite budget as their child commands.
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

function runPowerShell(script: string, args: string[], env?: NodeJS.ProcessEnv) {
  return run(
    "pwsh",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", script, ...args],
    undefined,
    env,
  );
}

function tempRoot(prefix: string) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryRoots.push(root);
  return root;
}

function initRepository(root: string, files: Record<string, string>) {
  fs.mkdirSync(root, { recursive: true });
  for (const [relativePath, content] of Object.entries(files)) {
    const file = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
  }

  expect(run("git", ["init", "--initial-branch=main", root]).status).toBe(0);
  expect(run("git", ["-C", root, "add", "."]).status).toBe(0);
  expect(
    run("git", [
      "-C",
      root,
      "-c",
      "user.name=Changed Files Test",
      "-c",
      "user.email=changed-files@example.test",
      "commit",
      "-m",
      "fixture",
    ]).status,
  ).toBe(0);

  return run("git", ["-C", root, "rev-parse", "HEAD"]).stdout.trim();
}

async function writeZip(file: string, entries: Record<string, string>) {
  const zip = new JSZip();
  for (const [name, content] of Object.entries(entries)) zip.file(name, content);
  fs.writeFileSync(file, await zip.generateAsync({ type: "nodebuffer" }));
}

async function readZip(file: string) {
  return JSZip.loadAsync(fs.readFileSync(file));
}

function packageManifest(overrides: Record<string, unknown> = {}) {
  return JSON.stringify(
    {
      schemaVersion: 1,
      packageKind: "archeion-change-package",
      projectName: "archeion",
      sourceCommit: "f".repeat(40),
      trackedOnly: false,
      includedFiles: 1,
      deletedPaths: 0,
      createdAt: "2026-10-03T12:34:56.789Z",
      ...overrides,
    },
    null,
    2,
  );
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("changed-files package provenance", scriptTestOptions, () => {
  it("packages changed paths with safe versioned provenance", async () => {
    const parent = tempRoot("archeion-package-");
    const source = path.join(parent, "source checkout");
    const sourceCommit = initRepository(source, {
      "keep.txt": "before\n",
      "remove.txt": "remove me\n",
      "same.txt": "same\n",
    });
    expect(
      run("git", ["-C", source, "remote", "add", "origin", "https://example.test/private/repo.git"])
        .status,
    ).toBe(0);
    fs.writeFileSync(path.join(source, "keep.txt"), "after\n");
    fs.rmSync(path.join(source, "remove.txt"));
    fs.writeFileSync(path.join(source, "added.txt"), "new\n");

    const output = path.join(parent, "phase-d2.zip");
    const result = runPowerShell(packageScript, [
      "--project",
      source,
      "--output",
      output,
      "--name",
      "phase-d2",
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Changed-files package");
    expect(result.stdout).toContain("Staging 2 file(s)");
    expect(result.stdout).toContain("Compressing archive");
    expect(result.stdout).toContain("✓ Package created");
    expect(result.stdout).toContain("Archive");
    expect(result.stdout).toContain("Included");
    expect(result.stdout).toContain("Deleted");
    expect(result.stdout).toContain("Elapsed");

    const zip = await readZip(output);
    const names = Object.values(zip.files)
      .filter((entry) => !entry.dir)
      .map((entry) => entry.name)
      .sort();
    expect(names).toEqual(
      [
        ".archeion-change-package.json",
        ".chatgpt-delete-manifest.txt",
        "added.txt",
        "keep.txt",
      ].sort(),
    );

    const manifestText = await zip.file(".archeion-change-package.json")!.async("string");
    const manifest = JSON.parse(manifestText);
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      packageKind: "archeion-change-package",
      projectName: "Archeion",
      sourceCommit,
      trackedOnly: false,
      includedFiles: 2,
      deletedPaths: 1,
    });
    expect(manifest.createdAt).toMatch(/Z$/);
    expect(Number.isNaN(Date.parse(manifest.createdAt))).toBe(false);
    expect(manifestText).not.toContain(source);
    expect(manifestText).not.toContain("https://example.test/private/repo.git");
    expect(
      (await zip.file(".chatgpt-delete-manifest.txt")!.async("string")).replace(/\r\n/g, "\n"),
    ).toBe("remove.txt\n");
  });

  it("reports a successful no-change state without creating an archive", () => {
    const parent = tempRoot("archeion-package-clean-");
    const source = path.join(parent, "source");
    initRepository(source, { "clean.txt": "clean\n" });
    const output = path.join(parent, "should-not-exist.zip");

    const result = runPowerShell(packageScript, ["--project", source, "--output", output]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("✓ No changes to package");
    expect(fs.existsSync(output)).toBe(false);
  });
});

describe("changed-files apply", scriptTestOptions, () => {
  it("previews every actionable path without mutation, backup creation, or unchanged-path noise", async () => {
    const parent = tempRoot("archeion-apply-preview-");
    const target = path.join(parent, "target");
    initRepository(target, {
      "copy.txt": "old\n",
      "same.txt": "same\n",
      "remove.txt": "remove\n",
    });
    const archive = path.join(parent, "legacy.zip");
    await writeZip(archive, {
      "copy.txt": "new\n",
      "same.txt": "same\n",
      ".chatgpt-delete-manifest.txt": "remove.txt\nalready-absent.txt\n",
    });
    const localAppData = path.join(parent, "local-app-data");

    const result = runPowerShell(
      applyScript,
      ["--zip", archive, "--project", target, "--dry-run"],
      { LOCALAPPDATA: localAppData, NO_COLOR: "1" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Changed-files preview");
    expect(result.stdout).toContain("Provenance");
    expect(result.stdout).toContain("unavailable (legacy package)");
    expect(result.stdout).toContain("COPY");
    expect(result.stdout).toContain("copy.txt");
    expect(result.stdout).toContain("DELETE");
    expect(result.stdout).toContain("remove.txt");
    expect(result.stdout).toContain("SKIP");
    expect(result.stdout).toContain("already-absent.txt (already absent)");
    expect(result.stdout).not.toContain("same.txt");
    expect(result.stdout).toContain("✓ Preview complete");
    expect(result.stdout).toContain("Would copy");
    expect(result.stdout).toContain("Would delete");
    expect(result.stdout).toContain("Unchanged");
    expect(fs.readFileSync(path.join(target, "copy.txt"), "utf8")).toBe("old\n");
    expect(fs.existsSync(path.join(target, "remove.txt"))).toBe(true);
    expect(fs.existsSync(localAppData)).toBe(false);
  });

  it("applies a new package, surfaces provenance, and never copies package metadata", async () => {
    const parent = tempRoot("archeion-apply-package-");
    const source = path.join(parent, "source");
    const sourceCommit = initRepository(source, {
      "update.txt": "old\n",
      "remove.txt": "remove\n",
    });
    fs.writeFileSync(path.join(source, "update.txt"), "new\n");
    fs.writeFileSync(path.join(source, "added.txt"), "added\n");
    fs.rmSync(path.join(source, "remove.txt"));

    const archive = path.join(parent, "changes.zip");
    const packaged = runPowerShell(packageScript, ["--project", source, "--output", archive]);
    expect(packaged.status, packaged.stderr).toBe(0);

    const target = path.join(parent, "target");
    const cloned = run("git", ["clone", "--quiet", source, target]);
    expect(cloned.status, cloned.stderr).toBe(0);
    expect(run("git", ["-C", target, "rev-parse", "HEAD"]).stdout.trim()).toBe(sourceCommit);

    const result = runPowerShell(applyScript, ["--zip", archive, "--project", target], {
      LOCALAPPDATA: path.join(parent, "local-app-data"),
      NO_COLOR: "1",
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("Package");
    expect(result.stdout).toContain("source");
    expect(result.stdout).toContain("Source commit");
    expect(result.stdout).toContain(sourceCommit);
    expect(result.stdout).toContain("source commit present in target");
    expect(result.stdout).toContain("COPY");
    expect(result.stdout).toContain("update.txt");
    expect(result.stdout).toContain("added.txt");
    expect(result.stdout).toContain("DELETE");
    expect(result.stdout).toContain("remove.txt");
    expect(result.stdout).toContain("✓ Changes applied");
    expect(result.stdout).toContain("Git status");
    expect(fs.readFileSync(path.join(target, "update.txt"), "utf8")).toBe("new\n");
    expect(fs.readFileSync(path.join(target, "added.txt"), "utf8")).toBe("added\n");
    expect(fs.existsSync(path.join(target, "remove.txt"))).toBe(false);
    expect(fs.existsSync(path.join(target, ".archeion-change-package.json"))).toBe(false);
    expect(fs.existsSync(path.join(target, ".chatgpt-delete-manifest.txt"))).toBe(false);
  });

  it("warns on unavailable source provenance without blocking preview", async () => {
    const parent = tempRoot("archeion-apply-provenance-");
    const target = path.join(parent, "target");
    initRepository(target, { "file.txt": "old\n" });
    const archive = path.join(parent, "foreign.zip");
    await writeZip(archive, {
      "file.txt": "new\n",
      ".archeion-change-package.json": packageManifest(),
    });

    const result = runPowerShell(applyScript, ["--zip", archive, "--project", target, "--dry-run"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("! Source commit is not present in the target repository");
    expect(result.stdout).toContain("COPY");
    expect(fs.readFileSync(path.join(target, "file.txt"), "utf8")).toBe("old\n");
  });

  it.each([
    ["malformed", "{not json"],
    ["unsupported schema", packageManifest({ schemaVersion: 99 })],
    ["unsupported kind", packageManifest({ packageKind: "other-package" })],
    ["non-UTC timestamp", packageManifest({ createdAt: "2026-10-03T12:34:56.789+01:00" })],
    ["invalid timestamp", packageManifest({ createdAt: "not-a-dateZ" })],
    ["numeric timestamp", packageManifest({ createdAt: 123 })],
    ["null timestamp", packageManifest({ createdAt: null })],
  ])("rejects %s reserved provenance before mutation", async (name, manifest) => {
    const parent = tempRoot("archeion-apply-invalid-manifest-");
    const target = path.join(parent, "target");
    initRepository(target, { "file.txt": "old\n" });
    const archive = path.join(parent, "invalid.zip");
    await writeZip(archive, {
      "file.txt": "new\n",
      ".archeion-change-package.json": manifest,
    });

    const result = runPowerShell(applyScript, ["--zip", archive, "--project", target]);
    expect(result.status).not.toBe(0);
    if (name.includes("timestamp")) {
      expect(`${result.stdout}\n${result.stderr}`).toContain("createdAt must be a UTC timestamp");
    }
    expect(fs.readFileSync(path.join(target, "file.txt"), "utf8")).toBe("old\n");
  });

  it("shows explicit allow-dirty/no-backup warnings and skips backup creation", async () => {
    const parent = tempRoot("archeion-apply-warnings-");
    const target = path.join(parent, "target");
    initRepository(target, {
      "dirty.txt": "clean\n",
      "replace.txt": "old\n",
    });
    fs.writeFileSync(path.join(target, "dirty.txt"), "local edit\n");
    const archive = path.join(parent, "legacy.zip");
    await writeZip(archive, { "replace.txt": "new\n" });
    const localAppData = path.join(parent, "local-app-data");

    const result = runPowerShell(
      applyScript,
      ["--zip", archive, "--project", target, "--allow-dirty", "--no-backup"],
      { LOCALAPPDATA: localAppData, NO_COLOR: "1" },
    );
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("! --allow-dirty is enabled");
    expect(result.stdout).toContain("! --no-backup is enabled");
    expect(fs.readFileSync(path.join(target, "replace.txt"), "utf8")).toBe("new\n");
    expect(fs.existsSync(localAppData)).toBe(false);
  });

  it("reports a successful no-op while keeping absent deletions as skips", async () => {
    const parent = tempRoot("archeion-apply-noop-");
    const target = path.join(parent, "target");
    initRepository(target, { "same.txt": "same\n" });
    const archive = path.join(parent, "noop.zip");
    await writeZip(archive, {
      "same.txt": "same\n",
      ".chatgpt-delete-manifest.txt": "missing.txt\n",
    });

    const result = runPowerShell(applyScript, ["--zip", archive, "--project", target]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("SKIP");
    expect(result.stdout).toContain("missing.txt (already absent)");
    expect(result.stdout).toContain("✓ No changes needed");
    expect(result.stdout).not.toContain("same.txt");
  });

  it.each(["dirty tree", "parent traversal", ".git", "directory deletion"] as const)(
    "preserves %s protection",
    async (protection) => {
      const parent = tempRoot("archeion-apply-safety-");
      const target = path.join(parent, "target");
      const files: Record<string, string> = { "file.txt": "old\n" };
      if (protection === "directory deletion") files["folder/child.txt"] = "keep\n";
      initRepository(target, files);
      const gitConfig = fs.readFileSync(path.join(target, ".git/config"), "utf8");
      const entries: Record<string, string> = { "file.txt": "new\n" };
      if (protection === "dirty tree") fs.writeFileSync(path.join(target, "file.txt"), "dirty\n");
      if (protection === "parent traversal")
        entries[".chatgpt-delete-manifest.txt"] = "../escape.txt\n";
      if (protection === ".git") entries[".git/config"] = "blocked\n";
      if (protection === "directory deletion")
        entries[".chatgpt-delete-manifest.txt"] = "dir:folder\n";
      const archive = path.join(parent, "unsafe.zip");
      await writeZip(archive, entries);

      const result = runPowerShell(applyScript, ["--zip", archive, "--project", target]);
      expect(result.status).not.toBe(0);
      const rejection = {
        "dirty tree": "The Git working tree is not clean",
        "parent traversal": "Parent-directory traversal is not allowed",
        ".git": "The importer will not modify .git",
        "directory deletion": "Directory deletion requested",
      }[protection];
      expect(`${result.stdout}\n${result.stderr}`).toContain(rejection);
      expect(fs.readFileSync(path.join(target, "file.txt"), "utf8")).toBe(
        protection === "dirty tree" ? "dirty\n" : "old\n",
      );
      expect(fs.readFileSync(path.join(target, ".git/config"), "utf8")).toBe(gitConfig);
      if (protection === "directory deletion") {
        expect(fs.readFileSync(path.join(target, "folder/child.txt"), "utf8")).toBe("keep\n");
      }
    },
  );
});

describe("changed-files restore", scriptTestOptions, () => {
  it("previews all restore/create actions without mutation and preserves the partial-restore warning", () => {
    const parent = tempRoot("archeion-restore-");
    const target = path.join(parent, "target");
    initRepository(target, { "existing.txt": "current\n" });
    const backup = path.join(parent, "backup");
    fs.mkdirSync(path.join(backup, "nested", "deeper"), { recursive: true });
    fs.writeFileSync(path.join(backup, "existing.txt"), "restored\n");
    fs.writeFileSync(path.join(backup, "nested", "deeper", "file.txt"), "backup\n");

    const preview = runPowerShell(restoreScript, [
      "--project",
      target,
      "--backup",
      backup,
      "--dry-run",
    ]);
    expect(preview.status, preview.stderr).toBe(0);
    expect(preview.stdout).toContain("Backup restore preview");
    expect(preview.stdout).toContain("CREATE");
    expect(preview.stdout).toContain("nested");
    expect(preview.stdout).toContain("RESTORE");
    expect(preview.stdout).toContain("existing.txt");
    expect(preview.stdout).toContain(path.join("nested", "deeper", "file.txt"));
    expect(preview.stdout).toContain("✓ Preview complete");
    expect(fs.readFileSync(path.join(target, "existing.txt"), "utf8")).toBe("current\n");
    expect(fs.existsSync(path.join(target, "nested"))).toBe(false);

    const restored = runPowerShell(restoreScript, ["--project", target, "--backup", backup], {
      NO_COLOR: "1",
    });
    expect(restored.status, restored.stderr).toBe(0);
    expect(restored.stdout).toContain("CREATE");
    expect(restored.stdout).toContain("nested");
    expect(restored.stdout).toContain("RESTORE");
    expect(restored.stdout).toContain("existing.txt");
    expect(restored.stdout).toContain("✓ Restore complete");
    expect(restored.stdout).toContain("! The current importer does not record newly added files");
    expect(restored.stdout).toContain("Git status");
    expect(fs.readFileSync(path.join(target, "existing.txt"), "utf8")).toBe("restored\n");
    expect(fs.readFileSync(path.join(target, "nested", "deeper", "file.txt"), "utf8")).toBe(
      "backup\n",
    );
  });
});
