import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import JSZip from "jszip";
import { afterEach, describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(projectRoot, "scripts/zip-project.ps1");
const temporaryRoots: string[] = [];
const exportTestTimeout = 30_000;

function run(command: string, args: string[], cwd?: string, env?: NodeJS.ProcessEnv) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: env ? { ...process.env, ...env } : process.env,
    timeout: 30_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  return result;
}

function fixture(withGit = true) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "archeion-export-"));
  temporaryRoots.push(parent);
  const root = path.join(parent, "source repo");
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  fs.mkdirSync(path.join(root, ".planning"));
  fs.mkdirSync(path.join(root, ".project"));
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.writeFileSync(path.join(root, ".gitignore"), ".planning/\n.project/\nnode_modules/\n");
  fs.writeFileSync(path.join(root, ".zipignore"), ".git\nnode_modules\n*.zip\n");
  fs.writeFileSync(path.join(root, "README.md"), "committed source\n");
  fs.writeFileSync(path.join(root, "src", "app.txt"), "tracked content\n");

  let commit: string | null = null;
  if (withGit) {
    expect(run("git", ["init", "--initial-branch=main", root]).status).toBe(0);
    expect(run("git", ["-C", root, "add", "."]).status).toBe(0);
    expect(
      run("git", [
        "-C",
        root,
        "-c",
        "user.name=Export Test",
        "-c",
        "user.email=export@example.test",
        "commit",
        "-m",
        "fixture",
      ]).status,
    ).toBe(0);
    commit = run("git", ["-C", root, "rev-parse", "HEAD"]).stdout.trim();
    fs.writeFileSync(path.join(root, "README.md"), "modified workspace source\n");
  }

  fs.writeFileSync(path.join(root, "local.txt"), "untracked workspace content\n");
  fs.writeFileSync(path.join(root, ".planning", "plan.md"), "local plan\n");
  fs.writeFileSync(path.join(root, ".project", "evidence.md"), "local evidence\n");
  fs.writeFileSync(path.join(root, "node_modules", "dependency.txt"), "excluded\n");
  return { parent, root, commit };
}

function exportZip(root: string, output: string, mode: "repo" | "workspace") {
  return run("pwsh", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    script,
    "--mode",
    mode,
    "--project",
    root,
    "--output",
    output,
  ]);
}

async function readZip(file: string) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const names = Object.values(zip.files)
    .filter((entry) => !entry.dir)
    .map((entry) => entry.name)
    .sort();
  const manifest = JSON.parse(await zip.file("EXPORT_MANIFEST.json")!.async("string"));
  return { zip, names, manifest };
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("project ZIP export provenance", () => {
  it(
    "exports exactly the committed tree plus manifest in repo mode",
    async () => {
      const { parent, root, commit } = fixture();
      const output = path.join(parent, "repo.zip");
      const result = exportZip(root, output, "repo");
      expect(result.status, result.stderr).toBe(0);

      const { zip, names, manifest } = await readZip(output);
      const committed = run("git", ["-C", root, "ls-tree", "-r", "--name-only", "HEAD"])
        .stdout.trim()
        .split(/\r?\n/);
      expect(names).toEqual([...committed, "EXPORT_MANIFEST.json"].sort());
      expect((await zip.file("README.md")!.async("string")).replace(/\r\n/g, "\n")).toBe(
        "committed source\n",
      );
      expect(manifest).toMatchObject({
        schemaVersion: 1,
        exportMode: "repo",
        sourceCommit: commit,
        workingTreeDirty: true,
        trackedSourceBaseline: "git-commit",
        includedLocalOnly: { planning: false, project: false },
      });
      expect(Number.isNaN(Date.parse(manifest.createdAt))).toBe(false);
      expect(manifest.createdAt).toMatch(/Z$/);
      expect(result.stdout).toContain("✓ Export complete");
      expect(result.stdout).toContain("Archive");
      expect(result.stdout).toContain("Files");
      expect(result.stdout).toContain("Commit");
    },
    exportTestTimeout,
  );

  it(
    "exports filtered local planning, project, and edited source in workspace mode",
    async () => {
      const { parent, root, commit } = fixture();
      const output = path.join(parent, "workspace.zip");
      const result = exportZip(root, output, "workspace");
      expect(result.status, result.stderr).toBe(0);

      const { zip, names, manifest } = await readZip(output);
      expect(names).toContain(".planning/plan.md");
      expect(names).toContain(".project/evidence.md");
      expect(names).toContain("local.txt");
      expect(names).not.toContain("node_modules/dependency.txt");
      expect(names.some((name) => name.startsWith(".git/"))).toBe(false);
      expect(await zip.file("README.md")!.async("string")).toBe("modified workspace source\n");
      expect(manifest).toMatchObject({
        exportMode: "workspace",
        sourceCommit: commit,
        workingTreeDirty: true,
        trackedSourceBaseline: "working-tree-over-commit",
        includedLocalOnly: { planning: true, project: true },
      });
    },
    exportTestTimeout,
  );

  it(
    "marks Git provenance unavailable for an unpacked workspace",
    async () => {
      const { parent, root } = fixture(false);
      const output = path.join(parent, "workspace.zip");
      const result = exportZip(root, output, "workspace");
      expect(result.status, result.stderr).toBe(0);

      const { manifest } = await readZip(output);
      expect(manifest).toMatchObject({
        exportMode: "workspace",
        sourceCommit: null,
        workingTreeDirty: null,
        trackedSourceBaseline: "working-tree",
        includedLocalOnly: { planning: true, project: true },
      });
      expect(exportZip(root, path.join(parent, "repo.zip"), "repo").status).not.toBe(0);
    },
    exportTestTimeout,
  );

  it(
    "reports an unborn Git workspace without inventing a source commit",
    async () => {
      const { parent, root } = fixture(false);
      expect(run("git", ["init", "--initial-branch=main", root]).status).toBe(0);
      const output = path.join(parent, "unborn.zip");
      const result = exportZip(root, output, "workspace");
      expect(result.status, result.stderr).toBe(0);

      const { manifest } = await readZip(output);
      expect(manifest).toMatchObject({
        sourceCommit: null,
        workingTreeDirty: true,
        trackedSourceBaseline: "working-tree",
      });
      expect(exportZip(root, path.join(parent, "repo.zip"), "repo").status).not.toBe(0);
    },
    exportTestTimeout,
  );

  it.each(["repo", "workspace"] as const)(
    "uses the fixed Archeion prefix and compact local timestamp in %s default output names",
    (mode) => {
      const { parent, root } = fixture();
      const result = run("pwsh", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        script,
        "--mode",
        mode,
        "--project",
        root,
      ]);
      expect(result.status, result.stderr).toBe(0);

      const exports = fs.readdirSync(parent).filter((name) => name.endsWith(".zip"));
      expect(exports).toHaveLength(1);
      expect(exports[0]).toMatch(new RegExp(`^archeion-${mode}\\(\\d{10}\\)\\.zip$`));
    },
    exportTestTimeout,
  );

  it(
    "cleans temporary source and rebuilt archives when finalization fails",
    () => {
      const { parent, root } = fixture();
      const tempRoot = path.join(parent, "script-temp");
      fs.mkdirSync(tempRoot);

      const blockedParent = path.join(parent, "blocked-parent");
      fs.writeFileSync(blockedParent, "not a directory\n");
      const output = path.join(blockedParent, "failed.zip");
      const result = run(
        "pwsh",
        [
          "-NoProfile",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          script,
          "--mode",
          "workspace",
          "--project",
          root,
          "--output",
          output,
        ],
        undefined,
        { TMPDIR: tempRoot, TMP: tempRoot, TEMP: tempRoot },
      );

      expect(result.status).not.toBe(0);
      expect(fs.existsSync(output)).toBe(false);
      expect(
        fs.readdirSync(tempRoot).filter((name) => /^archeion-(source|export)-/.test(name)),
      ).toEqual([]);
    },
    exportTestTimeout,
  );

  it(
    "refuses ambiguous modes and overwriting an existing export",
    () => {
      const { parent, root } = fixture();
      const missingMode = run("pwsh", ["-NoProfile", "-File", script, "--project", root]);
      expect(missingMode.status).not.toBe(0);
      expect(missingMode.stderr).toContain("Specify --mode repo or --mode workspace");

      const output = path.join(parent, "repo.zip");
      expect(exportZip(root, output, "repo").status).toBe(0);
      const original = fs.readFileSync(output);
      expect(exportZip(root, output, "repo").status).not.toBe(0);
      expect(fs.readFileSync(output)).toEqual(original);
      expect(exportZip(root, path.join(root, "inside.zip"), "repo").status).not.toBe(0);
    },
    exportTestTimeout,
  );
});
