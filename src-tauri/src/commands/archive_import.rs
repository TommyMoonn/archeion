use std::{
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use super::{archive_root, filesystem};

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
    message: Option<String>,
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
        message: Some(message.into()),
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
        message: Some(message.into()),
    }
}

fn import_imported(
    source_path: &str,
    file_name: impl Into<String>,
    relative_path: impl Into<String>,
) -> ArchiveImportResult {
    ArchiveImportResult {
        status: ArchiveImportStatus::Imported,
        source_path: source_path.to_string(),
        file_name: file_name.into(),
        relative_path: Some(relative_path.into()),
        message: None,
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

fn destination_for_conflict(
    destination_folder: &Path,
    destination_folder_path: &str,
    file_name: &str,
    conflict_action: ArchiveImportConflictAction,
) -> Result<Option<(PathBuf, String, String, bool)>, String> {
    filesystem::validate_epub_file_name(file_name)?;
    let destination = destination_folder.join(file_name);
    let relative_path = archive_join(destination_folder_path, file_name);

    if !destination.exists() {
        return Ok(Some((
            destination,
            file_name.to_string(),
            relative_path,
            false,
        )));
    }

    match conflict_action {
        ArchiveImportConflictAction::Skip => Ok(None),
        ArchiveImportConflictAction::Replace => {
            if !destination.is_file() {
                return Err("A folder with this name already exists.".to_string());
            }

            Ok(Some((
                destination,
                file_name.to_string(),
                relative_path,
                true,
            )))
        }
        ArchiveImportConflictAction::KeepBoth => {
            let (stem, extension) = split_epub_file_name(file_name);
            for index in 2..10_000 {
                let candidate_name = format!("{stem} ({index}){extension}");
                let candidate = destination_folder.join(&candidate_name);

                if !candidate.exists() {
                    let relative_path = archive_join(destination_folder_path, &candidate_name);
                    return Ok(Some((candidate, candidate_name, relative_path, false)));
                }
            }

            Err("No available filename could be found.".to_string())
        }
    }
}

trait ImportFileSystem {
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
    fs_ops: &impl ImportFileSystem,
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
    fs_ops: &impl ImportFileSystem,
    backup: &Path,
    destination: &Path,
) -> Result<(), String> {
    fs_ops.rename(backup, destination).map_err(|restore_error| {
        format!("The import failed and the original EPUB could not be restored: {restore_error}")
    })
}

fn copy_or_move_epub_with_fs(
    source: &Path,
    destination: &Path,
    mode: ArchiveImportMode,
    replace_existing: bool,
    fs_ops: &impl ImportFileSystem,
) -> Result<(), String> {
    let expected_size = fs::metadata(source)
        .map_err(|error| error.to_string())?
        .len();
    let temporary_path = transaction_path(destination, "tmp-import")?;
    let backup_path = transaction_path(destination, "replace-backup")?;

    let import_result = (|| -> Result<(), String> {
        copy_source_to_temp(fs_ops, source, &temporary_path, expected_size)?;

        if replace_existing {
            fs_ops.rename(destination, &backup_path)?;
            if let Err(rename_error) = fs_ops.rename(&temporary_path, destination) {
                restore_import_backup(fs_ops, &backup_path, destination)?;
                return Err(format!(
                    "The replacement EPUB could not be placed in the archive: {rename_error}"
                ));
            }
            fs_ops.remove_file(&backup_path)?;
        } else {
            fs_ops.rename(&temporary_path, destination)?;
        }

        if mode == ArchiveImportMode::Move {
            fs_ops.remove_file(source)?;
        }

        Ok(())
    })();

    if import_result.is_err() {
        let _ = fs_ops.remove_file(&temporary_path);
    }

    import_result
}

fn copy_or_move_epub(
    source: &Path,
    destination: &Path,
    mode: ArchiveImportMode,
    replace_existing: bool,
) -> Result<(), String> {
    copy_or_move_epub_with_fs(
        source,
        destination,
        mode,
        replace_existing,
        &RealImportFileSystem,
    )
}

fn add_epub_files_to_archive_at(
    root: &Path,
    source_paths: Vec<String>,
    destination_folder_path: Option<String>,
    conflict_action: ArchiveImportConflictAction,
    mode: ArchiveImportMode,
) -> Result<Vec<ArchiveImportResult>, String> {
    let canonical_root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let (destination_folder, destination_folder_path) =
        resolve_destination_folder(&canonical_root, destination_folder_path.as_deref())?;
    let mut results = Vec::with_capacity(source_paths.len());

    for source_path in source_paths {
        let source = PathBuf::from(&source_path);
        let file_name = source
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("Selected file")
            .to_string();

        if let Err(message) = filesystem::validate_epub_file_name(&file_name) {
            results.push(import_failed(&source_path, file_name, message));
            continue;
        }

        let source = match fs::canonicalize(&source) {
            Ok(source) => source,
            Err(_) => {
                results.push(import_failed(
                    &source_path,
                    file_name,
                    "The source EPUB is unavailable.",
                ));
                continue;
            }
        };

        if !source.is_file() {
            results.push(import_failed(
                &source_path,
                file_name,
                "The source EPUB is unavailable.",
            ));
            continue;
        }

        if source.starts_with(&canonical_root) {
            results.push(import_failed(
                &source_path,
                file_name,
                "Choose EPUB files outside the active archive.",
            ));
            continue;
        }

        let Some((destination, final_file_name, relative_path, replace_existing)) =
            (match destination_for_conflict(
                &destination_folder,
                &destination_folder_path,
                &file_name,
                conflict_action,
            ) {
                Ok(destination) => destination,
                Err(message) => {
                    results.push(import_failed(&source_path, file_name, message));
                    continue;
                }
            })
        else {
            results.push(import_skipped(
                &source_path,
                file_name,
                "A file with this name already exists.",
            ));
            continue;
        };

        match copy_or_move_epub(&source, &destination, mode, replace_existing) {
            Ok(()) => results.push(import_imported(
                &source_path,
                final_file_name,
                relative_path,
            )),
            Err(message) => results.push(import_failed(&source_path, file_name, message)),
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn add_epub_files_to_archive(
    app: tauri::AppHandle,
    root_path: Option<String>,
    source_paths: Vec<String>,
    destination_folder_path: Option<String>,
    conflict_action: ArchiveImportConflictAction,
    mode: ArchiveImportMode,
) -> Result<Vec<ArchiveImportResult>, String> {
    let root = archive_root::resolve_archive_root(&app, root_path)?;

    tauri::async_runtime::spawn_blocking(move || {
        add_epub_files_to_archive_at(
            &root,
            source_paths,
            destination_folder_path,
            conflict_action,
            mode,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{
        add_epub_files_to_archive_at, copy_or_move_epub_with_fs, ArchiveImportConflictAction,
        ArchiveImportMode, ArchiveImportStatus, ImportFileSystem,
    };

    fn test_root() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-archive-import-{nonce}"))
    }

    struct FailingFinalRenameFileSystem {
        backup_marker: &'static str,
        temp_marker: &'static str,
    }

    impl ImportFileSystem for FailingFinalRenameFileSystem {
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
            let source_name = source
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            let destination_name = destination
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();

            if source_name.contains(self.temp_marker)
                && !destination_name.contains(self.backup_marker)
            {
                return Err("simulated final rename failure".to_string());
            }

            fs::rename(source, destination).map_err(|error| error.to_string())
        }

        fn remove_file(&self, path: &std::path::Path) -> Result<(), String> {
            fs::remove_file(path).map_err(|error| error.to_string())
        }
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
        let fs_ops = FailingFinalRenameFileSystem {
            backup_marker: "replace-backup",
            temp_marker: "tmp-import",
        };

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
        .expect("import should run");

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].status, ArchiveImportStatus::Imported);
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
        .expect("import should run");

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
        .expect("skip import should run");
        assert_eq!(skipped[0].status, ArchiveImportStatus::Skipped);
        assert_eq!(fs::read(root.join("Novel.epub")).unwrap(), b"existing");

        let replaced = add_epub_files_to_archive_at(
            &root,
            vec![source.to_string_lossy().into_owned()],
            None,
            ArchiveImportConflictAction::Replace,
            ArchiveImportMode::Copy,
        )
        .expect("replace import should run");
        assert_eq!(replaced[0].status, ArchiveImportStatus::Imported);
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
        .expect("import should return per-file result");
        assert_eq!(results[0].status, ArchiveImportStatus::Failed);
        assert_eq!(
            results[0].message.as_deref(),
            Some("Choose EPUB files outside the active archive.")
        );
        let _ = fs::remove_dir_all(root);
    }
}
