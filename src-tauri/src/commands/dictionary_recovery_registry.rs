use std::{fmt, fs, io::Write, path::PathBuf};

use serde::{Deserialize, Serialize};

use crate::atomic_file::transaction_path;

use super::dictionary_store::{DictionaryStoragePaths, InstalledDictionary};

const RECOVERY_REGISTRY_FILE_NAME: &str = "registry-recovery-v1.json";
const RECOVERY_REGISTRY_SCHEMA_VERSION: u32 = 2;
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryRegistryFile<'a> {
    schema_version: u32,
    dictionaries: &'a [InstalledDictionary],
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RecoveryRegistryEnvelope {
    schema_version: u32,
    dictionaries: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct LegacyInstalledDictionaryV1 {
    id: String,
    display_name: String,
    language: String,
    enabled: bool,
    order: u32,
    entry_count: u64,
    installed_size_bytes: u64,
    source_kind: super::dictionary_store::DictionarySourceKind,
    catalog_id: Option<String>,
    source_attribution: String,
    license_name: String,
    license_url: Option<String>,
    package_version: String,
    index_state: super::dictionary_store::DictionaryIndexState,
    storage_relative_path: String,
}

impl From<LegacyInstalledDictionaryV1> for InstalledDictionary {
    fn from(value: LegacyInstalledDictionaryV1) -> Self {
        Self {
            id: value.id,
            display_name: value.display_name,
            source_language: value.language.clone(),
            target_language: value.language,
            enabled: value.enabled,
            order: value.order,
            entry_count: value.entry_count,
            installed_size_bytes: value.installed_size_bytes,
            source_kind: value.source_kind,
            catalog_id: value.catalog_id,
            source_attribution: value.source_attribution,
            license_name: value.license_name,
            license_url: value.license_url,
            package_version: value.package_version,
            index_state: value.index_state,
            storage_relative_path: value.storage_relative_path,
        }
    }
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
    decode_recovery_registry(&bytes)
}

pub(crate) fn recovery_registry_uses_current_schema(paths: &DictionaryStoragePaths) -> bool {
    let path = recovery_registry_path(paths);
    let Ok(metadata) = fs::symlink_metadata(&path) else {
        return false;
    };
    if !metadata.file_type().is_file() || metadata.len() > MAX_RECOVERY_REGISTRY_BYTES {
        return false;
    }
    let Ok(bytes) = fs::read(path) else {
        return false;
    };
    serde_json::from_slice::<RecoveryRegistryEnvelope>(&bytes)
        .is_ok_and(|registry| registry.schema_version == RECOVERY_REGISTRY_SCHEMA_VERSION)
}

fn decode_recovery_registry(
    bytes: &[u8],
) -> Result<Vec<InstalledDictionary>, DictionaryRecoveryRegistryError> {
    let registry: RecoveryRegistryEnvelope = serde_json::from_slice(bytes).map_err(|_| {
        DictionaryRecoveryRegistryError::Invalid(
            "Dictionary recovery registry contains invalid data.".to_string(),
        )
    })?;
    match registry.schema_version {
        RECOVERY_REGISTRY_SCHEMA_VERSION => registry
            .dictionaries
            .into_iter()
            .map(|dictionary| {
                serde_json::from_value(dictionary).map_err(|_| {
                    DictionaryRecoveryRegistryError::Invalid(
                        "Dictionary recovery registry contains invalid data.".to_string(),
                    )
                })
            })
            .collect(),
        1 => registry
            .dictionaries
            .into_iter()
            .map(|dictionary| {
                if let Ok(current) =
                    serde_json::from_value::<InstalledDictionary>(dictionary.clone())
                {
                    return Ok(current);
                }
                serde_json::from_value::<LegacyInstalledDictionaryV1>(dictionary)
                    .map(InstalledDictionary::from)
                    .map_err(|_| {
                        DictionaryRecoveryRegistryError::Invalid(
                            "Dictionary recovery registry contains invalid data.".to_string(),
                        )
                    })
            })
            .collect(),
        _ => Err(DictionaryRecoveryRegistryError::Invalid(
            "Dictionary recovery registry uses an unsupported schema.".to_string(),
        )),
    }
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
            dictionaries,
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

    use super::{
        read_recovery_registry, recovery_registry_uses_current_schema, StagedRecoveryRegistry,
    };
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
    fn legacy_single_language_registry_is_read_as_a_monolingual_pair() {
        let root = test_root();
        let paths = DictionaryStoragePaths::from_app_data_root(&root);
        fs::create_dir_all(paths.root()).unwrap();
        let path = paths.root().join("registry-recovery-v1.json");
        fs::write(
            &path,
            br#"{
  "schemaVersion": 1,
  "dictionaries": [
    {
      "id": "dict-00000000000000000000000000000000",
      "displayName": "Legacy English",
      "language": "en",
      "enabled": true,
      "order": 0,
      "entryCount": 1,
      "installedSizeBytes": 32,
      "sourceKind": "catalog",
      "catalogId": "english-core",
      "sourceAttribution": "Example",
      "licenseName": "Example license",
      "licenseUrl": "https://example.com/license",
      "packageVersion": "1",
      "indexState": "ready",
      "storageRelativePath": "installed/dict-00000000000000000000000000000000"
    }
  ]
}
"#,
        )
        .unwrap();

        let restored = read_recovery_registry(&paths).unwrap();
        assert_eq!(restored.len(), 1);
        assert_eq!(restored[0].source_language, "en");
        assert_eq!(restored[0].target_language, "en");
        assert!(!recovery_registry_uses_current_schema(&paths));

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn staged_registry_writes_the_current_recovery_schema() {
        let root = test_root();
        let paths = DictionaryStoragePaths::from_app_data_root(&root);
        StagedRecoveryRegistry::stage(&paths, &[dictionary(true)])
            .unwrap()
            .commit();

        assert!(recovery_registry_uses_current_schema(&paths));
        let value: serde_json::Value = serde_json::from_slice(
            &fs::read(paths.root().join("registry-recovery-v1.json")).unwrap(),
        )
        .unwrap();
        assert_eq!(value["schemaVersion"], serde_json::json!(2));

        fs::remove_dir_all(root).unwrap();
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
