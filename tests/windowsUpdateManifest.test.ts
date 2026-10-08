import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  createWindowsUpdateManifest,
  verifyWindowsUpdateManifest,
} from "../scripts/windows-update-manifest.mjs";

const script = fileURLToPath(new URL("../scripts/windows-update-manifest.mjs", import.meta.url));
const roots: string[] = [];
type MutableManifest = {
  version: string;
  notes: unknown;
  pub_date: string;
  platforms: Record<string, { url: string; signature: string }>;
  additional?: boolean;
};
const note =
  "<!-- release-note: v1.6.0; date: 2026-10-08 -->\n\n## Changes\n\n- First change.\n- Unicode: café.\n\n## Downloads\n\nNot updater prose.\n";

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "archeion-updater-manifest-"));
  roots.push(root);
  const artifacts = path.join(root, "operator's Windows assets");
  fs.mkdirSync(artifacts);
  fs.mkdirSync(path.join(root, "release-notes"));
  fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ version: "1.6.0" }));
  fs.writeFileSync(path.join(root, "release-notes/v1.6.0.md"), note);
  // Deliberately non-production sample text. These tests prove wire parity,
  // not cryptographic validity, which is exercised by the native updater.
  fs.writeFileSync(
    path.join(artifacts, "Archeion-Setup-x64.exe.sig"),
    "fixture NSIS signature\r\n",
  );
  fs.writeFileSync(path.join(artifacts, "Archeion-x64.msi.sig"), "fixture MSI signature\n");
  const manifest = createWindowsUpdateManifest(root, artifacts);
  fs.writeFileSync(path.join(artifacts, "latest.json"), JSON.stringify(manifest));
  return { root, artifacts, manifest };
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Windows updater manifest", () => {
  it("uses canonical Changes/date and exact-tag, distinct installer-family entries", () => {
    const { root, artifacts, manifest } = fixture();
    expect(manifest).toEqual({
      version: "1.6.0",
      notes: "- First change.\n- Unicode: café.",
      pub_date: "2026-10-08T00:00:00Z",
      platforms: {
        "windows-x86_64-nsis": {
          url: "https://github.com/TommyMoonn/archeion/releases/download/v1.6.0/Archeion-Setup-x64.exe",
          signature: "fixture NSIS signature\r\n",
        },
        "windows-x86_64-msi": {
          url: "https://github.com/TommyMoonn/archeion/releases/download/v1.6.0/Archeion-x64.msi",
          signature: "fixture MSI signature\n",
        },
      },
    });
    expect(() => verifyWindowsUpdateManifest(root, artifacts)).not.toThrow();
  });

  it("generates byte-identical JSON across repeated CLI runs", () => {
    const { root, artifacts } = fixture();
    const generate = () =>
      spawnSync(
        process.execPath,
        [script, "generate", "--project", root, "--artifacts-dir", artifacts],
        { encoding: "utf8", windowsHide: true },
      );
    expect(generate().status).toBe(0);
    const before = fs.readFileSync(path.join(artifacts, "latest.json"));
    expect(generate().status).toBe(0);
    expect(fs.readFileSync(path.join(artifacts, "latest.json"))).toEqual(before);
    expect(before.toString()).toBe(
      `${JSON.stringify(createWindowsUpdateManifest(root, artifacts), null, 2)}\n`,
    );
  });

  it.each([
    [
      "version",
      (m: MutableManifest) => {
        m.version = "1.6.1";
      },
    ],
    [
      "notes",
      (m: MutableManifest) => {
        m.notes = "other prose";
      },
    ],
    [
      "date",
      (m: MutableManifest) => {
        m.pub_date = "2026-10-09T00:00:00Z";
      },
    ],
    [
      "generic Windows fallback",
      (m: MutableManifest) => {
        m.platforms["windows-x86_64"] = m.platforms["windows-x86_64-nsis"];
      },
    ],
    [
      "missing installer family",
      (m: MutableManifest) => {
        delete m.platforms["windows-x86_64-msi"];
      },
    ],
    [
      "cross-family URL",
      (m: MutableManifest) => {
        m.platforms["windows-x86_64-msi"].url = m.platforms["windows-x86_64-nsis"].url;
      },
    ],
    [
      "latest URL",
      (m: MutableManifest) => {
        m.platforms["windows-x86_64-nsis"].url =
          "https://github.com/TommyMoonn/archeion/releases/latest/download/Archeion-Setup-x64.exe";
      },
    ],
    [
      "wrong tag",
      (m: MutableManifest) => {
        m.platforms["windows-x86_64-nsis"].url = m.platforms["windows-x86_64-nsis"].url.replace(
          "v1.6.0",
          "v1.6.1",
        );
      },
    ],
    [
      "cross-family signature",
      (m: MutableManifest) => {
        m.platforms["windows-x86_64-msi"].signature = m.platforms["windows-x86_64-nsis"].signature;
      },
    ],
    [
      "trimmed signature",
      (m: MutableManifest) => {
        m.platforms["windows-x86_64-nsis"].signature =
          m.platforms["windows-x86_64-nsis"].signature.trim();
      },
    ],
    [
      "extra schema field",
      (m: MutableManifest) => {
        m.additional = true;
      },
    ],
    [
      "wrong field type",
      (m: MutableManifest) => {
        m.notes = [];
      },
    ],
  ])("rejects %s drift even when JSON is valid", (_case, mutate) => {
    const { root, artifacts, manifest } = fixture();
    mutate(manifest);
    fs.writeFileSync(path.join(artifacts, "latest.json"), JSON.stringify(manifest));
    expect(() => verifyWindowsUpdateManifest(root, artifacts)).toThrow(
      "latest.json does not match",
    );
  });

  it.each(["missing", "empty", "whitespace"])("rejects a %s signature", (variant) => {
    const { root, artifacts } = fixture();
    const signature = path.join(artifacts, "Archeion-x64.msi.sig");
    if (variant === "missing") fs.rmSync(signature);
    else fs.writeFileSync(signature, variant === "empty" ? "" : " \r\n");
    expect(() => createWindowsUpdateManifest(root, artifacts)).toThrow();
  });

  it.each([
    note.replace("2026-10-08", "2026-02-30"),
    note.replace("; date: 2026-10-08", ""),
    note.replace("## Changes", "## Other"),
    note.replace("v1.6.0;", "v1.6.1;"),
    note.replace("First change.", "{{placeholder}}"),
  ])("rejects invalid canonical metadata through the release-note owner", (invalidNote) => {
    const { root, artifacts } = fixture();
    fs.writeFileSync(path.join(root, "release-notes/v1.6.0.md"), invalidNote);
    expect(() => createWindowsUpdateManifest(root, artifacts)).toThrow();
  });

  it("rejects malformed JSON and incomplete CLI arguments without rewriting output", () => {
    const { root, artifacts } = fixture();
    fs.writeFileSync(path.join(artifacts, "latest.json"), "not JSON");
    expect(() => verifyWindowsUpdateManifest(root, artifacts)).toThrow();
    const result = spawnSync(process.execPath, [script, "generate", "--project", root], {
      encoding: "utf8",
      windowsHide: true,
    });
    expect(result.status).toBe(1);
    expect(fs.readFileSync(path.join(artifacts, "latest.json"), "utf8")).toBe("not JSON");
  });
});
