---
name: release-prepare
description: Prepare an Archeion application release change using the repository's tracked release workflow. Use when the user asks to prepare a release, bump Archeion to a target stable version, synchronize release notes into the documentation site, or run the required local release-readiness checks. This skill updates and validates release-preparation state only; it does not write release prose unless separately requested, create tags or GitHub Releases, open PRs, commit, push, or publish.
---

# Release Prepare

Prepare one complete Archeion release transition using the repository-owned scripts and validation contract.

## Activation boundary

This skill owns:

- applying a requested stable `X.Y.Z` application version with the canonical version script;
- verifying that the matching technical changelog entry and tracked release note are present;
- synchronizing release-note-derived documentation output;
- running the repository's required local release checks;
- reviewing the final release-preparation diff for completeness and scope.

It does not own:

- drafting or rewriting release-note/changelog prose unless the user explicitly requests writing work;
- creating or pushing `v*` tags;
- creating, publishing, mutating, or deleting GitHub Releases;
- opening pull requests;
- generating commit messages;
- committing or pushing changes.

Use the existing `dumbo-release-writing` skill when release-note prose itself needs to be drafted or rewritten. Use `pull-request` and `commit-message` for those later handoffs.

## Input

Resolve the target stable release version from the user's request or authoritative release plan. It must be a stable `X.Y.Z` version greater than the current application version.

If the target version cannot be resolved safely, ask for it rather than inventing one.

## Workflow

### 1. Establish the release baseline

From the repository root:

- inspect Git status and current branch;
- read the current application version;
- read `docs/RELEASING.md` and `release-notes/README.md` before mutating release state;
- confirm the target version is not already the current version;
- inspect the matching `CHANGELOG.md` section and `release-notes/vX.Y.Z.md` when they already exist.

Read [the Archeion release workflow reference](references/archeion-release-workflow.md) before running release commands. Repository-tracked release documentation is authoritative if it has changed since this skill was written.

Do not silently absorb unrelated dirty files into release preparation. Record pre-existing changes and keep release-owned edits distinguishable.

### 2. Ensure release metadata is ready

The release-preparation change must ultimately contain all three together:

1. the application-version transition;
2. a dated `CHANGELOG.md` section plus comparison link for `X.Y.Z`;
3. `release-notes/vX.Y.Z.md` following the tracked release-note contract.

If changelog or release-note content is missing and the user did not ask this skill to author it, stop before claiming the release is prepared and report the missing input. Do not fabricate user-facing release content from implementation guesses.

Use Node 22 and pnpm 10.33.0. For a clean install, run
`pnpm install --frozen-lockfile`; app-only automation can filter `archeion...`.

### 3. Set the version through the canonical script

Use:

```powershell
pnpm run version:set X.Y.Z
```

Do not hand-edit the four version sources. The canonical script owns their coordinated update and rollback behavior.

If the command fails, report its failure. Do not manually recreate a partially applied version transition.

### 4. Synchronize documentation

After the release note and changelog are in their intended final form, run:

```powershell
pnpm run docs:sync
```

Sync writes only `website/src/generated/release-history.json`; it and docs:check are Node-only. Website build/MDX validation is separate. Treat generated documentation as derived output. Edit release prose in `release-notes/vX.Y.Z.md`, not in generated changelog data or Changelog MDX prose.

If sync reports that a source changed during generation, finish the source edit first and rerun the canonical sync command.

### 5. Run required release validation

Run the repository's release-readiness checks in this order:

```powershell
pnpm run docs:check
pnpm run release:check --tag vX.Y.Z
pnpm run verify
git diff --check
```

Do not claim release readiness unless all required checks that are available in the environment complete successfully.

`pnpm run verify` is intentionally broad. Do not redundantly run every release test file first unless diagnosing a failure or the user specifically requests focused evidence.

When a broad check fails, use the smallest relevant script or test to diagnose and correct the issue, then rerun the failed required check and any downstream checks whose result may have been invalidated.

### 6. Self-review the prepared release

Before reporting completion, verify:

1. all four application-version sources agree on `X.Y.Z`;
2. `CHANGELOG.md` has the dated `[X.Y.Z]` section and comparison link;
3. `release-notes/vX.Y.Z.md` has matching metadata and download-version references;
4. documentation generated from release notes is synchronized rather than hand-edited;
5. no unrelated product or maintenance work was pulled into the release-preparation change;
6. no tag, GitHub Release, publication state, PR, commit, or push was created by this skill;
7. the final diff keeps the version transition, changelog metadata, release note, and required generated documentation coherent as one release-preparation unit.

Do not treat a successful local build alone as release readiness. The tracked release validator and full repository verification are required.

## Failure behavior

Fail closed on release metadata inconsistencies.

- Do not bypass `release:check` by weakening metadata or tests.
- Do not create a manual tag to test the release path.
- Do not repair a missing release note by editing generated docs directly.
- Do not delete or rewrite unrelated user changes to obtain a clean tree.
- Do not claim remote tag-policy, CI, or publication behavior was verified by local preparation.

If a check is unavailable because the required platform or toolchain is unavailable, report exactly what was not run and leave the release as not fully locally verified.

## Final response

Report:

1. target release version;
2. release-preparation files changed at a high level;
3. documentation synchronization result;
4. exact required checks run and their results;
5. required checks not run and why;
6. any remaining blocker or evidence limitation.

Do not claim that the release was published, tagged, merged, or remotely validated unless a separate explicitly authorized workflow actually performed those actions.
