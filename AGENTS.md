# Archeion

Archeion is a local-first desktop app for managing EPUB archives and reading books. The interface runs in a React and TypeScript webview hosted by Tauri 2. Rust handles filesystem access, durable data, background work, and desktop integration.

An archive is a folder chosen by the user. EPUB files stay in that folder, alongside an `.archeion/` directory for library metadata, reading progress, annotations, scanner data, covers, and backups.

## Engineering philosophy

Build the simplest solution that fully solves the problem. Understand what the user needs, question assumptions, and look for the approach that removes the most complexity.

Use YAGNI: You Aren't Gonna Need It. Before adding code, ask whether the behavior needs to exist, whether the codebase already has a helper or established pattern, and whether the language, standard library, platform, or an installed dependency already provides it. Do not add a dependency for a small helper. Add custom code only when those options fall short.

Prefer deletion and reuse over new wrappers, factories, interfaces with one implementation, configuration for values that do not vary, and scaffolding for hypothetical future work. Keep the shortest diff that covers the whole change. A short diff that misses callers or edge cases is still a bad change.

Look for design ideas that remove a moving part, make invalid states unrepresentable, or eliminate an entire class of failure. Challenge the first implementation when a simpler design meets the goal. Prefer clear code over clever code that takes longer to understand. When two solutions are close, choose the one with simpler failure modes and correct edge-case behavior.

Do not trade away input validation, data-loss protection, error handling, security, accessibility, or behavior the user explicitly requested.

## Protect user data

The user's EPUB files and `.archeion/` data are part of their library. Treat them as user-owned content.

Preserve existing on-disk formats. Add an explicit migration when a persisted format must change. Use the existing atomic-write, backup, import transaction, and EPUB writeback paths for durable changes. Failed or cancelled operations must leave existing files and archive state consistent.

EPUBs, dictionary packages, and imported archives are untrusted input. Validate archive paths and file contents in Rust, even when the frontend has already checked them.

Library and reading data stay on the user's machine. The app uses the network for dictionary catalog refreshes and package downloads, and for update checks and downloads. Do not add cloud sync, account requirements, or uploads of library content unless the task asks for them.

Archeion currently targets Windows. Check the native implementation and CI before extending platform support or making cross-platform claims.

## Before changing code

Read the implementation, its tests, and the documentation for the area. Trace the affected flow across the frontend, state, storage, Tauri command, and Rust implementation.

Check every affected call site, fixture, configuration file, and export. For bug fixes, correct the shared implementation instead of patching individual callers.

Use the Node version selected by `.node-version` and the Rust toolchain in `rust-toolchain.toml`. Use `npm ci` for a clean install. Keep `package-lock.json` in sync through npm commands instead of editing it by hand.

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

`ArchiveScanSession` coordinates the Library's scan lifecycle. `ArchiveMutationCoordinator` applies scan results and archive changes to the current Library snapshot. Preserve cancellation and archive-generation checks so work started for an old archive cannot update the active one. Settings rescan and metadata repair must reconcile through the active Library scan owner.

`AppPreferencesStore` owns application preferences. `ThemeRepository` manages installed custom theme packages, while `src/themes/` resolves the selected appearance and publishes it to the interface.

Give each piece of state one owner. Keep temporary presentation state in its component, shared application state in its store, and archive operations behind `LibraryStorage`. Extend the existing owner instead of creating a competing store, scanner, watcher, or metadata-write path.

Archeion has separate main, Archive Manager, Settings, About, and Theme Manager windows. Check every affected window when changing shared shell, routing, focus, or appearance behavior.

## Treat Tauri commands as APIs

Give each Tauri command typed inputs and results. Keep command handlers focused on calling the relevant service.

Use the existing command clients in `src/storage/tauri/` and the clients owned by the relevant feature or store. Keep raw `invoke` calls out of presentation components.

When you add or change a command, update its TypeScript client and types, register it in `src-tauri/src/lib.rs`, and run `npm run ipc:check`.

Keep settings mutations aligned across `src/types/appSettings.ts`, the Rust settings types, and `tests/fixtures/app-settings-mutations/v4.json`. Run `npm run settings:contract:check` after changing that contract.

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

Handle the loading, empty, error, success, and cancellation states that an operation can reach. Keep dimensions stable when content changes. Preserve accessible names, keyboard access, visible focus, appropriate hit areas, and reduced-motion support.

## Keep the app responsive

Keep expensive parsing, indexing, and filesystem work out of React render paths. Derive display values during render. Use effects for external subscriptions and lifecycle work that need cleanup.

Prefer targeted scans when a full Library reconciliation is unnecessary. Avoid repeated polling and unbounded background work. Keep reader interaction responsive while scans, EPUB parsing, and file operations run.

Make event handlers safe against repeated activation when an operation can mutate files or start background work.

## Test behavior that can break

Test behavior that can regress. For a bug fix, reproduce the failure in a focused test when practical. Extend an existing test or fixture when it already covers the behavior. Add a new test when no suitable case exists.

Test at the lowest layer that can prove the behavior. Do not repeat the same assertion in a helper, component, and end-to-end test. Skip tests for trivial expressions, static copy, type-system guarantees, mock-call mirrors, and callback wiring that does not prove user-visible behavior.

Use Vitest for frontend tests, Playwright for browser behavior, and Cargo tests for Rust. Keep tests deterministic. Wait for explicit events or conditions instead of fixed sleeps and polling loops.

Filesystem tests must use temporary directories and disposable archives. Never point a test at a real library. Check that failed or cancelled operations leave existing data intact. For archive lifecycle changes, cover rapid archive switches, overlapping scans, maintenance, and cross-window updates where relevant. For import and writeback changes, cover failure cleanup, rollback, backup preservation, and cancellation.

Use `npm run test -- <test-file>` for focused Vitest tests and `npm run test:browser` for browser tests. For Rust changes, run `npm run rust:test`, `npm run rust:fmt`, and `npm run rust:clippy`.

Run `npm run architecture:check` for dependency-boundary changes, `npm run ipc:check` for Tauri command changes, and `npm run settings:contract:check` for settings mutation changes. Run `npm run test:runtime:windows` or `npm run test:updater:windows` for the corresponding Windows behavior. Run `npm run test:inter-assets` when changing shared icon or font copies.

Run `npm run verify` before a release or when a full validation pass is requested.

## Keep documentation useful

The guide index is `docs/README.md`. Keep setup, architecture, design, testing, documentation-site, and release procedures in their dedicated guides instead of copying them into `AGENTS.md`.

Update user documentation when a supported workflow changes. Keep architecture documentation for decisions and constraints that are hard to recover from the source. Do not document every component, method, or implementation detail.

The public documentation site uses source articles and `docs/documentation/page-registry.json`. Edit those sources, then run `npm run docs:sync` and `npm run docs:check`. Do not edit generated navigation, search, or release-history output by hand.

Update `docs/README.md` when you add, remove, or move an engineering guide.

## Planning and work artifacts

Use `.planning/` for implementation plans, research notes, review reports, temporary handoffs, and generated evidence. Reuse its existing subdirectories when they fit the work.

Use `.project/` for local project material such as audits, dictionary source files, and theme packs. `.dev/` contains local development helpers. Use `.scratch/` for disposable experiments and `.agent-work/` for temporary agent-specific work.

## Git and handoff

Before editing, check `git status --short` and inspect the existing diff. Preserve work you did not create.

Do not reset, clean, stash, rebase, amend, or overwrite existing user changes without permission. Do not commit, push, or open a pull request unless the user asks.

Before handing off, inspect the final diff and `git status`. Run the checks that cover the changed behavior. Report what changed and the exact checks you ran, including anything you could not run.
