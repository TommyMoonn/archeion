import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const frontendJobs = [
  "frontend-static",
  "frontend-tests",
  "browser-contracts",
  "frontend-build",
];
export const platformJobs = [
  "rust-checks",
  "font-catalog-portability",
  "windows-runtime",
  "windows-updater",
  "msrv",
];
export const allJobs = [...frontendJobs, ...platformJobs];

function decision(mode) {
  return { mode, expected_jobs: JSON.stringify(mode === "docs-only" ? frontendJobs : allJobs) };
}

function documentationPath(file) {
  if (file.split("/").some((part) => !part || part === "." || part === "..")) return false;
  // Runtime assets and the generated release-history page always require full validation.
  if (
    file.startsWith("docs/documentation/assets/") ||
    file.startsWith("docs/documentation/changelog/")
  )
    return false;
  return (
    /^docs\/.+\.md$/.test(file) ||
    /^docs\/documentation\/.+\.html$/.test(file) ||
    file === "docs/documentation/page-registry.json"
  );
}

export function classifyChanges(eventName, event, git) {
  try {
    if (eventName !== "pull_request") return decision("full");
    const { base, head } = event.pull_request;
    if (![base.sha, head.sha].every((sha) => typeof sha === "string" && /^[a-f0-9]{40}$/.test(sha)))
      throw new Error("Missing exact PR revisions");
    if (git(["rev-parse", "--is-shallow-repository"]).trim() !== "false")
      throw new Error("Shallow repository");
    git(["fetch", "--no-tags", "origin", base.sha, head.sha]);
    for (const sha of [base.sha, head.sha]) git(["cat-file", "-e", `${sha}^{commit}`]);
    if (!/^[a-f0-9]{40}$/.test(git(["merge-base", base.sha, head.sha]).trim()))
      throw new Error("Missing merge base");
    const diff = git([
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--name-status",
      "-z",
      "--find-renames",
      base.sha,
      head.sha,
      "--",
    ]);
    if (!diff || !diff.endsWith("\0")) throw new Error("Empty or incomplete diff");
    const fields = diff.slice(0, -1).split("\0");
    if (fields.length % 2 !== 0) throw new Error("Ambiguous diff");
    for (let index = 0; index < fields.length; index += 2) {
      if (!["A", "M"].includes(fields[index]) || !documentationPath(fields[index + 1]))
        return decision("full");
    }
    return decision("docs-only");
  } catch (error) {
    console.warn(`CI classification defaults to full validation: ${error.message}`);
    return decision("full");
  }
}

export function checkGate(needs, eventName) {
  const classifier = needs["classify-changes"];
  if (classifier?.result !== "success") throw new Error("CI classifier did not succeed");
  const mode = classifier.outputs?.mode;
  if (mode !== "full" && (mode !== "docs-only" || eventName !== "pull_request"))
    throw new Error("Invalid CI validation mode for event");
  const expected = JSON.parse(classifier.outputs.expected_jobs);
  const allowed = mode === "docs-only" ? frontendJobs : allJobs;
  if (
    !Array.isArray(expected) ||
    expected.length !== allowed.length ||
    new Set(expected).size !== expected.length ||
    allowed.some((job) => !expected.includes(job))
  )
    throw new Error("Invalid expected CI job set");
  if (
    Object.keys(needs).length !== allJobs.length + 1 ||
    allJobs.some((job) => !Object.hasOwn(needs, job))
  )
    throw new Error("CI Gate is missing validation jobs or has unknown jobs");
  for (const job of allJobs) {
    const result = needs[job]?.result;
    console.log(`${job}: ${result}`);
    if (
      result !== "success" &&
      !(mode === "docs-only" && !expected.includes(job) && result === "skipped")
    )
      throw new Error(`CI validation job did not succeed: ${job}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === "classify") {
    let event = {};
    try {
      event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    } catch (error) {
      console.warn(`Cannot read CI event: ${error.message}`);
    }
    const result = classifyChanges(process.env.GITHUB_EVENT_NAME, event, (args) =>
      execFileSync("git", args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 60_000 }),
    );
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `mode=${result.mode}\nexpected_jobs=${result.expected_jobs}\n`,
    );
  } else if (process.argv[2] === "gate") {
    checkGate(JSON.parse(process.env.REQUIRED_JOBS), process.env.GITHUB_EVENT_NAME);
  } else {
    throw new Error("Expected classify or gate command");
  }
}
