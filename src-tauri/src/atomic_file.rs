use std::{
    fs::{self, OpenOptions},
    io::{self, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

static TRANSACTION_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TemporaryWriteStage {
    Create,
    Write,
    Sync,
}

#[derive(Debug)]
pub(crate) struct TemporaryWriteError {
    stage: TemporaryWriteStage,
    source: io::Error,
}

impl TemporaryWriteError {
    pub(crate) fn stage(&self) -> TemporaryWriteStage {
        self.stage
    }

    pub(crate) fn into_source(self) -> io::Error {
        self.source
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum BackupCleanup {
    BestEffort,
    Required,
}

#[derive(Debug, Eq, PartialEq)]
pub(crate) enum AtomicReplaceError {
    DestinationNotFile,
    MoveDestinationToBackup(String),
    ReplaceMissingDestination(String),
    ReplaceRestored { replace_error: String },
    RestoreFailed { restore_error: String },
    RemoveBackup(String),
    SyncDirectory(String),
}

pub(crate) trait AtomicFileSystem {
    fn rename(&self, source: &Path, destination: &Path) -> Result<(), String>;
    fn remove_file(&self, path: &Path) -> Result<(), String>;
}

pub(crate) struct RealAtomicFileSystem;

impl AtomicFileSystem for RealAtomicFileSystem {
    fn rename(&self, source: &Path, destination: &Path) -> Result<(), String> {
        fs::rename(source, destination).map_err(|error| error.to_string())
    }

    fn remove_file(&self, path: &Path) -> Result<(), String> {
        fs::remove_file(path).map_err(|error| error.to_string())
    }
}

pub(crate) fn transaction_path(destination: &Path, marker: &str) -> PathBuf {
    let file_name = destination
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_default();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let sequence = TRANSACTION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    destination.with_file_name(format!(
        "{file_name}.{marker}-{}-{timestamp}-{sequence}",
        std::process::id()
    ))
}

#[derive(Debug)]
struct TransactionArtifact {
    path: PathBuf,
    order: (u128, u64, u32),
}

fn transaction_artifacts(destination: &Path, marker: &str) -> io::Result<Vec<TransactionArtifact>> {
    let Some(parent) = destination.parent() else {
        return Ok(Vec::new());
    };
    let Some(file_name) = destination.file_name() else {
        return Ok(Vec::new());
    };
    let prefix = format!("{}.{marker}-", file_name.to_string_lossy());
    let entries = match fs::read_dir(parent) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };

    let mut artifacts = Vec::new();
    for entry in entries {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let Some(suffix) = name.strip_prefix(&prefix) else {
            continue;
        };
        let Some((process_and_timestamp, sequence)) = suffix.rsplit_once('-') else {
            continue;
        };
        let Some((process, timestamp)) = process_and_timestamp.rsplit_once('-') else {
            continue;
        };
        let (Ok(process), Ok(timestamp), Ok(sequence)) = (
            process.parse::<u32>(),
            timestamp.parse::<u128>(),
            sequence.parse::<u64>(),
        ) else {
            continue;
        };
        if !entry.file_type()?.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "Transaction artifact is not a regular file: {}",
                    entry.path().display()
                ),
            ));
        }
        artifacts.push(TransactionArtifact {
            path: entry.path(),
            order: (timestamp, sequence, process),
        });
    }

    artifacts.sort_by(|left, right| {
        left.order
            .cmp(&right.order)
            .then_with(|| left.path.cmp(&right.path))
    });
    Ok(artifacts)
}

#[cfg(unix)]
fn sync_parent_directory(destination: &Path) -> io::Result<()> {
    if let Some(parent) = destination.parent() {
        fs::File::open(parent)?.sync_all()?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn sync_parent_directory(_destination: &Path) -> io::Result<()> {
    Ok(())
}

fn remove_transaction_artifact(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn cleanup_transaction_artifacts(
    temporary_files: &[TransactionArtifact],
    backup_files: &[TransactionArtifact],
    preserved_path: Option<&Path>,
) -> io::Result<()> {
    for artifact in temporary_files.iter().chain(backup_files) {
        if preserved_path.is_some_and(|path| path == artifact.path) {
            continue;
        }
        remove_transaction_artifact(&artifact.path)?;
    }
    Ok(())
}

pub(crate) fn recover_atomic_replace(destination: &Path) -> io::Result<()> {
    let temporary_files = transaction_artifacts(destination, "tmp-write")?;
    let backup_files = transaction_artifacts(destination, "write-backup")?;

    if temporary_files.is_empty() && backup_files.is_empty() {
        return Ok(());
    }

    if destination.exists() {
        if !destination.is_file() {
            return Err(io::Error::new(
                io::ErrorKind::InvalidData,
                format!(
                    "Atomic replacement destination is not a regular file: {}",
                    destination.display()
                ),
            ));
        }
        cleanup_transaction_artifacts(&temporary_files, &backup_files, None)?;
        return sync_parent_directory(destination);
    }

    let recovery_source = backup_files
        .last()
        .or_else(|| temporary_files.last())
        .ok_or_else(|| io::Error::other("Atomic replacement recovery source is unavailable."))?;

    fs::rename(&recovery_source.path, destination)?;
    sync_parent_directory(destination)?;
    cleanup_transaction_artifacts(&temporary_files, &backup_files, Some(&recovery_source.path))?;
    sync_parent_directory(destination)
}

pub(crate) struct PreparedAtomicFile {
    path: PathBuf,
    committed: bool,
}

impl PreparedAtomicFile {
    pub(crate) fn write(path: PathBuf, contents: &[u8]) -> Result<Self, TemporaryWriteError> {
        Self::write_with(
            path,
            contents,
            |file, contents| file.write_all(contents),
            fs::File::sync_all,
        )
    }

    fn write_with(
        path: PathBuf,
        contents: &[u8],
        write_contents: impl FnOnce(&mut fs::File, &[u8]) -> io::Result<()>,
        sync_file: impl FnOnce(&fs::File) -> io::Result<()>,
    ) -> Result<Self, TemporaryWriteError> {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);

        let mut file = options.open(&path).map_err(|source| TemporaryWriteError {
            stage: TemporaryWriteStage::Create,
            source,
        })?;

        if let Err(source) = write_contents(&mut file, contents) {
            drop(file);
            let _ = fs::remove_file(&path);
            return Err(TemporaryWriteError {
                stage: TemporaryWriteStage::Write,
                source,
            });
        }
        if let Err(source) = sync_file(&file) {
            drop(file);
            let _ = fs::remove_file(&path);
            return Err(TemporaryWriteError {
                stage: TemporaryWriteStage::Sync,
                source,
            });
        }
        drop(file);

        Ok(Self {
            path,
            committed: false,
        })
    }

    pub(crate) fn path(&self) -> &Path {
        &self.path
    }

    pub(crate) fn replace(
        mut self,
        destination: &Path,
        backup: &Path,
        backup_cleanup: BackupCleanup,
        fs_ops: &impl AtomicFileSystem,
    ) -> Result<(), AtomicReplaceError> {
        if !destination.exists() {
            fs_ops
                .rename(&self.path, destination)
                .map_err(AtomicReplaceError::ReplaceMissingDestination)?;
            self.committed = true;
            sync_parent_directory(destination)
                .map_err(|error| AtomicReplaceError::SyncDirectory(error.to_string()))?;
            return Ok(());
        }

        if !destination.is_file() {
            return Err(AtomicReplaceError::DestinationNotFile);
        }

        fs_ops
            .rename(destination, backup)
            .map_err(AtomicReplaceError::MoveDestinationToBackup)?;

        if let Err(replace_error) = fs_ops.rename(&self.path, destination) {
            return match fs_ops.rename(backup, destination) {
                Ok(()) => Err(AtomicReplaceError::ReplaceRestored { replace_error }),
                Err(restore_error) => Err(AtomicReplaceError::RestoreFailed { restore_error }),
            };
        }
        self.committed = true;
        sync_parent_directory(destination)
            .map_err(|error| AtomicReplaceError::SyncDirectory(error.to_string()))?;

        match fs_ops.remove_file(backup) {
            Ok(()) => sync_parent_directory(destination)
                .map_err(|error| AtomicReplaceError::SyncDirectory(error.to_string())),
            Err(_) if backup_cleanup == BackupCleanup::BestEffort => Ok(()),
            Err(error) => Err(AtomicReplaceError::RemoveBackup(error)),
        }
    }
}

impl Drop for PreparedAtomicFile {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(&self.path);
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path, time::SystemTime};

    use super::{
        recover_atomic_replace, transaction_path, AtomicFileSystem, AtomicReplaceError,
        BackupCleanup, PreparedAtomicFile, RealAtomicFileSystem,
    };

    fn test_root(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-atomic-file-{label}-{nonce}"))
    }

    #[test]
    fn transaction_paths_are_distinct() {
        let destination = Path::new("state.json");

        let first = transaction_path(destination, "tmp-write");
        let second = transaction_path(destination, "tmp-write");

        assert_ne!(first, second);
    }

    #[test]
    fn replaces_existing_file_and_removes_transaction_artifacts() {
        let root = test_root("replace");
        fs::create_dir_all(&root).expect("test root should be created");
        let destination = root.join("state.json");
        fs::write(&destination, b"old").expect("existing file should be written");
        let temporary_path = transaction_path(&destination, "tmp-write");
        let backup_path = transaction_path(&destination, "write-backup");
        let prepared = PreparedAtomicFile::write(temporary_path, b"new")
            .expect("temporary file should be prepared");

        prepared
            .replace(
                &destination,
                &backup_path,
                BackupCleanup::Required,
                &RealAtomicFileSystem,
            )
            .expect("replacement should succeed");

        assert_eq!(fs::read(&destination).unwrap(), b"new");
        assert!(!backup_path.exists());
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    struct FailFinalRename;

    impl AtomicFileSystem for FailFinalRename {
        fn rename(&self, source: &Path, destination: &Path) -> Result<(), String> {
            let source_name = source
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            let destination_name = destination
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            if source_name.contains("tmp-write") && destination_name == "state.json" {
                return Err("replacement blocked".to_string());
            }
            fs::rename(source, destination).map_err(|error| error.to_string())
        }

        fn remove_file(&self, path: &Path) -> Result<(), String> {
            fs::remove_file(path).map_err(|error| error.to_string())
        }
    }

    #[test]
    fn restores_existing_file_and_cleans_temporary_after_failed_replacement() {
        let root = test_root("restore");
        fs::create_dir_all(&root).expect("test root should be created");
        let destination = root.join("state.json");
        fs::write(&destination, b"old").expect("existing file should be written");
        let temporary_path = transaction_path(&destination, "tmp-write");
        let backup_path = transaction_path(&destination, "write-backup");
        let prepared = PreparedAtomicFile::write(temporary_path.clone(), b"new")
            .expect("temporary file should be prepared");

        let error = prepared
            .replace(
                &destination,
                &backup_path,
                BackupCleanup::Required,
                &FailFinalRename,
            )
            .expect_err("replacement should fail");

        assert_eq!(
            error,
            AtomicReplaceError::ReplaceRestored {
                replace_error: "replacement blocked".to_string()
            }
        );
        assert_eq!(fs::read(&destination).unwrap(), b"old");
        assert!(!temporary_path.exists());
        assert!(!backup_path.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_temporary_write_removes_partial_transaction_file() {
        let root = test_root("write-failure");
        fs::create_dir_all(&root).expect("test root should be created");
        let temporary_path = root.join("state.tmp");

        let error = match PreparedAtomicFile::write_with(
            temporary_path.clone(),
            b"new",
            |_file, _contents| Err(std::io::Error::other("write blocked")),
            fs::File::sync_all,
        ) {
            Ok(_) => panic!("temporary write should fail"),
            Err(error) => error,
        };

        assert_eq!(error.stage(), super::TemporaryWriteStage::Write);
        assert!(!temporary_path.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn failed_temporary_creation_leaves_no_transaction_file() {
        let root = test_root("create-failure");
        fs::create_dir_all(&root).expect("test root should be created");
        let temporary_path = root.join("missing").join("state.tmp");

        assert!(PreparedAtomicFile::write(temporary_path.clone(), b"new").is_err());
        assert!(!temporary_path.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_keeps_valid_destination_without_transaction_artifacts() {
        let root = test_root("recovery-current-only");
        fs::create_dir_all(&root).expect("test root should be created");
        let destination = root.join("state.json");
        fs::write(&destination, b"current").expect("current destination should be written");

        recover_atomic_replace(&destination).expect("recovery should be a no-op");

        assert_eq!(fs::read(&destination).unwrap(), b"current");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_keeps_current_destination_and_cleans_synced_temporary_file() {
        let root = test_root("recovery-current-temp");
        fs::create_dir_all(&root).expect("test root should be created");
        let destination = root.join("state.json");
        fs::write(&destination, b"current").expect("current destination should be written");
        let temporary = transaction_path(&destination, "tmp-write");
        fs::write(&temporary, b"pending").expect("pending replacement should be written");

        recover_atomic_replace(&destination).expect("recovery should keep the current destination");

        assert_eq!(fs::read(&destination).unwrap(), b"current");
        assert!(!temporary.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_restores_transaction_backup_when_destination_is_missing() {
        let root = test_root("recovery-backup-temp");
        fs::create_dir_all(&root).expect("test root should be created");
        let destination = root.join("state.json");
        let backup = transaction_path(&destination, "write-backup");
        let temporary = transaction_path(&destination, "tmp-write");
        fs::write(&backup, b"previous").expect("transaction backup should be written");
        fs::write(&temporary, b"pending").expect("pending replacement should be written");

        recover_atomic_replace(&destination).expect("recovery should restore last-known-good data");

        assert_eq!(fs::read(&destination).unwrap(), b"previous");
        assert!(!backup.exists());
        assert!(!temporary.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_restores_transaction_backup_when_temporary_file_is_missing() {
        let root = test_root("recovery-backup-only");
        fs::create_dir_all(&root).expect("test root should be created");
        let destination = root.join("state.json");
        let backup = transaction_path(&destination, "write-backup");
        fs::write(&backup, b"previous").expect("transaction backup should be written");

        recover_atomic_replace(&destination).expect("recovery should restore the backup");

        assert_eq!(fs::read(&destination).unwrap(), b"previous");
        assert!(!backup.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_never_replaces_valid_destination_with_stale_transaction_artifacts() {
        let root = test_root("recovery-committed");
        fs::create_dir_all(&root).expect("test root should be created");
        let destination = root.join("state.json");
        let backup = transaction_path(&destination, "write-backup");
        let temporary = transaction_path(&destination, "tmp-write");
        fs::write(&destination, b"replacement").expect("replacement should be written");
        fs::write(&backup, b"previous").expect("stale backup should be written");
        fs::write(&temporary, b"stale-pending").expect("stale temporary should be written");

        recover_atomic_replace(&destination).expect("recovery should keep committed data");

        assert_eq!(fs::read(&destination).unwrap(), b"replacement");
        assert!(!backup.exists());
        assert!(!temporary.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_uses_newest_backup_and_cleans_multiple_stale_artifacts() {
        let root = test_root("recovery-multiple");
        fs::create_dir_all(&root).expect("test root should be created");
        let destination = root.join("state.json");
        let older_backup = transaction_path(&destination, "write-backup");
        let newer_backup = transaction_path(&destination, "write-backup");
        let older_temporary = transaction_path(&destination, "tmp-write");
        let newer_temporary = transaction_path(&destination, "tmp-write");
        fs::write(&older_backup, b"older").expect("older backup should be written");
        fs::write(&newer_backup, b"newer").expect("newer backup should be written");
        fs::write(&older_temporary, b"pending-one").expect("older temp should be written");
        fs::write(&newer_temporary, b"pending-two").expect("newer temp should be written");

        recover_atomic_replace(&destination).expect("recovery should choose deterministically");

        assert_eq!(fs::read(&destination).unwrap(), b"newer");
        assert_eq!(fs::read_dir(&root).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_finishes_new_file_from_temporary_when_no_backup_exists() {
        let root = test_root("recovery-new-file");
        fs::create_dir_all(&root).expect("test root should be created");
        let destination = root.join("state.json");
        let temporary = transaction_path(&destination, "tmp-write");
        fs::write(&temporary, b"pending").expect("pending new file should be written");

        recover_atomic_replace(&destination).expect("recovery should finish the new file");

        assert_eq!(fs::read(&destination).unwrap(), b"pending");
        assert!(!temporary.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn recovery_surfaces_unusable_transaction_artifact_without_creating_destination() {
        let root = test_root("recovery-invalid-artifact");
        fs::create_dir_all(&root).expect("test root should be created");
        let destination = root.join("state.json");
        let backup = transaction_path(&destination, "write-backup");
        fs::create_dir(&backup).expect("invalid transaction artifact should be created");

        let error = recover_atomic_replace(&destination)
            .expect_err("invalid artifact should fail recovery");

        assert_eq!(error.kind(), std::io::ErrorKind::InvalidData);
        assert!(!destination.exists());
        assert!(backup.is_dir());
        fs::remove_dir_all(root).unwrap();
    }
}
