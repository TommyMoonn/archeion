# Project Scripts

Run these commands from the project root using PowerShell.

| Script                       | Purpose                                                               | Example                                                     |
| ---------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------- |
| `apply-chatgpt-zip.ps1`      | Applies the newest Archeion changed-files ZIP from Downloads.         | `.\scripts\apply-chatgpt-zip.ps1 -DryRun`                   |
| `package-changed-files.ps1`  | Packages current Git changes while preserving project-relative paths. | `.\scripts\package-changed-files.ps1 -Name "phase-0.2.0.7"` |
| `review-changes.ps1`         | Summarizes staged, unstaged, added, modified, and deleted files.      | `.\scripts\review-changes.ps1 -Detailed`                    |
| `restore-chatgpt-import.ps1` | Restores files from the latest ChatGPT import backup.                 | `.\scripts\restore-chatgpt-import.ps1 -DryRun`              |
| `clean-generated.ps1`        | Removes generated output and caches.                                  | `.\scripts\clean-generated.ps1 -DryRun`                     |
| `zip-project.ps1`            | Creates a full project ZIP using `.zipignore`.                        | `.\scripts\zip-project.ps1`                                 |
| `stage-windows-bundles.ps1`  | Collects or stages generated Windows release bundles.                 | `.\scripts\stage-windows-bundles.ps1`                       |

## Script flags

### `apply-chatgpt-zip.ps1`

| Flag                      | Purpose                                                                       |
| ------------------------- | ----------------------------------------------------------------------------- |
| `-ZipPath <path>`         | Apply a specific ZIP instead of the newest matching ZIP in Downloads.         |
| `-DryRun`                 | Preview copies and deletions without changing files.                          |
| `-AllowDirty`             | Allow importing when tracked files already have uncommitted changes.          |
| `-NoBackup`               | Skip backing up overwritten or deleted files.                                 |
| `-AllowDirectoryDeletion` | Permit directories listed with `dir:` in the deletion manifest to be removed. |
| `-StripSingleRoot`        | Force removal of one extra top-level ZIP folder.                              |
| `-DownloadsPath <path>`   | Use a different Downloads directory.                                          |
| `-ZipPattern <pattern>`   | Change the automatic ZIP search pattern. Default: `archeion*.zip`.            |
| `-ProjectRoot <path>`     | Apply into another project root.                                              |

Typical use:

```powershell
.\scripts\apply-chatgpt-zip.ps1 -DryRun
.\scripts\apply-chatgpt-zip.ps1
```

---

### `package-changed-files.ps1`

| Flag                  | Purpose                                                        |
| --------------------- | -------------------------------------------------------------- |
| `-Name <name>`        | Sets the task portion of the ZIP filename. Default: `changes`. |
| `-OutputPath <path>`  | Places the ZIP at a custom location.                           |
| `-ExcludeUntracked`   | Excludes untracked files from the ZIP.                         |
| `-Force`              | Replaces an existing ZIP with the same filename.               |
| `-ProjectRoot <path>` | Packages changes from another project root.                    |

Typical use:

```powershell
.\scripts\package-changed-files.ps1 -Name "phase-0.2.0.7"
```

---

### `review-changes.ps1`

| Flag                  | Purpose                                          |
| --------------------- | ------------------------------------------------ |
| `-Detailed`           | Prints every changed path, not only the summary. |
| `-ProjectRoot <path>` | Reviews another project root.                    |

Typical use:

```powershell
.\scripts\review-changes.ps1
.\scripts\review-changes.ps1 -Detailed
```

---

### `restore-chatgpt-import.ps1`

| Flag                  | Purpose                                              |
| --------------------- | ---------------------------------------------------- |
| `-DryRun`             | Preview which files would be restored.               |
| `-BackupPath <path>`  | Restore a specific backup instead of the newest one. |
| `-ProjectRoot <path>` | Restore into another project root.                   |

Typical use:

```powershell
.\scripts\restore-chatgpt-import.ps1 -DryRun
.\scripts\restore-chatgpt-import.ps1
```

---

### `clean-generated.ps1`

| Flag                  | Purpose                                                         |
| --------------------- | --------------------------------------------------------------- |
| `-DryRun`             | Preview cleanup and estimated freed space.                      |
| `-Rust`               | Also remove `src-tauri/target`.                                 |
| `-Dependencies`       | Also remove `node_modules`.                                     |
| `-Installers`         | Also remove generated Tauri installer bundles.                  |
| `-All`                | Enable Rust, dependencies, and installer cleanup.               |
| `-Force`              | Allow removal of selected directories containing tracked files. |
| `-ProjectRoot <path>` | Clean another project root.                                     |

Typical use:

```powershell
.\scripts\clean-generated.ps1 -DryRun
.\scripts\clean-generated.ps1
.\scripts\clean-generated.ps1 -Rust
.\scripts\clean-generated.ps1 -All -DryRun
```

`-Force` should be rare. It bypasses the tracked-file protection, not just confirmation.
