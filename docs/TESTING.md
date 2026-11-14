# Testing and validation

> [!IMPORTANT]
> All of the documentation here are written by LLMs.

Use `pnpm run verify` before preparing a pull request or release. It runs the
repository's local frontend and Rust checks, builds the frontend, and verifies
bundled Inter assets.

## Run the full local verification

```powershell
pnpm run verify
```

The command runs these checks:

- Frontend architecture, Tauri command parity, settings mutation contracts, and
  generated documentation.
- Prettier, ESLint, TypeScript, and the Vitest suite.
- Rust formatting, Clippy, and Cargo tests.
- The production frontend build and bundled Inter asset verification.

`pnpm run verify` does not run the separate Chromium browser suite, Windows
runtime smoke, Windows updater smoke, Linux font catalog portability check, or
Rust MSRV check. CI runs those as separate `CI Gate` dependencies. The
release-tooling tests run once as part of the full Windows Vitest suite.

## Run focused checks

Use the narrowest command that covers the change:

| Area                               | Command                            |
| ---------------------------------- | ---------------------------------- |
| Formatting                         | `pnpm run fmt`                     |
| Lint                               | `pnpm run lint`                    |
| TypeScript                         | `pnpm run typecheck`               |
| Frontend tests                     | `pnpm run test`                    |
| Rust formatting, Clippy, and tests | `pnpm run check:rust`              |
| Rust tests only                    | `pnpm run rust:test`               |
| Frontend build                     | `pnpm run build`                   |
| Shared Inter asset copies          | `pnpm run test:inter-assets`       |
| Tauri command parity               | `pnpm run ipc:check`               |
| Frontend architecture boundaries   | `pnpm run architecture:check`      |
| Settings mutation contract         | `pnpm run settings:contract:check` |
| Generated documentation            | `pnpm run docs:check`              |

Run one frontend test file with:

```powershell
pnpm run test tests/example.test.ts
```

The frontend suite uses Vitest. Its DOM tests use `happy-dom`. The browser suite
and Windows smoke tests cover behavior that these tests cannot verify.

The frontend suite also checks byte parity for physical assets shared by the
desktop app and public site. `src-tauri/icons/128x128.png` is the canonical
128-pixel icon for the frontend and site copies. The frontend Latin Atkinson and
Literata font files are canonical for the site's four matching font copies.
Run `pnpm run test tests/sharedAssetParity.test.ts` to check these copies.
Resized platform icons, the favicon, and distinct site imagery are not parity
targets.

For changes to archive lifecycle ownership, check rapid archive switches,
overlapping Library scans, Settings maintenance, and cross-window archive
changes. The relevant frontend suites include:

- `src/stores/archiveStore.test.ts`
- `src/storage/archiveScanSession.test.ts`
- `src/storage/TauriArchiveLibraryStorage.scanSession.test.ts`
- `src/storage/TauriArchiveLibraryStorage.maintenance.test.ts`
- `src/storage/TauriArchiveLibraryStorage.watcherUpdates.test.ts`
- `src/features/settings/settingsArchiveMaintenanceClient.test.ts`
- `src/features/archive/archiveWatcher.test.ts`

Run the relevant subset with `pnpm run test --` followed by the selected file
paths. Native scanner tests live in `src-tauri/src/commands/scanner.rs` and run
with `pnpm run rust:test`.

Commands that apply automatic formatting or lint fixes:

```powershell
pnpm run fmt:fix
pnpm run lint:fix
pnpm run rust:fmt:fix
```

## Run the Chromium browser suite

The browser suite checks rendered navigation, focus, ARIA values, and responsive
presentation that `happy-dom` cannot verify. It uses Chromium with the public
pages and a Vite fixture that mounts production Reader, Library, and dialog
components. It does not launch Tauri.

Install the pinned Chromium headless shell once, then run the suite:

```powershell
pnpm run test:browser:install
pnpm run test:browser
```

To apply the CI failure policy locally, run `pnpm run test:browser
--fail-on-flaky-tests`. CI retains one diagnostic retry, but a test that passes
only on retry fails the job. Both the source suite and built async-surface suite
use this policy.

`pnpm run test:browser` runs the browser-test TypeScript check before Playwright.
CI runs browser TypeScript validation once in `frontend-static`, then invokes
Playwright directly in two shards with two workers and test-level parallelism.
Both shards remain required `CI Gate` dependencies. Each test owns its browser
context and uses `testInfo.outputPath` for artifacts. The first
shard also builds and runs the separate async-surface browser contracts.

Browser failure artifacts are named `browser-contract-failure-1` and
`browser-contract-failure-2`. They contain the HTML report, screenshots, and
first-attempt and retry traces where available, including a successful retry.
The first shard also uploads
`async-surface-contract-failure` when those checks fail. Browser outputs are
ignored by Git.

### Optional browser diagnostics

Observational workloads do not run in the required browser suite. Run them explicitly:

```powershell
pnpm run test:browser:ui-stability
pnpm run test:browser:visual-diagnostics
```

Both commands build the existing production fixture bundle before opening cold
browser contexts, so development-module transforms do not distort observations.
The first command measures the UI stability workloads. The second records the
cold/warm UX-15 Add EPUB first-paint observations. The remaining visual-refinement
and all first-paint acceptance tests still run in required CI. For the built-fixture
visual review, build with `pnpm exec vite build --config
tests/browser/visual-refinement-build.config.ts`, then run `pnpm exec playwright
test --config tests/browser/visual-refinement.config.ts`.

Frontend tests fail on unexpected console warnings or errors. Tests that exercise
an expected diagnostic must intercept and assert that specific message, then
restore their spy. Do not filter React warnings or disable the act environment.

## Run the Windows Tauri runtime smoke

The Windows runtime smoke builds an unbundled release-profile test executable
from the current sources and drives its real WebView2 instance through Tauri's
WebDriver bridge. It covers archive creation and opening, EPUB import and
reading, settings after restart, annotation metadata and export, a disposable
EPUB replacement, and a secondary window.

The test build uses a unique application identifier and a temporary archive.
It does not use the normal Archeion settings or archives. It does not install
an MSI or NSIS package. The separate installer and updater checks cover those
paths.

On Windows, install the Tauri WebDriver bridge and run the smoke:

```powershell
cargo install tauri-driver --version 2.0.6 --locked --root .scratch/runtime-smoke-tools
pnpm run test:runtime:windows
```

The runner downloads the Microsoft Edge WebDriver version that matches the
installed WebView2 Runtime. That version can differ from the Edge browser
version. The runner removes its temporary archive, roaming settings, and local
WebView2 test identity state on success or failure.

If a step fails, inspect `test-results/runtime-smoke/failure.txt`, the driver
log, and any captured page or screenshot. CI uploads those files as the
`windows-runtime-smoke-failure` artifact.

## Run the Windows updater smoke

The installed updater smoke validates signed updates through isolated NSIS and
MSI installations. It uses synthetic versions, a temporary signing key, and a
controlled loopback manifest. It does not change production installer settings
or use the ordinary Archeion installer identity.

The complete NSIS and MSI run requires an elevated administrator terminal
because the MSI keeps the bundler's normal all-users scope. The harness checks
elevation before building or installing anything. It does not elevate itself.

Follow the setup and safety instructions in [the release operator guide](RELEASING.md),
then run:

```powershell
cargo install tauri-driver --version 2.0.6 --locked --root .scratch/runtime-smoke-tools
pnpm run test:updater:windows
```

CI runs the updater smoke as a required `CI Gate` dependency.

## Understand release-tooling tests

Release-tooling integration tests invoke PowerShell, pnpm, and Cargo against
temporary fixtures. They do not modify the project's version files. Run them
with:

```powershell
pnpm run test tests/releaseTooling.test.ts tests/releaseCandidate.test.ts tests/releasePublication.test.ts
```

CI runs these tests once through the full Windows Vitest suite. There is no
separate release-tooling job.

## Generate diagnostic coverage reports

Coverage reports show which code ran. They are diagnostic and do not set a
merge threshold. The normal `CI Gate` does not depend on coverage percentages.

Generate the frontend report after `pnpm install --frozen-lockfile`:

```powershell
pnpm run test:coverage:frontend
```

The command writes an HTML report to `coverage/frontend/index.html` and LCOV data
to `coverage/frontend/lcov.info`.

For Rust coverage, install the LLVM tools component for the pinned development
toolchain and the coverage utility:

```powershell
rustup component add llvm-tools-preview
cargo install cargo-llvm-cov --version 0.9.0 --locked
pnpm run test:coverage:rust
```

The Rust command runs Cargo tests with instrumentation. It writes
`coverage/rust/html/index.html` and `coverage/rust/lcov.info`.

Both report directories are ignored by Git. The separate Coverage diagnostics
workflow runs weekly, on manual request, and when coverage tooling changes in a
pull request. It uploads the reports as short-lived Actions artifacts. Coverage
reports do not include the Chromium browser or Windows runtime smoke lanes.

## Review CodeQL results

The separate CodeQL workflow scans JavaScript, TypeScript, and Rust with the
default query suite. It runs every Tuesday at 06:17 UTC and can also be started
manually from the Actions tab. Scheduled scans run on the default branch. A
manual dispatch can select another ref after the workflow exists on the default
branch.

CodeQL does not run on ordinary pull requests or `main` pushes. Rust analysis
runs on Windows with the pinned project toolchain. Both language scans are
informational and remain outside `CI Gate`. Keep `CI Gate` as a required status
check. Do not enable `Require code scanning results` in the `Protect main`
ruleset while the workflow uses this schedule.

After the workflow is published on the default branch, verify that a scheduled
or manually dispatched run uploads results for both languages. Review every
alert. Fix it or record a justified dismissal in GitHub. A successful analysis
job means the scan completed. It does not mean the alert list is empty.

If a language is missing, extraction is incomplete, or the results are too
noisy to act on, correct the scan and repeat the review before considering
promotion.

If CodeQL is later considered for merge protection, restore pull-request
scanning first. Verify both language results on representative pull requests.
Add CodeQL through `Require code scanning results` only after both languages
scan successfully on representative pull requests and the alert baseline is
clean or has justified dismissals. Choose alert and security-alert thresholds
based on that baseline.
Keep `CI Gate` under required status checks. Requiring CodeQL job names as
status checks does not replace code-scanning merge protection because a
successful job can still report alerts. Dependency Review remains the separate
pull-request gate for newly introduced dependency vulnerabilities.

## Related guides

- [Architecture guide](ARCHITECTURE.md) for application ownership and boundaries.
- [Development guide](DEVELOPMENT.md) for setup and local builds.
- [Public documentation guide](DOCUMENTATION.md) for documentation-site checks
  and generated files.
- [Performance measurement guide](performance/measuring.md) for diagnostic
  measurements.
- [Release operator guide](RELEASING.md) for release preparation and installer
  verification.
