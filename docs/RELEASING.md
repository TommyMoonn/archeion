# Release operator guide

This tracked guide is the source of truth for preparing an Archeion application
release. The release must represent deliberate product work, not maintenance of
the release automation itself. Work through a reviewed pull request into
`main`; do not manually create or push a `v*` tag or paste an ignored local
release-note draft into GitHub. The [development guide](DEVELOPMENT.md) covers
machine setup and general validation. The [release-note contract](../release-notes/README.md)
defines the user-facing note format.
The ignored `.planning/release/RELEASE_PROCESS.md` is superseded and is not an
operator procedure.

## Prepare one complete version transition

1. Start from current `main` on a release-preparation branch. Choose a new,
   stable `X.Y.Z` version greater than the current application version. Check
   that neither `vX.Y.Z` nor a GitHub Release with that tag already exists.
2. Update all five application-version sources together:

   ```powershell
   npm ci
   npm run version:set -- X.Y.Z
   ```

   The command updates `package.json`, `package-lock.json`,
   `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, and
   `src-tauri/tauri.conf.json`. It does not create a changelog entry, release
   note, tag, or release.

3. Add a dated `## [X.Y.Z] - YYYY-MM-DD` section to
   [CHANGELOG.md](../CHANGELOG.md) with technical changes, and add the
   corresponding `[X.Y.Z]:` comparison link at the bottom.
4. Add `release-notes/vX.Y.Z.md` using the tracked
   [release-note format](../release-notes/README.md). Its first line must be
   `<!-- release-note: vX.Y.Z; date: YYYY-MM-DD -->`, followed by a blank line
   and concise user-facing body. Download links must point to `vX.Y.Z`. The
   metadata header is not part of the published release body.
5. Keep the version change, changelog section, and release note together in the
   commit that first changes the application version relative to its first
   parent. Do not merge a version-only commit and repair the metadata later:
   the successful `main` CI run for that first commit is the release trigger,
   while a later unchanged-version commit is not another candidate.

## Validate and merge

Run from a clean clone with the toolchains in the
[development guide](DEVELOPMENT.md):

```powershell
npm ci
npm run release:check -- --tag vX.Y.Z
npm run verify
git diff --check
```

`release:check` validates the five aligned version sources, the expected tag,
the dated changelog section and comparison link, and the tracked release note.
Review the resulting diff, open a PR, and wait for the protected-branch checks
and review requirements. Do not bypass the main ruleset. An ordinary
`workflow_dispatch` Windows installer build is separate from release
publication and does not substitute for the successful `main` CI run.

Before relying on automatic publication, confirm the `v*` tag ruleset still
protects creation, update, deletion, and non-fast-forward changes and has the
scoped GitHub Actions integration bypass needed by the publication job. This
guide does not authorize changing the ruleset or using a personal access token
to work around it. If that prerequisite is absent, stop and coordinate the
repository setting change before merging a release-preparation PR.

## After merge

The [CI workflow](../.github/workflows/ci.yml) retains a distinct successful
push run for each `main` commit. The [Release workflow](../.github/workflows/release.yml)
reacts only to a successful repository-owned `CI` push run for `main` and
checks out its exact `workflow_run.head_sha`. The single candidate detector
compares the application version with that commit's first parent. Ordinary
commits with an unchanged version have no release side effects, even if `main`
has advanced after an earlier version bump.

For a valid candidate, the workflow builds the Windows NSIS and MSI installers
from that exact SHA, stages `Archeion-Setup-x64.exe`, `Archeion-x64.msi`, and
`SHA256SUMS.txt`, then verifies the downloaded candidate artifact before the
publication job receives `contents: write`. Publication rechecks the source,
metadata, and artifact; creates the protected `vX.Y.Z` tag at the candidate
SHA; creates or resumes a draft with the tracked release-note body; verifies
the exact asset set, sizes, and GitHub-reported SHA-256 digests; and only then
publishes it. The tag, draft, and release are not created by local validation
or PR CI.

Inspect the hosted Release run and resulting GitHub Release. Confirm the tag
resolves to the green candidate SHA, the title and body match the tracked
note, and the three assets and their digests match the verified bundle. A
green workflow alone is not evidence that repository tag protections or
immutable-release behavior have been exercised.

## Retry and conflicts

- If a hosted run fails transiently, diagnose the failed job and rerun that
  Release workflow for the same green source SHA. A same-SHA draft can resume
  with missing assets; already-valid assets are preserved. A fully matching
  published release is verified without remote mutation on a rerun.
- A tag pointing at another commit, a release without its matching tag, or a
  published release with conflicting title, tracked body, assets, sizes, or
  GitHub-reported digests must fail closed. Do not delete, move, or overwrite
  the protected tag/release to make a rerun pass. Investigate the mismatch and
  agree on a reviewed recovery path.
- If the candidate commit itself has invalid version sources, changelog, note,
  or build inputs, a later same-version `main` commit will not retrigger a
  release. Do not assume a routine fix commit will resume it or manually tag
  the broken commit. Prepare a new deliberate higher-version transition with
  complete metadata, or use a separately reviewed recovery procedure.

GitHub's [immutable-release setting](https://docs.github.com/en/code-security/concepts/supply-chain-security/immutable-releases)
protects only releases published while it is enabled; it does not retroactively
protect earlier releases. After the automated path has been safely validated,
the repository owner must enable and verify that setting separately before
depending on immutability for the first applicable release. Once a release is
published as immutable, do not plan on replacing its tag or assets; use a new
version for corrected binaries. Check the live setting and the release's
reported immutable state rather than inferring either from this document.
