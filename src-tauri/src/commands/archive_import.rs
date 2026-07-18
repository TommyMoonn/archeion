use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use super::{
    archive_import_transaction::ArchiveImportTransactionState,
    archive_root, filesystem, scanner_cache,
    watcher::{ArchiveWatcherSuppressionOwner, SuppressedWatcherChange},
};

#[derive(Clone)]
pub struct ArchiveImportCommandState {
    transaction_state: ArchiveImportTransactionState,
    watcher_suppressions: ArchiveWatcherSuppressionOwner,
}

impl ArchiveImportCommandState {
    pub(crate) fn new(
        transaction_state: ArchiveImportTransactionState,
        watcher_suppressions: ArchiveWatcherSuppressionOwner,
    ) -> Self {
        Self {
            transaction_state,
            watcher_suppressions,
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ArchiveImportConflictAction {
    KeepBoth,
    Skip,
    Replace,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ArchiveImportMode {
    Copy,
    Move,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ArchiveImportStatus {
    Imported,
    Skipped,
    Failed,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveImportResult {
    status: ArchiveImportStatus,
    source_path: String,
    file_name: String,
    relative_path: Option<String>,
    replaced_existing: bool,
    message: Option<String>,
    source_cleanup_warning: Option<String>,
    maintenance_warning: Option<String>,
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveImportBatchResult {
    results: Vec<ArchiveImportResult>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    folded_watcher_changes: Vec<SuppressedWatcherChange>,
    #[serde(skip_serializing_if = "Option::is_none")]
    cache_warning: Option<scanner_cache::ScannerCacheWarning>,
}

fn import_failed(
    source_path: &str,
    file_name: impl Into<String>,
    message: impl Into<String>,
) -> ArchiveImportResult {
    ArchiveImportResult {
        status: ArchiveImportStatus::Failed,
        source_path: source_path.to_string(),
        file_name: file_name.into(),
        relative_path: None,
        replaced_existing: false,
        message: Some(message.into()),
        source_cleanup_warning: None,
        maintenance_warning: None,
    }
}

fn import_skipped(
    source_path: &str,
    file_name: impl Into<String>,
    message: impl Into<String>,
) -> ArchiveImportResult {
    ArchiveImportResult {
        status: ArchiveImportStatus::Skipped,
        source_path: source_path.to_string(),
        file_name: file_name.into(),
        relative_path: None,
        replaced_existing: false,
        message: Some(message.into()),
        source_cleanup_warning: None,
        maintenance_warning: None,
    }
}

fn import_imported(
    source_path: &str,
    file_name: impl Into<String>,
    relative_path: impl Into<String>,
    replaced_existing: bool,
    source_cleanup_warning: Option<String>,
    maintenance_warning: Option<String>,
) -> ArchiveImportResult {
    ArchiveImportResult {
        status: ArchiveImportStatus::Imported,
        source_path: source_path.to_string(),
        file_name: file_name.into(),
        relative_path: Some(relative_path.into()),
        replaced_existing,
        message: None,
        source_cleanup_warning,
        maintenance_warning,
    }
}

fn archive_join(folder_path: &str, file_name: &str) -> String {
    if folder_path.is_empty() {
        file_name.to_string()
    } else {
        format!("{folder_path}/{file_name}")
    }
}

fn split_epub_file_name(file_name: &str) -> (String, String) {
    let extension_start = file_name
        .to_ascii_lowercase()
        .rfind(".epub")
        .unwrap_or(file_name.len());

    (
        file_name[..extension_start].to_string(),
        file_name[extension_start..].to_string(),
    )
}

fn resolve_destination_folder(
    root: &Path,
    destination_folder_path: Option<&str>,
) -> Result<(PathBuf, String), String> {
    let canonical_root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let Some(destination_folder_path) =
        destination_folder_path.filter(|path| !path.trim().is_empty())
    else {
        return Ok((canonical_root, String::new()));
    };

    let normalized = filesystem::normalize_archive_relative_path(destination_folder_path)?;
    let destination = fs::canonicalize(canonical_root.join(&normalized))
        .map_err(|_| "The destination folder is unavailable.".to_string())?;

    if !destination.starts_with(&canonical_root) || !destination.is_dir() {
        return Err("The destination folder is unavailable.".to_string());
    }

    Ok((destination, normalized))
}

fn path_identity(path: &str) -> String {
    path.replace('\\', "/").to_lowercase()
}

fn find_case_insensitive_child(folder: &Path, file_name: &str) -> Result<Option<PathBuf>, String> {
    let wanted = file_name.to_lowercase();
    for entry in fs::read_dir(folder).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        if entry.file_name().to_string_lossy().to_lowercase() == wanted {
            return Ok(Some(entry.path()));
        }
    }
    Ok(None)
}

#[derive(Debug)]
struct PlannedImport {
    index: usize,
    source_path: String,
    source: PathBuf,
    destination: PathBuf,
    file_name: String,
    relative_path: String,
    replace_existing: bool,
}

fn reserve_destination(
    destination_folder: &Path,
    destination_folder_path: &str,
    file_name: &str,
    conflict_action: ArchiveImportConflictAction,
    reserved: &mut HashSet<String>,
) -> Result<Option<(PathBuf, String, String, bool)>, String> {
    filesystem::validate_epub_file_name(file_name)?;
    let existing = find_case_insensitive_child(destination_folder, file_name)?;
    let original_relative = archive_join(destination_folder_path, file_name);
    let original_identity = path_identity(&original_relative);
    let claimed = reserved.contains(&original_identity);

    match conflict_action {
        ArchiveImportConflictAction::Skip if existing.is_some() || claimed => Ok(None),
        ArchiveImportConflictAction::Replace => {
            if claimed {
                return Err(
                    "Another selected EPUB already targets this replacement destination."
                        .to_string(),
                );
            }
            if let Some(existing) = existing {
                if !existing.is_file() {
                    return Err("A folder with this name already exists.".to_string());
                }
                let actual_name = existing
                    .file_name()
                    .and_then(|name| name.to_str())
                    .unwrap_or(file_name)
                    .to_string();
                let relative_path = archive_join(destination_folder_path, &actual_name);
                reserved.insert(path_identity(&relative_path));
                return Ok(Some((existing, actual_name, relative_path, true)));
            }
            reserved.insert(original_identity);
            Ok(Some((
                destination_folder.join(file_name),
                file_name.to_string(),
                original_relative,
                false,
            )))
        }
        ArchiveImportConflictAction::KeepBoth => {
            if existing.is_none() && !claimed {
                reserved.insert(original_identity);
                return Ok(Some((
                    destination_folder.join(file_name),
                    file_name.to_string(),
                    original_relative,
                    false,
                )));
            }
            let (stem, extension) = split_epub_file_name(file_name);
            for index in 2..10_000 {
                let candidate_name = format!("{stem} ({index}){extension}");
                let relative_path = archive_join(destination_folder_path, &candidate_name);
                let identity = path_identity(&relative_path);
                if reserved.contains(&identity) {
                    continue;
                }
                if find_case_insensitive_child(destination_folder, &candidate_name)?.is_none() {
                    reserved.insert(identity);
                    return Ok(Some((
                        destination_folder.join(&candidate_name),
                        candidate_name,
                        relative_path,
                        false,
                    )));
                }
            }
            Err("No available filename could be found.".to_string())
        }
        ArchiveImportConflictAction::Skip => {
            reserved.insert(original_identity);
            Ok(Some((
                destination_folder.join(file_name),
                file_name.to_string(),
                original_relative,
                false,
            )))
        }
    }
}

trait ImportFileSystem: Send + Sync {
    fn copy(&self, source: &Path, destination: &Path) -> Result<u64, String>;
    fn rename(&self, source: &Path, destination: &Path) -> Result<(), String>;
    fn remove_file(&self, path: &Path) -> Result<(), String>;
}

struct RealImportFileSystem;

impl ImportFileSystem for RealImportFileSystem {
    fn copy(&self, source: &Path, destination: &Path) -> Result<u64, String> {
        fs::copy(source, destination).map_err(|error| error.to_string())
    }

    fn rename(&self, source: &Path, destination: &Path) -> Result<(), String> {
        fs::rename(source, destination).map_err(|error| error.to_string())
    }

    fn remove_file(&self, path: &Path) -> Result<(), String> {
        fs::remove_file(path).map_err(|error| error.to_string())
    }
}

fn import_transaction_nonce() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!("{timestamp}-{}", std::process::id())
}

fn transaction_path(destination: &Path, marker: &str) -> Result<PathBuf, String> {
    let parent = destination
        .parent()
        .ok_or_else(|| "The destination folder is unavailable.".to_string())?;
    let file_name = destination
        .file_name()
        .ok_or_else(|| "The destination file is unavailable.".to_string())?
        .to_string_lossy();
    Ok(parent.join(format!(
        "{file_name}.{marker}-{}",
        import_transaction_nonce()
    )))
}

fn copy_source_to_temp(
    fs_ops: &dyn ImportFileSystem,
    source: &Path,
    temporary: &Path,
    expected_size: u64,
) -> Result<(), String> {
    let copied_size = fs_ops.copy(source, temporary)?;
    if copied_size != expected_size {
        let _ = fs_ops.remove_file(temporary);
        return Err("The copied EPUB size did not match the source EPUB.".to_string());
    }
    Ok(())
}

fn restore_import_backup(
    fs_ops: &dyn ImportFileSystem,
    backup: &Path,
    destination: &Path,
) -> Result<(), String> {
    fs_ops.rename(backup, destination).map_err(|restore_error| {
        format!(
            "The original EPUB could not be restored. Its replacement backup remains available for recovery at '{}': {restore_error}",
            backup.display()
        )
    })
}

fn is_regular_epub_file(path: &Path) -> bool {
    path.extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("epub"))
        && fs::symlink_metadata(path).is_ok_and(|metadata| metadata.file_type().is_file())
}

#[derive(Debug, Default, PartialEq, Eq)]
struct ImportCommitOutcome {
    source_cleanup_warning: Option<String>,
    maintenance_warning: Option<String>,
}

fn copy_or_move_epub_with_fs(
    source: &Path,
    destination: &Path,
    mode: ArchiveImportMode,
    replace_existing: bool,
    fs_ops: &dyn ImportFileSystem,
) -> Result<ImportCommitOutcome, String> {
    let expected_size = fs::metadata(source)
        .map_err(|error| error.to_string())?
        .len();
    let temporary_path = transaction_path(destination, "tmp-import")?;
    let backup_path = transaction_path(destination, "replace-backup")?;

    copy_source_to_temp(fs_ops, source, &temporary_path, expected_size)?;

    if replace_existing {
        if let Err(error) = fs_ops.rename(destination, &backup_path) {
            let _ = fs_ops.remove_file(&temporary_path);
            return Err(error);
        }
        if let Err(rename_error) = fs_ops.rename(&temporary_path, destination) {
            let _ = fs_ops.remove_file(&temporary_path);
            if let Err(restore_error) = restore_import_backup(fs_ops, &backup_path, destination) {
                return Err(format!(
                    "The replacement EPUB could not be placed in the archive: {rename_error}. {restore_error}"
                ));
            }
            return Err(format!(
                "The replacement EPUB could not be placed in the archive: {rename_error}"
            ));
        }
    } else if let Err(error) = fs_ops.rename(&temporary_path, destination) {
        let _ = fs_ops.remove_file(&temporary_path);
        return Err(error);
    }

    let maintenance_warning = if replace_existing {
        fs_ops.remove_file(&backup_path).err().map(|error| {
            format!(
                "The imported EPUB is available, but its replacement backup could not be removed. Run archive metadata repair after closing other programs that may be using the archive: {error}"
            )
        })
    } else {
        None
    };

    let source_cleanup_warning = if mode == ArchiveImportMode::Move {
        fs_ops.remove_file(source).err().map(|error| {
            format!(
                "The EPUB was imported, but the original source could not be removed and remains outside the archive: {error}"
            )
        })
    } else {
        None
    };

    Ok(ImportCommitOutcome {
        source_cleanup_warning,
        maintenance_warning,
    })
}

struct ArchiveImportExecution<'a> {
    transaction_state: &'a ArchiveImportTransactionState,
    watcher_suppressions: Option<&'a ArchiveWatcherSuppressionOwner>,
    file_system: &'a dyn ImportFileSystem,
}

fn add_epub_files_to_archive_at_with_context(
    root: &Path,
    source_paths: Vec<String>,
    destination_folder_path: Option<String>,
    conflict_action: ArchiveImportConflictAction,
    mode: ArchiveImportMode,
    execution: ArchiveImportExecution<'_>,
) -> Result<ArchiveImportBatchResult, String> {
    let canonical_root = fs::canonicalize(root).map_err(|error| error.to_string())?;

    execution.transaction_state.run(&canonical_root, || {
        let (destination_folder, destination_folder_path) =
            resolve_destination_folder(&canonical_root, destination_folder_path.as_deref())?;
        let mut results: Vec<Option<ArchiveImportResult>> = std::iter::repeat_with(|| None)
            .take(source_paths.len())
            .collect();
        let mut planned = Vec::new();
        let mut reserved = HashSet::new();

        for (index, source_path) in source_paths.into_iter().enumerate() {
            let source = PathBuf::from(&source_path);
            let file_name = source
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("Selected file")
                .to_string();

            if let Err(message) = filesystem::validate_epub_file_name(&file_name) {
                results[index] = Some(import_failed(&source_path, file_name, message));
                continue;
            }

            let source = match fs::canonicalize(&source) {
                Ok(source) => source,
                Err(_) => {
                    results[index] = Some(import_failed(
                        &source_path,
                        file_name,
                        "The source EPUB is unavailable.",
                    ));
                    continue;
                }
            };

            if !source.is_file() {
                results[index] = Some(import_failed(
                    &source_path,
                    file_name,
                    "The source EPUB is unavailable.",
                ));
                continue;
            }
            if source.starts_with(&canonical_root) {
                results[index] = Some(import_failed(
                    &source_path,
                    file_name,
                    "Choose EPUB files outside the active archive.",
                ));
                continue;
            }

            match reserve_destination(
                &destination_folder,
                &destination_folder_path,
                &file_name,
                conflict_action,
                &mut reserved,
            ) {
                Ok(Some((destination, final_file_name, relative_path, replace_existing))) => {
                    planned.push(PlannedImport {
                        index,
                        source_path,
                        source,
                        destination,
                        file_name: final_file_name,
                        relative_path,
                        replace_existing,
                    });
                }
                Ok(None) => {
                    results[index] = Some(import_skipped(
                        &source_path,
                        file_name,
                        "A file with this name already exists or was already reserved by this import batch.",
                    ));
                }
                Err(message) => {
                    results[index] = Some(import_failed(&source_path, file_name, message));
                }
            }
        }

        let planned_paths = planned
            .iter()
            .map(|item| item.relative_path.clone())
            .collect::<Vec<_>>();
        let watcher_suppression = execution
            .watcher_suppressions
            .map(|owner| owner.begin(&canonical_root, &planned_paths))
            .transpose()?;

        let mut imported_paths = Vec::new();
        let mut final_state_changes = Vec::new();
        for item in planned {
            results[item.index] = Some(match copy_or_move_epub_with_fs(
                &item.source,
                &item.destination,
                mode,
                item.replace_existing,
                execution.file_system,
            ) {
                Ok(outcome) => {
                    imported_paths.push(item.relative_path.clone());
                    import_imported(
                        &item.source_path,
                        item.file_name,
                        item.relative_path,
                        item.replace_existing,
                        outcome.source_cleanup_warning,
                        outcome.maintenance_warning,
                    )
                }
                Err(message) => {
                    if item.replace_existing && !is_regular_epub_file(&item.destination) {
                        final_state_changes.push(SuppressedWatcherChange {
                            kind: "remove",
                            relative_paths: vec![item.relative_path.clone()],
                        });
                    }
                    import_failed(&item.source_path, item.file_name, message)
                }
            });
        }

        let cache_warning = scanner_cache::invalidate_paths(&canonical_root, &imported_paths).warning;
        let mut folded_watcher_changes = watcher_suppression
            .map(|suppression| suppression.finish())
            .unwrap_or_default();
        folded_watcher_changes.extend(final_state_changes);

        Ok(ArchiveImportBatchResult {
            cache_warning,
            folded_watcher_changes,
            results: results
                .into_iter()
                .map(|result| result.expect("every import result should be planned"))
                .collect(),
        })
    })
}

#[cfg(test)]
fn add_epub_files_to_archive_at(
    root: &Path,
    source_paths: Vec<String>,
    destination_folder_path: Option<String>,
    conflict_action: ArchiveImportConflictAction,
    mode: ArchiveImportMode,
) -> Result<ArchiveImportBatchResult, String> {
    add_epub_files_to_archive_at_with_context(
        root,
        source_paths,
        destination_folder_path,
        conflict_action,
        mode,
        ArchiveImportExecution {
            transaction_state: &ArchiveImportTransactionState::default(),
            watcher_suppressions: None,
            file_system: &RealImportFileSystem,
        },
    )
}

#[tauri::command]
pub async fn add_epub_files_to_archive(
    app: tauri::AppHandle,
    root_path: Option<String>,
    source_paths: Vec<String>,
    destination_folder_path: Option<String>,
    conflict_action: ArchiveImportConflictAction,
    mode: ArchiveImportMode,
    import_state: tauri::State<'_, ArchiveImportCommandState>,
) -> Result<ArchiveImportBatchResult, String> {
    let root = archive_root::resolve_archive_root(&app, root_path)?;
    let transaction_state = import_state.transaction_state.clone();
    let watcher_suppressions = import_state.watcher_suppressions.clone();

    tauri::async_runtime::spawn_blocking(move || {
        add_epub_files_to_archive_at_with_context(
            &root,
            source_paths,
            destination_folder_path,
            conflict_action,
            mode,
            ArchiveImportExecution {
                transaction_state: &transaction_state,
                watcher_suppressions: Some(&watcher_suppressions),
                file_system: &RealImportFileSystem,
            },
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::{mpsc, Arc, Mutex},
        thread,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    use super::{
        add_epub_files_to_archive_at, add_epub_files_to_archive_at_with_context,
        copy_or_move_epub_with_fs, ArchiveImportBatchResult, ArchiveImportConflictAction,
        ArchiveImportExecution, ArchiveImportMode, ArchiveImportStatus, ImportFileSystem,
        RealImportFileSystem,
    };
    use crate::commands::{
        archive_import_artifacts::cleanup_archive_import_artifacts_at,
        archive_import_transaction::ArchiveImportTransactionState, metadata, scanner_cache,
        watcher::ArchiveWatcherSuppressionOwner,
    };

    fn test_root() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-archive-import-{nonce}"))
    }

    #[derive(Clone, Copy)]
    enum ReplacementFailureStage {
        Backup,
        Copy,
        Placement,
        Restoration,
    }

    struct ReplacementFailureFileSystem(ReplacementFailureStage);

    impl ImportFileSystem for ReplacementFailureFileSystem {
        fn copy(
            &self,
            source: &std::path::Path,
            destination: &std::path::Path,
        ) -> Result<u64, String> {
            if matches!(self.0, ReplacementFailureStage::Copy) {
                return Err("simulated temporary copy failure".to_string());
            }
            fs::copy(source, destination).map_err(|error| error.to_string())
        }

        fn rename(
            &self,
            source: &std::path::Path,
            destination: &std::path::Path,
        ) -> Result<(), String> {
            let source_name = source
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            let destination_name = destination
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();

            if matches!(self.0, ReplacementFailureStage::Backup)
                && destination_name.contains(".replace-backup-")
            {
                return Err("simulated replacement backup failure".to_string());
            }
            if matches!(
                self.0,
                ReplacementFailureStage::Placement | ReplacementFailureStage::Restoration
            ) && source_name.contains(".tmp-import-")
            {
                return Err("simulated final rename failure".to_string());
            }
            if matches!(self.0, ReplacementFailureStage::Restoration)
                && source_name.contains(".replace-backup-")
            {
                return Err("simulated replacement restoration failure".to_string());
            }

            fs::rename(source, destination).map_err(|error| error.to_string())
        }

        fn remove_file(&self, path: &std::path::Path) -> Result<(), String> {
            fs::remove_file(path).map_err(|error| error.to_string())
        }
    }

    fn run_replacement_failure(
        stage: ReplacementFailureStage,
    ) -> (PathBuf, PathBuf, ArchiveImportBatchResult) {
        let root = test_root();
        let external = test_root();
        fs::create_dir_all(&root).expect("archive should be created");
        fs::create_dir_all(&external).expect("source folder should be created");
        fs::write(root.join("Novel.epub"), b"existing").expect("existing EPUB should exist");
        let source = external.join("Novel.epub");
        fs::write(&source, b"incoming").expect("incoming EPUB should exist");

        let result = add_epub_files_to_archive_at_with_context(
            &root,
            vec![source.to_string_lossy().into_owned()],
            None,
            ArchiveImportConflictAction::Replace,
            ArchiveImportMode::Copy,
            ArchiveImportExecution {
                transaction_state: &ArchiveImportTransactionState::default(),
                watcher_suppressions: None,
                file_system: &ReplacementFailureFileSystem(stage),
            },
        )
        .expect("replacement failure should return an import result");

        (root, external, result)
    }

    #[test]
    fn replace_import_restores_existing_destination_when_final_rename_fails() {
        let root = test_root();
        let external = test_root();
        fs::create_dir_all(&root).expect("archive should be created");
        fs::create_dir_all(&external).expect("source folder should be created");
        let destination = root.join("Novel.epub");
        let source = external.join("Novel.epub");
        fs::write(&destination, b"existing").expect("existing EPUB should exist");
        fs::write(&source, b"incoming").expect("incoming EPUB should exist");
        let fs_ops = ReplacementFailureFileSystem(ReplacementFailureStage::Placement);

        let result = copy_or_move_epub_with_fs(
            &source,
            &destination,
            ArchiveImportMode::Copy,
            true,
            &fs_ops,
        );

        assert!(result.is_err());
        assert_eq!(fs::read(&destination).unwrap(), b"existing");
        assert!(source.is_file());
        assert!(!root
            .read_dir()
            .expect("archive should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .contains("replace-backup")));
        fs::remove_dir_all(root).expect("test archive should be removed");
        fs::remove_dir_all(external).expect("source folder should be removed");
    }

    #[test]
    fn temporary_copy_failure_keeps_the_existing_destination_without_reconciliation() {
        let (root, external, result) = run_replacement_failure(ReplacementFailureStage::Copy);

        assert_eq!(result.results[0].status, ArchiveImportStatus::Failed);
        assert!(result.folded_watcher_changes.is_empty());
        assert_eq!(fs::read(root.join("Novel.epub")).unwrap(), b"existing");
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(external).unwrap();
    }

    #[test]
    fn backup_failure_keeps_the_existing_destination_without_reconciliation() {
        let (root, external, result) = run_replacement_failure(ReplacementFailureStage::Backup);

        assert_eq!(result.results[0].status, ArchiveImportStatus::Failed);
        assert!(result.folded_watcher_changes.is_empty());
        assert_eq!(fs::read(root.join("Novel.epub")).unwrap(), b"existing");
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(external).unwrap();
    }

    #[test]
    fn successful_restoration_keeps_the_existing_destination_without_reconciliation() {
        let (root, external, result) = run_replacement_failure(ReplacementFailureStage::Placement);

        assert_eq!(result.results[0].status, ArchiveImportStatus::Failed);
        assert!(result.folded_watcher_changes.is_empty());
        assert_eq!(fs::read(root.join("Novel.epub")).unwrap(), b"existing");
        assert!(!root
            .read_dir()
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".replace-backup-")
            }));
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(external).unwrap();
    }

    #[test]
    fn restoration_failure_reports_the_missing_destination_and_preserves_the_backup() {
        let (root, external, result) =
            run_replacement_failure(ReplacementFailureStage::Restoration);

        assert_eq!(result.results[0].status, ArchiveImportStatus::Failed);
        assert!(!result.results[0].replaced_existing);
        assert!(!root.join("Novel.epub").exists());
        assert_eq!(
            result.folded_watcher_changes,
            [crate::commands::watcher::SuppressedWatcherChange {
                kind: "remove",
                relative_paths: vec!["Novel.epub".to_string()],
            }]
        );
        let backup = root
            .read_dir()
            .unwrap()
            .filter_map(Result::ok)
            .find(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".replace-backup-")
            })
            .expect("replacement backup should remain available");
        assert_eq!(fs::read(backup.path()).unwrap(), b"existing");
        let message = result.results[0]
            .message
            .as_deref()
            .expect("failed import should explain recovery");
        assert!(message.contains("replacement backup remains available for recovery"));
        assert!(message.contains(&backup.file_name().to_string_lossy().to_string()));
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(external).unwrap();
    }

    #[test]
    fn imports_epubs_into_the_archive() {
        let root = test_root();
        let external = test_root();
        fs::create_dir_all(root.join("Series")).expect("destination should be created");
        fs::create_dir_all(&external).expect("source folder should be created");
        let source = external.join("Novel.epub");
        fs::write(&source, b"epub").expect("source EPUB should be written");

        let results = add_epub_files_to_archive_at(
            &root,
            vec![source.to_string_lossy().into_owned()],
            Some("Series".to_string()),
            ArchiveImportConflictAction::KeepBoth,
            ArchiveImportMode::Copy,
        )
        .expect("import should run")
        .results;

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].status, ArchiveImportStatus::Imported);
        assert!(!results[0].replaced_existing);
        assert_eq!(
            results[0].relative_path.as_deref(),
            Some("Series/Novel.epub")
        );
        assert_eq!(
            fs::read(root.join("Series").join("Novel.epub")).unwrap(),
            b"epub"
        );
        assert!(source.is_file());
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(external);
    }

    #[test]
    fn keeps_both_when_destination_filename_conflicts() {
        let root = test_root();
        let external = test_root();
        fs::create_dir_all(&root).expect("archive should be created");
        fs::create_dir_all(&external).expect("source folder should be created");
        fs::write(root.join("Novel.epub"), b"existing").expect("existing EPUB should exist");
        let source = external.join("Novel.epub");
        fs::write(&source, b"incoming").expect("incoming EPUB should exist");

        let results = add_epub_files_to_archive_at(
            &root,
            vec![source.to_string_lossy().into_owned()],
            None,
            ArchiveImportConflictAction::KeepBoth,
            ArchiveImportMode::Copy,
        )
        .expect("import should run")
        .results;

        assert_eq!(results[0].status, ArchiveImportStatus::Imported);
        assert_eq!(results[0].relative_path.as_deref(), Some("Novel (2).epub"));
        assert_eq!(fs::read(root.join("Novel.epub")).unwrap(), b"existing");
        assert_eq!(fs::read(root.join("Novel (2).epub")).unwrap(), b"incoming");
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(external);
    }

    #[test]
    fn skips_or_replaces_destination_conflicts_explicitly() {
        let root = test_root();
        let external = test_root();
        fs::create_dir_all(&root).expect("archive should be created");
        fs::create_dir_all(&external).expect("source folder should be created");
        fs::write(root.join("Novel.epub"), b"existing").expect("existing EPUB should exist");
        let source = external.join("Novel.epub");
        fs::write(&source, b"incoming").expect("incoming EPUB should exist");

        let skipped = add_epub_files_to_archive_at(
            &root,
            vec![source.to_string_lossy().into_owned()],
            None,
            ArchiveImportConflictAction::Skip,
            ArchiveImportMode::Copy,
        )
        .expect("skip import should run")
        .results;
        assert_eq!(skipped[0].status, ArchiveImportStatus::Skipped);
        assert_eq!(fs::read(root.join("Novel.epub")).unwrap(), b"existing");

        let replaced = add_epub_files_to_archive_at(
            &root,
            vec![source.to_string_lossy().into_owned()],
            None,
            ArchiveImportConflictAction::Replace,
            ArchiveImportMode::Copy,
        )
        .expect("replace import should run")
        .results;
        assert_eq!(replaced[0].status, ArchiveImportStatus::Imported);
        assert!(replaced[0].replaced_existing);
        assert_eq!(fs::read(root.join("Novel.epub")).unwrap(), b"incoming");
        assert!(!root
            .read_dir()
            .expect("archive should be readable")
            .filter_map(Result::ok)
            .any(|entry| {
                let file_name = entry.file_name().to_string_lossy().to_string();
                file_name.contains("tmp-import") || file_name.contains("replace-backup")
            }));
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(external);
    }

    #[test]
    fn replacement_import_invalidation_survives_restart() {
        let root = test_root();
        let external = test_root();
        fs::create_dir_all(root.join(metadata::METADATA_DIRECTORY))
            .expect("metadata folder should be created");
        fs::create_dir_all(&external).expect("source folder should be created");
        fs::write(root.join("Novel.epub"), b"old").expect("existing EPUB should exist");
        let source = external.join("Novel.epub");
        fs::write(&source, b"replacement").expect("incoming EPUB should exist");
        let mut cache = metadata::ScannerCache::default();
        for relative_path in ["Novel.epub", "Stable.epub"] {
            cache.entries.insert(
                relative_path.to_string(),
                metadata::ScannerCacheEntry {
                    size: 4,
                    modified_at: 4,
                    source_metadata: None,
                    metadata_error: None,
                },
            );
        }
        metadata::save_scanner_cache_at(&root, &cache).expect("scanner cache should be saved");

        scanner_cache::force_cache_save_failure(&root, true);
        let result = add_epub_files_to_archive_at(
            &root,
            vec![source.to_string_lossy().into_owned()],
            None,
            ArchiveImportConflictAction::Replace,
            ArchiveImportMode::Copy,
        )
        .expect("replacement import should remain authoritative");
        assert!(result.cache_warning.is_some());
        scanner_cache::force_cache_save_failure(&root, false);
        scanner_cache::simulate_restart(&root);

        let restarted = scanner_cache::load_snapshot(&root);
        assert!(!restarted
            .snapshot
            .cache()
            .entries
            .contains_key("Novel.epub"));
        assert!(restarted
            .snapshot
            .cache()
            .entries
            .contains_key("Stable.epub"));
        assert_eq!(fs::read(root.join("Novel.epub")).unwrap(), b"replacement");
        fs::remove_dir_all(root).expect("archive should be removed");
        fs::remove_dir_all(external).expect("source folder should be removed");
    }

    #[test]
    fn rejects_reserved_destinations_and_sources_inside_the_archive() {
        let root = test_root();
        fs::create_dir_all(root.join(".archeion")).expect("metadata should be created");
        fs::write(root.join("Inside.epub"), b"inside").expect("inside EPUB should exist");

        assert!(add_epub_files_to_archive_at(
            &root,
            vec![root.join("Inside.epub").to_string_lossy().into_owned()],
            Some(".archeion".to_string()),
            ArchiveImportConflictAction::KeepBoth,
            ArchiveImportMode::Copy,
        )
        .is_err());

        let results = add_epub_files_to_archive_at(
            &root,
            vec![root.join("Inside.epub").to_string_lossy().into_owned()],
            None,
            ArchiveImportConflictAction::KeepBoth,
            ArchiveImportMode::Copy,
        )
        .expect("import should return per-file result")
        .results;
        assert_eq!(results[0].status, ArchiveImportStatus::Failed);
        assert_eq!(
            results[0].message.as_deref(),
            Some("Choose EPUB files outside the active archive.")
        );
        let _ = fs::remove_dir_all(root);
    }

    struct FailingSourceCleanupFileSystem {
        source: std::path::PathBuf,
    }

    impl ImportFileSystem for FailingSourceCleanupFileSystem {
        fn copy(
            &self,
            source: &std::path::Path,
            destination: &std::path::Path,
        ) -> Result<u64, String> {
            fs::copy(source, destination).map_err(|error| error.to_string())
        }

        fn rename(
            &self,
            source: &std::path::Path,
            destination: &std::path::Path,
        ) -> Result<(), String> {
            fs::rename(source, destination).map_err(|error| error.to_string())
        }

        fn remove_file(&self, path: &std::path::Path) -> Result<(), String> {
            if path == self.source {
                return Err("simulated source cleanup failure".to_string());
            }
            fs::remove_file(path).map_err(|error| error.to_string())
        }
    }

    #[test]
    fn move_import_remains_imported_when_external_source_cleanup_fails() {
        let root = test_root();
        let external = test_root();
        fs::create_dir_all(&root).expect("archive should be created");
        fs::create_dir_all(&external).expect("source folder should be created");
        let source = external.join("Novel.epub");
        let destination = root.join("Novel.epub");
        fs::write(&source, b"incoming").expect("source EPUB should exist");
        let outcome = copy_or_move_epub_with_fs(
            &source,
            &destination,
            ArchiveImportMode::Move,
            false,
            &FailingSourceCleanupFileSystem {
                source: source.clone(),
            },
        )
        .expect("destination commit should remain authoritative");

        assert_eq!(fs::read(&destination).unwrap(), b"incoming");
        assert!(source.is_file());
        assert!(outcome
            .source_cleanup_warning
            .as_deref()
            .is_some_and(|warning| warning.contains("original source could not be removed")));
        fs::remove_dir_all(root).expect("archive should be removed");
        fs::remove_dir_all(external).expect("source folder should be removed");
    }

    fn same_name_sources() -> (std::path::PathBuf, std::path::PathBuf, std::path::PathBuf) {
        let first_root = test_root();
        let second_root = test_root();
        fs::create_dir_all(&first_root).expect("first source folder should exist");
        fs::create_dir_all(&second_root).expect("second source folder should exist");
        let first = first_root.join("Novel.epub");
        let second = second_root.join("Novel.epub");
        fs::write(&first, b"first").expect("first source should exist");
        fs::write(&second, b"second").expect("second source should exist");
        (first_root, first, second)
    }

    #[test]
    fn replace_preflight_rejects_later_duplicate_destination_before_mutation() {
        let root = test_root();
        fs::create_dir_all(&root).expect("archive should exist");
        fs::write(root.join("Novel.epub"), b"existing").expect("destination should exist");
        let (first_root, first, second) = same_name_sources();
        let second_root = second.parent().unwrap().to_path_buf();

        let result = add_epub_files_to_archive_at(
            &root,
            vec![
                first.to_string_lossy().into_owned(),
                second.to_string_lossy().into_owned(),
            ],
            None,
            ArchiveImportConflictAction::Replace,
            ArchiveImportMode::Copy,
        )
        .expect("batch should return outcomes");

        assert_eq!(result.results[0].status, ArchiveImportStatus::Imported);
        assert!(result.results[0].replaced_existing);
        assert_eq!(result.results[1].status, ArchiveImportStatus::Failed);
        assert_eq!(fs::read(root.join("Novel.epub")).unwrap(), b"first");
        fs::remove_dir_all(root).expect("archive should be removed");
        fs::remove_dir_all(first_root).expect("first source folder should be removed");
        fs::remove_dir_all(second_root).expect("second source folder should be removed");
    }

    #[test]
    fn replace_preflight_treats_case_only_batch_destinations_as_duplicates() {
        let root = test_root();
        let first_root = test_root();
        let second_root = test_root();
        fs::create_dir_all(&root).expect("archive should exist");
        fs::create_dir_all(&first_root).expect("first source folder should exist");
        fs::create_dir_all(&second_root).expect("second source folder should exist");
        let first = first_root.join("Novel.epub");
        let second = second_root.join("novel.epub");
        fs::write(&first, b"first").expect("first source should exist");
        fs::write(&second, b"second").expect("second source should exist");

        let result = add_epub_files_to_archive_at(
            &root,
            vec![
                first.to_string_lossy().into_owned(),
                second.to_string_lossy().into_owned(),
            ],
            None,
            ArchiveImportConflictAction::Replace,
            ArchiveImportMode::Copy,
        )
        .expect("batch should return outcomes");

        assert_eq!(result.results[0].status, ArchiveImportStatus::Imported);
        assert_eq!(result.results[1].status, ArchiveImportStatus::Failed);
        assert_eq!(fs::read(root.join("Novel.epub")).unwrap(), b"first");
        fs::remove_dir_all(root).expect("archive should be removed");
        fs::remove_dir_all(first_root).expect("first source folder should be removed");
        fs::remove_dir_all(second_root).expect("second source folder should be removed");
    }

    #[test]
    fn keep_both_preflight_reserves_unique_batch_destinations() {
        let root = test_root();
        fs::create_dir_all(&root).expect("archive should exist");
        fs::write(root.join("Novel.epub"), b"existing").expect("destination should exist");
        let (first_root, first, second) = same_name_sources();
        let second_root = second.parent().unwrap().to_path_buf();

        let result = add_epub_files_to_archive_at(
            &root,
            vec![
                first.to_string_lossy().into_owned(),
                second.to_string_lossy().into_owned(),
            ],
            None,
            ArchiveImportConflictAction::KeepBoth,
            ArchiveImportMode::Copy,
        )
        .expect("batch should import");

        assert_eq!(
            result.results[0].relative_path.as_deref(),
            Some("Novel (2).epub")
        );
        assert_eq!(
            result.results[1].relative_path.as_deref(),
            Some("Novel (3).epub")
        );
        assert_eq!(fs::read(root.join("Novel (2).epub")).unwrap(), b"first");
        assert_eq!(fs::read(root.join("Novel (3).epub")).unwrap(), b"second");
        fs::remove_dir_all(root).expect("archive should be removed");
        fs::remove_dir_all(first_root).expect("first source folder should be removed");
        fs::remove_dir_all(second_root).expect("second source folder should be removed");
    }

    #[test]
    fn skip_preflight_imports_one_and_skips_later_batch_conflict() {
        let root = test_root();
        fs::create_dir_all(&root).expect("archive should exist");
        let (first_root, first, second) = same_name_sources();
        let second_root = second.parent().unwrap().to_path_buf();

        let result = add_epub_files_to_archive_at(
            &root,
            vec![
                first.to_string_lossy().into_owned(),
                second.to_string_lossy().into_owned(),
            ],
            None,
            ArchiveImportConflictAction::Skip,
            ArchiveImportMode::Copy,
        )
        .expect("batch should return outcomes");

        assert_eq!(result.results[0].status, ArchiveImportStatus::Imported);
        assert_eq!(result.results[1].status, ArchiveImportStatus::Skipped);
        assert_eq!(fs::read(root.join("Novel.epub")).unwrap(), b"first");
        fs::remove_dir_all(root).expect("archive should be removed");
        fs::remove_dir_all(first_root).expect("first source folder should be removed");
        fs::remove_dir_all(second_root).expect("second source folder should be removed");
    }

    struct FailingBackupCleanupFileSystem;

    impl ImportFileSystem for FailingBackupCleanupFileSystem {
        fn copy(&self, source: &Path, destination: &Path) -> Result<u64, String> {
            fs::copy(source, destination).map_err(|error| error.to_string())
        }

        fn rename(&self, source: &Path, destination: &Path) -> Result<(), String> {
            fs::rename(source, destination).map_err(|error| error.to_string())
        }

        fn remove_file(&self, path: &Path) -> Result<(), String> {
            if path
                .file_name()
                .and_then(|name| name.to_str())
                .is_some_and(|name| name.contains(".replace-backup-"))
            {
                return Err("simulated replacement backup cleanup failure".to_string());
            }
            fs::remove_file(path).map_err(|error| error.to_string())
        }
    }

    #[test]
    fn metadata_repair_removes_a_replacement_backup_left_after_commit() {
        let root = test_root();
        let external = test_root();
        fs::create_dir_all(&root).unwrap();
        fs::create_dir_all(&external).unwrap();
        let destination = root.join("Novel.epub");
        let source = external.join("Novel.epub");
        fs::write(&destination, b"existing").unwrap();
        fs::write(&source, b"replacement").unwrap();

        let outcome = copy_or_move_epub_with_fs(
            &source,
            &destination,
            ArchiveImportMode::Copy,
            true,
            &FailingBackupCleanupFileSystem,
        )
        .unwrap();
        assert!(outcome.maintenance_warning.is_some());
        assert_eq!(fs::read(&destination).unwrap(), b"replacement");
        assert!(root
            .read_dir()
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".replace-backup-")
            }));

        let restarted_state = ArchiveImportTransactionState::default();
        let cleanup = cleanup_archive_import_artifacts_at(&root, &restarted_state).unwrap();
        assert_eq!(cleanup.removed_count, 1);
        assert!(cleanup.failures.is_empty());
        assert!(!root
            .read_dir()
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".replace-backup-")
            }));

        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(external).unwrap();
    }

    struct BlockingCopyFileSystem {
        copy_started: mpsc::Sender<()>,
        release_copy: Mutex<mpsc::Receiver<()>>,
    }

    impl ImportFileSystem for BlockingCopyFileSystem {
        fn copy(&self, source: &Path, destination: &Path) -> Result<u64, String> {
            self.copy_started.send(()).unwrap();
            self.release_copy.lock().unwrap().recv().unwrap();
            fs::copy(source, destination).map_err(|error| error.to_string())
        }

        fn rename(&self, source: &Path, destination: &Path) -> Result<(), String> {
            fs::rename(source, destination).map_err(|error| error.to_string())
        }

        fn remove_file(&self, path: &Path) -> Result<(), String> {
            fs::remove_file(path).map_err(|error| error.to_string())
        }
    }

    struct RecordingCopyFileSystem {
        copy_started: mpsc::Sender<()>,
    }

    impl ImportFileSystem for RecordingCopyFileSystem {
        fn copy(&self, source: &Path, destination: &Path) -> Result<u64, String> {
            self.copy_started.send(()).unwrap();
            fs::copy(source, destination).map_err(|error| error.to_string())
        }

        fn rename(&self, source: &Path, destination: &Path) -> Result<(), String> {
            fs::rename(source, destination).map_err(|error| error.to_string())
        }

        fn remove_file(&self, path: &Path) -> Result<(), String> {
            fs::remove_file(path).map_err(|error| error.to_string())
        }
    }

    struct FailingCopyFileSystem;

    impl ImportFileSystem for FailingCopyFileSystem {
        fn copy(&self, _source: &Path, _destination: &Path) -> Result<u64, String> {
            Err("simulated copy failure".to_string())
        }

        fn rename(&self, source: &Path, destination: &Path) -> Result<(), String> {
            fs::rename(source, destination).map_err(|error| error.to_string())
        }

        fn remove_file(&self, path: &Path) -> Result<(), String> {
            fs::remove_file(path).map_err(|error| error.to_string())
        }
    }

    struct SuppressionCheckingFileSystem {
        owner: ArchiveWatcherSuppressionOwner,
        root: PathBuf,
        relative_path: String,
    }

    impl ImportFileSystem for SuppressionCheckingFileSystem {
        fn copy(&self, source: &Path, destination: &Path) -> Result<u64, String> {
            assert!(self.owner.is_suppressed(&self.root, &self.relative_path));
            assert!(self.owner.record_test_event(
                &self.root,
                "create",
                std::slice::from_ref(&self.relative_path),
            ));
            fs::copy(source, destination).map_err(|error| error.to_string())
        }

        fn rename(&self, source: &Path, destination: &Path) -> Result<(), String> {
            fs::rename(source, destination).map_err(|error| error.to_string())
        }

        fn remove_file(&self, path: &Path) -> Result<(), String> {
            fs::remove_file(path).map_err(|error| error.to_string())
        }
    }

    struct FailingSuppressionCheckingFileSystem {
        owner: ArchiveWatcherSuppressionOwner,
        root: PathBuf,
        relative_path: String,
    }

    impl ImportFileSystem for FailingSuppressionCheckingFileSystem {
        fn copy(&self, _source: &Path, _destination: &Path) -> Result<u64, String> {
            assert!(self
                .owner
                .is_actively_suppressed(&self.root, &self.relative_path));
            Err("simulated copy failure".to_string())
        }

        fn rename(&self, source: &Path, destination: &Path) -> Result<(), String> {
            fs::rename(source, destination).map_err(|error| error.to_string())
        }

        fn remove_file(&self, path: &Path) -> Result<(), String> {
            fs::remove_file(path).map_err(|error| error.to_string())
        }
    }

    fn source_file(folder: &Path, file_name: &str, bytes: &[u8]) -> PathBuf {
        fs::create_dir_all(folder).unwrap();
        let source = folder.join(file_name);
        fs::write(&source, bytes).unwrap();
        source
    }

    #[test]
    fn concurrent_keep_both_commands_plan_against_the_latest_archive_state() {
        let root = test_root();
        let first_source_root = test_root();
        let second_source_root = test_root();
        fs::create_dir_all(&root).unwrap();
        let first_source = source_file(&first_source_root, "Novel.epub", b"first");
        let second_source = source_file(&second_source_root, "Novel.epub", b"second");
        let state = ArchiveImportTransactionState::default();
        let (first_started_tx, first_started_rx) = mpsc::channel();
        let (release_first_tx, release_first_rx) = mpsc::channel();
        let first_fs = Arc::new(BlockingCopyFileSystem {
            copy_started: first_started_tx,
            release_copy: Mutex::new(release_first_rx),
        });
        let (second_started_tx, second_started_rx) = mpsc::channel();
        let second_fs = Arc::new(RecordingCopyFileSystem {
            copy_started: second_started_tx,
        });

        let first_root = root.clone();
        let first_state = state.clone();
        let first = thread::spawn(move || {
            add_epub_files_to_archive_at_with_context(
                &first_root,
                vec![first_source.to_string_lossy().into_owned()],
                None,
                ArchiveImportConflictAction::KeepBoth,
                ArchiveImportMode::Copy,
                ArchiveImportExecution {
                    transaction_state: &first_state,
                    watcher_suppressions: None,
                    file_system: first_fs.as_ref(),
                },
            )
            .unwrap()
        });
        first_started_rx.recv().unwrap();

        let second_root = root.clone();
        let second_state = state.clone();
        let second = thread::spawn(move || {
            add_epub_files_to_archive_at_with_context(
                &second_root,
                vec![second_source.to_string_lossy().into_owned()],
                None,
                ArchiveImportConflictAction::KeepBoth,
                ArchiveImportMode::Copy,
                ArchiveImportExecution {
                    transaction_state: &second_state,
                    watcher_suppressions: None,
                    file_system: second_fs.as_ref(),
                },
            )
            .unwrap()
        });

        assert!(second_started_rx
            .recv_timeout(Duration::from_millis(50))
            .is_err());
        release_first_tx.send(()).unwrap();
        let first_result = first.join().unwrap();
        second_started_rx
            .recv_timeout(Duration::from_secs(1))
            .unwrap();
        let second_result = second.join().unwrap();

        assert_eq!(
            first_result.results[0].relative_path.as_deref(),
            Some("Novel.epub")
        );
        assert_eq!(
            second_result.results[0].relative_path.as_deref(),
            Some("Novel (2).epub")
        );
        assert_eq!(fs::read(root.join("Novel.epub")).unwrap(), b"first");
        assert_eq!(fs::read(root.join("Novel (2).epub")).unwrap(), b"second");
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(first_source_root).unwrap();
        fs::remove_dir_all(second_source_root).unwrap();
    }

    #[test]
    fn concurrent_replace_commands_serialize_and_report_the_actual_replacement_state() {
        let root = test_root();
        let first_source_root = test_root();
        let second_source_root = test_root();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("Novel.epub"), b"original").unwrap();
        let first_source = source_file(&first_source_root, "Novel.epub", b"first");
        let second_source = source_file(&second_source_root, "Novel.epub", b"second");
        let state = ArchiveImportTransactionState::default();
        let (first_started_tx, first_started_rx) = mpsc::channel();
        let (release_first_tx, release_first_rx) = mpsc::channel();
        let first_fs = Arc::new(BlockingCopyFileSystem {
            copy_started: first_started_tx,
            release_copy: Mutex::new(release_first_rx),
        });
        let (second_started_tx, second_started_rx) = mpsc::channel();
        let second_fs = Arc::new(RecordingCopyFileSystem {
            copy_started: second_started_tx,
        });

        let first_root = root.clone();
        let first_state = state.clone();
        let first = thread::spawn(move || {
            add_epub_files_to_archive_at_with_context(
                &first_root,
                vec![first_source.to_string_lossy().into_owned()],
                None,
                ArchiveImportConflictAction::Replace,
                ArchiveImportMode::Copy,
                ArchiveImportExecution {
                    transaction_state: &first_state,
                    watcher_suppressions: None,
                    file_system: first_fs.as_ref(),
                },
            )
            .unwrap()
        });
        first_started_rx.recv().unwrap();

        let second_root = root.clone();
        let second_state = state.clone();
        let second = thread::spawn(move || {
            add_epub_files_to_archive_at_with_context(
                &second_root,
                vec![second_source.to_string_lossy().into_owned()],
                None,
                ArchiveImportConflictAction::Replace,
                ArchiveImportMode::Copy,
                ArchiveImportExecution {
                    transaction_state: &second_state,
                    watcher_suppressions: None,
                    file_system: second_fs.as_ref(),
                },
            )
            .unwrap()
        });

        assert!(second_started_rx
            .recv_timeout(Duration::from_millis(50))
            .is_err());
        release_first_tx.send(()).unwrap();
        let first_result = first.join().unwrap();
        second_started_rx
            .recv_timeout(Duration::from_secs(1))
            .unwrap();
        let second_result = second.join().unwrap();

        assert_eq!(
            first_result.results[0].status,
            ArchiveImportStatus::Imported
        );
        assert!(first_result.results[0].replaced_existing);
        assert_eq!(
            second_result.results[0].status,
            ArchiveImportStatus::Imported
        );
        assert!(second_result.results[0].replaced_existing);
        assert_eq!(fs::read(root.join("Novel.epub")).unwrap(), b"second");
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(first_source_root).unwrap();
        fs::remove_dir_all(second_source_root).unwrap();
    }

    #[test]
    fn concurrent_skip_commands_plan_against_the_prior_commit() {
        let root = test_root();
        let first_source_root = test_root();
        let second_source_root = test_root();
        fs::create_dir_all(&root).unwrap();
        let first_source = source_file(&first_source_root, "Novel.epub", b"first");
        let second_source = source_file(&second_source_root, "Novel.epub", b"second");
        let state = ArchiveImportTransactionState::default();
        let (first_started_tx, first_started_rx) = mpsc::channel();
        let (release_first_tx, release_first_rx) = mpsc::channel();
        let first_fs = Arc::new(BlockingCopyFileSystem {
            copy_started: first_started_tx,
            release_copy: Mutex::new(release_first_rx),
        });
        let (second_started_tx, second_started_rx) = mpsc::channel();
        let second_fs = Arc::new(RecordingCopyFileSystem {
            copy_started: second_started_tx,
        });

        let first_root = root.clone();
        let first_state = state.clone();
        let first = thread::spawn(move || {
            add_epub_files_to_archive_at_with_context(
                &first_root,
                vec![first_source.to_string_lossy().into_owned()],
                None,
                ArchiveImportConflictAction::Skip,
                ArchiveImportMode::Copy,
                ArchiveImportExecution {
                    transaction_state: &first_state,
                    watcher_suppressions: None,
                    file_system: first_fs.as_ref(),
                },
            )
            .unwrap()
        });
        first_started_rx.recv().unwrap();

        let second_root = root.clone();
        let second_state = state.clone();
        let second = thread::spawn(move || {
            add_epub_files_to_archive_at_with_context(
                &second_root,
                vec![second_source.to_string_lossy().into_owned()],
                None,
                ArchiveImportConflictAction::Skip,
                ArchiveImportMode::Copy,
                ArchiveImportExecution {
                    transaction_state: &second_state,
                    watcher_suppressions: None,
                    file_system: second_fs.as_ref(),
                },
            )
            .unwrap()
        });

        assert!(second_started_rx
            .recv_timeout(Duration::from_millis(50))
            .is_err());
        release_first_tx.send(()).unwrap();
        let first_result = first.join().unwrap();
        let second_result = second.join().unwrap();

        assert_eq!(
            first_result.results[0].status,
            ArchiveImportStatus::Imported
        );
        assert_eq!(
            second_result.results[0].status,
            ArchiveImportStatus::Skipped
        );
        assert!(second_started_rx.try_recv().is_err());
        assert_eq!(fs::read(root.join("Novel.epub")).unwrap(), b"first");
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(first_source_root).unwrap();
        fs::remove_dir_all(second_source_root).unwrap();
    }

    #[test]
    fn concurrent_replace_and_skip_commands_observe_the_prior_commit() {
        let root = test_root();
        let first_source_root = test_root();
        let second_source_root = test_root();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("Novel.epub"), b"existing").unwrap();
        let first_source = source_file(&first_source_root, "Novel.epub", b"first");
        let second_source = source_file(&second_source_root, "Novel.epub", b"second");
        let state = ArchiveImportTransactionState::default();
        let (first_started_tx, first_started_rx) = mpsc::channel();
        let (release_first_tx, release_first_rx) = mpsc::channel();
        let first_fs = Arc::new(BlockingCopyFileSystem {
            copy_started: first_started_tx,
            release_copy: Mutex::new(release_first_rx),
        });
        let (second_started_tx, second_started_rx) = mpsc::channel();
        let second_fs = Arc::new(RecordingCopyFileSystem {
            copy_started: second_started_tx,
        });

        let first_root = root.clone();
        let first_state = state.clone();
        let first = thread::spawn(move || {
            add_epub_files_to_archive_at_with_context(
                &first_root,
                vec![first_source.to_string_lossy().into_owned()],
                None,
                ArchiveImportConflictAction::Replace,
                ArchiveImportMode::Copy,
                ArchiveImportExecution {
                    transaction_state: &first_state,
                    watcher_suppressions: None,
                    file_system: first_fs.as_ref(),
                },
            )
            .unwrap()
        });
        first_started_rx.recv().unwrap();

        let second_root = root.clone();
        let second_state = state.clone();
        let second = thread::spawn(move || {
            add_epub_files_to_archive_at_with_context(
                &second_root,
                vec![second_source.to_string_lossy().into_owned()],
                None,
                ArchiveImportConflictAction::Skip,
                ArchiveImportMode::Copy,
                ArchiveImportExecution {
                    transaction_state: &second_state,
                    watcher_suppressions: None,
                    file_system: second_fs.as_ref(),
                },
            )
            .unwrap()
        });
        assert!(second_started_rx
            .recv_timeout(Duration::from_millis(50))
            .is_err());
        release_first_tx.send(()).unwrap();

        let first_result = first.join().unwrap();
        let second_result = second.join().unwrap();
        assert!(first_result.results[0].replaced_existing);
        assert_eq!(
            second_result.results[0].status,
            ArchiveImportStatus::Skipped
        );
        assert!(second_started_rx.try_recv().is_err());
        assert_eq!(fs::read(root.join("Novel.epub")).unwrap(), b"first");
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(first_source_root).unwrap();
        fs::remove_dir_all(second_source_root).unwrap();
    }

    #[test]
    fn concurrent_case_only_replace_targets_use_the_actual_committed_path() {
        let root = test_root();
        let first_source_root = test_root();
        let second_source_root = test_root();
        fs::create_dir_all(&root).unwrap();
        let first_source = source_file(&first_source_root, "Novel.epub", b"first");
        let second_source = source_file(&second_source_root, "novel.epub", b"second");
        let state = ArchiveImportTransactionState::default();

        let first = add_epub_files_to_archive_at_with_context(
            &root,
            vec![first_source.to_string_lossy().into_owned()],
            None,
            ArchiveImportConflictAction::Replace,
            ArchiveImportMode::Copy,
            ArchiveImportExecution {
                transaction_state: &state,
                watcher_suppressions: None,
                file_system: &RealImportFileSystem,
            },
        )
        .unwrap();
        let second = add_epub_files_to_archive_at_with_context(
            &root,
            vec![second_source.to_string_lossy().into_owned()],
            None,
            ArchiveImportConflictAction::Replace,
            ArchiveImportMode::Copy,
            ArchiveImportExecution {
                transaction_state: &state,
                watcher_suppressions: None,
                file_system: &RealImportFileSystem,
            },
        )
        .unwrap();

        assert!(!first.results[0].replaced_existing);
        assert!(second.results[0].replaced_existing);
        assert_eq!(
            second.results[0].relative_path.as_deref(),
            Some("Novel.epub")
        );
        assert_eq!(fs::read(root.join("Novel.epub")).unwrap(), b"second");
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(first_source_root).unwrap();
        fs::remove_dir_all(second_source_root).unwrap();
    }

    #[test]
    fn a_later_failed_import_does_not_change_the_prior_committed_file() {
        let root = test_root();
        let first_source_root = test_root();
        let second_source_root = test_root();
        fs::create_dir_all(&root).unwrap();
        let first_source = source_file(&first_source_root, "Novel.epub", b"first");
        let second_source = source_file(&second_source_root, "Novel.epub", b"second");
        let state = ArchiveImportTransactionState::default();

        let first = add_epub_files_to_archive_at_with_context(
            &root,
            vec![first_source.to_string_lossy().into_owned()],
            None,
            ArchiveImportConflictAction::Replace,
            ArchiveImportMode::Copy,
            ArchiveImportExecution {
                transaction_state: &state,
                watcher_suppressions: None,
                file_system: &RealImportFileSystem,
            },
        )
        .unwrap();
        let second = add_epub_files_to_archive_at_with_context(
            &root,
            vec![second_source.to_string_lossy().into_owned()],
            None,
            ArchiveImportConflictAction::Replace,
            ArchiveImportMode::Copy,
            ArchiveImportExecution {
                transaction_state: &state,
                watcher_suppressions: None,
                file_system: &FailingCopyFileSystem,
            },
        )
        .unwrap();

        assert_eq!(first.results[0].status, ArchiveImportStatus::Imported);
        assert_eq!(second.results[0].status, ArchiveImportStatus::Failed);
        assert_eq!(fs::read(root.join("Novel.epub")).unwrap(), b"first");
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(first_source_root).unwrap();
        fs::remove_dir_all(second_source_root).unwrap();
    }

    #[test]
    fn imports_into_different_archives_are_not_globally_serialized() {
        let first_root = test_root();
        let second_root = test_root();
        let first_source_root = test_root();
        let second_source_root = test_root();
        fs::create_dir_all(&first_root).unwrap();
        fs::create_dir_all(&second_root).unwrap();
        let first_source = source_file(&first_source_root, "First.epub", b"first");
        let second_source = source_file(&second_source_root, "Second.epub", b"second");
        let state = ArchiveImportTransactionState::default();
        let (first_started_tx, first_started_rx) = mpsc::channel();
        let (second_started_tx, second_started_rx) = mpsc::channel();
        let (release_first_tx, release_first_rx) = mpsc::channel();
        let (release_second_tx, release_second_rx) = mpsc::channel();

        let first_state = state.clone();
        let first_fs = Arc::new(BlockingCopyFileSystem {
            copy_started: first_started_tx,
            release_copy: Mutex::new(release_first_rx),
        });
        let first_archive = first_root.clone();
        let first = thread::spawn(move || {
            add_epub_files_to_archive_at_with_context(
                &first_archive,
                vec![first_source.to_string_lossy().into_owned()],
                None,
                ArchiveImportConflictAction::KeepBoth,
                ArchiveImportMode::Copy,
                ArchiveImportExecution {
                    transaction_state: &first_state,
                    watcher_suppressions: None,
                    file_system: first_fs.as_ref(),
                },
            )
            .unwrap()
        });
        let second_state = state.clone();
        let second_fs = Arc::new(BlockingCopyFileSystem {
            copy_started: second_started_tx,
            release_copy: Mutex::new(release_second_rx),
        });
        let second_archive = second_root.clone();
        let second = thread::spawn(move || {
            add_epub_files_to_archive_at_with_context(
                &second_archive,
                vec![second_source.to_string_lossy().into_owned()],
                None,
                ArchiveImportConflictAction::KeepBoth,
                ArchiveImportMode::Copy,
                ArchiveImportExecution {
                    transaction_state: &second_state,
                    watcher_suppressions: None,
                    file_system: second_fs.as_ref(),
                },
            )
            .unwrap()
        });

        first_started_rx
            .recv_timeout(Duration::from_secs(1))
            .unwrap();
        second_started_rx
            .recv_timeout(Duration::from_secs(1))
            .unwrap();
        release_first_tx.send(()).unwrap();
        release_second_tx.send(()).unwrap();
        assert_eq!(
            first.join().unwrap().results[0].status,
            ArchiveImportStatus::Imported
        );
        assert_eq!(
            second.join().unwrap().results[0].status,
            ArchiveImportStatus::Imported
        );
        assert_eq!(fs::read(first_root.join("First.epub")).unwrap(), b"first");
        assert_eq!(
            fs::read(second_root.join("Second.epub")).unwrap(),
            b"second"
        );
        fs::remove_dir_all(first_root).unwrap();
        fs::remove_dir_all(second_root).unwrap();
        fs::remove_dir_all(first_source_root).unwrap();
        fs::remove_dir_all(second_source_root).unwrap();
    }

    #[test]
    fn failed_planned_import_releases_active_suppression_and_retains_only_the_tail() {
        let root = test_root();
        let source_root = test_root();
        fs::create_dir_all(&root).unwrap();
        let source = source_file(&source_root, "Novel.epub", b"incoming");
        let transaction_state = ArchiveImportTransactionState::default();
        let suppression_owner = ArchiveWatcherSuppressionOwner::default();
        let canonical_root = fs::canonicalize(&root).unwrap();
        let file_system = FailingSuppressionCheckingFileSystem {
            owner: suppression_owner.clone(),
            root: canonical_root.clone(),
            relative_path: "Novel.epub".to_string(),
        };

        let result = add_epub_files_to_archive_at_with_context(
            &root,
            vec![source.to_string_lossy().into_owned()],
            None,
            ArchiveImportConflictAction::KeepBoth,
            ArchiveImportMode::Copy,
            ArchiveImportExecution {
                transaction_state: &transaction_state,
                watcher_suppressions: Some(&suppression_owner),
                file_system: &file_system,
            },
        )
        .unwrap();

        assert_eq!(result.results[0].status, ArchiveImportStatus::Failed);
        assert!(!suppression_owner.is_actively_suppressed(&canonical_root, "Novel.epub"));
        assert!(suppression_owner.is_suppressed(&canonical_root, "Novel.epub"));
        assert!(!root.join("Novel.epub").exists());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(source_root).unwrap();
    }

    #[test]
    fn generated_keep_both_path_is_suppressed_before_temporary_copy() {
        let root = test_root();
        let source_root = test_root();
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("Novel.epub"), b"existing").unwrap();
        let source = source_file(&source_root, "Novel.epub", b"incoming");
        let transaction_state = ArchiveImportTransactionState::default();
        let suppression_owner = ArchiveWatcherSuppressionOwner::default();
        let canonical_root = fs::canonicalize(&root).unwrap();
        let file_system = SuppressionCheckingFileSystem {
            owner: suppression_owner.clone(),
            root: canonical_root,
            relative_path: "Novel (2).epub".to_string(),
        };

        let result = add_epub_files_to_archive_at_with_context(
            &root,
            vec![source.to_string_lossy().into_owned()],
            None,
            ArchiveImportConflictAction::KeepBoth,
            ArchiveImportMode::Copy,
            ArchiveImportExecution {
                transaction_state: &transaction_state,
                watcher_suppressions: Some(&suppression_owner),
                file_system: &file_system,
            },
        )
        .unwrap();

        assert_eq!(
            result.results[0].relative_path.as_deref(),
            Some("Novel (2).epub")
        );
        assert_eq!(result.folded_watcher_changes.len(), 1);
        assert_eq!(result.folded_watcher_changes[0].kind, "create");
        assert_eq!(
            result.folded_watcher_changes[0].relative_paths,
            ["Novel (2).epub"]
        );
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(source_root).unwrap();
    }
}
