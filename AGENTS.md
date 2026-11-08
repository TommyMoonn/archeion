# Archeion

Archeion is a local-first desktop app for managing EPUB archives and reading books. The interface runs in a React and TypeScript webview hosted by Tauri 2. Rust handles filesystem access, durable data, background work, and desktop integration.

An archive is a user-selected folder. EPUB files stay in that folder, alongside an `.archeion/` directory for library metadata, reading progress, annotations, scanner data, covers, and backups.

## Engineering philosophy

Build the simplest solution that fully solves the problem. Challenge assumptions and remove unnecessary complexity.

Follow YAGNI (You Aren't Gonna Need It). Before adding code, ask whether the behavior is needed and whether an existing pattern, standard library, platform capability, or installed dependency can handle it. Avoid new dependencies for trivial helpers and abstractions for hypothetical needs.

Prefer deletion and reuse over unnecessary wrappers, factories, single-use interfaces, configuration for values that never vary, and speculative scaffolding. Look for designs that remove moving parts, make invalid states unrepresentable, or eliminate classes of failure. Favor readable code and simple failure modes. Keep changes focused without overlooking callers or edge cases.

Never sacrifice correctness, input validation, data integrity, error handling, security, accessibility, or requested behavior for simplicity.

## Protect user data

Treat EPUB files and `.archeion/` data as user-owned content.

Preserve existing on-disk formats. Add an explicit migration when a persisted format must change. Use the existing atomic-write, backup, import transaction, and EPUB writeback paths for durable changes. Failed or cancelled operations must leave existing files and archive state consistent.

EPUBs, dictionary packages, and imported archives are untrusted input. Validate archive paths and file contents in Rust, even when the frontend has already checked them.

Library and reading data stay on the user's machine. The app uses the network to refresh dictionary catalogs, download dictionary packages, and check for or download updates. Do not add cloud sync, account requirements, or uploads of library content unless the task asks for them.

Archeion currently targets Windows. Check the native implementation and CI before extending platform support or making cross-platform claims.

## Before changing code

Read the relevant implementation, tests, and documentation before editing. Trace affected call sites and cross-layer contracts when applicable. Fix bugs at their source rather than patching individual callers.

Use the Node version selected by `.node-version` and the Rust toolchain in `rust-toolchain.toml`. Use `pnpm install --frozen-lockfile` for a clean install. Keep `pnpm-lock.yaml` in sync through pnpm commands instead of editing it by hand.

## Where code lives

- `src/main.tsx` starts the React application. `src/app/` owns startup, window selection, routing, navigation, and the application shell.
- `src/features/` contains feature workflows and their UI. `src/components/` contains controls, dialogs, menus, feedback, and other shared UI.
- `src/stores/` contains state shared across features or windows. `src/storage/` contains the Library storage contract, its Tauri implementation, command clients, scan coordination, and archive operations.
- `src/themes/` handles theme parsing, validation, resolution, catalogs, and the active appearance runtime. `src/styles/` contains design tokens and shared, layout, and feature styles.
- `src/types/` contains shared domain and application contracts. `src/utils/` contains general-purpose helpers.
- `src-tauri/src/` contains the Rust application, native commands, and services. `src-tauri/src/lib.rs` builds the Tauri app and registers commands. `src-tauri/src/atomic_file.rs` provides atomic file replacement and recovery support.
- `tests/` contains frontend, architecture, documentation, and cross-language contract tests. `tests/browser/` contains Playwright tests. Rust integration tests live in `src-tauri/tests/`.
- `scripts/` contains architecture, IPC, settings-contract, documentation, release, and maintenance checks. `docs/` contains engineering guides and the source for the public documentation site. `release-notes/` contains release-note drafts and authoring guidance.

## Keep ownership clear

`ArchiveStore` owns the known archive registry and active-archive lifecycle, including registry events from other windows. Preserve event cleanup and cross-window updates when changing archive or window lifecycles.

`LibraryStorage` defines archive and book operations. `TauriArchiveLibraryStorage` implements that contract for the desktop app. Library and Reader archive operations go through this storage layer.

`ArchiveScanSession` coordinates the Library scan lifecycle. `ArchiveMutationCoordinator` applies scan results and archive changes to the current Library snapshot. Preserve cancellation and archive-generation checks so work started for a previous archive cannot update the active one. Rescans from Settings and metadata repairs must reconcile through the active Library scan owner.

`AppPreferencesStore` owns application preferences. `ThemeRepository` manages installed custom theme packages, while `src/themes/` resolves the selected appearance and publishes it to the interface.

Give each piece of state one owner. Keep temporary presentation state in its component, shared application state in its store, and archive operations behind `LibraryStorage`. Extend the existing owner instead of creating a competing store, scanner, watcher, or metadata-write path.

Archeion has separate main, Archive Manager, Settings, About, and Theme Manager windows. Check every affected window when changing shared shell, routing, focus, or appearance behavior.

## Treat Tauri commands as APIs

Give each Tauri command typed inputs and results. Keep command handlers focused on calling the relevant service.

Use the existing command clients in `src/storage/tauri/` and the clients owned by the relevant feature or store. Keep raw `invoke` calls out of presentation components.

When you add or change a command, update its TypeScript client and types, register it in `src-tauri/src/lib.rs`, and run `pnpm run ipc:check`.

Keep settings mutations aligned across `src/types/appSettings.ts`, the Rust settings types, and `tests/fixtures/app-settings-mutations/v4.json`. Run `pnpm run settings:contract:check` after changing that contract.

Follow the dependency directions in `scripts/check-architecture.mjs`. Keep shared components independent of feature domains, and keep stores and storage independent of React. Add a cross-feature dependency only when the design needs it. Record intentional exceptions in `scripts/feature-domain-baseline.json` with a reason.

## Write clear TypeScript and Rust

The frontend uses strict TypeScript, including `noUnusedLocals` and `noUnusedParameters`. Keep those checks enabled.

Avoid `any`. Use `unknown` for untrusted values and narrow them before use. Prefer inferred local types and explicit types at public boundaries. Use discriminated unions when states have different valid shapes.

Avoid type assertions, non-null assertions, `@ts-ignore`, and broad lint suppressions. If an assertion is necessary, keep it local and explain the invariant it relies on. Do not use optional chaining or fallback values to hide a missing required value.

In Rust, return `Result` for fallible operations and preserve useful error context. Avoid `unwrap()` and `expect()` in production paths. Add `unsafe` code only when there is a concrete need and a clear safety explanation.

Write comments for invariants and external constraints that the code cannot express. Do not narrate the implementation or repeat what a name already says.

## Build a consistent, accessible interface

Read `docs/DESIGN.md` before changing the interface, themes, typography, layout, or interaction behavior.

Use existing components and semantic theme tokens. Check light, dark, and custom themes when changing colors or appearance. Keep feature-specific behavior in its owning feature.

Handle applicable loading, empty, error, success, and cancellation states. Keep dimensions stable when content changes. Preserve accessible names, keyboard access, visible focus, appropriate hit areas, and reduced-motion support.

## Keep the app responsive

Keep expensive parsing, indexing, and filesystem work out of React render paths. Derive display values during render. Use effects for external subscriptions and lifecycle work that need cleanup.

Prefer targeted scans when a full Library reconciliation is unnecessary. Avoid repeated polling and unbounded background work. Keep reader interaction responsive while scans, EPUB parsing, and file operations run.

Guard actions that mutate files or start background work against repeated activation.

## Test behavior that can break

For bug fixes, reproduce failures in a focused test when practical. Reuse existing cases or fixtures before adding new tests. Test at the lowest layer that proves the behavior; avoid duplicate assertions and tests of trivial implementation details.

Use Vitest for frontend tests, Playwright for browser behavior, and Cargo tests for Rust. Prefer explicit events or conditions over fixed sleeps. Bound necessary polling with timeouts.

Use temporary directories and disposable archives for filesystem tests, never a real library. Verify that failed or cancelled operations leave existing data intact. For archive lifecycle changes, cover rapid archive switches, overlapping scans, maintenance, and cross-window updates where relevant. For imports and writebacks, cover failure cleanup, rollback, backup preservation, and cancellation.

Prefer focused verification: `pnpm run test <test-file>` for Vitest and `pnpm run test:browser` for browser behavior. For Rust changes, run relevant Rust tests and formatting/lint checks (`pnpm run rust:test`, `pnpm run rust:fmt`, and `pnpm run rust:clippy`) as appropriate to the scope.

Run `pnpm run architecture:check` for dependency-boundary changes, `pnpm run test:runtime:windows` or `pnpm run test:updater:windows` for corresponding Windows behavior, and `pnpm run test:inter-assets` for changes to shared icon or font copies.

Run `pnpm run verify` before a release or when a full validation pass is requested.

## Keep documentation useful

The guide index is `docs/README.md`. Keep setup, architecture, design, testing, documentation-site, and release procedures in their dedicated guides instead of copying them into `AGENTS.md`.

Update user documentation when a supported workflow changes. Keep architecture documentation for decisions and constraints that are hard to recover from the source. Do not document every component, method, or implementation detail.

The public documentation site uses source articles and `docs/documentation/page-registry.json`. Edit those sources, then run `pnpm run docs:sync` and `pnpm run docs:check`. Do not edit generated navigation, search, or release-history output by hand.

Update `docs/README.md` when you add, remove, or move an engineering guide.

## Planning and work artifacts

Keep plans, research, reviews, handoffs, and evidence in `.plans/`. Use `.project/` for project reference material, `.scratch/` for disposable experiments, and `.agent-work/` for temporary agent output. Reuse existing subdirectories.

## Git and handoff

- Review the working tree before editing. Preserve unrelated changes and never discard user work without permission.
- Follow the requested Git workflow. Commit, push, or create a PR only when directly requested or authorized by an explicitly invoked workflow.
- Use concise Conventional Commit subjects for commits and titles for PRs. Scopes are optional, e.g., `fix(reader): preserve progress when switching archives`. PR descriptions should explain the problem, solution, and validation.
- Before handoff, review the final diff, run relevant checks, and report results and anything unverified.
