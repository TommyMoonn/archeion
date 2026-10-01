import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

type ParityGroup = Readonly<{
  canonical: string;
  copies: readonly string[];
}>;

// Only physical copies that must represent the same source bytes belong here.
// Resized platform icons, the favicon, and other site imagery are not copies.
const requiredCopies: readonly ParityGroup[] = [
  {
    canonical: "src-tauri/icons/128x128.png",
    copies: ["src/assets/brand/archeion-icon-128.png", "docs/assets/images/archeion-icon.png"],
  },
  {
    canonical:
      "src/assets/fonts/atkinson-hyperlegible/atkinson-hyperlegible-latin-400-normal.woff2",
    copies: ["docs/assets/fonts/atkinson-regular.woff2"],
  },
  {
    canonical:
      "src/assets/fonts/atkinson-hyperlegible/atkinson-hyperlegible-latin-700-normal.woff2",
    copies: ["docs/assets/fonts/atkinson-bold.woff2"],
  },
  {
    canonical: "src/assets/fonts/literata/literata-latin-standard-normal.woff2",
    copies: ["docs/assets/fonts/literata-regular.woff2"],
  },
  {
    canonical: "src/assets/fonts/literata/literata-latin-standard-italic.woff2",
    copies: ["docs/assets/fonts/literata-italic.woff2"],
  },
];

function sha256(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function parityProblems(root: string, groups: readonly ParityGroup[]): string[] {
  const problems: string[] = [];

  for (const { canonical, copies } of groups) {
    const source = path.join(root, canonical);
    if (!fs.existsSync(source)) {
      problems.push(`${canonical}: canonical asset is missing`);
      continue;
    }

    const expected = sha256(source);
    for (const copy of copies) {
      const target = path.join(root, copy);
      if (!fs.existsSync(target)) {
        problems.push(`${copy}: required copy of ${canonical} is missing`);
      } else if (sha256(target) !== expected) {
        problems.push(`${copy}: bytes differ from ${canonical}`);
      }
    }
  }

  return problems;
}

describe("required shared asset parity", () => {
  it("keeps the deployed icon and font copies identical to their canonical files", () => {
    expect(parityProblems(projectRoot, requiredCopies)).toEqual([]);
  });

  it("identifies a mismatched copy by both repository paths", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "archeion-asset-parity-"));
    try {
      fs.writeFileSync(path.join(root, "source.bin"), "canonical");
      fs.writeFileSync(path.join(root, "copy.bin"), "different");
      expect(parityProblems(root, [{ canonical: "source.bin", copies: ["copy.bin"] }])).toEqual([
        "copy.bin: bytes differ from source.bin",
      ]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not require unrelated or intentionally distinct assets to match", () => {
    const requiredPaths = requiredCopies.flatMap(({ canonical, copies }) => [canonical, ...copies]);
    expect(requiredPaths).not.toContain("public/favicon.png");
    expect(requiredPaths).not.toContain("src-tauri/icons/32x32.png");

    const root = fs.mkdtempSync(path.join(os.tmpdir(), "archeion-asset-parity-"));
    try {
      fs.writeFileSync(path.join(root, "source.bin"), "canonical");
      fs.writeFileSync(path.join(root, "copy.bin"), "canonical");
      fs.writeFileSync(path.join(root, "distinct.bin"), "different by design");
      expect(parityProblems(root, [{ canonical: "source.bin", copies: ["copy.bin"] }])).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
