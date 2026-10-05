import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const stableVersionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const commitPattern = /^[0-9a-f]{40,64}$/;

function runCommand(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", windowsHide: true });
  if (result.error) throw result.error;
  return result;
}

function requireSuccess(result, description) {
  if (result.status !== 0) {
    throw new Error(
      `${description} failed: ${(result.stderr || result.stdout || "unknown error").trim()}`,
    );
  }
  return result.stdout.trim();
}

function compareStableVersions(current, previous) {
  const currentParts = stableVersionPattern.exec(current);
  const previousParts = stableVersionPattern.exec(previous);
  if (!currentParts || !previousParts) {
    throw new Error(
      `Release version transition must use stable X.Y.Z versions: ${previous} -> ${current}`,
    );
  }

  for (let index = 1; index <= 3; index += 1) {
    const difference = BigInt(currentParts[index]) - BigInt(previousParts[index]);
    if (difference > 0n) return 1;
    if (difference < 0n) return -1;
  }
  return 0;
}

export function tagTarget(output, tag) {
  const ref = `refs/tags/${tag}`;
  const entries = output.trim() ? output.trim().split(/\r?\n/) : [];
  const refs = new Map();
  for (const entry of entries) {
    const match = /^([0-9a-f]{40,64})\s+(refs\/tags\/[^\s]+)$/.exec(entry);
    if (!match || (match[2] !== ref && match[2] !== `${ref}^{}`)) {
      throw new Error(`Unexpected remote tag result for ${tag}.`);
    }
    refs.set(match[2], match[1]);
  }
  if (refs.has(`${ref}^{}`) && !refs.has(ref)) {
    throw new Error(`Remote tag ${tag} has a peeled target without a tag ref.`);
  }
  return refs.get(`${ref}^{}`) ?? refs.get(ref) ?? null;
}

export function releaseHasTag(release, tag, draftId) {
  return (
    release.tag_name === tag ||
    (Number.isSafeInteger(draftId) &&
      draftId > 0 &&
      release.id === draftId &&
      release.draft === true &&
      /^untagged-[0-9a-f]+$/.test(release.tag_name))
  );
}

export function readRelease(result, tag, { draftId } = {}) {
  if (result.status === 0) {
    try {
      const release = JSON.parse(result.stdout);
      if (!releaseHasTag(release, tag, draftId) || typeof release.draft !== "boolean") {
        throw new Error("Invalid release metadata.");
      }
      return release;
    } catch (error) {
      throw new Error(`Could not validate existing release ${tag}: ${error.message}`);
    }
  }
  if (/\bHTTP 404\b/.test(result.stderr)) return null;
  throw new Error(
    `Could not inspect existing release ${tag}: ${(result.stderr || result.stdout).trim()}`,
  );
}

export function detectReleaseCandidate({ projectRoot, commit, repository, run = runCommand }) {
  if (!commitPattern.test(commit)) throw new Error("The CI head SHA is invalid.");
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error("The GitHub repository name is invalid.");
  }

  const git = (...args) => requireSuccess(run("git", args, projectRoot), `git ${args[0]}`);
  const checked = (command, args, description) =>
    requireSuccess(run(command, args, projectRoot), description);

  if (git("rev-parse", "HEAD") !== commit) {
    throw new Error(`Checkout HEAD does not match green CI commit ${commit}.`);
  }

  checked(
    "pwsh",
    ["-NoProfile", "-File", path.join(scriptRoot, "check-release.ps1"), "--project", projectRoot],
    "Five-source release version validation",
  );

  const currentVersion = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"),
  ).version;
  const parentVersion = JSON.parse(git("show", `${commit}^1:package.json`)).version;
  if (currentVersion === parentVersion) {
    return { candidate: false, reason: "Application version is unchanged." };
  }
  if (compareStableVersions(currentVersion, parentVersion) < 0) {
    throw new Error(`Application version decreased: ${parentVersion} -> ${currentVersion}.`);
  }

  const tag = `v${currentVersion}`;
  checked(
    "pwsh",
    [
      "-NoProfile",
      "-File",
      path.join(scriptRoot, "check-release.ps1"),
      "--project",
      projectRoot,
      "--tag",
      tag,
      "--require-changelog",
    ],
    "Release changelog and note validation",
  );

  const remoteTag = tagTarget(
    git("ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`),
    tag,
  );
  if (remoteTag && remoteTag !== commit) {
    throw new Error(`Remote tag ${tag} points to ${remoteTag}, not candidate ${commit}.`);
  }

  const release = readRelease(
    run("gh", ["api", `repos/${repository}/releases/tags/${tag}`], projectRoot),
    tag,
  );
  if (release && !remoteTag) {
    throw new Error(`Release ${tag} exists without a matching remote tag.`);
  }
  return { candidate: true, version: currentVersion, sha: commit };
}

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 4 || args[0] !== "--commit" || args[2] !== "--repo") {
    throw new Error(
      "Usage: node scripts/detect-release-candidate.mjs --commit <green-main-sha> --repo <owner/name>",
    );
  }

  const result = detectReleaseCandidate({
    projectRoot: path.resolve(scriptRoot, ".."),
    commit: args[1],
    repository: args[3],
  });
  console.log(JSON.stringify(result));
  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      `candidate=${result.candidate}\n${result.candidate ? `version=${result.version}\nsha=${result.sha}\n` : ""}`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
