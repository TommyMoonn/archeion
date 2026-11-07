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
- npm with the committed `package-lock.json`.
- Rust and Cargo. `rust-toolchain.toml` pins the development and normal CI
  toolchain to Rust 1.97.1. `src-tauri/Cargo.toml` declares Rust 1.90 as the
  minimum supported Rust version (MSRV). CI checks the MSRV separately.
- PowerShell 7.
- The Windows prerequisites required by Tauri 2.

## Set up the repository

```powershell
git clone https://github.com/TommyMoonn/archeion.git
cd archeion
npm ci
```

Use `npm ci` for a clean checkout. It installs the versions recorded in
`package-lock.json`.

## Run Archeion

Start the Tauri desktop application:

```powershell
npm run tauri:dev
```

Run only the Vite frontend when you do not need desktop APIs:

```powershell
npm run dev
```

## Build installers locally

Build both supported Windows installer formats:

```powershell
npm run tauri:build:windows
```

Stage the validated installers and generate `SHA256SUMS.txt`:

```powershell
npm run release:stage
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

## Use repository utilities

The npm aliases for change packaging, cleanup, and repository exports are
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
