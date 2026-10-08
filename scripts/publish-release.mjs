import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readRelease, releaseHasTag, tagTarget } from "./detect-release-candidate.mjs";
import { readReleaseNote } from "./release-notes.mjs";
import { windowsReleaseAssetNames } from "./windows-update-manifest.mjs";

const scriptRoot = path.dirname(fileURLToPath(import.meta.url));
const assetNames = windowsReleaseAssetNames;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const commitPattern = /^[0-9a-f]{40,64}$/;
const repositoryPattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

function runCommand(command, args, cwd, input) {
  const result = spawnSync(command, args, {
    cwd,
    input,
    encoding: "utf8",
    windowsHide: true,
  });
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

function releaseAssets(artifactsDirectory) {
  const actual = fs.readdirSync(artifactsDirectory).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...assetNames].sort())) {
    throw new Error("Release artifact files do not match the expected assets.");
  }
  return new Map(
    assetNames.map((name) => {
      const file = path.join(artifactsDirectory, name);
      const bytes = fs.readFileSync(file);
      if (bytes.length === 0) throw new Error(`Release asset is empty: ${name}.`);
      return [
        name,
        {
          file,
          size: bytes.length,
          digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}`,
        },
      ];
    }),
  );
}

function verifyRelease(release, tag, body, assets, draftId) {
  if (!releaseHasTag(release, tag, draftId) || release.name !== tag || release.body !== body) {
    throw new Error(`Release ${tag} title or body does not match the tracked release note.`);
  }
  const actual = release.assets;
  if (!Array.isArray(actual) || actual.length !== assets.size) {
    throw new Error(`Release ${tag} does not contain exactly the expected assets.`);
  }
  verifyExistingAssets(actual, tag, assets);
}

function verifyExistingAssets(actual, tag, assets) {
  const names = new Set();
  for (const asset of actual) {
    const expected = assets.get(asset.name);
    if (
      !expected ||
      names.has(asset.name) ||
      asset.state !== "uploaded" ||
      asset.size !== expected.size ||
      asset.digest !== expected.digest
    ) {
      throw new Error(`Release ${tag} asset ${asset.name} does not match the verified bundle.`);
    }
    names.add(asset.name);
  }
}

export function publishReleaseCandidate({
  projectRoot,
  commit,
  version,
  repository,
  artifactsDirectory,
  run = runCommand,
}) {
  if (!commitPattern.test(commit)) throw new Error("The candidate SHA is invalid.");
  if (!versionPattern.test(version)) throw new Error("The candidate version is invalid.");
  if (!repositoryPattern.test(repository))
    throw new Error("The GitHub repository name is invalid.");

  const tag = `v${version}`;
  const git = (...args) => requireSuccess(run("git", args, projectRoot), `git ${args[0]}`);
  const ghApi = (method, endpoint, payload, description) => {
    const args = ["api", "-X", method, endpoint];
    if (payload !== undefined) args.push("--input", "-");
    return requireSuccess(
      run("gh", args, projectRoot, payload === undefined ? undefined : JSON.stringify(payload)),
      description,
    );
  };
  const remoteTag = () =>
    tagTarget(git("ls-remote", "--tags", "origin", `refs/tags/${tag}`, `refs/tags/${tag}^{}`), tag);
  const validateIdentity = (release, expectedId = release?.id) => {
    if (!Number.isSafeInteger(release?.id) || release.id <= 0 || release.id !== expectedId) {
      throw new Error(`Invalid release identity for ${tag}.`);
    }
    return release;
  };
  const pendingRelease = () => {
    const [owner, name] = repository.split("/");
    const response = JSON.parse(
      ghApi(
        "POST",
        "graphql",
        {
          query:
            "query($owner: String!, $name: String!, $tag: String!) { repository(owner: $owner, name: $name) { release(tagName: $tag) { databaseId isDraft } } }",
          variables: { owner, name, tag },
        },
        `Inspect pending release ${tag}`,
      ),
    );
    const metadata = response.data?.repository;
    if (response.errors || !metadata || typeof metadata !== "object" || !("release" in metadata)) {
      throw new Error(`Invalid pending release lookup for ${tag}.`);
    }
    const pending = metadata.release;
    if (pending === null) return null;
    if (
      !Number.isSafeInteger(pending.databaseId) ||
      pending.databaseId <= 0 ||
      typeof pending.isDraft !== "boolean"
    ) {
      throw new Error(`Invalid release identity for ${tag}.`);
    }
    return pending;
  };
  const releaseById = (id, pending = pendingRelease()) => {
    if (!pending?.isDraft) throw new Error(`Release ${tag} is not a draft before publication.`);
    if (pending.databaseId !== id) throw new Error(`Invalid release identity for ${tag}.`);
    return validateIdentity(
      readRelease(run("gh", ["api", `repos/${repository}/releases/${id}`], projectRoot), tag, {
        draftId: id,
      }),
      id,
    );
  };
  const currentRelease = () => {
    const published = readRelease(
      run("gh", ["api", `repos/${repository}/releases/tags/${tag}`], projectRoot),
      tag,
    );
    if (published) return validateIdentity(published);

    // GitHub CLI also resolves a draft by its pending tag through GraphQL, then
    // reads it by ID. REST can report an untagged-* placeholder for that draft.
    const pending = pendingRelease();
    if (pending) {
      if (!pending.isDraft) throw new Error(`Release ${tag} is not a draft before publication.`);
      return releaseById(pending.databaseId, pending);
    }

    // If the pending tag has been lost, do not adopt a draft by title or create a
    // duplicate. Inspect all pages before the first mutation and require recovery.
    const pages = JSON.parse(
      requireSuccess(
        run(
          "gh",
          ["api", "--paginate", "--slurp", `repos/${repository}/releases?per_page=100`],
          projectRoot,
        ),
        `List releases for ${tag}`,
      ),
    );
    if (!Array.isArray(pages) || !pages.every((page) => Array.isArray(page))) {
      throw new Error(`Invalid release list for ${tag}.`);
    }
    const releases = pages.flat();
    if (
      releases.some(
        (release) =>
          !release ||
          typeof release.tag_name !== "string" ||
          release.tag_name.length === 0 ||
          typeof release.draft !== "boolean",
      )
    ) {
      throw new Error(`Invalid release list for ${tag}.`);
    }
    if (
      releases.some(
        (release) => release.tag_name === tag || (release.draft && release.name === tag),
      )
    ) {
      throw new Error(
        `Release ${tag} has inconsistent tag metadata and requires reviewed recovery.`,
      );
    }
    return null;
  };

  // The publication token is available only after the independent artifact-verification job.
  // Repeat the checks here before the first remote mutation.
  if (git("rev-parse", "HEAD") !== commit) {
    throw new Error(`Checkout HEAD does not match green candidate commit ${commit}.`);
  }
  requireSuccess(
    run(
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
      projectRoot,
    ),
    "Release metadata validation",
  );
  requireSuccess(
    run(
      "pwsh",
      [
        "-NoProfile",
        "-File",
        path.join(scriptRoot, "verify-windows-release.ps1"),
        "--project",
        projectRoot,
        "--artifacts-dir",
        artifactsDirectory,
      ],
      projectRoot,
    ),
    "Release installer verification",
  );

  const body = readReleaseNote(projectRoot, version).body;
  const assets = releaseAssets(artifactsDirectory);
  let target = remoteTag();
  if (target && target !== commit) {
    throw new Error(`Remote tag ${tag} points to ${target}, not candidate ${commit}.`);
  }
  let release = currentRelease();
  if (release && !target) throw new Error(`Release ${tag} exists without a matching remote tag.`);
  if (release && !release.draft) {
    verifyRelease(release, tag, body, assets);
    return { published: true, reused: true, tag, sha: commit };
  }

  if (!target) {
    const created = run(
      "gh",
      ["api", "-X", "POST", `repos/${repository}/git/refs`, "--input", "-"],
      projectRoot,
      JSON.stringify({ ref: `refs/tags/${tag}`, sha: commit }),
    );
    // A concurrent same-SHA creator is safe. Any other result fails closed.
    target = remoteTag();
    if (target !== commit) {
      requireSuccess(created, `Create protected tag ${tag}`);
      throw new Error(`Protected tag ${tag} was not created at candidate ${commit}.`);
    }
  }

  if (!release) {
    const created = run(
      "gh",
      ["api", "-X", "POST", `repos/${repository}/releases`, "--input", "-"],
      projectRoot,
      JSON.stringify({ tag_name: tag, target_commitish: commit, name: tag, body, draft: true }),
    );
    if (created.status !== 0) {
      release = currentRelease();
      if (!release || !release.draft) requireSuccess(created, `Create draft release ${tag}`);
    } else {
      release = validateIdentity(readRelease(created, tag));
    }
  }
  if (!release?.draft) throw new Error(`Release ${tag} is no longer a draft.`);
  if (remoteTag() !== commit) throw new Error(`Remote tag ${tag} changed before publication.`);

  ghApi(
    "PATCH",
    `repos/${repository}/releases/${release.id}`,
    { tag_name: tag, name: tag, body },
    `Update draft release ${tag}`,
  );
  release = releaseById(release.id);
  if (!release?.draft || !Array.isArray(release.assets)) {
    throw new Error(`Release ${tag} is not a valid draft before asset upload.`);
  }
  verifyExistingAssets(release.assets, tag, assets);
  const existingNames = new Set(release.assets.map((asset) => asset.name));
  const missing = assetNames.filter((name) => !existingNames.has(name));
  if (missing.length > 0) {
    requireSuccess(
      run(
        "gh",
        [
          "release",
          "upload",
          tag,
          ...missing.map((name) => assets.get(name).file),
          "--repo",
          repository,
        ],
        projectRoot,
      ),
      `Upload verified release assets for ${tag}`,
    );
  }
  release = releaseById(release.id);
  if (!release?.draft) throw new Error(`Release ${tag} is not a draft before publication.`);
  verifyRelease(release, tag, body, assets, release.id);
  if (remoteTag() !== commit) throw new Error(`Remote tag ${tag} changed before publication.`);

  const published = validateIdentity(
    readRelease(
      {
        status: 0,
        stdout: ghApi(
          "PATCH",
          `repos/${repository}/releases/${release.id}`,
          { tag_name: tag, draft: false },
          `Publish release ${tag}`,
        ),
      },
      tag,
    ),
    release.id,
  );
  if (published.draft) throw new Error(`Release ${tag} remained a draft after publication.`);
  verifyRelease(published, tag, body, assets);
  return { published: true, reused: false, tag, sha: commit };
}

function main() {
  const args = process.argv.slice(2);
  if (
    args.length !== 8 ||
    args[0] !== "--commit" ||
    args[2] !== "--version" ||
    args[4] !== "--repo" ||
    args[6] !== "--artifacts-dir"
  ) {
    throw new Error(
      "Usage: node scripts/publish-release.mjs --commit <sha> --version X.Y.Z --repo <owner/name> --artifacts-dir <path>",
    );
  }
  console.log(
    JSON.stringify(
      publishReleaseCandidate({
        projectRoot: path.resolve(scriptRoot, ".."),
        commit: args[1],
        version: args[3],
        repository: args[5],
        artifactsDirectory: path.resolve(args[7]),
      }),
    ),
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
