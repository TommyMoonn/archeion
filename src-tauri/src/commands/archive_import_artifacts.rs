use std::{fs, path::Path};

use serde::Serialize;
use tauri::State;

use super::{archive_import_transaction::ArchiveImportTransactionState, archive_root, metadata};

const TEMP_IMPORT_MARKER: &str = ".tmp-import-";
const REPLACEMENT_BACKUP_MARKER: &str = ".replace-backup-";

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveImportArtifactCleanupFailure {
    relative_path: String,
    message: String,
}

#[derive(Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveImportArtifactCleanupResult {
    pub(crate) removed_count: usize,
    pub(crate) failures: Vec<ArchiveImportArtifactCleanupFailure>,
}

fn valid_import_nonce(value: &str) -> bool {
    let mut parts = value.split('-');
    let Some(timestamp) = parts.next() else {
        return false;
    };
    let Some(process_id) = parts.next() else {
        return false;
    };
    parts.next().is_none()
        && !timestamp.is_empty()
        && timestamp.bytes().all(|byte| byte.is_ascii_digit())
        && !process_id.is_empty()
        && process_id.bytes().all(|byte| byte.is_ascii_digit())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ArchiveImportArtifactKind {
    ReplacementBackup,
    TemporaryImport,
}

#[derive(Debug, Eq, PartialEq)]
struct ParsedArchiveImportArtifact<'a> {
    destination_file_name: &'a str,
    kind: ArchiveImportArtifactKind,
}

fn parse_archive_import_artifact_file_name(
    file_name: &str,
) -> Option<ParsedArchiveImportArtifact<'_>> {
    for (marker, kind) in [
        (
            TEMP_IMPORT_MARKER,
            ArchiveImportArtifactKind::TemporaryImport,
        ),
        (
            REPLACEMENT_BACKUP_MARKER,
            ArchiveImportArtifactKind::ReplacementBackup,
        ),
    ] {
        let Some((base_name, nonce)) = file_name.rsplit_once(marker) else {
            continue;
        };
        if base_name.to_ascii_lowercase().ends_with(".epub") && valid_import_nonce(nonce) {
            return Some(ParsedArchiveImportArtifact {
                destination_file_name: base_name,
                kind,
            });
        }
    }
    None
}

pub(crate) fn is_archive_import_artifact_file_name(file_name: &str) -> bool {
    parse_archive_import_artifact_file_name(file_name).is_some()
}

pub(crate) fn is_archive_import_artifact_relative_path(relative_path: &str) -> bool {
    relative_path
        .rsplit('/')
        .next()
        .is_some_and(is_archive_import_artifact_file_name)
}

pub(crate) fn archive_import_artifact_destination_relative_path(
    relative_path: &str,
) -> Option<String> {
    let (parent, file_name) = relative_path
        .rsplit_once('/')
        .map_or((None, relative_path), |(parent, file_name)| {
            (Some(parent), file_name)
        });
    let artifact = parse_archive_import_artifact_file_name(file_name)?;

    Some(match parent {
        Some(parent) => format!("{parent}/{}", artifact.destination_file_name),
        None => artifact.destination_file_name.to_string(),
    })
}

trait ImportArtifactFileSystem {
    fn remove_file(&self, path: &Path) -> Result<(), String>;
}

struct RealImportArtifactFileSystem;

impl ImportArtifactFileSystem for RealImportArtifactFileSystem {
    fn remove_file(&self, path: &Path) -> Result<(), String> {
        fs::remove_file(path).map_err(|error| error.to_string())
    }
}

fn relative_path(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/")
}

fn record_failure(
    result: &mut ArchiveImportArtifactCleanupResult,
    root: &Path,
    path: &Path,
    message: impl Into<String>,
) {
    result.failures.push(ArchiveImportArtifactCleanupFailure {
        relative_path: relative_path(root, path),
        message: message.into(),
    });
}

fn cleanup_archive_import_artifacts_with_fs(
    root: &Path,
    file_system: &dyn ImportArtifactFileSystem,
) -> Result<ArchiveImportArtifactCleanupResult, String> {
    let mut result = ArchiveImportArtifactCleanupResult::default();
    let mut directories = vec![root.to_path_buf()];

    while let Some(directory) = directories.pop() {
        let entries = match fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) => {
                record_failure(&mut result, root, &directory, error.to_string());
                continue;
            }
        };
        for entry in entries {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    record_failure(&mut result, root, &directory, error.to_string());
                    continue;
                }
            };
            let path = entry.path();
            let file_name = entry.file_name().to_string_lossy().into_owned();
            let parsed_artifact = parse_archive_import_artifact_file_name(&file_name);
            let file_metadata = match fs::symlink_metadata(&path) {
                Ok(file_metadata) => file_metadata,
                Err(error) => {
                    if parsed_artifact.is_some() {
                        record_failure(&mut result, root, &path, error.to_string());
                    }
                    continue;
                }
            };
            let file_type = file_metadata.file_type();

            if file_type.is_symlink() {
                if parsed_artifact.is_some() {
                    record_failure(
                        &mut result,
                        root,
                        &path,
                        "Import artifacts that are symbolic links are not removed.",
                    );
                }
                continue;
            }
            if file_type.is_dir() {
                if directory == root && file_name.eq_ignore_ascii_case(metadata::METADATA_DIRECTORY)
                {
                    continue;
                }
                if parsed_artifact.is_some() {
                    record_failure(
                        &mut result,
                        root,
                        &path,
                        "Import artifacts that are directories are not removed.",
                    );
                } else {
                    directories.push(path);
                }
                continue;
            }
            let Some(parsed_artifact) = parsed_artifact else {
                continue;
            };
            if !file_type.is_file() {
                continue;
            }

            if parsed_artifact.kind == ArchiveImportArtifactKind::ReplacementBackup {
                let destination = path.with_file_name(parsed_artifact.destination_file_name);
                match fs::symlink_metadata(&destination) {
                    Ok(destination_metadata)
                        if destination_metadata.file_type().is_file()
                            && !destination_metadata.file_type().is_symlink() => {}
                    Ok(_) => {
                        record_failure(
                            &mut result,
                            root,
                            &path,
                            "The replacement backup was retained because its destination is not a regular file.",
                        );
                        continue;
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                        record_failure(
                            &mut result,
                            root,
                            &path,
                            "The replacement backup was retained because the destination EPUB is missing.",
                        );
                        continue;
                    }
                    Err(error) => {
                        record_failure(&mut result, root, &path, error.to_string());
                        continue;
                    }
                }
            }

            match file_system.remove_file(&path) {
                Ok(()) => result.removed_count += 1,
                Err(error) => record_failure(&mut result, root, &path, error),
            }
        }
    }

    result.failures.sort_by(|left, right| {
        left.relative_path
            .cmp(&right.relative_path)
            .then_with(|| left.message.cmp(&right.message))
    });
    Ok(result)
}

pub(crate) fn cleanup_archive_import_artifacts_at(
    canonical_root: &Path,
    transaction_state: &ArchiveImportTransactionState,
) -> Result<ArchiveImportArtifactCleanupResult, String> {
    transaction_state.run(canonical_root, || {
        cleanup_archive_import_artifacts_with_fs(canonical_root, &RealImportArtifactFileSystem)
    })
}

#[tauri::command]
pub async fn cleanup_archive_import_artifacts(
    app: tauri::AppHandle,
    root_path: Option<String>,
    transaction_state: State<'_, ArchiveImportTransactionState>,
) -> Result<ArchiveImportArtifactCleanupResult, String> {
    let root = archive_root::resolve_archive_root(&app, root_path)?;
    let canonical_root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let transaction_state = transaction_state.inner().clone();

    tauri::async_runtime::spawn_blocking(move || {
        cleanup_archive_import_artifacts_at(&canonical_root, &transaction_state)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::mpsc,
        thread,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    use super::{
        cleanup_archive_import_artifacts_at, cleanup_archive_import_artifacts_with_fs,
        is_archive_import_artifact_file_name, ImportArtifactFileSystem,
    };
    use crate::commands::archive_import_transaction::ArchiveImportTransactionState;

    fn test_root() -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-import-artifacts-{nonce}"))
    }

    #[test]
    fn recognizes_only_strict_archeion_import_artifacts() {
        assert!(is_archive_import_artifact_file_name(
            "Novel.epub.tmp-import-123-45"
        ));
        assert!(is_archive_import_artifact_file_name(
            "Novel.epub.replace-backup-123-45"
        ));
        for file_name in [
            "Novel.tmp-import-123-45",
            "Novel.epub.tmp-import-note",
            "Novel.epub.tmp-import-123-45-extra",
            "Novel.epub.replace-backup-123",
            "my-tmp-import-Novel.epub",
        ] {
            assert!(!is_archive_import_artifact_file_name(file_name));
        }
    }

    #[test]
    fn resolves_the_corresponding_destination_for_strict_artifacts() {
        assert_eq!(
            super::archive_import_artifact_destination_relative_path(
                "Series/Novel.epub.tmp-import-123-45"
            ),
            Some("Series/Novel.epub".to_string())
        );
        assert_eq!(
            super::archive_import_artifact_destination_relative_path(
                "Novel.epub.replace-backup-123-45"
            ),
            Some("Novel.epub".to_string())
        );
        assert_eq!(
            super::archive_import_artifact_destination_relative_path("Novel.epub.tmp-import-notes"),
            None
        );
    }

    #[test]
    fn repair_removes_abandoned_artifacts_and_preserves_similar_user_files() {
        let root = test_root();
        fs::create_dir_all(root.join("Series")).unwrap();
        fs::write(root.join("Novel.epub"), b"replacement").unwrap();
        fs::write(root.join("Novel.epub.replace-backup-123-45"), b"backup").unwrap();
        fs::write(
            root.join("Series/Novel.epub.tmp-import-456-78"),
            b"temporary",
        )
        .unwrap();
        fs::write(root.join("Novel.epub.replace-backup-notes"), b"user").unwrap();

        let result =
            cleanup_archive_import_artifacts_at(&root, &ArchiveImportTransactionState::default())
                .unwrap();

        assert_eq!(result.removed_count, 2);
        assert!(result.failures.is_empty());
        assert!(root.join("Novel.epub.replace-backup-notes").is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn repair_after_simulated_restart_removes_a_committed_replacement_backup() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let artifact = root.join("Novel.epub.replace-backup-123-45");
        fs::write(root.join("Novel.epub"), b"replacement").unwrap();
        fs::write(&artifact, b"backup").unwrap();

        let restarted_state = ArchiveImportTransactionState::default();
        let result = cleanup_archive_import_artifacts_at(&root, &restarted_state).unwrap();

        assert_eq!(result.removed_count, 1);
        assert!(!artifact.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn artifact_directories_are_rejected_without_following_them() {
        let root = test_root();
        let artifact = root.join("Novel.epub.tmp-import-123-45");
        fs::create_dir_all(&artifact).unwrap();
        fs::write(artifact.join("inside.epub"), b"book").unwrap();

        let result =
            cleanup_archive_import_artifacts_at(&root, &ArchiveImportTransactionState::default())
                .unwrap();

        assert_eq!(result.removed_count, 0);
        assert_eq!(result.failures.len(), 1);
        assert!(artifact.is_dir());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn artifact_symlinks_are_rejected() {
        use std::os::unix::fs::symlink;

        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let target = root.join("target.epub");
        let artifact = root.join("Novel.epub.tmp-import-123-45");
        fs::write(&target, b"book").unwrap();
        symlink(&target, &artifact).unwrap();

        let result =
            cleanup_archive_import_artifacts_at(&root, &ArchiveImportTransactionState::default())
                .unwrap();

        assert_eq!(result.removed_count, 0);
        assert_eq!(result.failures.len(), 1);
        assert!(target.is_file());
        assert!(artifact.exists());
        fs::remove_dir_all(root).unwrap();
    }

    struct FailingRemovalFileSystem {
        failing_path: PathBuf,
    }

    impl ImportArtifactFileSystem for FailingRemovalFileSystem {
        fn remove_file(&self, path: &Path) -> Result<(), String> {
            if path == self.failing_path {
                Err("simulated cleanup failure".to_string())
            } else {
                fs::remove_file(path).map_err(|error| error.to_string())
            }
        }
    }

    #[test]
    fn partial_cleanup_reports_remaining_failures() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let removed = root.join("One.epub.tmp-import-123-45");
        let failed = root.join("Two.epub.replace-backup-456-78");
        fs::write(&removed, b"temporary").unwrap();
        fs::write(root.join("Two.epub"), b"replacement").unwrap();
        fs::write(&failed, b"backup").unwrap();

        let result = cleanup_archive_import_artifacts_with_fs(
            &root,
            &FailingRemovalFileSystem {
                failing_path: failed.clone(),
            },
        )
        .unwrap();

        assert_eq!(result.removed_count, 1);
        assert_eq!(result.failures.len(), 1);
        assert_eq!(
            result.failures[0].relative_path,
            "Two.epub.replace-backup-456-78"
        );
        assert!(failed.is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn replacement_backup_is_retained_when_the_destination_is_missing() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let artifact = root.join("Novel.epub.replace-backup-123-45");
        fs::write(&artifact, b"original").unwrap();

        let result =
            cleanup_archive_import_artifacts_at(&root, &ArchiveImportTransactionState::default())
                .unwrap();

        assert_eq!(result.removed_count, 0);
        assert_eq!(result.failures.len(), 1);
        assert!(artifact.is_file());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn cleanup_waits_for_an_active_import_transaction() {
        let root = test_root();
        fs::create_dir_all(&root).unwrap();
        let artifact = root.join("Novel.epub.tmp-import-123-45");
        fs::write(&artifact, b"active").unwrap();
        let state = ArchiveImportTransactionState::default();
        let active_state = state.clone();
        let active_root = root.clone();
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let active = thread::spawn(move || {
            active_state
                .run(&active_root, || {
                    started_tx.send(()).unwrap();
                    release_rx.recv().unwrap();
                    Ok(())
                })
                .unwrap();
        });
        started_rx.recv().unwrap();

        let cleanup_state = state.clone();
        let cleanup_root = root.clone();
        let (cleanup_tx, cleanup_rx) = mpsc::channel();
        let cleanup = thread::spawn(move || {
            let result = cleanup_archive_import_artifacts_at(&cleanup_root, &cleanup_state);
            cleanup_tx.send(result).unwrap();
        });

        assert!(cleanup_rx.recv_timeout(Duration::from_millis(50)).is_err());
        release_tx.send(()).unwrap();
        let result = cleanup_rx
            .recv_timeout(Duration::from_secs(1))
            .unwrap()
            .unwrap();
        assert_eq!(result.removed_count, 1);
        active.join().unwrap();
        cleanup.join().unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}
