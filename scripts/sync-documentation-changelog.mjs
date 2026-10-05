import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as prettier from "prettier";
import { readAllReleaseNotes } from "./release-notes.mjs";

const defaultProjectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outputPath = "docs/documentation/assets/docs-changelog-data.json";

export async function syncDocumentationChangelog(
  projectRoot = defaultProjectRoot,
  { check = true } = {},
) {
  // Release validation and publication own parsing. Docs only project their validated data.
  const notes = readAllReleaseNotes(projectRoot);
  const entries = notes.map(({ version, date, changes }) => ({
    version,
    date,
    sourcePath: `release-notes/v${version}.md`,
    changes: changes.replace(/\r\n/g, "\n"),
  }));
  const target = path.join(projectRoot, outputPath);
  const before = fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null;
  const options = await prettier.resolveConfig(path.join(projectRoot, ".prettierrc.json"));
  const output = await prettier.format(JSON.stringify({ schemaVersion: 1, entries }), {
    ...options,
    parser: "json",
  });
  const changed = before?.replace(/\r\n/g, "\n") !== output;
  if (!check && changed) {
    if (JSON.stringify(readAllReleaseNotes(projectRoot)) !== JSON.stringify(notes))
      throw new Error("Release notes changed during changelog sync; retry after finishing edits.");
    if ((fs.existsSync(target) ? fs.readFileSync(target, "utf8") : null) !== before)
      throw new Error("Changelog data changed during sync; retry after finishing edits.");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      fs.writeFileSync(temporary, output, { encoding: "utf8", flag: "wx" });
      fs.renameSync(temporary, target);
    } finally {
      fs.rmSync(temporary, { force: true });
    }
  }
  return { changed, entryCount: entries.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [mode, option, root, ...extra] = process.argv.slice(2);
    if (
      !["--check", "--write"].includes(mode) ||
      (option !== undefined && (option !== "--project" || !root)) ||
      extra.length
    )
      throw new Error(
        "Usage: node scripts/sync-documentation-changelog.mjs --check|--write [--project PATH]",
      );
    const check = mode === "--check";
    const result = await syncDocumentationChangelog(root ?? defaultProjectRoot, { check });
    if (check && result.changed) {
      console.error(
        "Documentation changelog data drift. Run npm run docs:changelog:sync and commit the generated data.",
      );
      process.exitCode = 1;
    } else {
      console.log(
        `Documentation changelog ${check ? "checked" : "synced"}: ${result.entryCount} releases, ${result.changed ? 1 : 0} changed.`,
      );
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
