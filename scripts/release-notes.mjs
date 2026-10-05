import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const noteFilename = /^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)\.md$/;
const noteHeader =
  /^<!-- release-note: (v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)); date: (\d{4}-\d{2}-\d{2}) -->\r?\n\r?\n/;
const downloadUrl = /https:\/\/github\.com\/TommyMoonn\/archeion\/releases\/download\/([^\s)>]+)/g;

function fail(filename, reason) {
  throw new Error(`${filename}: ${reason}`);
}

export function parseReleaseNote(filename, source) {
  const filenameMatch = noteFilename.exec(path.basename(filename));
  if (!filenameMatch) fail(filename, "expected a vX.Y.Z.md filename.");

  const version = filenameMatch[0].slice(1, -3);
  const header = noteHeader.exec(source);
  if (!header) fail(filename, "missing or malformed release-note version/date header.");
  if (header[1] !== `v${version}`) {
    fail(filename, `header version ${header[1]} does not match filename v${version}.`);
  }

  const date = header[2];
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) {
    fail(filename, `invalid release date ${date}.`);
  }

  const body = source.slice(header[0].length);
  const changesHeading = /^## Changes[ \t]*$/m.exec(body);
  if (!changesHeading) fail(filename, "missing a Changes section.");

  const afterChanges = body.slice(changesHeading.index + changesHeading[0].length);
  const nextSection = /^## [^\r\n]+/m.exec(afterChanges);
  const changes = (nextSection ? afterChanges.slice(0, nextSection.index) : afterChanges).trim();
  if (!/^[-*] \S/m.test(changes)) {
    fail(filename, "Changes must contain at least one user-facing item.");
  }
  if (/\{\{[^}]+\}\}|vX\.X\.X/.test(body)) {
    fail(filename, "unfilled release-note placeholder.");
  }

  for (const match of body.matchAll(downloadUrl)) {
    const [tag, asset] = match[1].split("/", 2);
    if (tag !== `v${version}` || !asset) {
      fail(filename, `download link must target v${version}: ${match[0]}`);
    }
  }

  return { version, date, body, changes };
}

export function readReleaseNote(projectRoot, version) {
  const filename = `v${version}.md`;
  if (!noteFilename.test(filename)) fail(filename, "expected a stable X.Y.Z version.");

  const notePath = path.join(projectRoot, "release-notes", filename);
  if (!fs.existsSync(notePath)) fail(filename, "release note is missing.");
  return parseReleaseNote(filename, fs.readFileSync(notePath, "utf8"));
}

export function readAllReleaseNotes(projectRoot) {
  const directory = path.join(projectRoot, "release-notes");
  if (!fs.existsSync(directory)) throw new Error("release-notes/ is missing.");

  const filenames = fs.readdirSync(directory).filter((filename) => filename.endsWith(".md"));
  const noteNames = filenames.filter((filename) => filename !== "README.md");
  if (noteNames.length === 0) throw new Error("release-notes/ contains no versioned notes.");

  return noteNames
    .map((filename) => {
      if (!noteFilename.test(filename)) fail(filename, "expected a vX.Y.Z.md filename.");
      return parseReleaseNote(filename, fs.readFileSync(path.join(directory, filename), "utf8"));
    })
    .sort((a, b) => {
      // Calendar dates are the timeline order; numeric versions break same-day ties.
      if (a.date !== b.date) return a.date > b.date ? -1 : 1;
      const aParts = a.version.split(".").map(BigInt);
      const bParts = b.version.split(".").map(BigInt);
      for (let index = 0; index < aParts.length; index++) {
        if (aParts[index] !== bParts[index]) return aParts[index] > bParts[index] ? -1 : 1;
      }
      return 0;
    });
}

function runCli(args) {
  const [command, ...options] = args;
  if (command !== "validate" && command !== "read") {
    throw new Error(
      "Usage: node scripts/release-notes.mjs <validate|read> (--all|--version X.Y.Z) [--project PATH] [--body]",
    );
  }

  let projectRoot = process.cwd();
  let version;
  let all = false;
  let bodyOnly = false;
  for (let index = 0; index < options.length; index++) {
    const option = options[index];
    if (option === "--project") projectRoot = options[++index];
    else if (option === "--version") version = options[++index];
    else if (option === "--all") all = true;
    else if (option === "--body") bodyOnly = true;
    else throw new Error(`Unknown release-note option: ${option}`);
  }

  if (!projectRoot || all === Boolean(version) || (bodyOnly && (command !== "read" || all))) {
    throw new Error("Specify exactly one of --all or --version; --body requires read --version.");
  }

  const notes = all ? readAllReleaseNotes(projectRoot) : readReleaseNote(projectRoot, version);
  if (command === "validate") {
    process.stdout.write(`Validated ${all ? notes.length : 1} release note(s).\n`);
  } else if (bodyOnly) {
    process.stdout.write(notes.body);
  } else {
    process.stdout.write(`${JSON.stringify(notes)}\n`);
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
