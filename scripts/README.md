# Project Scripts

Run from the project root with PowerShell 7.

Public flags use Git-style `--kebab-case`. Existing PowerShell-style flags and renamed script entry points remain compatibility aliases.

Every command supports `-h` / `--help`.

## Commands

| Script                        | Purpose                                                          | Example                                                 |
| ----------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------- |
| `apply-changes.ps1`           | Apply a changed-files ZIP.                                       | `.\scripts\apply-changes.ps1 --dry-run`                 |
| `package-changes.ps1`         | Package current Git changes.                                     | `.\scripts\package-changes.ps1 --name "phase-1.3.0.16"` |
| `review-changes.ps1`          | Summarize working-tree changes.                                  | `.\scripts\review-changes.ps1 --files`                  |
| `restore-changes.ps1`         | Restore an import backup.                                        | `.\scripts\restore-changes.ps1 --dry-run`               |
| `clean-generated.ps1`         | Remove generated outputs and caches.                             | `.\scripts\clean-generated.ps1 --dry-run`               |
| `zip-project.ps1`             | Export committed source or a filtered workspace with provenance. | `.\scripts\zip-project.ps1 --mode repo`                 |
| `check-release.ps1`           | Validate release versions, tags, and changelog metadata.         | `.\scripts\check-release.ps1 --require-changelog`       |
| `set-version.ps1`             | Update all application version sources transactionally.          | `.\scripts\set-version.ps1 1.3.0`                       |
| `stage-windows-release.ps1`   | Validate and stage Windows release installers.                   | `.\scripts\stage-windows-release.ps1`                   |
| `verify-windows-release.ps1`  | Verify staged Windows installers and SHA-256 checksums.          | `.\scripts\verify-windows-release.ps1`                  |
| `smoke-windows-installer.ps1` | Silently install and uninstall the staged per-user NSIS bundle.  | `.\scripts\smoke-windows-installer.ps1`                 |

Compatibility entry points:

```text
apply-chatgpt-zip.ps1      -> apply-changes.ps1
package-changed-files.ps1  -> package-changes.ps1
restore-chatgpt-import.ps1 -> restore-changes.ps1
stage-windows-bundles.ps1  -> stage-windows-release.ps1
```

The wrappers contain no implementation logic and forward all arguments to the canonical script.

## Common flags

Use the same long names when a command exposes the same concept:

```text
--project <path>
--output <path>
--dry-run
--force
--help
```

Short aliases are command-specific. `-p`, `-o`, `-f`, and `-h` keep their obvious meanings where exposed; `-n` is `--dry-run` on previewable commands but `--name` on `package-changes.ps1`. Prefer long flags in scripts and documentation when ambiguity matters.

## CLI presentation

`scripts/Cli.Common.ps1` owns the shared presentation primitives used by
human-facing PowerShell commands. Semantic color is optional: success is green,
warnings are yellow, important paths are cyan, and muted detail is dark gray
when the host supports color. Setting `NO_COLOR` disables color and transient
progress rendering without removing permanent headings, steps, warnings, or
summaries.

Transient progress is reserved for measurable work such as copying a known
number of files. Indeterminate work such as source snapshot creation and archive
finalization is reported as permanent step text instead of a fabricated
percentage. Redirected and CI output therefore remains readable as ordinary
text.

For commands with a dry-run mode, actionable paths remain visible while
unchanged paths are summarized by count. Compatibility wrapper scripts contain
no presentation logic of their own and inherit the canonical command output.

## `apply-changes.ps1`

```text
--zip <path>
-p, --project <path>
--downloads <path>
--pattern <glob>
--strip-root
-n, --dry-run
--allow-dirty
--no-backup
--allow-directory-deletion
-h, --help
```

Without `--zip`, the newest ZIP matching `archeion*.zip` in Downloads is used. A dry run prints every path that would be copied or deleted and every already-absent deletion target, while unchanged filenames are summarized by count only. Real apply output likewise lists actual copies, deletions, and skips rather than every unchanged file.

New changed-files packages surface their project and source commit before apply. Source-commit presence in a Git target is advisory: a missing commit produces a warning but does not block legitimate shallow, forked, or rebased workflows. Legacy packages without provenance metadata remain supported and are identified as having unavailable provenance. `--allow-dirty` and `--no-backup` print explicit safety warnings when used.

```powershell
.\scripts\apply-changes.ps1 --dry-run
.\scripts\apply-changes.ps1 --zip .\archeion-fix-changed-files.zip
```

## `package-changes.ps1`

```text
-n, --name <slug>
-p, --project <path>
-o, --output <path>
--tracked-only
-f, --force
-h, --help
```

Untracked files are included by default. `--tracked-only` excludes them. New archives include `.archeion-change-package.json` with versioned package provenance: project name, source `HEAD`, tracked-only mode, included/deleted counts, and a precise UTC creation time. The manifest contains no remote URL or local absolute project path and is never copied into the target project. `.chatgpt-delete-manifest.txt` remains the deletion list when deleted paths are present.

Packaging shows measurable staging progress for included files, reports compression as an indeterminate permanent step, and finishes with archive size and counts. If there are no changes, it exits successfully without creating an archive.

```powershell
.\scripts\package-changes.ps1 --name "phase-1.3.0.16"
```

## `review-changes.ps1`

```text
-p, --project <path>
--files
-h, --help
```

The default view shows the project, current branch when available, total/staged/unstaged counts, change-type and area counts, and any review flags. A clean tree ends with an explicit success state. `--files` is the opt-in detailed view and prints every changed path; the default summary does not list them.

## `restore-changes.ps1`

```text
-p, --project <path>
--backup <path>
-n, --dry-run
-h, --help
```

Without `--backup`, the newest import backup for the project is used. Dry run lists every directory that would be created and every file that would be restored without changing the project. A real restore keeps the existing warning that import backups do not record newly introduced files, so those files are not removed automatically.

## `clean-generated.ps1`

```text
-p, --project <path>
--rust
--deps
--installers
--all
-n, --dry-run
-f, --force
-h, --help
```

Cleanup always shows the selected scope. Dry run lists every selected target with its measured size and performs no deletion. Real cleanup reports each target only after it is removed, then summarizes the removed target count and approximate space freed using the shared binary-size labels. Expensive directories such as `src-tauri/target`, `node_modules`, and installer bundles are called out when they are intentionally preserved. Multi-target real cleanup may use transient target-count progress, but recursive deletion never reports fabricated internal percentages.

`--force` bypasses tracked-file protection for the selected cleanup targets and produces a prominent warning. Use it only after reviewing the paths.

## `check-release.ps1`

```text
-p, --project <path>
--tag <tag>
--require-changelog
-h, --help
```

Successful validation stays compact: it reports one success state plus the
validated version and effective tag when a tag is present. Version-source,
changelog, release-note, and tag mismatches still terminate with the specific
failing source.

## `set-version.ps1`

```text
set-version.ps1 VERSION
-p, --project <path>
-h, --help
```

The version remains positional because it is the command's primary operand.
The update is presented as four permanent steps: npm metadata, Cargo metadata,
Tauri configuration, and release validation. If any update or validation step
fails, every original version file is restored before the script reports that
rollback succeeded. A rollback failure is surfaced instead of being reported as
successful recovery.

## `stage-windows-release.ps1`

```text
--bundle-dir <path>
-o, --output <path>
-p, --project <path>
--installers-only
-h, --help
```

The default bundle directory is `src-tauri/target/release/bundle`; the default
output is `artifacts/windows`. Staging reports validation, installer discovery,
copying, and checksum creation as permanent steps. The final summary lists the
stable EXE/MSI/checksum names with their sizes and the output directory in a
fixed order. Default release staging requires exactly one version-matched x64
NSIS installer/signature pair and one MSI installer/signature pair. It generates
`latest.json` from the canonical release note, and hashes all five payload files.
The exact public set is the EXE, MSI, both `.sig` files, `latest.json`, and
`SHA256SUMS.txt`.

Staging validates a temporary sibling directory before replacing previous
generated output. Unknown content, linked paths, project/drive roots, and output
overlapping the bundle tree are refused. Generation failure preserves the previous
output. `--installers-only` is an explicit non-release mode used by the manual
desktop workflow: it stages only unsigned installers and their checksums.

## `verify-windows-release.ps1`

```text
--artifacts-dir <path>
-p, --project <path>
--installers-only
-h, --help
```

The default directory is `artifacts/windows`; the project defaults to this
repository. Release verification requires exactly the six public assets. All
must be nonempty regular files. Checksums must cover each of the five payload
files exactly once. The manifest must match the project's stable version,
canonical Changes text/date, exact-tag bundle-specific URLs, and signature-file
contents. No generic Windows platform entry is accepted. `--installers-only`
verifies the manual build's two installers and checksum file, not an updater
release. Success is reported only after all applicable checks pass.

## `windows-update-manifest.mjs`

```powershell
node scripts/windows-update-manifest.mjs generate --project . --artifacts-dir artifacts/windows
node scripts/windows-update-manifest.mjs verify --project . --artifacts-dir artifacts/windows
```

The staging/verifying scripts invoke this focused manifest owner. It reuses
`release-notes.mjs`, maps the tracked date to UTC midnight, preserves signature
text verbatim, and writes deterministic UTF-8 JSON. It checks metadata parity,
not cryptographic authenticity; the native updater owns signature verification.

## `smoke-windows-installer.ps1`

```text
--installer <path>
-h, --help
```

The default installer is `artifacts/windows/Archeion-Setup-x64.exe`. Run this
only on an isolated Windows runner. The script refuses an existing Archeion
installation or data directory, uses a unique temporary install path, checks the
installed executable, product metadata, uninstaller, and registration, then
silently uninstalls and verifies removal. Successful smoke output permanently
shows all four lifecycle stages: installing, verifying installation,
uninstalling, and verifying cleanup. These are lifecycle steps, not fabricated
percentage progress. Both Windows installer workflows run it after staging and
checksum verification, before uploading the bundle.

## `zip-project.ps1`

```text
--mode <repo|workspace>
-p, --project <path>
-o, --output <path>
-h, --help
```

`repo` exports exactly the committed Git tree plus `EXPORT_MANIFEST.json`. It
does not include uncommitted edits, untracked files, or local `.planning/` and
`.project/` records. `workspace` exports the current filesystem using
`.zipignore`, including eligible local planning and project records. Do not
share a workspace export without inspecting those local records.

The manifest records the export mode, source commit, Git working-tree dirty
state, tracked-source baseline, presence of local-only planning/project files,
and precise UTC creation time. Dirty state describes Git-visible changes; ignored
local records are reported separately. When `--output` is omitted, the archive
uses the local wall-clock filename `archeion-repo(yyMMddHHmm).zip` or
`archeion-workspace(yyMMddHHmm).zip`, for example
`archeion-repo(2610031858).zip` or `archeion-workspace(2610031858).zip`. Both
modes refuse to replace an existing ZIP, and `--output` must point outside the
repository.

## npm aliases

For the complete preparation and automatic publication procedure, use the
[release operator guide](../docs/RELEASING.md). These aliases are command
references, not a manual tagging procedure.

```powershell
npm run version:check
npm run version:set -- X.Y.Z
npm run release:check -- --tag vX.Y.Z
npm run release:stage
npm run changes:review -- --files
npm run changes:package -- --name "phase-1.3.0.16"
npm run changes:apply -- --dry-run
npm run changes:restore -- --dry-run
npm run clean
npm run clean:all -- --dry-run
npm run zip:repo
npm run zip:workspace
```

Arguments after npm's `--` are forwarded to the underlying script.

## Compatibility

Legacy invocations remain accepted, including:

```powershell
.\scripts\apply-chatgpt-zip.ps1 -DryRun
.\scripts\package-changed-files.ps1 -Name "phase-1.3.0.16"
.\scripts\review-changes.ps1 -Detailed
.\scripts\clean-generated.ps1 -Dependencies -DryRun
.\scripts\check-release.ps1 -RequireChangelogEntry
```

New documentation and automation should use the canonical command names and Git-style flags.
