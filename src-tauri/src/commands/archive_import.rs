use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};

use super::{filesystem, vault};

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

fn copy_or_move_epub(
    source: &Path,
    destination: &Path,
    mode: ArchiveImportMode,
    replace_existing: bool,
) -> Result<(), String> {
    if replace_existing {
        fs::remove_file(destination).map_err(|error| error.to_string())?;
    }

    match mode {
        ArchiveImportMode::Copy => {
            fs::copy(source, destination).map_err(|error| error.to_string())?;
            Ok(())
        }
        ArchiveImportMode::Move => match fs::rename(source, destination) {
            Ok(()) => Ok(()),
            Err(_) => {
                fs::copy(source, destination).map_err(|error| error.to_string())?;
                fs::remove_file(source).map_err(|error| error.to_string())
            }
        },
    }
}

fn add_epub_files_to_vault_at(
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
pub async fn add_epub_files_to_vault(
    app: tauri::AppHandle,
    root_path: Option<String>,
    source_paths: Vec<String>,
    destination_folder_path: Option<String>,
    conflict_action: ArchiveImportConflictAction,
    mode: ArchiveImportMode,
) -> Result<Vec<ArchiveImportResult>, String> {
    let root = vault::resolve_vault_root(&app, root_path)?;

    tauri::async_runtime::spawn_blocking(move || {
        add_epub_files_to_vault_at(
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
        add_epub_files_to_vault_at, ArchiveImportConflictAction, ArchiveImportMode,
        ArchiveImportStatus,
    };

    fn test_root() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-archive-import-{nonce}"))
    }

    #[test]
    fn imports_epubs_into_the_archive() {
        let root = test_root();
        let external = test_root();
        fs::create_dir_all(root.join("Series")).expect("destination should be created");
        fs::create_dir_all(&external).expect("source folder should be created");
        let source = external.join("Novel.epub");
        fs::write(&source, b"epub").expect("source EPUB should be written");

        let results = add_epub_files_to_vault_at(
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

        let results = add_epub_files_to_vault_at(
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

        let skipped = add_epub_files_to_vault_at(
            &root,
            vec![source.to_string_lossy().into_owned()],
            None,
            ArchiveImportConflictAction::Skip,
            ArchiveImportMode::Copy,
        )
        .expect("skip import should run");
        assert_eq!(skipped[0].status, ArchiveImportStatus::Skipped);
        assert_eq!(fs::read(root.join("Novel.epub")).unwrap(), b"existing");

        let replaced = add_epub_files_to_vault_at(
            &root,
            vec![source.to_string_lossy().into_owned()],
            None,
            ArchiveImportConflictAction::Replace,
            ArchiveImportMode::Copy,
        )
        .expect("replace import should run");
        assert_eq!(replaced[0].status, ArchiveImportStatus::Imported);
        assert_eq!(fs::read(root.join("Novel.epub")).unwrap(), b"incoming");
        let _ = fs::remove_dir_all(root);
        let _ = fs::remove_dir_all(external);
    }

    #[test]
    fn rejects_reserved_destinations_and_sources_inside_the_archive() {
        let root = test_root();
        fs::create_dir_all(root.join(".archeion")).expect("metadata should be created");
        fs::write(root.join("Inside.epub"), b"inside").expect("inside EPUB should exist");

        assert!(add_epub_files_to_vault_at(
            &root,
            vec![root.join("Inside.epub").to_string_lossy().into_owned()],
            Some(".archeion".to_string()),
            ArchiveImportConflictAction::KeepBoth,
            ArchiveImportMode::Copy,
        )
        .is_err());

        let results = add_epub_files_to_vault_at(
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
