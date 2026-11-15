# Archeion Release Workflow Reference

Read this reference when `release-prepare` is activated. It captures the current repository-owned preparation workflow and the non-obvious behavior of the scripts and tests. If tracked repository documentation disagrees with this file, follow the repository.

## Sources of truth

Use these project files as authorities:

- `docs/RELEASING.md` for the release operator procedure;
- `release-notes/README.md` for release-note format and documentation projection;
- `package.json` for canonical pnpm entry points;
- `scripts/set-version.ps1` for coordinated version mutation;
- `scripts/check-release.ps1` for release metadata validation;
- `scripts/release-notes.mjs` for release-note parsing/validation;
- `scripts/sync-documentation-*.mjs` for generated documentation;
- release-related tests under `tests/` for regression coverage.

The ignored `.planning/release/RELEASE_PROCESS.md` is not the tracked operator authority when `docs/RELEASING.md` says it is superseded.

## Canonical preparation sequence

For a stable target `X.Y.Z`:

```powershell
pnpm install --frozen-lockfile
pnpm run version:set X.Y.Z
# Ensure CHANGELOG.md and release-notes/vX.Y.Z.md are complete.
pnpm run docs:sync
pnpm run docs:check
pnpm run release:check --tag vX.Y.Z
pnpm run verify
git diff --check
```

`pnpm install --frozen-lockfile` is the tracked release-guide default for an exact dependency install. When the current task environment already has the exact lockfile dependencies established and reinstalling would be unnecessary or disruptive, preserve the environment and state that assumption. For a clean-clone release-readiness run, use `pnpm install --frozen-lockfile`.

## Version ownership

`pnpm run version:set X.Y.Z` calls `scripts/set-version.ps1` and updates these four sources together:

- `package.json`;
- `src-tauri/Cargo.toml`;
- `src-tauri/Cargo.lock`;
- `src-tauri/tauri.conf.json`.

`pnpm-lock.yaml` has no application version and is not changed by version:set.
Use Node 22 and pnpm 10.33.0. The script validates Cargo metadata and invokes the release validator after the update. If an update or validation step fails, it restores the original version files. Do not replace this behavior with four manual edits.

The script does **not** create:

- a changelog entry;
- a release note;
- a Git tag;
- a GitHub Release.

## Release metadata contract

An official stable release uses one `release-notes/vX.Y.Z.md` file with:

```markdown
<!-- release-note: vX.Y.Z; date: YYYY-MM-DD -->

## Downloads

...

## Changes

...
```

The header version must match the filename and application version. Download links must target the same `vX.Y.Z` release. User-facing release prose belongs here, while `CHANGELOG.md` remains the technical developer changelog.

`CHANGELOG.md` must contain both:

- `## [X.Y.Z] - YYYY-MM-DD`;
- the matching `[X.Y.Z]:` comparison link.

The version change, changelog section, and release note must land together in the commit that first changes the application version relative to its first parent. A later same-version fix commit is not another release candidate.

## Documentation synchronization

`pnpm run docs:sync` is the canonical write path. It uses the unchanged
shared release parser to project canonical notes into
`website/src/generated/release-history.json` (schemaVersion 1; version, date,
repository-relative sourcePath and LF-normalized changes). It validates the
entire supported Markdown vocabulary before an atomic replacement. No timestamp
or checkout path is emitted. Do not edit generated JSON or Changelog MDX prose.

`pnpm run docs:check` checks freshness and Node-only documentation sources
without writing. Neither command invokes legacy HTML/navigation/search
renderers or Docusaurus. Application-only installs can run them; website
compilation and route validation belong to the separate website build.

## Required checks and what they prove

### `pnpm run release:check --tag vX.Y.Z`

Validates:

- all four application-version sources agree;
- the effective tag matches `vX.Y.Z`;
- `CHANGELOG.md` contains the dated release section;
- `CHANGELOG.md` contains the comparison link;
- the matching release note exists and passes `release-notes.mjs` validation.

This is the primary release-metadata gate.

### `pnpm run verify`

Runs the repository's broad local verification chain:

- frontend architecture, IPC, settings-contract, documentation, formatting, lint, typecheck, and Vitest checks;
- Rust formatting, Clippy, and tests;
- production frontend build;
- packaged Inter asset verification.

The Vitest run includes release regression coverage such as:

- `tests/releaseConfig.test.ts` for aligned release configuration;
- `tests/releaseNotes.test.ts` for release-note parsing/history/body behavior;
- `tests/releaseDocumentation.test.ts` for the tracked operator/documentation contract;
- `tests/releaseTooling.test.ts` for release scripts and version rollback behavior;
- `tests/releaseCandidate.test.ts` for release-candidate detection and exact-SHA behavior;
- `tests/releasePublication.test.ts` for publication contract behavior;
- documentation changelog data/timeline tests for the generated docs projection.

Because `verify` already runs the full Vitest suite, running all of those files separately before `verify` is usually redundant. Use focused test files when diagnosing a failure or when the broader environment cannot run yet.

### `git diff --check`

Catches whitespace errors in the final release-preparation diff.

## Gotchas

- Official release preparation uses a stable `X.Y.Z`. Do not derive a prerelease version unless the tracked release process explicitly changes.
- `version:set` accepts broader semantic versions at the script level, but the operator guide requires a new stable version greater than the current application version.
- `docs:sync` must run after release-note prose is final enough to project. Re-run it after any release-note change.
- `docs:check` is already part of the frontend verification path. Do not add a separate mandatory `docs:check` after `verify` unless diagnosing drift.
- Local preparation does not prove hosted `v*` tag rules, protected-branch CI, immutable-release settings, or GitHub publication behavior.
- Do not manually create a release tag. The release workflow is designed to react to the successful exact `main` SHA containing the deliberate version transition.
- Do not introduce a PAT or alternate publication credential during release preparation.
- If release-note prose is missing, preparation is blocked unless the user explicitly asks for release writing. Use the repository's `dumbo-release-writing` skill for that writing task rather than inventing prose inside this workflow.
