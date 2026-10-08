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

## Updater signing key custody

Windows updater support uses the official Rust updater plugin on the coordinated
Tauri 2.12 / Rust 1.90 stack. The application trusts one long-lived Tauri
signing public key. Updater signatures are separate from Windows Authenticode.
The configured updater must require signed versions, reject downgrades, and use
only the stable HTTPS GitHub Releases endpoint.

The production public key is tracked in `src-tauri/tauri.conf.json`. Reuse its
matching private key for every release. The following generation procedure is
for initial provisioning only, not for routine release preparation.

For initial provisioning, generate a password-protected keypair once using the
repository's installed Tauri CLI. Choose a private location outside every
repository, build directory, and synchronized log or artifact folder. For
example, replace the drive/path below with the approved secure storage location:

```powershell
npm run tauri -- signer generate --write-keys D:/Secure/Archeion/updater.key
```

Enter a non-empty password at the interactive prompt. Do not pass it on the
command line, put it in an `.env` file, or paste it into chat. Do not use `--force`
to replace an existing key. Track only the generated `.pub` file's contents in
`plugins.updater.pubkey` in `src-tauri/tauri.conf.json`, never a key file path.
Never commit or log the private key or its password, and never copy either into
test fixtures or uploaded build artifacts.

Store the generated private key and its password as repository Actions secrets:

- `TAURI_SIGNING_PRIVATE_KEY`: the full contents of the generated private key
  file, not the public key or a path to the operator's machine.
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`: the non-empty password used when
  generating the private key.

Keep a reviewed offline backup of the encrypted private key and a recoverable
password record outside GitHub Actions. Confirm both backups can be recovered
before enabling a production release. GitHub secrets are not a backup. Losing
the key or password prevents already-installed clients from trusting future
updates signed with a replacement key. Do not regenerate this key for ordinary
releases; key rotation and recovery need a separate reviewed design.

The ordinary `tauri:dev` and `tauri:build*` commands leave updater artifact
generation disabled and need no production signing secrets. An explicitly
trusted release-candidate build can opt into the release overlay:

```powershell
npm run tauri:build:windows -- --config src-tauri/tauri.release.conf.json
```

That build requires the two signing environment variables above. Scope them
only to the repository-owned candidate build after the successful exact-SHA
`main` CI run and deliberate version transition have been validated. Never
expose them to PR jobs, untrusted workflow sources, documentation jobs, or the
publication job. The overlay only enables artifact creation. The release
workflow selects it only in the Windows candidate build step, with both secrets
bound to that step's environment. A missing or blank key/password fails before
the build starts. Dependency installation, staging, verification, and publication
do not receive these signing secrets.

## Signed Windows artifact contract

After a trusted signed candidate build, stage and verify the bundle:

```powershell
./scripts/stage-windows-release.ps1 --bundle-dir ./src-tauri/target/release/bundle
./scripts/verify-windows-release.ps1 --artifacts-dir ./artifacts/windows
```

Default release staging requires one version-matched x64 installer and its
matching `.sig` in each of the NSIS/MSI bundle directories. It produces exactly:

- `Archeion-Setup-x64.exe` and `Archeion-Setup-x64.exe.sig`;
- `Archeion-x64.msi` and `Archeion-x64.msi.sig`;
- `latest.json`;
- `SHA256SUMS.txt`, covering the five other files.

The manifest reuses the validated `release-notes/vX.Y.Z.md` Changes section and
tracked date (UTC midnight). It contains only `windows-x86_64-nsis` and
`windows-x86_64-msi`, exact `vX.Y.Z` download URLs, and verbatim signature-file
contents. Verification rejects asset, checksum, version, notes/date, URL,
platform, or signature-content drift. These tooling checks do not establish
cryptographic authenticity; the native updater verifies signatures.

The manual desktop workflow explicitly passes `--installers-only` to both
scripts. That non-release mode packages unsigned installers and checksums without
production secrets or a release note. It cannot pass default release verification.

The release workflow uploads all six files in one candidate artifact named for
the candidate version and exact SHA. The independent verifier and publisher
download that same artifact. The verifier uses the repository's Node version,
checks its checkout SHA, and runs default release verification with read-only
permissions; only the downstream publication job receives `contents: write`.

## Release tag authorization

Before relying on automatic publication, confirm the active `Protect tag`
ruleset targets `refs/tags/v*`, allows creation of new `v*` tags, and blocks
updates, deletions, and non-fast-forward pushes to existing `v*` tags through
the normal protected path. The publication job uses its job-scoped
`GITHUB_TOKEN` with `contents: write`; no GitHub Actions/App bypass is required
for release-tag creation. Do not introduce a personal access token to work
around the ruleset. If this policy is not live, stop and coordinate the
repository setting change before merging a release-preparation PR.

This policy permits any actor with ordinary tag-creation permission to create
a new version-shaped tag manually. It does not, by itself, prove that every
new `v*` tag came from the release workflow. Existing `v*` tags cannot be
moved or deleted through the normal protected path; actors with an explicit
ruleset bypass remain an exception. The publication tool checks an existing
tag's exact SHA and fails closed on a conflict instead of moving or deleting
it. Release operators must still let the workflow create the tag, not create
one manually.

## After merge

The [CI workflow](../.github/workflows/ci.yml) retains a distinct successful
push run for each `main` commit. The [Release workflow](../.github/workflows/release.yml)
reacts only to a successful repository-owned `CI` push run for `main` and
checks out its exact `workflow_run.head_sha`. The single candidate detector
compares the application version with that commit's first parent. Ordinary
commits with an unchanged version have no release side effects, even if `main`
has advanced after an earlier version bump.

For a validated candidate, the workflow builds signed NSIS/MSI installers from
that exact SHA using the release-only overlay. It stages and verifies the six-file
contract, smoke-tests the staged NSIS installer, and uploads the candidate bundle.
The independent verifier checks the downloaded artifact before the publication
job receives `contents: write`.

The publication tool requires the six-file contract. It rechecks the source,
metadata, and artifact; creates the new `vX.Y.Z` tag at the candidate SHA
under the creation-allowed policy; creates or resumes a draft with the tracked
release-note body; verifies the exact asset set, sizes, and GitHub-reported
SHA-256 digests; and only then publishes it. The tag, draft, and release are
not created by local validation or PR CI.

Inspect the hosted Release run and resulting GitHub Release. Confirm the tag
resolves to the green candidate SHA, the title and body match the tracked
note, and the six assets and their digests match the verified bundle. A
green local test run is not evidence that hosted signing, repository tag
protections, or immutable-release behavior have been exercised. Confirm hosted
signing uses the key matching the tracked public key, and verify actual NSIS/MSI
update/install/relaunch behavior separately before claiming updater acceptance.

## Retry and conflicts

- If a hosted run fails transiently, diagnose the failed job and rerun that
  Release workflow for the same green source SHA. A same-SHA draft can resume
  with missing assets; already-valid assets are preserved. A fully matching
  published release is verified without remote mutation on a rerun.
- Existing draft assets are checked against the candidate's names, sizes, and
  SHA-256 digests before draft metadata is changed, then rechecked before upload
  and publication. A stale `latest.json` or `.sig` asset is a conflict, not a
  resumable asset: do not overwrite it or use `--clobber`. Diagnose the mismatch
  and agree on reviewed recovery. Missing assets alone can be uploaded safely.
- Draft discovery uses GraphQL's pending-tag lookup because GitHub's REST
  release-by-tag endpoint returns published releases. Publication confirms the
  pending tag and numeric release ID before re-reading the draft through REST.
  REST may report an `untagged-*` placeholder for a valid pending-tag draft; that
  placeholder is accepted only for the same GraphQL-selected draft ID. If no
  pending tag resolves, the paginated release list checks for conflicting drafts.
  An orphaned draft requires reviewed recovery; the publisher must not adopt it
  by title or create a duplicate automatically.
- A publisher-code defect is not a transient failure. Put the correction through
  a reviewed PR first. A rerun still checks out the original candidate SHA, so it
  uses that commit's publisher, not a correction subsequently merged to `main`.
  An unchanged-version correction is not another release candidate. Agree on a
  separately reviewed recovery procedure for the original verified candidate
  instead of expecting either action to resume publication with new tooling.
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
