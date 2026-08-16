use std::{fmt, fs, io::Write, path::PathBuf};

use serde::{Deserialize, Serialize};

use crate::atomic_file::transaction_path;

use super::dictionary_store::{DictionaryStoragePaths, InstalledDictionary};

const RECOVERY_REGISTRY_FILE_NAME: &str = "registry-recovery-v1.json";
const RECOVERY_REGISTRY_SCHEMA_VERSION: u32 = 1;
const MAX_RECOVERY_REGISTRY_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug)]
pub(crate) enum DictionaryRecoveryRegistryError {
    Filesystem(std::io::Error),
    Invalid(String),
}

impl fmt::Display for DictionaryRecoveryRegistryError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Filesystem(error) => {
                write!(
                    formatter,
                    "Dictionary recovery registry is unavailable: {error}"
                )
            }
            Self::Invalid(message) => formatter.write_str(message),
        }
    }
}

impl From<std::io::Error> for DictionaryRecoveryRegistryError {
    fn from(value: std::io::Error) -> Self {
        Self::Filesystem(value)
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecoveryRegistryFile {
    schema_version: u32,
    dictionaries: Vec<InstalledDictionary>,
}

pub(crate) fn recovery_registry_exists(paths: &DictionaryStoragePaths) -> bool {
    fs::symlink_metadata(recovery_registry_path(paths))
        .is_ok_and(|metadata| metadata.file_type().is_file())
}

pub(crate) fn read_recovery_registry(
    paths: &DictionaryStoragePaths,
) -> Result<Vec<InstalledDictionary>, DictionaryRecoveryRegistryError> {
    let path = recovery_registry_path(paths);
    let metadata = fs::symlink_metadata(&path)?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_RECOVERY_REGISTRY_BYTES {
        return Err(DictionaryRecoveryRegistryError::Invalid(
            "Dictionary recovery registry is not a bounded regular file.".to_string(),
        ));
    }
    let bytes = fs::read(path)?;
    let registry: RecoveryRegistryFile = serde_json::from_slice(&bytes).map_err(|_| {
        DictionaryRecoveryRegistryError::Invalid(
            "Dictionary recovery registry contains invalid data.".to_string(),
        )
    })?;
    if registry.schema_version != RECOVERY_REGISTRY_SCHEMA_VERSION {
        return Err(DictionaryRecoveryRegistryError::Invalid(
            "Dictionary recovery registry uses an unsupported schema.".to_string(),
        ));
    }
    Ok(registry.dictionaries)
}

pub(crate) struct StagedRecoveryRegistry {
    current_path: PathBuf,
    backup_path: Option<PathBuf>,
    active: bool,
}

impl StagedRecoveryRegistry {
    pub(crate) fn stage(
        paths: &DictionaryStoragePaths,
        dictionaries: &[InstalledDictionary],
    ) -> Result<Self, DictionaryRecoveryRegistryError> {
        fs::create_dir_all(paths.root())?;
        let current_path = recovery_registry_path(paths);
        let temporary_path = transaction_path(&current_path, "pending");
        let backup_path = transaction_path(&current_path, "previous");
        let mut bytes = serde_json::to_vec_pretty(&RecoveryRegistryFile {
            schema_version: RECOVERY_REGISTRY_SCHEMA_VERSION,
            dictionaries: dictionaries.to_vec(),
        })
        .map_err(|_| {
            DictionaryRecoveryRegistryError::Invalid(
                "Dictionary recovery registry could not be encoded.".to_string(),
            )
        })?;
        bytes.push(b'\n');
        if bytes.len() as u64 > MAX_RECOVERY_REGISTRY_BYTES {
            return Err(DictionaryRecoveryRegistryError::Invalid(
                "Dictionary recovery registry exceeds its size limit.".to_string(),
            ));
        }

        let mut temporary = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary_path)?;
        if let Err(error) = temporary
            .write_all(&bytes)
            .and_then(|()| temporary.sync_all())
        {
            drop(temporary);
            let _ = fs::remove_file(&temporary_path);
            return Err(error.into());
        }
        drop(temporary);

        let backup = match fs::symlink_metadata(&current_path) {
            Ok(metadata) if metadata.file_type().is_file() => {
                if let Err(error) = fs::rename(&current_path, &backup_path) {
                    let _ = fs::remove_file(&temporary_path);
                    return Err(error.into());
                }
                Some(backup_path)
            }
            Ok(_) => {
                let _ = fs::remove_file(&temporary_path);
                return Err(DictionaryRecoveryRegistryError::Invalid(
                    "Dictionary recovery registry path is not a regular file.".to_string(),
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => {
                let _ = fs::remove_file(&temporary_path);
                return Err(error.into());
            }
        };

        if let Err(error) = fs::rename(&temporary_path, &current_path) {
            if let Some(backup) = &backup {
                let _ = fs::rename(backup, &current_path);
            }
            let _ = fs::remove_file(&temporary_path);
            return Err(error.into());
        }

        Ok(Self {
            current_path,
            backup_path: backup,
            active: true,
        })
    }

    pub(crate) fn commit(mut self) {
        self.active = false;
        if let Some(backup) = self.backup_path.take() {
            if let Err(error) = fs::remove_file(&backup) {
                eprintln!(
                    "Dictionary recovery registry committed but backup cleanup failed at {}: {error}",
                    backup.display()
                );
            }
        }
    }

    pub(crate) fn rollback(mut self) -> Result<(), DictionaryRecoveryRegistryError> {
        self.rollback_inner()?;
        self.active = false;
        Ok(())
    }

    fn rollback_inner(&mut self) -> Result<(), DictionaryRecoveryRegistryError> {
        match fs::remove_file(&self.current_path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        if let Some(backup) = self.backup_path.take() {
            fs::rename(backup, &self.current_path)?;
        }
        Ok(())
    }
}

impl Drop for StagedRecoveryRegistry {
    fn drop(&mut self) {
        if self.active {
            let _ = self.rollback_inner();
        }
    }
}

fn recovery_registry_path(paths: &DictionaryStoragePaths) -> PathBuf {
    paths.root().join(RECOVERY_REGISTRY_FILE_NAME)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    use super::{read_recovery_registry, StagedRecoveryRegistry};
    use crate::commands::dictionary_store::{
        DictionaryIndexState, DictionarySourceKind, DictionaryStoragePaths, InstalledDictionary,
    };

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn test_root() -> PathBuf {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "archeion-dictionary-recovery-registry-{}-{sequence}",
            std::process::id()
        ))
    }

    fn dictionary(enabled: bool) -> InstalledDictionary {
        InstalledDictionary {
            id: "dict-00000000000000000000000000000000".to_string(),
            display_name: "French to English".to_string(),
            source_language: "fr".to_string(),
            target_language: "en".to_string(),
            enabled,
            order: 0,
            entry_count: 1,
            installed_size_bytes: 32,
            source_kind: DictionarySourceKind::Catalog,
            catalog_id: Some("french-english".to_string()),
            source_attribution: "Example".to_string(),
            license_name: "Example license".to_string(),
            license_url: Some("https://example.com/license".to_string()),
            package_version: "1".to_string(),
            index_state: DictionaryIndexState::Ready,
            storage_relative_path: "installed/dict-00000000000000000000000000000000".to_string(),
        }
    }

    #[test]
    fn staged_registry_can_commit_or_restore_the_previous_snapshot() {
        let root = test_root();
        let paths = DictionaryStoragePaths::from_app_data_root(&root);
        StagedRecoveryRegistry::stage(&paths, &[dictionary(true)])
            .unwrap()
            .commit();

        StagedRecoveryRegistry::stage(&paths, &[dictionary(false)])
            .unwrap()
            .rollback()
            .unwrap();
        let restored = read_recovery_registry(&paths).unwrap();
        assert!(restored[0].enabled);
        assert_eq!(restored[0].source_language, "fr");
        assert_eq!(restored[0].target_language, "en");

        StagedRecoveryRegistry::stage(&paths, &[dictionary(false)])
            .unwrap()
            .commit();
        assert!(!read_recovery_registry(&paths).unwrap()[0].enabled);
        fs::remove_dir_all(root).unwrap();
    }
}
