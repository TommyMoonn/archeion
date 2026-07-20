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

        match fs_ops.remove_file(backup) {
            Ok(()) => Ok(()),
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
        transaction_path, AtomicFileSystem, AtomicReplaceError, BackupCleanup, PreparedAtomicFile,
        RealAtomicFileSystem,
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
}
