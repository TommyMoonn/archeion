# Project Scripts

Run from the project root with PowerShell 7.

Public flags use Git-style `--kebab-case`. Existing PowerShell-style flags and renamed script entry points remain compatibility aliases.

Every command supports `-h` / `--help`.

## Commands

| Script                      | Purpose                                                     | Example                                                 |
| --------------------------- | ----------------------------------------------------------- | ------------------------------------------------------- |
| `apply-changes.ps1`         | Apply a changed-files ZIP.                                  | `.\scripts\apply-changes.ps1 --dry-run`                 |
| `package-changes.ps1`       | Package current Git changes.                                | `.\scripts\package-changes.ps1 --name "phase-1.3.0.16"` |
| `review-changes.ps1`        | Summarize working-tree changes.                             | `.\scripts\review-changes.ps1 --files`                  |
| `restore-changes.ps1`       | Restore an import backup.                                   | `.\scripts\restore-changes.ps1 --dry-run`               |
| `clean-generated.ps1`       | Remove generated outputs and caches.                        | `.\scripts\clean-generated.ps1 --dry-run`               |
| `zip-project.ps1`           | Create `<project-slug>(yyMMddHHmm).zip` using `.zipignore`. | `.\scripts\zip-project.ps1`                             |
| `check-release.ps1`         | Validate release versions, tags, and changelog metadata.    | `.\scripts\check-release.ps1 --require-changelog`       |
| `set-version.ps1`           | Update all application version sources transactionally.     | `.\scripts\set-version.ps1 1.3.0`                       |
| `stage-windows-release.ps1` | Validate and stage Windows release installers.              | `.\scripts\stage-windows-release.ps1`                   |

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

Without `--zip`, the newest ZIP matching `archeion*.zip` in Downloads is used.

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

Untracked files are included by default. `--tracked-only` excludes them.

```powershell
.\scripts\package-changes.ps1 --name "phase-1.3.0.16"
```

## `review-changes.ps1`

```text
-p, --project <path>
--files
-h, --help
```

`--files` prints every changed path in addition to the summary.

## `restore-changes.ps1`

```text
-p, --project <path>
--backup <path>
-n, --dry-run
-h, --help
```

Without `--backup`, the newest import backup for the project is used.

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

`--force` bypasses tracked-file protection for the selected cleanup targets. Use it only after reviewing the paths.

## `check-release.ps1`

```text
-p, --project <path>
--tag <tag>
--require-changelog
-h, --help
```

## `set-version.ps1`

```text
set-version.ps1 VERSION
-p, --project <path>
-h, --help
```

The version remains positional because it is the command's primary operand.

## `stage-windows-release.ps1`

```text
--bundle-dir <path>
-o, --output <path>
-p, --project <path>
-h, --help
```

The default bundle directory is `src-tauri/target/release/bundle`; the default output is `artifacts/windows`.

## `zip-project.ps1`

```text
-h, --help
```

The command otherwise remains zero-config.

## npm aliases

```powershell
npm run version:check
npm run version:set -- 1.3.0
npm run release:check -- --tag v1.3.0
npm run release:stage
npm run changes:review -- --files
npm run changes:package -- --name "phase-1.3.0.16"
npm run changes:apply -- --dry-run
npm run changes:restore -- --dry-run
npm run clean
npm run clean:all -- --dry-run
npm run zip
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
