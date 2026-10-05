import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";
import { parseReleaseNote, readAllReleaseNotes } from "../scripts/release-notes.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = path.join(projectRoot, "scripts", "release-notes.mjs");
const temporaryRoots: string[] = [];
const historicalVersions = [
  "0.1.0",
  "0.2.0",
  "0.3.0",
  "0.4.0",
  "0.5.0",
  "0.6.0",
  "0.7.0",
  "0.8.0",
  "0.9.0",
  "1.0.0",
  "1.0.1",
  "1.0.2",
  "1.1.0",
  "1.2.0",
  "1.3.0",
  "1.4.0",
  "1.4.1",
  "1.4.2",
  "1.4.3",
  "1.5.0",
  "1.5.1",
  "1.5.2",
  "1.5.3",
  "1.5.4",
];

function runNotes(...args: string[]) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: projectRoot,
    encoding: "utf8",
    windowsHide: true,
  });
}

function noteFixture(contents?: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archeion-release-notes-"));
  temporaryRoots.push(root);
  fs.mkdirSync(path.join(root, "release-notes"));
  if (contents !== undefined) {
    fs.writeFileSync(path.join(root, "release-notes", "v0.3.0.md"), contents);
  }
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    fs.rmSync(root, { force: true, recursive: true });
  }
});

describe("tracked release notes", () => {
  it("exposes only Changes for documentation while preserving the complete release body", () => {
    const body =
      "## Downloads\r\n\r\n- Installer.\r\n\r\n## Changes\r\n\r\n- Keep **formatting** and [links](https://example.com).\r\n  Continuation text.\r\n\r\n## Notes\r\n\r\nAdditional release guidance.\r\n";
    const note = parseReleaseNote(
      "v0.3.0.md",
      `<!-- release-note: v0.3.0; date: 2026-07-12 -->\r\n\r\n${body}`,
    );
    expect(note.body).toBe(body);
    expect(note.changes).toBe(
      "- Keep **formatting** and [links](https://example.com).\r\n  Continuation text.",
    );
  });

  it("orders by descending date, then numeric version without precision loss", () => {
    const root = noteFixture();
    const inputs = [
      ["1.9.0", "2026-07-12"],
      ["1.10.0", "2026-07-12"],
      ["0.3.0", "2026-07-13"],
      ["1.10.2", "2026-07-12"],
      ["9007199254740992.0.0", "2026-07-11"],
      ["9007199254740993.0.0", "2026-07-11"],
    ];
    for (const [version, date] of inputs) {
      fs.writeFileSync(
        path.join(root, "release-notes", `v${version}.md`),
        `<!-- release-note: v${version}; date: ${date} -->\n\n## Changes\n\n- Version ${version}.\n`,
      );
    }
    expect(readAllReleaseNotes(root).map((note) => note.version)).toEqual([
      "0.3.0",
      "1.10.2",
      "1.10.0",
      "1.9.0",
      "9007199254740993.0.0",
      "9007199254740992.0.0",
    ]);
  });

  it("validates the complete historical set and exposes deterministic timeline metadata", () => {
    const validation = runNotes("validate", "--all");
    const result = runNotes("read", "--all");

    expect(validation.status).toBe(0);
    expect(validation.stdout).toContain("Validated 24 release note(s).");
    expect(result.status).toBe(0);
    const notes = JSON.parse(result.stdout) as Array<{
      version: string;
      date: string;
      body: string;
    }>;
    expect(notes.map(({ version }) => version).sort()).toEqual([...historicalVersions].sort());
    expect(notes[0].version).toBe("1.5.4");
    expect(notes.at(-1)?.version).toBe("0.1.0");
    for (const note of notes) {
      expect(note.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(note.body).toContain("## Changes");
      expect(note.body).not.toContain("<!-- release-note:");
    }
  });

  it("preserves the published v1.5.4 user-facing body without metadata", () => {
    const result = runNotes("read", "--version", "1.5.4", "--body");
    const body = result.stdout.replace(/\r\n/g, "\n");

    expect(result.status).toBe(0);
    expect(body).toMatch(/^## Downloads\n/);
    expect(body).not.toContain("<!-- release-note:");
    expect(createHash("sha256").update(body).digest("hex")).toBe(
      "172ab905b67f030523ebb6efbaed16b455c3c1adf1a8094ecb42d4359ab31904",
    );
  });

  it.each([
    {
      name: "missing metadata",
      source: "## Changes\n\n- Fixture release.\n",
      error: "missing or malformed release-note version/date header",
    },
    {
      name: "mismatched version",
      source:
        "<!-- release-note: v0.4.0; date: 2026-07-12 -->\n\n## Changes\n\n- Fixture release.\n",
      error: "header version v0.4.0 does not match filename v0.3.0",
    },
    {
      name: "invalid date",
      source:
        "<!-- release-note: v0.3.0; date: 2026-02-30 -->\n\n## Changes\n\n- Fixture release.\n",
      error: "invalid release date 2026-02-30",
    },
    {
      name: "missing Changes section",
      source: "<!-- release-note: v0.3.0; date: 2026-07-12 -->\n\n## Downloads\n\n- Installer.\n",
      error: "missing a Changes section",
    },
    {
      name: "mismatched download link",
      source:
        "<!-- release-note: v0.3.0; date: 2026-07-12 -->\n\n## Changes\n\n- [Installer](https://github.com/TommyMoonn/archeion/releases/download/v0.2.0/file.exe)\n",
      error: "download link must target v0.3.0",
    },
  ])("rejects $name", ({ source, error }) => {
    const root = noteFixture(source);
    const result = runNotes("validate", "--version", "0.3.0", "--project", root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(error);
  });

  it("rejects an absent current-version note", () => {
    const root = noteFixture();
    const result = runNotes("validate", "--version", "0.3.0", "--project", root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("v0.3.0.md: release note is missing.");
  });
});
