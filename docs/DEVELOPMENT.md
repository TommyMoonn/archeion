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

## Run Archeion

Start the Tauri desktop application:

```powershell
pnpm run tauri:dev
```

Run only the Vite frontend when you do not need desktop APIs:

```powershell
pnpm run dev
```

## Build installers locally

Build both supported Windows installer formats:

```powershell
pnpm run tauri:build:windows
```

Stage the validated installers and generate `SHA256SUMS.txt`:

```powershell
pnpm run release:stage
```

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
under `docs/`, authored HTML under `docs/documentation/`, or
`docs/documentation/page-registry.json`. Documentation runtime assets and the
generated changelog page remain in full validation, as do mixed changes,
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
  static documentation site.
- The [release operator guide](RELEASING.md) covers release preparation and
  publication.
- The [performance measurement guide](performance/measuring.md) documents
  diagnostic procedures.
- The [performance architecture baseline](performance/architecture-baseline.md)
  records retained structural evidence and measurement limits.
