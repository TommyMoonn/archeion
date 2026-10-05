import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readAllReleaseNotes, readReleaseNote } from "../scripts/release-notes.mjs";
import { syncDocumentationChangelog } from "../scripts/sync-documentation-changelog.mjs";

const projectRoot = process.cwd();
const noteCount = readAllReleaseNotes(projectRoot).length;
const currentVersion = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const targetPath = "docs/documentation/assets/docs-changelog-data.json";
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    if (
      path.dirname(root) !== path.resolve(os.tmpdir()) ||
      !path.basename(root).startsWith("archeion-changelog-")
    )
      throw new Error("Unsafe changelog fixture cleanup path.");
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archeion-changelog-"));
  roots.push(root);
  fs.cpSync(path.join(projectRoot, "release-notes"), path.join(root, "release-notes"), {
    recursive: true,
  });
  fs.copyFileSync(path.join(projectRoot, ".prettierrc.json"), path.join(root, ".prettierrc.json"));
  return root;
}

describe("documentation release-history data", () => {
  it("reproduces every tracked release from the shared parser without writing", async () => {
    const before = fs.readFileSync(targetPath, "utf8");
    const data = JSON.parse(before);
    const notes = readAllReleaseNotes(projectRoot);
    expect(data.schemaVersion).toBe(1);
    expect(data.entries).toEqual(
      notes.map(({ version, date, changes }) => ({
        version,
        date,
        sourcePath: `release-notes/v${version}.md`,
        changes: changes.replace(/\r\n/g, "\n"),
      })),
    );
    expect(data.entries).toHaveLength(notes.length);
    expect(data.entries[0].version).toBe(currentVersion);
    expect(data.entries.at(-1).version).toBe("0.1.0");
    expect(await syncDocumentationChangelog(projectRoot)).toEqual({
      changed: false,
      entryCount: notes.length,
    });
    expect(fs.readFileSync(targetPath, "utf8")).toBe(before);
    for (const entry of data.entries) {
      const source = fs.readFileSync(entry.sourcePath, "utf8");
      expect(readReleaseNote(projectRoot, entry.version).body).toBe(
        source.replace(/^<!-- release-note: [^\r\n]+ -->\r?\n\r?\n/, ""),
      );
      expect(entry.changes).not.toContain("## Downloads");
      expect(entry.changes).not.toContain("<!-- release-note:");
    }
  });

  it("generates source-only input deterministically and detects edits, additions, and removals", async () => {
    const root = fixture();
    const target = path.join(root, targetPath);
    const notePath = path.join(root, "release-notes/v1.5.4.md");
    const noteBefore = fs.readFileSync(notePath, "utf8");
    expect(await syncDocumentationChangelog(root)).toEqual({
      changed: true,
      entryCount: noteCount,
    });
    expect(fs.existsSync(target)).toBe(false);
    await syncDocumentationChangelog(root, { check: false });
    const generated = fs.readFileSync(target, "utf8");
    expect(generated).toBe(fs.readFileSync(targetPath, "utf8"));
    expect(await syncDocumentationChangelog(root, { check: false })).toEqual({
      changed: false,
      entryCount: noteCount,
    });
    expect(fs.readFileSync(notePath, "utf8")).toBe(noteBefore);
    fs.writeFileSync(notePath, `${noteBefore}\n- Another user-facing change.\n`);
    expect(await syncDocumentationChangelog(root)).toEqual({
      changed: true,
      entryCount: noteCount,
    });
    expect(fs.readFileSync(target, "utf8")).toBe(generated);
    fs.writeFileSync(
      path.join(root, "release-notes/v99.0.0.md"),
      "<!-- release-note: v99.0.0; date: 2099-01-01 -->\n\n## Changes\n\n- New release.\n",
    );
    expect(await syncDocumentationChangelog(root)).toEqual({
      changed: true,
      entryCount: noteCount + 1,
    });
    fs.rmSync(path.join(root, "release-notes/v0.1.0.md"));
    await syncDocumentationChangelog(root, { check: false });
    const entries = JSON.parse(fs.readFileSync(target, "utf8")).entries;
    expect(entries[0].version).toBe("99.0.0");
    expect(entries.some((entry: { version: string }) => entry.version === "0.1.0")).toBe(false);
  });

  it.each([
    ["missing metadata", "## Changes\n\n- Invalid.\n", /missing or malformed/],
    [
      "invalid date",
      "<!-- release-note: v1.5.4; date: 2026-02-30 -->\n\n## Changes\n\n- Invalid.\n",
      /invalid release date/,
    ],
    [
      "mismatched version",
      "<!-- release-note: v1.5.3; date: 2026-09-25 -->\n\n## Changes\n\n- Invalid.\n",
      /does not match filename/,
    ],
  ])("rejects %s before replacing generated data", async (_name, source, error) => {
    const root = fixture();
    await syncDocumentationChangelog(root, { check: false });
    const target = path.join(root, targetPath);
    const before = fs.readFileSync(target, "utf8");
    fs.writeFileSync(path.join(root, "release-notes/v1.5.4.md"), source);
    await expect(syncDocumentationChangelog(root, { check: false })).rejects.toThrow(error);
    expect(fs.readFileSync(target, "utf8")).toBe(before);
  });

  it("normalizes source line endings without changing authored note bytes", async () => {
    const root = fixture();
    const sources = fs
      .readdirSync(path.join(root, "release-notes"))
      .filter((name) => /^v.*\.md$/.test(name));
    for (const name of sources) {
      const source = path.join(root, "release-notes", name);
      fs.writeFileSync(source, fs.readFileSync(source, "utf8").replace(/\r?\n/g, "\r\n"));
    }
    const notePath = path.join(root, "release-notes/v1.5.4.md");
    const before = fs.readFileSync(notePath);
    await syncDocumentationChangelog(root, { check: false });
    expect(fs.readFileSync(path.join(root, targetPath), "utf8")).toBe(
      fs.readFileSync(targetPath, "utf8"),
    );
    expect(fs.readFileSync(notePath)).toEqual(before);
  });

  it("rejects an empty history or malformed filename without producing partial output", async () => {
    const root = fixture();
    for (const name of fs.readdirSync(path.join(root, "release-notes"))) {
      if (name !== "README.md") fs.rmSync(path.join(root, "release-notes", name));
    }
    await expect(syncDocumentationChangelog(root, { check: false })).rejects.toThrow(
      /no versioned notes/,
    );
    fs.writeFileSync(path.join(root, "release-notes/v1.5.md"), "Invalid filename");
    await expect(syncDocumentationChangelog(root, { check: false })).rejects.toThrow(
      /v1.5.md: expected a vX.Y.Z.md filename/,
    );
    expect(fs.existsSync(path.join(root, targetPath))).toBe(false);
  });

  it("CLI check fails for missing or stale data and never rewrites it", async () => {
    const root = fixture();
    const run = () =>
      spawnSync(
        process.execPath,
        [
          path.join(projectRoot, "scripts/sync-documentation-changelog.mjs"),
          "--check",
          "--project",
          root,
        ],
        { encoding: "utf8", windowsHide: true },
      );
    const missing = run();
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("Documentation changelog data drift");
    expect(fs.existsSync(path.join(root, targetPath))).toBe(false);
    await syncDocumentationChangelog(root, { check: false });
    expect(run().status).toBe(0);
    fs.appendFileSync(path.join(root, "release-notes/v1.5.4.md"), "\n- Body change.\n");
    const before = fs.readFileSync(path.join(root, targetPath), "utf8");
    expect(run().status).toBe(1);
    expect(fs.readFileSync(path.join(root, targetPath), "utf8")).toBe(before);
  });
});
