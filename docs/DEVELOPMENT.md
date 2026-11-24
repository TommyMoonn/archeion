# Archeion development guide

> [!IMPORTANT]
> All of the documentation here are written by LLMs.

Use this guide to set up a local checkout, run Archeion, and build local
installers. The root [README](../README.md) describes the product. The
[maintainer documentation index](README.md) links to the other engineering guides.

## Requirements

Archeion development currently targets Windows and requires:

- Node.js 22.13 or newer. `.node-version` selects the major version for
  development and CI. `package.json` records the minimum supported version.
- pnpm 10.33.0, pinned by `packageManager` in `package.json`.
- Rust and Cargo. `rust-toolchain.toml` pins the development and normal CI
  toolchain to Rust 1.97.1. `src-tauri/Cargo.toml` declares Rust 1.90 as the
  minimum supported Rust version (MSRV). CI checks the MSRV separately.
- PowerShell 7.
- The Windows prerequisites required by Tauri 2.

## Set up the repository

```powershell
git clone https://github.com/TommyMoonn/archeion.git
cd archeion
corepack enable
corepack pnpm --version
pnpm install --frozen-lockfile
```

Use `pnpm install --frozen-lockfile` for a clean checkout. It installs the versions recorded in
`pnpm-lock.yaml`.

The repository is a pnpm workspace. A root install includes the desktop app
(`archeion`) and the private website package (`@archeion/website`) under
`website/`, using the same lockfile and package-manager version. Keep website
dependencies in that package; the root application keeps its existing Vite
and Tauri toolchain.

For a package-specific clean install, use:

```powershell
# Desktop application, including CI, coverage, installers, and release builds
pnpm install --filter archeion... --frozen-lockfile

# Website build and deployment jobs
pnpm install --filter @archeion/website... --frozen-lockfile
```

Jobs that need both packages must select both or use the full workspace
install. Do not create a lockfile or duplicate package-manager configuration
inside `website/`.

The website workspace contains the public React landing and MDX documentation.
Its package scripts are available through `pnpm --filter @archeion/website`
or from inside `website/`. See [website development](../website/README.md#local-development)
for commands and browser checks. Pages publishes `website/build/`. Root `pnpm run docs:sync` writes canonical
release history to `website/src/generated/release-history.json`; `pnpm run
docs:check` checks freshness and Node-only source contracts. Neither requires
website dependencies. Run website typecheck/build separately for MDX and links.
After building, `node scripts/check-website-build.mjs` checks the Pages output.
The main-only deployment workflow is independent from releases; see
[publication ownership](DOCUMENTATION.md#public-resources-and-publication).
For releases, finalize prose, sync, docs:check, release:check, then verify; see
the release operator guide.

## Run Archeion

Start the Tauri desktop application:

```powershell
pnpm run tauri:dev
```

Run only the Vite frontend when you do not need desktop APIs:

```powershell
pnpm run dev
```

## Test a cold-start EPUB request

`tauri dev` does not install Windows file associations. Pass the simulated file-open
request as application arguments instead. Use an existing `.epub` file:

```powershell
pnpm exec tauri dev -- -- --open-epub "C:\Books\Example 日本語.epub"
```

The first `--` separates runner arguments from application arguments. A
packaged executable also accepts an EPUB path as its only positional argument,
which is how Explorer's **Open with** command starts it. A valid request opens
only a standalone Reader. Invalid requests fall back to ordinary startup.

## Test standalone EPUB requests on Windows

Install each format independently in a clean Windows environment. Verify
Archeion appears in **Open with** for `.epub` without changing the existing
default viewer. Open a local EPUB with spaces and Unicode in its filename.
Close the only Reader and confirm the application exits.

With the Library open, open a tracked EPUB from the active archive and an
untracked EPUB from another folder. The tracked book should restore saved
progress and annotations; the untracked file should not save book state.
Opening the same file again focuses its Reader. Rapidly open different files,
close one window, reopen its file, and verify the other windows stay open.
A cold-start Reader can also accept another EPUB without opening the Library.

The installed executable accepts the same arguments as the development app:

```powershell
& "$env:LOCALAPPDATA\Archeion\Archeion.exe" --open-epub "C:\Books\Example 日本語.epub"
```

Use the actual installation path for MSI. Verify unsupported network paths,
removed files, malformed EPUBs and files over 256 MiB do not open unsafe
sessions. See [TESTING.md](TESTING.md) for the installed-package smoke commands.

## Build installers locally

Build both supported Windows installer formats:

```powershell
pnpm run tauri:build:windows
```

Stage the validated installers and generate `SHA256SUMS.txt`:

```powershell
pnpm run release:stage:local
```

For an NSIS-only test build, use `pnpm run tauri:build:nsis` followed by
`pnpm run release:stage:local --bundle nsis`. The staged EXE and checksum
will be written to `artifacts/windows` without requiring an MSI or signatures.

These commands build and stage local installers. They do not create a tag or
publish a GitHub Release. Follow the [release operator guide](RELEASING.md) for
release preparation and publication.

The staging step keeps Tauri's versioned build outputs for validation, then
copies the public release assets to stable names:

```text
Archeion-Setup-x64.exe
Archeion-x64.msi
SHA256SUMS.txt
```

Generated build output and staged artifacts are ignored by Git.

The manual Windows installer workflow and automatic release-candidate build
verify staged checksums. They then use `scripts/smoke-windows-installer.ps1` to
install and uninstall the per-user NSIS bundle silently before upload.

The smoke requires a clean Windows runner. It refuses an existing Archeion
installation or default data directory. It verifies the installed executable
and product metadata, the uninstaller and registration, then checks that
uninstall removes the installed state. The MSI is staged and checksum-verified,
but this bounded install and uninstall smoke does not exercise it.

## CI platforms and coverage diagnostics

The shared CI workflow runs frontend static checks and the Vite asset build on
Ubuntu. These jobs use Node tooling without building the Tauri application.
Browser contracts and the Linux font catalog check also run on Ubuntu. The full
Vitest suite stays on Windows because it includes PowerShell-dependent tests;
Rust checks, MSRV, and native runtime and updater smoke also stay on Windows.

One shared `CI` workflow validates pull requests and pushes to `main`. Main pushes
always run every validation job. Pull requests also run full validation unless
the exact event base and head revisions contain only added or modified Markdown
under maintained `docs/` paths or explicit `website/` source owners. Shared
tooling and unknown paths remain in full validation, as do mixed changes,
renames, deletions, empty diffs, unknown paths, and classification uncertainty.

Documentation-only PRs retain static checks (including `docs:check`), the full
Windows Vitest suite, both browser shards and built async-surface contracts, and
the frontend asset build. Only Rust checks, Linux font catalog, Windows runtime,
Windows updater, and MSRV may be skipped. The classifier publishes the mode and
expected job IDs. The stable `CI Gate` requires successful classification, a
valid complete job set, and successful expected jobs; it accepts only the five
explicit documentation-only skips and rejects failures or cancellations even
from jobs outside the expected set. Classification errors default to full
validation; a failed classifier or malformed output fails the gate. Dependency
Review remains an independent PR check, and Release still follows successful
main-push CI for the exact validated commit.

Coverage is diagnostic and has no threshold gate. The separate Coverage
diagnostics workflow runs weekly on Monday at 07:00 UTC, on manual dispatch,
and for pull requests changing its workflow, `package.json` (coverage commands
and provider dependency), `vitest.config.ts`, or `scripts/coverage-rust.ps1`.
Lockfile-only updates do not trigger it. Frontend and Rust reports are uploaded
as artifacts for seven days, including available reports after a failed command.
Coverage command failures still fail their jobs; coverage is outside `CI Gate`.

## Use repository utilities

The pnpm aliases for change packaging, cleanup, and repository exports are
documented in [Project scripts](../scripts/README.md). Use that guide for
command flags and safety behavior.

## Related guides

- [Architecture](ARCHITECTURE.md) describes application ownership and dependency
  boundaries.
- [Design](DESIGN.md) defines the desktop application's visual rules.
- [Testing and validation](TESTING.md) lists the existing local and CI validation
  lanes.
- [Public documentation](DOCUMENTATION.md) explains how to edit and publish the
  React landing and MDX documentation site.
- The [release operator guide](RELEASING.md) covers release preparation and
  publication.
- The [performance measurement guide](performance/measuring.md) documents
  diagnostic procedures.
- The [performance architecture baseline](performance/architecture-baseline.md)
  records retained structural evidence and measurement limits.
