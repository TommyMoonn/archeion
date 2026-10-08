import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { readReleaseNote } from "./release-notes.mjs";

const installers = [
  ["windows-x86_64-nsis", "Archeion-Setup-x64.exe"],
  ["windows-x86_64-msi", "Archeion-x64.msi"],
];

export const windowsReleaseAssetNames = [
  ...installers.flatMap(([, filename]) => [filename, `${filename}.sig`]),
  "latest.json",
  "SHA256SUMS.txt",
];

// Release notes own version/date validation and Changes extraction. Signatures
// remain opaque: cryptographic validation belongs to the native updater.
export function createWindowsUpdateManifest(projectRoot, artifactsDirectory) {
  const { version } = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
  const note = readReleaseNote(projectRoot, version);
  const platforms = Object.fromEntries(
    installers.map(([platform, filename]) => {
      const signature = fs.readFileSync(path.join(artifactsDirectory, `${filename}.sig`), "utf8");
      if (!signature.trim()) throw new Error(`Empty updater signature: ${filename}.sig`);
      return [
        platform,
        {
          url: `https://github.com/TommyMoonn/archeion/releases/download/v${note.version}/${filename}`,
          signature,
        },
      ];
    }),
  );
  return {
    version: note.version,
    notes: note.changes,
    pub_date: `${note.date}T00:00:00Z`,
    platforms,
  };
}

export function verifyWindowsUpdateManifest(projectRoot, artifactsDirectory) {
  const actual = JSON.parse(fs.readFileSync(path.join(artifactsDirectory, "latest.json"), "utf8"));
  const expected = createWindowsUpdateManifest(projectRoot, artifactsDirectory);
  if (!isDeepStrictEqual(actual, expected)) {
    throw new Error(
      "latest.json does not match the release version, canonical notes/date, bundle-specific URLs, and signature files.",
    );
  }
}

function runCli(args) {
  const [command, ...options] = args;
  if (!["generate", "verify"].includes(command)) {
    throw new Error(
      "Usage: node scripts/windows-update-manifest.mjs <generate|verify> --project PATH --artifacts-dir PATH",
    );
  }
  const values = new Map();
  for (let index = 0; index < options.length; index += 2) {
    const option = options[index];
    const value = options[index + 1];
    if (
      !["--project", "--artifacts-dir"].includes(option) ||
      values.has(option) ||
      !value ||
      value.startsWith("--")
    ) {
      throw new Error(`Invalid or duplicate manifest option: ${option}`);
    }
    values.set(option, value);
  }
  if (values.size !== 2) throw new Error("Both --project and --artifacts-dir are required.");
  const projectRoot = path.resolve(values.get("--project"));
  const artifactsDirectory = path.resolve(values.get("--artifacts-dir"));
  if (command === "generate") {
    const manifest = createWindowsUpdateManifest(projectRoot, artifactsDirectory);
    fs.writeFileSync(
      path.join(artifactsDirectory, "latest.json"),
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
  } else {
    verifyWindowsUpdateManifest(projectRoot, artifactsDirectory);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
