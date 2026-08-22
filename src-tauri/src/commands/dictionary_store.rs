use std::{
    collections::HashSet,
    fmt, fs,
    path::{Path, PathBuf},
    time::Duration,
};

use rusqlite::{params, Connection, OpenFlags, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

use super::{
    dictionary_index::{self, DictionaryLookupEntry},
    dictionary_language::is_canonical_language_tag,
    dictionary_recovery_registry::{
        read_recovery_registry, recovery_registry_exists, recovery_registry_uses_current_schema,
        StagedRecoveryRegistry,
    },
    stardict_validation::ValidatedStarDictPackage,
};

const DATABASE_FILE_NAME: &str = "dictionaries.sqlite3";
const DICTIONARY_ROOT_NAME: &str = "dictionaries";
const INSTALLED_DIRECTORY_NAME: &str = "installed";
const REMOVAL_STAGING_DIRECTORY: &str = "staging/removals";
const SCHEMA_VERSION: i64 = 2;
const SQLITE_BUSY_TIMEOUT: Duration = Duration::from_secs(5);

const CREATE_SCHEMA: &str = r#"
CREATE TABLE installed_dictionaries (
    dictionary_id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL,
    source_language TEXT NOT NULL,
    target_language TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    entry_count INTEGER NOT NULL CHECK (entry_count >= 0),
    installed_size_bytes INTEGER NOT NULL CHECK (installed_size_bytes >= 0),
    source_kind TEXT NOT NULL CHECK (source_kind IN ('catalog', 'manual-import')),
    catalog_id TEXT,
    source_attribution TEXT NOT NULL,
    license_name TEXT NOT NULL,
    license_url TEXT,
    package_version TEXT NOT NULL,
    index_state TEXT NOT NULL CHECK (
        index_state IN ('pending', 'ready', 'rebuild-required', 'unavailable')
    ),
    storage_relative_path TEXT NOT NULL UNIQUE
);

CREATE INDEX installed_dictionaries_order_idx
ON installed_dictionaries(sort_order, dictionary_id);

CREATE TABLE dictionary_entries (
    dictionary_id TEXT NOT NULL,
    source_ordinal INTEGER NOT NULL CHECK (source_ordinal >= 0),
    normalized_headword TEXT NOT NULL,
    display_headword TEXT NOT NULL,
    definition_offset INTEGER NOT NULL CHECK (definition_offset >= 0),
    definition_length INTEGER NOT NULL CHECK (definition_length >= 0),
    PRIMARY KEY (dictionary_id, source_ordinal),
    FOREIGN KEY (dictionary_id)
        REFERENCES installed_dictionaries(dictionary_id)
        ON DELETE CASCADE
);

CREATE INDEX dictionary_entries_headword_idx
ON dictionary_entries(normalized_headword, dictionary_id, source_ordinal);

CREATE TABLE dictionary_aliases (
    dictionary_id TEXT NOT NULL,
    normalized_alias TEXT NOT NULL,
    source_ordinal INTEGER NOT NULL CHECK (source_ordinal >= 0),
    PRIMARY KEY (dictionary_id, normalized_alias, source_ordinal),
    FOREIGN KEY (dictionary_id, source_ordinal)
        REFERENCES dictionary_entries(dictionary_id, source_ordinal)
        ON DELETE CASCADE
);

CREATE INDEX dictionary_aliases_lookup_idx
ON dictionary_aliases(normalized_alias, dictionary_id, source_ordinal);

PRAGMA user_version = 2;
"#;

const VERIFY_SCHEMA: &str = r#"
SELECT
    dictionary_id,
    display_name,
    source_language,
    target_language,
    enabled,
    sort_order,
    entry_count,
    installed_size_bytes,
    source_kind,
    catalog_id,
    source_attribution,
    license_name,
    license_url,
    package_version,
    index_state,
    storage_relative_path
FROM installed_dictionaries
LIMIT 0
"#;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledDictionary {
    pub id: String,
    pub display_name: String,
    pub source_language: String,
    pub target_language: String,
    pub enabled: bool,
    pub order: u32,
    pub entry_count: u64,
    pub installed_size_bytes: u64,
    pub source_kind: DictionarySourceKind,
    pub catalog_id: Option<String>,
    pub source_attribution: String,
    pub license_name: String,
    pub license_url: Option<String>,
    pub package_version: String,
    pub index_state: DictionaryIndexState,
    pub storage_relative_path: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DictionarySourceKind {
    Catalog,
    ManualImport,
}

impl DictionarySourceKind {
    #[allow(dead_code)]
    fn as_database_value(self) -> &'static str {
        match self {
            Self::Catalog => "catalog",
            Self::ManualImport => "manual-import",
        }
    }

    fn from_database_value(value: &str) -> Result<Self, DictionaryStoreError> {
        match value {
            "catalog" => Ok(Self::Catalog),
            "manual-import" => Ok(Self::ManualImport),
            _ => Err(DictionaryStoreError::InvalidStoredValue("source kind")),
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DictionaryIndexState {
    Pending,
    Ready,
    RebuildRequired,
    Unavailable,
}

impl DictionaryIndexState {
    pub(crate) fn as_database_value(self) -> &'static str {
        match self {
            Self::Pending => "pending",
            Self::Ready => "ready",
            Self::RebuildRequired => "rebuild-required",
            Self::Unavailable => "unavailable",
        }
    }

    fn from_database_value(value: &str) -> Result<Self, DictionaryStoreError> {
        match value {
            "pending" => Ok(Self::Pending),
            "ready" => Ok(Self::Ready),
            "rebuild-required" => Ok(Self::RebuildRequired),
            "unavailable" => Ok(Self::Unavailable),
            _ => Err(DictionaryStoreError::InvalidStoredValue("index state")),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[allow(dead_code)]
pub(crate) struct DictionaryRegistration {
    pub display_name: String,
    pub source_language: String,
    pub target_language: String,
    pub enabled: bool,
    pub entry_count: u64,
    pub installed_size_bytes: u64,
    pub source_kind: DictionarySourceKind,
    pub catalog_id: Option<String>,
    pub source_attribution: String,
    pub license_name: String,
    pub license_url: Option<String>,
    pub package_version: String,
    pub index_state: DictionaryIndexState,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DictionaryRegistryStatus {
    Ready,
    RecoveryRequired,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryRegistrySnapshot {
    pub status: DictionaryRegistryStatus,
    pub dictionaries: Vec<InstalledDictionary>,
    pub recovery: Option<DictionaryRecoveryState>,
}

impl DictionaryRegistrySnapshot {
    fn ready(dictionaries: Vec<InstalledDictionary>) -> Self {
        Self {
            status: DictionaryRegistryStatus::Ready,
            dictionaries,
            recovery: None,
        }
    }

    fn recovery_required(recovery: DictionaryRecoveryState) -> Self {
        Self {
            status: DictionaryRegistryStatus::RecoveryRequired,
            dictionaries: Vec::new(),
            recovery: Some(recovery),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DictionaryRecoveryState {
    pub reason: DictionaryRecoveryReason,
    pub message: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DictionaryRecoveryReason {
    CorruptDatabase,
    UnsupportedSchema,
}

#[derive(Debug)]
pub(crate) enum DictionaryStoreError {
    Activation(String),
    Database(rusqlite::Error),
    Filesystem(std::io::Error),
    InvalidDictionaryId,
    InvalidOrder,
    InvalidStoredValue(&'static str),
    InvalidIndex(String),
    NumericOverflow(&'static str),
    Recovery(String),
    RecoveryRequired(DictionaryRecoveryState),
}

impl fmt::Display for DictionaryStoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Activation(message) => formatter.write_str(message),
            Self::Database(error) => {
                write!(formatter, "Dictionary database operation failed: {error}")
            }
            Self::Filesystem(error) => {
                write!(formatter, "Dictionary storage operation failed: {error}")
            }
            Self::InvalidDictionaryId => formatter.write_str("Dictionary id is invalid."),
            Self::InvalidOrder => formatter
                .write_str("Dictionary order must contain every installed dictionary once."),
            Self::InvalidStoredValue(field) => {
                write!(
                    formatter,
                    "Dictionary database contains an invalid {field}."
                )
            }
            Self::InvalidIndex(message) => formatter.write_str(message),
            Self::NumericOverflow(field) => {
                write!(
                    formatter,
                    "Dictionary {field} is outside the supported range."
                )
            }
            Self::Recovery(message) => formatter.write_str(message),
            Self::RecoveryRequired(state) => formatter.write_str(&state.message),
        }
    }
}

impl From<rusqlite::Error> for DictionaryStoreError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Database(value)
    }
}

impl From<std::io::Error> for DictionaryStoreError {
    fn from(value: std::io::Error) -> Self {
        Self::Filesystem(value)
    }
}

#[derive(Clone, Debug)]
pub(crate) struct DictionaryStoragePaths {
    root: PathBuf,
    database: PathBuf,
    #[allow(dead_code)]
    installed: PathBuf,
}

impl DictionaryStoragePaths {
    pub(crate) fn from_app_data_root(app_data_root: &Path) -> Self {
        let root = app_data_root.join(DICTIONARY_ROOT_NAME);
        Self {
            database: root.join(DATABASE_FILE_NAME),
            installed: root.join(INSTALLED_DIRECTORY_NAME),
            root,
        }
    }

    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    pub(crate) fn database(&self) -> &Path {
        &self.database
    }

    #[allow(dead_code)]
    pub(crate) fn installed_path(
        &self,
        dictionary_id: &str,
    ) -> Result<PathBuf, DictionaryStoreError> {
        validate_dictionary_id(dictionary_id)?;
        Ok(self.installed.join(dictionary_id))
    }

    #[allow(dead_code)]
    fn relative_installed_path(&self, dictionary_id: &str) -> Result<String, DictionaryStoreError> {
        owned_storage_relative_path(dictionary_id)
    }
}

pub(crate) enum DictionaryStoreOpen {
    Current(DictionaryStore),
    RecoveryRequired(DictionaryRecoveryState),
}

pub(crate) struct DictionaryStore {
    connection: Connection,
    #[allow(dead_code)]
    paths: DictionaryStoragePaths,
}

impl DictionaryStore {
    pub(crate) fn open(app_data_root: &Path) -> Result<DictionaryStoreOpen, DictionaryStoreError> {
        let paths = DictionaryStoragePaths::from_app_data_root(app_data_root);
        fs::create_dir_all(paths.root())?;
        let database_existed = paths.database().exists();

        let connection = match Connection::open_with_flags(
            paths.database(),
            OpenFlags::SQLITE_OPEN_READ_WRITE
                | OpenFlags::SQLITE_OPEN_CREATE
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ) {
            Ok(connection) => connection,
            Err(error) => {
                return Ok(DictionaryStoreOpen::RecoveryRequired(corrupt_recovery(
                    &error,
                )))
            }
        };
        if let Err(error) = connection.busy_timeout(SQLITE_BUSY_TIMEOUT) {
            return Ok(DictionaryStoreOpen::RecoveryRequired(corrupt_recovery(
                &error,
            )));
        }
        if let Err(error) = connection.pragma_update(None, "foreign_keys", true) {
            return Ok(DictionaryStoreOpen::RecoveryRequired(corrupt_recovery(
                &error,
            )));
        }

        match inspect_database(&connection) {
            Ok(DatabaseInspection::Empty)
                if database_existed || !recovery_registry_exists(&paths) =>
            {
                initialize_schema(&connection)?
            }
            Ok(DatabaseInspection::Empty) => {
                return Ok(DictionaryStoreOpen::RecoveryRequired(corrupt_recovery(
                    &"the dictionary database is missing",
                )))
            }
            Ok(DatabaseInspection::Current) => {}
            Ok(DatabaseInspection::VersionOne(layout)) => {
                if let Err(error) = migrate_version_one_schema(&connection, layout) {
                    return Ok(DictionaryStoreOpen::RecoveryRequired(corrupt_recovery(
                        &error,
                    )));
                }
            }
            Ok(DatabaseInspection::Unsupported(version)) => {
                return Ok(DictionaryStoreOpen::RecoveryRequired(unsupported_recovery(
                    version,
                )))
            }
            Err(error) => {
                return Ok(DictionaryStoreOpen::RecoveryRequired(corrupt_recovery(
                    &error,
                )))
            }
        }

        if let Err(error) = verify_schema(&connection) {
            return Ok(DictionaryStoreOpen::RecoveryRequired(corrupt_recovery(
                &error,
            )));
        }
        if let Err(error) = list_with_connection(&connection) {
            return Ok(DictionaryStoreOpen::RecoveryRequired(corrupt_recovery(
                &error,
            )));
        }

        Ok(DictionaryStoreOpen::Current(Self { connection, paths }))
    }

    pub(crate) fn snapshot(
        app_data_root: &Path,
    ) -> Result<DictionaryRegistrySnapshot, DictionaryStoreError> {
        match Self::open(app_data_root)? {
            DictionaryStoreOpen::Current(mut store) => {
                store.reconcile_installed_resources()?;
                Ok(DictionaryRegistrySnapshot::ready(store.list()?))
            }
            DictionaryStoreOpen::RecoveryRequired(recovery)
                if recovery.reason == DictionaryRecoveryReason::CorruptDatabase =>
            {
                match recover_database_from_installed_registry(app_data_root) {
                    Ok(mut store) => {
                        store.reconcile_installed_resources()?;
                        Ok(DictionaryRegistrySnapshot::ready(store.list()?))
                    }
                    Err(error) => Ok(DictionaryRegistrySnapshot::recovery_required(
                        DictionaryRecoveryState {
                            reason: recovery.reason,
                            message: format!("{} Recovery failed: {error}", recovery.message),
                        },
                    )),
                }
            }
            DictionaryStoreOpen::RecoveryRequired(recovery) => {
                Ok(DictionaryRegistrySnapshot::recovery_required(recovery))
            }
        }
    }

    pub(crate) fn list(&self) -> Result<Vec<InstalledDictionary>, DictionaryStoreError> {
        list_with_connection(&self.connection)
    }

    fn reconcile_installed_resources(&mut self) -> Result<(), DictionaryStoreError> {
        let dictionaries = self.list()?;
        let mut resources = Vec::with_capacity(dictionaries.len());
        let mut changed = false;
        for dictionary in &dictionaries {
            let installed_path = self.paths.installed_path(&dictionary.id)?;
            match dictionary_index::validate_installed_package(&installed_path) {
                Ok(package) => {
                    let installed_size_bytes = package
                        .source_files
                        .iter()
                        .map(|source| source.byte_length)
                        .sum::<u64>();
                    let index_current = dictionary_index::dictionary_index_is_current(
                        &self.connection,
                        &dictionary.id,
                        &package,
                    )
                    .unwrap_or(false);
                    let current = index_current
                        && dictionary.index_state == DictionaryIndexState::Ready
                        && dictionary.entry_count == package.entries.len() as u64
                        && dictionary.installed_size_bytes == installed_size_bytes;
                    changed |= !current;
                    resources.push(Some((package, installed_size_bytes, current)));
                }
                Err(_) => {
                    changed |= dictionary.index_state != DictionaryIndexState::Unavailable;
                    resources.push(None);
                }
            }
        }

        if !changed {
            let recovery_is_current = recovery_registry_uses_current_schema(&self.paths)
                && read_recovery_registry(&self.paths)
                    .ok()
                    .is_some_and(|recovered| recovered == dictionaries);
            if !recovery_is_current {
                stage_recovery_registry(&self.paths, &dictionaries)?.commit();
            }
            return Ok(());
        }

        let transaction = self.connection.transaction()?;
        for (dictionary, resource) in dictionaries.iter().zip(resources) {
            match resource {
                Some((package, installed_size_bytes, false)) => {
                    transaction.execute(
                        "UPDATE installed_dictionaries
                         SET installed_size_bytes = ?1
                         WHERE dictionary_id = ?2",
                        params![
                            to_sql_integer(installed_size_bytes, "installed size")?,
                            dictionary.id
                        ],
                    )?;
                    dictionary_index::replace_dictionary_index_in_transaction(
                        &transaction,
                        &dictionary.id,
                        &package,
                        package.definition_data.expanded_bytes,
                    )?;
                }
                Some((_package, _installed_size_bytes, true)) => {}
                None => {
                    transaction.execute(
                        "DELETE FROM dictionary_entries WHERE dictionary_id = ?1",
                        [&dictionary.id],
                    )?;
                    transaction.execute(
                        "UPDATE installed_dictionaries
                         SET index_state = ?1
                         WHERE dictionary_id = ?2",
                        params![
                            DictionaryIndexState::Unavailable.as_database_value(),
                            dictionary.id
                        ],
                    )?;
                }
            }
        }
        let settled = list_with_connection(&transaction)?;
        let recovery = stage_recovery_registry(&self.paths, &settled)?;
        commit_with_recovery_registry(transaction, recovery)
    }

    #[allow(dead_code)]
    pub(crate) fn register(
        &mut self,
        registration: DictionaryRegistration,
    ) -> Result<InstalledDictionary, DictionaryStoreError> {
        let transaction = self.connection.transaction()?;
        let dictionary_id = generate_dictionary_id(&transaction)?;
        let storage_relative_path = self.paths.relative_installed_path(&dictionary_id)?;
        let order: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(sort_order) + 1, 0) FROM installed_dictionaries",
            [],
            |row| row.get(0),
        )?;
        insert_registration(
            &transaction,
            &dictionary_id,
            &storage_relative_path,
            order,
            &registration,
        )?;
        let dictionaries = list_with_connection(&transaction)?;
        let recovery = stage_recovery_registry(&self.paths, &dictionaries)?;
        commit_with_recovery_registry(transaction, recovery)?;

        self.get(&dictionary_id)?
            .ok_or(DictionaryStoreError::InvalidStoredValue("new dictionary"))
    }

    pub(crate) fn install_dictionary<Activate, Rollback>(
        &mut self,
        registration: DictionaryRegistration,
        package: &ValidatedStarDictPackage,
        installed_definition_bytes: u64,
        activate: Activate,
        rollback_activation: Rollback,
    ) -> Result<InstalledDictionary, DictionaryStoreError>
    where
        Activate: FnOnce(&str, &Path) -> Result<(), String>,
        Rollback: FnOnce(&Path) -> Result<(), String>,
    {
        let paths = self.paths.clone();
        let transaction = self.connection.transaction()?;
        let dictionary_id = generate_dictionary_id(&transaction)?;
        let storage_relative_path = paths.relative_installed_path(&dictionary_id)?;
        let installed_path = paths.installed_path(&dictionary_id)?;
        let order: i64 = transaction.query_row(
            "SELECT COALESCE(MAX(sort_order) + 1, 0) FROM installed_dictionaries",
            [],
            |row| row.get(0),
        )?;
        insert_registration(
            &transaction,
            &dictionary_id,
            &storage_relative_path,
            order,
            &registration,
        )?;
        dictionary_index::replace_dictionary_index_in_transaction(
            &transaction,
            &dictionary_id,
            package,
            installed_definition_bytes,
        )?;

        activate(&dictionary_id, &installed_path).map_err(DictionaryStoreError::Activation)?;
        let dictionaries = list_with_connection(&transaction)?;
        let recovery = match stage_recovery_registry(&paths, &dictionaries) {
            Ok(recovery) => recovery,
            Err(error) => {
                return match rollback_activation(&installed_path) {
                    Ok(()) => Err(error),
                    Err(rollback_error) => Err(DictionaryStoreError::Activation(format!(
                        "Dictionary recovery publication failed ({error}) and activated-file cleanup failed: {rollback_error}"
                    ))),
                }
            }
        };
        if let Err(error) = transaction.commit() {
            let recovery_error = recovery.rollback().err();
            return match rollback_activation(&installed_path) {
                Ok(()) if recovery_error.is_none() => Err(DictionaryStoreError::Database(error)),
                Ok(()) => Err(DictionaryStoreError::Activation(format!(
                    "Dictionary database publication failed ({error}) and recovery-registry restoration failed: {}",
                    recovery_error.unwrap()
                ))),
                Err(rollback_error) => Err(DictionaryStoreError::Activation(format!(
                    "Dictionary database publication failed ({error}) and activated-file cleanup failed: {rollback_error}"
                ))),
            };
        }
        recovery.commit();
        self.get(&dictionary_id)?
            .ok_or(DictionaryStoreError::InvalidStoredValue("new dictionary"))
    }

    pub(crate) fn unavailable_catalog_dictionary(
        &self,
        catalog_id: &str,
    ) -> Result<Option<InstalledDictionary>, DictionaryStoreError> {
        let matches = self
            .list()?
            .into_iter()
            .filter(|dictionary| {
                dictionary.source_kind == DictionarySourceKind::Catalog
                    && dictionary.catalog_id.as_deref() == Some(catalog_id)
                    && dictionary.index_state == DictionaryIndexState::Unavailable
            })
            .collect::<Vec<_>>();
        match matches.as_slice() {
            [] => Ok(None),
            [dictionary] => Ok(Some(dictionary.clone())),
            _ => Err(DictionaryStoreError::InvalidStoredValue(
                "catalog recovery identity",
            )),
        }
    }

    pub(crate) fn replace_unavailable_dictionary<Activate, Rollback>(
        &mut self,
        dictionary_id: &str,
        registration: DictionaryRegistration,
        package: &ValidatedStarDictPackage,
        installed_definition_bytes: u64,
        activate: Activate,
        rollback_activation: Rollback,
    ) -> Result<InstalledDictionary, DictionaryStoreError>
    where
        Activate: FnOnce(&str, &Path) -> Result<(), String>,
        Rollback: FnOnce(&Path) -> Result<(), String>,
    {
        validate_dictionary_id(dictionary_id)?;
        let current = self
            .get(dictionary_id)?
            .ok_or(DictionaryStoreError::InvalidDictionaryId)?;
        if current.source_kind != DictionarySourceKind::Catalog
            || current.index_state != DictionaryIndexState::Unavailable
            || current.catalog_id != registration.catalog_id
        {
            return Err(DictionaryStoreError::InvalidDictionaryId);
        }
        validate_language_pair(&registration.source_language, &registration.target_language)?;

        let paths = self.paths.clone();
        let installed_path = paths.installed_path(dictionary_id)?;
        let transaction = self.connection.transaction()?;
        let updated = transaction.execute(
            "UPDATE installed_dictionaries
             SET display_name = ?1, source_language = ?2, target_language = ?3, entry_count = ?4,
                 installed_size_bytes = ?5, source_attribution = ?6,
                 license_name = ?7, license_url = ?8, package_version = ?9,
                 index_state = ?10
             WHERE dictionary_id = ?11 AND index_state = 'unavailable'",
            params![
                registration.display_name,
                registration.source_language,
                registration.target_language,
                to_sql_integer(registration.entry_count, "entry count")?,
                to_sql_integer(registration.installed_size_bytes, "installed size")?,
                registration.source_attribution,
                registration.license_name,
                registration.license_url,
                registration.package_version,
                registration.index_state.as_database_value(),
                dictionary_id,
            ],
        )?;
        if updated != 1 {
            return Err(DictionaryStoreError::InvalidDictionaryId);
        }
        dictionary_index::replace_dictionary_index_in_transaction(
            &transaction,
            dictionary_id,
            package,
            installed_definition_bytes,
        )?;

        activate(dictionary_id, &installed_path).map_err(DictionaryStoreError::Activation)?;
        let dictionaries = list_with_connection(&transaction)?;
        let recovery = match stage_recovery_registry(&paths, &dictionaries) {
            Ok(recovery) => recovery,
            Err(error) => {
                return match rollback_activation(&installed_path) {
                    Ok(()) => Err(error),
                    Err(rollback_error) => Err(DictionaryStoreError::Activation(format!(
                        "Dictionary recovery publication failed ({error}) and replacement rollback failed: {rollback_error}"
                    ))),
                }
            }
        };
        if let Err(error) = transaction.commit() {
            let recovery_error = recovery.rollback().err();
            return match rollback_activation(&installed_path) {
                Ok(()) if recovery_error.is_none() => Err(DictionaryStoreError::Database(error)),
                Ok(()) => Err(DictionaryStoreError::Activation(format!(
                    "Dictionary replacement failed ({error}) and recovery-registry restoration failed: {}",
                    recovery_error.unwrap()
                ))),
                Err(rollback_error) => Err(DictionaryStoreError::Activation(format!(
                    "Dictionary replacement failed ({error}) and installed-file restoration failed: {rollback_error}"
                ))),
            };
        }
        recovery.commit();
        self.get(dictionary_id)?
            .ok_or(DictionaryStoreError::InvalidStoredValue(
                "replaced dictionary",
            ))
    }

    pub(crate) fn set_enabled(
        &mut self,
        dictionary_id: &str,
        enabled: bool,
    ) -> Result<Vec<InstalledDictionary>, DictionaryStoreError> {
        validate_dictionary_id(dictionary_id)?;
        let transaction = self.connection.transaction()?;
        let changed = transaction.execute(
            "UPDATE installed_dictionaries SET enabled = ?1 WHERE dictionary_id = ?2",
            params![enabled, dictionary_id],
        )?;
        if changed != 1 {
            return Err(DictionaryStoreError::InvalidDictionaryId);
        }
        let dictionaries = list_with_connection(&transaction)?;
        let recovery = stage_recovery_registry(&self.paths, &dictionaries)?;
        commit_with_recovery_registry(transaction, recovery)?;
        self.list()
    }

    pub(crate) fn set_order(
        &mut self,
        ordered_ids: &[String],
    ) -> Result<Vec<InstalledDictionary>, DictionaryStoreError> {
        let transaction = self.connection.transaction()?;
        let current_ids = list_ids(&transaction)?;
        validate_complete_order(&current_ids, ordered_ids)?;

        for (order, dictionary_id) in ordered_ids.iter().enumerate() {
            transaction.execute(
                "UPDATE installed_dictionaries SET sort_order = ?1 WHERE dictionary_id = ?2",
                params![to_sql_integer(order as u64, "order")?, dictionary_id],
            )?;
        }
        let dictionaries = list_with_connection(&transaction)?;
        let recovery = stage_recovery_registry(&self.paths, &dictionaries)?;
        commit_with_recovery_registry(transaction, recovery)?;
        self.list()
    }

    pub(crate) fn remove_dictionary(
        &mut self,
        dictionary_id: &str,
    ) -> Result<Vec<InstalledDictionary>, DictionaryStoreError> {
        validate_dictionary_id(dictionary_id)?;
        let installed = self
            .get(dictionary_id)?
            .ok_or(DictionaryStoreError::InvalidDictionaryId)?;
        let installed_path = self.paths.installed_path(dictionary_id)?;
        let retired_path = match fs::symlink_metadata(&installed_path) {
            Ok(metadata) if metadata.file_type().is_dir() => {
                let retired_parent = self.paths.root().join(REMOVAL_STAGING_DIRECTORY);
                fs::create_dir_all(&retired_parent)?;
                let retired_path = retired_parent.join(dictionary_id);
                if fs::symlink_metadata(&retired_path).is_ok() {
                    return Err(DictionaryStoreError::Activation(
                        "Dictionary removal staging already exists and requires recovery."
                            .to_string(),
                    ));
                }
                fs::rename(&installed_path, &retired_path)?;
                Some(retired_path)
            }
            Ok(_) => {
                return Err(DictionaryStoreError::Activation(
                    "Installed dictionary storage is not a regular directory.".to_string(),
                ))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };

        let database_result = (|| {
            let transaction = self.connection.transaction()?;
            let removed = transaction.execute(
                "DELETE FROM installed_dictionaries WHERE dictionary_id = ?1",
                [dictionary_id],
            )?;
            if removed != 1 {
                return Err(DictionaryStoreError::InvalidDictionaryId);
            }
            transaction.execute(
                "UPDATE installed_dictionaries
                 SET sort_order = sort_order - 1
                 WHERE sort_order > ?1",
                [i64::from(installed.order)],
            )?;
            let dictionaries = list_with_connection(&transaction)?;
            let recovery = stage_recovery_registry(&self.paths, &dictionaries)?;
            commit_with_recovery_registry(transaction, recovery)?;
            Ok(())
        })();

        if let Err(error) = database_result {
            return if let Some(retired_path) = &retired_path {
                match fs::rename(retired_path, &installed_path) {
                    Ok(()) => Err(error),
                    Err(restore_error) => Err(DictionaryStoreError::Activation(format!(
                        "Dictionary removal failed ({error}) and installed-file restoration failed: {restore_error}"
                    ))),
                }
            } else {
                Err(error)
            };
        }

        if let Some(retired_path) = retired_path {
            if let Err(error) = fs::remove_dir_all(&retired_path) {
                eprintln!(
                    "Dictionary removal committed but retired-file cleanup failed at {}: {error}",
                    retired_path.display()
                );
            }
        }
        self.list()
    }

    pub(crate) fn get(
        &self,
        dictionary_id: &str,
    ) -> Result<Option<InstalledDictionary>, DictionaryStoreError> {
        let mut statement = self.connection.prepare(
            "SELECT
                dictionary_id,
                display_name,
                source_language,
                target_language,
                enabled,
                sort_order,
                entry_count,
                installed_size_bytes,
                source_kind,
                catalog_id,
                source_attribution,
                license_name,
                license_url,
                package_version,
                index_state,
                storage_relative_path
            FROM installed_dictionaries
            WHERE dictionary_id = ?1",
        )?;
        statement
            .query_row([dictionary_id], read_dictionary)
            .optional()
            .map_err(DictionaryStoreError::from)
    }

    #[allow(dead_code)]
    pub(crate) fn installed_path(
        &self,
        dictionary_id: &str,
    ) -> Result<PathBuf, DictionaryStoreError> {
        self.paths.installed_path(dictionary_id)
    }

    pub(crate) fn replace_index(
        &mut self,
        dictionary_id: &str,
        package: &ValidatedStarDictPackage,
        installed_definition_bytes: u64,
    ) -> Result<(), DictionaryStoreError> {
        validate_dictionary_id(dictionary_id)?;
        let transaction = self.connection.transaction()?;
        dictionary_index::replace_dictionary_index_in_transaction(
            &transaction,
            dictionary_id,
            package,
            installed_definition_bytes,
        )?;
        let dictionaries = list_with_connection(&transaction)?;
        let recovery = stage_recovery_registry(&self.paths, &dictionaries)?;
        commit_with_recovery_registry(transaction, recovery)
    }

    #[allow(dead_code)]
    pub(crate) fn lookup_exact(
        &self,
        headword: &str,
        maximum_results: usize,
    ) -> Result<Vec<DictionaryLookupEntry>, DictionaryStoreError> {
        dictionary_index::lookup_exact(&self.connection, headword, maximum_results)
    }

    pub(crate) fn lookup_english_lemmas(
        &self,
        lemmas: &[String],
        maximum_results: usize,
    ) -> Result<Vec<DictionaryLookupEntry>, DictionaryStoreError> {
        dictionary_index::lookup_english_lemmas(&self.connection, lemmas, maximum_results)
    }

    #[allow(dead_code)]
    pub(crate) fn rebuild_index(
        &mut self,
        dictionary_id: &str,
    ) -> Result<(), DictionaryStoreError> {
        validate_dictionary_id(dictionary_id)?;
        dictionary_index::rebuild_dictionary_index(self, dictionary_id)
    }

    #[cfg(test)]
    pub(crate) fn connection(&self) -> &Connection {
        &self.connection
    }
}

enum DatabaseInspection {
    Empty,
    Current,
    VersionOne(VersionOneSchema),
    Unsupported(i64),
}

#[derive(Clone, Copy)]
enum VersionOneSchema {
    SingleLanguage,
    LanguagePair,
}

fn inspect_database(connection: &Connection) -> rusqlite::Result<DatabaseInspection> {
    let quick_check: String =
        connection.query_row("PRAGMA quick_check(1)", [], |row| row.get(0))?;
    if quick_check != "ok" {
        return Err(rusqlite::Error::InvalidQuery);
    }

    let version: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
    if version == SCHEMA_VERSION {
        return Ok(DatabaseInspection::Current);
    }
    if version == 1 {
        return Ok(inspect_version_one_schema(connection)?
            .map(DatabaseInspection::VersionOne)
            .unwrap_or(DatabaseInspection::Unsupported(version)));
    }
    if version != 0 {
        return Ok(DatabaseInspection::Unsupported(version));
    }

    let application_table_count: i64 = connection.query_row(
        "SELECT COUNT(*) FROM sqlite_schema
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        [],
        |row| row.get(0),
    )?;
    if application_table_count == 0 {
        Ok(DatabaseInspection::Empty)
    } else {
        Ok(DatabaseInspection::Unsupported(version))
    }
}

fn inspect_version_one_schema(
    connection: &Connection,
) -> rusqlite::Result<Option<VersionOneSchema>> {
    let mut statement = connection.prepare("PRAGMA table_info(installed_dictionaries)")?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<HashSet<_>, _>>()?;
    if columns.is_empty() {
        return Ok(None);
    }

    let has_single_language = columns.contains("language");
    let has_source_language = columns.contains("source_language");
    let has_target_language = columns.contains("target_language");
    match (
        has_single_language,
        has_source_language,
        has_target_language,
    ) {
        (true, false, false) => Ok(Some(VersionOneSchema::SingleLanguage)),
        (false, true, true) => Ok(Some(VersionOneSchema::LanguagePair)),
        _ => Ok(None),
    }
}

fn migrate_version_one_schema(
    connection: &Connection,
    layout: VersionOneSchema,
) -> Result<(), DictionaryStoreError> {
    if matches!(layout, VersionOneSchema::SingleLanguage) {
        let mut statement = connection.prepare("SELECT language FROM installed_dictionaries")?;
        let languages = statement
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        for language in languages {
            if !is_canonical_language_tag(&language) {
                return Err(DictionaryStoreError::InvalidStoredValue("language"));
            }
        }
    }

    let transaction = connection.unchecked_transaction()?;
    if matches!(layout, VersionOneSchema::SingleLanguage) {
        transaction.execute_batch(
            "ALTER TABLE installed_dictionaries
                 ADD COLUMN source_language TEXT NOT NULL DEFAULT 'und';
             ALTER TABLE installed_dictionaries
                 ADD COLUMN target_language TEXT NOT NULL DEFAULT 'und';
             UPDATE installed_dictionaries
             SET source_language = language, target_language = language;
             ALTER TABLE installed_dictionaries DROP COLUMN language;",
        )?;
    }
    transaction.pragma_update(None, "user_version", SCHEMA_VERSION)?;
    transaction.commit()?;
    Ok(())
}

fn initialize_schema(connection: &Connection) -> Result<(), DictionaryStoreError> {
    let transaction = connection.unchecked_transaction()?;
    transaction.execute_batch(CREATE_SCHEMA)?;
    transaction.commit()?;
    Ok(())
}

fn verify_schema(connection: &Connection) -> rusqlite::Result<()> {
    connection.prepare(VERIFY_SCHEMA)?;
    connection.prepare(
        "SELECT dictionary_id, source_ordinal, normalized_headword, display_headword,
                definition_offset, definition_length
         FROM dictionary_entries LIMIT 0",
    )?;
    connection.prepare(
        "SELECT dictionary_id, normalized_alias, source_ordinal
         FROM dictionary_aliases LIMIT 0",
    )?;
    Ok(())
}

fn list_with_connection(
    connection: &Connection,
) -> Result<Vec<InstalledDictionary>, DictionaryStoreError> {
    let mut statement = connection.prepare(
        "SELECT
            dictionary_id,
            display_name,
            source_language,
            target_language,
            enabled,
            sort_order,
            entry_count,
            installed_size_bytes,
            source_kind,
            catalog_id,
            source_attribution,
            license_name,
            license_url,
            package_version,
            index_state,
            storage_relative_path
        FROM installed_dictionaries
        ORDER BY sort_order, dictionary_id",
    )?;
    let rows = statement.query_map([], read_dictionary)?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(DictionaryStoreError::from)
}

fn stage_recovery_registry(
    paths: &DictionaryStoragePaths,
    dictionaries: &[InstalledDictionary],
) -> Result<StagedRecoveryRegistry, DictionaryStoreError> {
    validate_recovery_dictionaries(dictionaries)?;
    StagedRecoveryRegistry::stage(paths, dictionaries)
        .map_err(|error| DictionaryStoreError::Recovery(error.to_string()))
}

fn commit_with_recovery_registry(
    transaction: Transaction<'_>,
    recovery: StagedRecoveryRegistry,
) -> Result<(), DictionaryStoreError> {
    match transaction.commit() {
        Ok(()) => {
            recovery.commit();
            Ok(())
        }
        Err(database_error) => match recovery.rollback() {
            Ok(()) => Err(DictionaryStoreError::Database(database_error)),
            Err(recovery_error) => Err(DictionaryStoreError::Recovery(format!(
                "Dictionary database publication failed ({database_error}) and recovery-registry restoration failed: {recovery_error}"
            ))),
        },
    }
}

fn validate_recovery_dictionaries(
    dictionaries: &[InstalledDictionary],
) -> Result<(), DictionaryStoreError> {
    let mut ids = HashSet::new();
    let mut orders = HashSet::new();
    for dictionary in dictionaries {
        validate_dictionary_id(&dictionary.id)?;
        if dictionary.storage_relative_path != owned_storage_relative_path(&dictionary.id)? {
            return Err(DictionaryStoreError::InvalidStoredValue("storage path"));
        }
        validate_language_pair(&dictionary.source_language, &dictionary.target_language)?;
        if !ids.insert(dictionary.id.as_str()) || !orders.insert(dictionary.order) {
            return Err(DictionaryStoreError::InvalidStoredValue(
                "recovery registry identity or order",
            ));
        }
        match dictionary.source_kind {
            DictionarySourceKind::Catalog if dictionary.catalog_id.is_none() => {
                return Err(DictionaryStoreError::InvalidStoredValue("catalog id"))
            }
            DictionarySourceKind::ManualImport if dictionary.catalog_id.is_some() => {
                return Err(DictionaryStoreError::InvalidStoredValue("catalog id"))
            }
            _ => {}
        }
    }
    if orders.len() != dictionaries.len()
        || !(0..dictionaries.len() as u32).all(|order| orders.contains(&order))
    {
        return Err(DictionaryStoreError::InvalidOrder);
    }
    Ok(())
}

fn recover_database_from_installed_registry(
    app_data_root: &Path,
) -> Result<DictionaryStore, DictionaryStoreError> {
    let paths = DictionaryStoragePaths::from_app_data_root(app_data_root);
    let mut dictionaries = read_recovery_registry(&paths)
        .map_err(|error| DictionaryStoreError::Recovery(error.to_string()))?;
    dictionaries.sort_by_key(|dictionary| (dictionary.order, dictionary.id.clone()));
    validate_recovery_dictionaries(&dictionaries)?;

    let recovery_database = paths.root().join("dictionaries.sqlite3.recovery");
    remove_recognized_database_artifact(&recovery_database)?;
    let mut connection = Connection::open_with_flags(
        &recovery_database,
        OpenFlags::SQLITE_OPEN_READ_WRITE
            | OpenFlags::SQLITE_OPEN_CREATE
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    connection.busy_timeout(SQLITE_BUSY_TIMEOUT)?;
    connection.pragma_update(None, "foreign_keys", true)?;
    initialize_schema(&connection)?;
    {
        let transaction = connection.transaction()?;
        for dictionary in &dictionaries {
            let installed_path = paths.installed_path(&dictionary.id)?;
            let package = dictionary_index::validate_installed_package(&installed_path).ok();
            let installed_size_bytes = package
                .as_ref()
                .map(|package| {
                    package
                        .source_files
                        .iter()
                        .map(|source| source.byte_length)
                        .sum()
                })
                .unwrap_or(dictionary.installed_size_bytes);
            let registration = DictionaryRegistration {
                display_name: dictionary.display_name.clone(),
                source_language: dictionary.source_language.clone(),
                target_language: dictionary.target_language.clone(),
                enabled: dictionary.enabled,
                entry_count: if package.is_some() {
                    0
                } else {
                    dictionary.entry_count
                },
                installed_size_bytes,
                source_kind: dictionary.source_kind,
                catalog_id: dictionary.catalog_id.clone(),
                source_attribution: dictionary.source_attribution.clone(),
                license_name: dictionary.license_name.clone(),
                license_url: dictionary.license_url.clone(),
                package_version: dictionary.package_version.clone(),
                index_state: if package.is_some() {
                    DictionaryIndexState::Pending
                } else {
                    DictionaryIndexState::Unavailable
                },
            };
            insert_registration(
                &transaction,
                &dictionary.id,
                &dictionary.storage_relative_path,
                i64::from(dictionary.order),
                &registration,
            )?;
            if let Some(package) = package {
                dictionary_index::replace_dictionary_index_in_transaction(
                    &transaction,
                    &dictionary.id,
                    &package,
                    package.definition_data.expanded_bytes,
                )?;
            }
        }
        transaction.commit()?;
    }
    connection.close().map_err(|(_, error)| error)?;

    let retired_database = paths.root().join("dictionaries.sqlite3.corrupt");
    remove_recognized_database_artifact(&retired_database)?;
    let database_was_present = match fs::symlink_metadata(paths.database()) {
        Ok(_) => {
            fs::rename(paths.database(), &retired_database)?;
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(error.into()),
    };
    if let Err(error) = fs::rename(&recovery_database, paths.database()) {
        if database_was_present {
            let _ = fs::rename(&retired_database, paths.database());
        }
        return Err(error.into());
    }

    let recovered = match DictionaryStore::open(app_data_root)? {
        DictionaryStoreOpen::Current(store) => store,
        DictionaryStoreOpen::RecoveryRequired(state) => {
            let _ = fs::remove_file(paths.database());
            if database_was_present {
                let _ = fs::rename(&retired_database, paths.database());
            }
            return Err(DictionaryStoreError::Recovery(format!(
                "Rebuilt dictionary database did not open successfully: {}",
                state.message
            )));
        }
    };
    if database_was_present {
        if let Err(error) = remove_recognized_database_artifact(&retired_database) {
            eprintln!(
                "Dictionary database recovery committed but retired-database cleanup failed at {}: {error}",
                retired_database.display()
            );
        }
    }
    Ok(recovered)
}

fn remove_recognized_database_artifact(path: &Path) -> Result<(), DictionaryStoreError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() => fs::remove_file(path)?,
        Ok(metadata) if metadata.file_type().is_dir() => fs::remove_dir_all(path)?,
        Ok(_) => {
            return Err(DictionaryStoreError::Recovery(format!(
                "Recognized dictionary database recovery path is not a regular resource: {}",
                path.display()
            )))
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    Ok(())
}

fn read_dictionary(row: &rusqlite::Row<'_>) -> rusqlite::Result<InstalledDictionary> {
    let id: String = row.get(0)?;
    let source_language: String = row.get(2)?;
    let target_language: String = row.get(3)?;
    validate_language_pair(&source_language, &target_language).map_err(to_sql_conversion_error)?;
    let source_kind: String = row.get(8)?;
    let index_state: String = row.get(14)?;
    let order: i64 = row.get(5)?;
    let entry_count: i64 = row.get(6)?;
    let installed_size_bytes: i64 = row.get(7)?;
    let storage_relative_path: String = row.get(15)?;
    let expected_storage_relative_path =
        owned_storage_relative_path(&id).map_err(to_sql_conversion_error)?;
    if storage_relative_path != expected_storage_relative_path {
        return Err(to_sql_conversion_error(
            DictionaryStoreError::InvalidStoredValue("storage path"),
        ));
    }

    Ok(InstalledDictionary {
        id,
        display_name: row.get(1)?,
        source_language,
        target_language,
        enabled: row.get(4)?,
        order: to_u32(order, "order").map_err(to_sql_conversion_error)?,
        entry_count: to_u64(entry_count, "entry count").map_err(to_sql_conversion_error)?,
        installed_size_bytes: to_u64(installed_size_bytes, "installed size")
            .map_err(to_sql_conversion_error)?,
        source_kind: DictionarySourceKind::from_database_value(&source_kind)
            .map_err(to_sql_conversion_error)?,
        catalog_id: row.get(9)?,
        source_attribution: row.get(10)?,
        license_name: row.get(11)?,
        license_url: row.get(12)?,
        package_version: row.get(13)?,
        index_state: DictionaryIndexState::from_database_value(&index_state)
            .map_err(to_sql_conversion_error)?,
        storage_relative_path,
    })
}

fn to_sql_conversion_error(error: DictionaryStoreError) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        0,
        rusqlite::types::Type::Text,
        Box::new(std::io::Error::new(
            std::io::ErrorKind::InvalidData,
            error.to_string(),
        )),
    )
}

#[allow(dead_code)]
fn generate_dictionary_id(transaction: &Transaction<'_>) -> Result<String, DictionaryStoreError> {
    for _ in 0..8 {
        let random_hex: String =
            transaction.query_row("SELECT lower(hex(randomblob(16)))", [], |row| row.get(0))?;
        let dictionary_id = format!("dict-{random_hex}");
        let exists: bool = transaction.query_row(
            "SELECT EXISTS(
                SELECT 1 FROM installed_dictionaries WHERE dictionary_id = ?1
            )",
            [&dictionary_id],
            |row| row.get(0),
        )?;
        if !exists {
            return Ok(dictionary_id);
        }
    }
    Err(DictionaryStoreError::InvalidStoredValue(
        "generated dictionary id",
    ))
}

fn insert_registration(
    transaction: &Transaction<'_>,
    dictionary_id: &str,
    storage_relative_path: &str,
    order: i64,
    registration: &DictionaryRegistration,
) -> Result<(), DictionaryStoreError> {
    validate_language_pair(&registration.source_language, &registration.target_language)?;
    transaction.execute(
        "INSERT INTO installed_dictionaries (
            dictionary_id, display_name, source_language, target_language, enabled, sort_order, entry_count,
            installed_size_bytes, source_kind, catalog_id, source_attribution,
            license_name, license_url, package_version, index_state, storage_relative_path
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
        params![
            dictionary_id,
            registration.display_name,
            registration.source_language,
            registration.target_language,
            registration.enabled,
            order,
            to_sql_integer(registration.entry_count, "entry count")?,
            to_sql_integer(registration.installed_size_bytes, "installed size")?,
            registration.source_kind.as_database_value(),
            registration.catalog_id,
            registration.source_attribution,
            registration.license_name,
            registration.license_url,
            registration.package_version,
            registration.index_state.as_database_value(),
            storage_relative_path,
        ],
    )?;
    Ok(())
}

fn validate_language_pair(
    source_language: &str,
    target_language: &str,
) -> Result<(), DictionaryStoreError> {
    if !is_canonical_language_tag(source_language) {
        return Err(DictionaryStoreError::InvalidStoredValue("source language"));
    }
    if !is_canonical_language_tag(target_language) {
        return Err(DictionaryStoreError::InvalidStoredValue("target language"));
    }
    Ok(())
}

fn validate_dictionary_id(dictionary_id: &str) -> Result<(), DictionaryStoreError> {
    let Some(random_part) = dictionary_id.strip_prefix("dict-") else {
        return Err(DictionaryStoreError::InvalidDictionaryId);
    };
    if random_part.len() != 32
        || !random_part
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(DictionaryStoreError::InvalidDictionaryId);
    }
    Ok(())
}

fn owned_storage_relative_path(dictionary_id: &str) -> Result<String, DictionaryStoreError> {
    validate_dictionary_id(dictionary_id)?;
    Ok(format!("{INSTALLED_DIRECTORY_NAME}/{dictionary_id}"))
}

fn list_ids(transaction: &Transaction<'_>) -> Result<Vec<String>, DictionaryStoreError> {
    let mut statement = transaction.prepare(
        "SELECT dictionary_id FROM installed_dictionaries ORDER BY sort_order, dictionary_id",
    )?;
    let rows = statement.query_map([], |row| row.get(0))?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(DictionaryStoreError::from)
}

fn validate_complete_order(
    current_ids: &[String],
    ordered_ids: &[String],
) -> Result<(), DictionaryStoreError> {
    if current_ids.len() != ordered_ids.len() {
        return Err(DictionaryStoreError::InvalidOrder);
    }
    let current = current_ids.iter().collect::<HashSet<_>>();
    let ordered = ordered_ids.iter().collect::<HashSet<_>>();
    if ordered.len() != ordered_ids.len() || current != ordered {
        return Err(DictionaryStoreError::InvalidOrder);
    }
    Ok(())
}

fn to_sql_integer(value: u64, field: &'static str) -> Result<i64, DictionaryStoreError> {
    i64::try_from(value).map_err(|_| DictionaryStoreError::NumericOverflow(field))
}

fn to_u64(value: i64, field: &'static str) -> Result<u64, DictionaryStoreError> {
    u64::try_from(value).map_err(|_| DictionaryStoreError::NumericOverflow(field))
}

fn to_u32(value: i64, field: &'static str) -> Result<u32, DictionaryStoreError> {
    u32::try_from(value).map_err(|_| DictionaryStoreError::NumericOverflow(field))
}

fn unsupported_recovery(version: i64) -> DictionaryRecoveryState {
    DictionaryRecoveryState {
        reason: DictionaryRecoveryReason::UnsupportedSchema,
        message: format!(
            "Dictionary storage uses unsupported schema version {version} and requires recovery."
        ),
    }
}

fn corrupt_recovery(error: &impl fmt::Display) -> DictionaryRecoveryState {
    DictionaryRecoveryState {
        reason: DictionaryRecoveryReason::CorruptDatabase,
        message: format!("Dictionary storage is unavailable and requires recovery: {error}"),
    }
}

pub(crate) fn open_current_store(
    app_data_root: &Path,
) -> Result<DictionaryStore, DictionaryStoreError> {
    match DictionaryStore::open(app_data_root)? {
        DictionaryStoreOpen::Current(store) => Ok(store),
        DictionaryStoreOpen::RecoveryRequired(recovery) => {
            Err(DictionaryStoreError::RecoveryRequired(recovery))
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::Path,
        sync::atomic::{AtomicU64, Ordering},
    };

    use rusqlite::Connection;

    use super::{
        open_current_store, DictionaryIndexState, DictionaryRecoveryReason, DictionaryRegistration,
        DictionaryRegistryStatus, DictionarySourceKind, DictionaryStoragePaths, DictionaryStore,
        DictionaryStoreOpen,
    };

    static TEST_NONCE: AtomicU64 = AtomicU64::new(0);

    fn test_root(label: &str) -> std::path::PathBuf {
        let nonce = TEST_NONCE.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "archeion-dictionary-store-{label}-{}-{nonce}",
            std::process::id()
        ))
    }

    fn registration(name: &str) -> DictionaryRegistration {
        DictionaryRegistration {
            display_name: name.to_string(),
            source_language: "en".to_string(),
            target_language: "en".to_string(),
            enabled: true,
            entry_count: 42,
            installed_size_bytes: 4096,
            source_kind: DictionarySourceKind::Catalog,
            catalog_id: Some("english-core".to_string()),
            source_attribution: "Example Lexicographers".to_string(),
            license_name: "CC BY 4.0".to_string(),
            license_url: Some("https://example.com/license".to_string()),
            package_version: "2026.1".to_string(),
            index_state: DictionaryIndexState::Ready,
        }
    }

    fn current_store(root: &Path) -> DictionaryStore {
        open_current_store(root).expect("dictionary store should be current")
    }

    fn install_test_package(
        store: &mut DictionaryStore,
        name: &str,
        word: &str,
        definition: &[u8],
    ) -> super::InstalledDictionary {
        let dictionary = store.register(registration(name)).unwrap();
        let installed_path = store.installed_path(&dictionary.id).unwrap();
        fs::create_dir_all(&installed_path).unwrap();
        let mut index = Vec::new();
        index.extend_from_slice(word.as_bytes());
        index.push(0);
        index.extend_from_slice(&0_u32.to_be_bytes());
        index.extend_from_slice(&(definition.len() as u32).to_be_bytes());
        fs::write(installed_path.join("dictionary.idx"), &index).unwrap();
        fs::write(installed_path.join("dictionary.dict"), definition).unwrap();
        fs::write(
            installed_path.join("dictionary.ifo"),
            format!(
                "StarDict's dict ifo file\nversion=2.4.2\nbookname={name}\nwordcount=1\nidxfilesize={}\nsametypesequence=m\n",
                index.len()
            ),
        )
        .unwrap();
        store.rebuild_index(&dictionary.id).unwrap();
        store.get(&dictionary.id).unwrap().unwrap()
    }

    fn create_legacy_single_language_database(root: &Path) {
        let paths = DictionaryStoragePaths::from_app_data_root(root);
        fs::create_dir_all(paths.root()).unwrap();
        let connection = Connection::open(paths.database()).unwrap();
        connection
            .execute_batch(
                r#"
CREATE TABLE installed_dictionaries (
    dictionary_id TEXT PRIMARY KEY NOT NULL,
    display_name TEXT NOT NULL,
    language TEXT NOT NULL,
    enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
    sort_order INTEGER NOT NULL CHECK (sort_order >= 0),
    entry_count INTEGER NOT NULL CHECK (entry_count >= 0),
    installed_size_bytes INTEGER NOT NULL CHECK (installed_size_bytes >= 0),
    source_kind TEXT NOT NULL CHECK (source_kind IN ('catalog', 'manual-import')),
    catalog_id TEXT,
    source_attribution TEXT NOT NULL,
    license_name TEXT NOT NULL,
    license_url TEXT,
    package_version TEXT NOT NULL,
    index_state TEXT NOT NULL CHECK (
        index_state IN ('pending', 'ready', 'rebuild-required', 'unavailable')
    ),
    storage_relative_path TEXT NOT NULL UNIQUE
);
CREATE INDEX installed_dictionaries_order_idx
ON installed_dictionaries(sort_order, dictionary_id);
CREATE TABLE dictionary_entries (
    dictionary_id TEXT NOT NULL,
    source_ordinal INTEGER NOT NULL CHECK (source_ordinal >= 0),
    normalized_headword TEXT NOT NULL,
    display_headword TEXT NOT NULL,
    definition_offset INTEGER NOT NULL CHECK (definition_offset >= 0),
    definition_length INTEGER NOT NULL CHECK (definition_length >= 0),
    PRIMARY KEY (dictionary_id, source_ordinal),
    FOREIGN KEY (dictionary_id)
        REFERENCES installed_dictionaries(dictionary_id)
        ON DELETE CASCADE
);
CREATE INDEX dictionary_entries_headword_idx
ON dictionary_entries(normalized_headword, dictionary_id, source_ordinal);
CREATE TABLE dictionary_aliases (
    dictionary_id TEXT NOT NULL,
    normalized_alias TEXT NOT NULL,
    source_ordinal INTEGER NOT NULL CHECK (source_ordinal >= 0),
    PRIMARY KEY (dictionary_id, normalized_alias, source_ordinal),
    FOREIGN KEY (dictionary_id, source_ordinal)
        REFERENCES dictionary_entries(dictionary_id, source_ordinal)
        ON DELETE CASCADE
);
CREATE INDEX dictionary_aliases_lookup_idx
ON dictionary_aliases(normalized_alias, dictionary_id, source_ordinal);
PRAGMA user_version = 1;
"#,
            )
            .unwrap();
        connection
            .execute(
                "INSERT INTO installed_dictionaries (
                    dictionary_id, display_name, language, enabled, sort_order, entry_count,
                    installed_size_bytes, source_kind, catalog_id, source_attribution,
                    license_name, license_url, package_version, index_state, storage_relative_path
                 ) VALUES (?1, ?2, ?3, 1, 0, 42, 4096, 'catalog', ?4, ?5, ?6, ?7, ?8, 'ready', ?9)",
                rusqlite::params![
                    "dict-00000000000000000000000000000001",
                    "Legacy English",
                    "en",
                    "english-core",
                    "Example Lexicographers",
                    "CC BY 4.0",
                    "https://example.com/license",
                    "2026.1",
                    "installed/dict-00000000000000000000000000000001",
                ],
            )
            .unwrap();
    }

    #[test]
    fn legacy_single_language_schema_migrates_without_losing_registry_metadata() {
        let root = test_root("legacy-language-schema");
        create_legacy_single_language_database(&root);

        let mut store = current_store(&root);
        let migrated = store.list().unwrap();
        assert_eq!(migrated.len(), 1);
        assert_eq!(migrated[0].display_name, "Legacy English");
        assert_eq!(migrated[0].source_language, "en");
        assert_eq!(migrated[0].target_language, "en");
        assert!(migrated[0].enabled);
        assert_eq!(migrated[0].order, 0);
        assert_eq!(migrated[0].entry_count, 42);

        store
            .register(registration("New English"))
            .expect("current inserts should work after migration");
        drop(store);

        let paths = DictionaryStoragePaths::from_app_data_root(&root);
        let connection = Connection::open(paths.database()).unwrap();
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 2);
        let mut statement = connection
            .prepare("PRAGMA table_info(installed_dictionaries)")
            .unwrap();
        let columns = statement
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(!columns.iter().any(|column| column == "language"));
        assert!(columns.iter().any(|column| column == "source_language"));
        assert!(columns.iter().any(|column| column == "target_language"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn language_pair_schema_stamped_as_version_one_is_promoted_in_place() {
        let root = test_root("language-pair-v1");
        let expected = {
            let mut store = current_store(&root);
            store.register(registration("English Core")).unwrap()
        };
        let paths = DictionaryStoragePaths::from_app_data_root(&root);
        let connection = Connection::open(paths.database()).unwrap();
        connection
            .pragma_update(None, "user_version", 1_i64)
            .unwrap();
        drop(connection);

        let reopened = current_store(&root);
        assert_eq!(reopened.list().unwrap(), vec![expected]);
        let version: i64 = reopened
            .connection()
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .unwrap();
        assert_eq!(version, 2);

        drop(reopened);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn empty_app_data_initializes_current_empty_registry() {
        let root = test_root("empty");
        let snapshot = DictionaryStore::snapshot(&root).expect("empty registry should initialize");
        let paths = DictionaryStoragePaths::from_app_data_root(&root);

        assert_eq!(snapshot.status, DictionaryRegistryStatus::Ready);
        assert!(snapshot.dictionaries.is_empty());
        assert!(snapshot.recovery.is_none());
        assert!(paths.database().is_file());
        let connection = Connection::open(paths.database()).expect("database should open");
        let version: i64 = connection
            .pragma_query_value(None, "user_version", |row| row.get(0))
            .expect("schema version should be readable");
        assert_eq!(version, 2);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn installed_metadata_round_trips_deterministically() {
        let root = test_root("round-trip");
        let expected = {
            let mut store = current_store(&root);
            store
                .register(registration("English Core"))
                .expect("dictionary should register")
        };
        let reopened = current_store(&root)
            .list()
            .expect("registered dictionary should reload");

        assert_eq!(reopened, vec![expected]);
        assert_eq!(reopened[0].source_language, "en");
        assert_eq!(reopened[0].target_language, "en");
        assert_eq!(
            reopened[0].storage_relative_path,
            format!("installed/{}", reopened[0].id)
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn directional_language_pairs_remain_distinct_through_registry_updates() {
        let root = test_root("language-pairs");
        let mut store = current_store(&root);
        let mut french_english = registration("French to English");
        french_english.source_language = "fr".to_string();
        french_english.target_language = "en".to_string();
        french_english.catalog_id = Some("french-english".to_string());
        let french_english = store.register(french_english).unwrap();

        let mut english_french = registration("English to French");
        english_french.source_language = "en".to_string();
        english_french.target_language = "fr".to_string();
        english_french.catalog_id = Some("english-french".to_string());
        let english_french = store.register(english_french).unwrap();

        store.set_enabled(&french_english.id, false).unwrap();
        store
            .set_order(&[english_french.id.clone(), french_english.id.clone()])
            .unwrap();
        drop(store);

        let reopened = current_store(&root).list().unwrap();
        assert_eq!(reopened.len(), 2);
        assert_eq!(reopened[0].id, english_french.id);
        assert_eq!(reopened[0].source_language, "en");
        assert_eq!(reopened[0].target_language, "fr");
        assert!(reopened[0].enabled);
        assert_eq!(reopened[0].order, 0);
        assert_eq!(reopened[0].index_state, DictionaryIndexState::Ready);
        assert_eq!(reopened[1].id, french_english.id);
        assert_eq!(reopened[1].source_language, "fr");
        assert_eq!(reopened[1].target_language, "en");
        assert!(!reopened[1].enabled);
        assert_eq!(reopened[1].order, 1);
        assert_eq!(reopened[1].index_state, DictionaryIndexState::Ready);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn enable_and_order_updates_are_transactional() {
        let root = test_root("updates");
        let mut store = current_store(&root);
        let first = store
            .register(registration("First"))
            .expect("first dictionary should register");
        let second = store
            .register(registration("Second"))
            .expect("second dictionary should register");
        let third = store
            .register(registration("Third"))
            .expect("third dictionary should register");

        store
            .set_enabled(&second.id, false)
            .expect("enabled state should update");
        store
            .set_order(&[third.id.clone(), first.id.clone(), second.id.clone()])
            .expect("complete order should update");
        let invalid = store.set_order(&[first.id.clone(), first.id.clone(), third.id.clone()]);
        assert!(invalid.is_err());
        drop(store);

        let reopened = current_store(&root).list().expect("updates should persist");
        assert_eq!(
            reopened
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            vec![third.id.as_str(), first.id.as_str(), second.id.as_str()]
        );
        assert_eq!(
            reopened.iter().map(|item| item.order).collect::<Vec<_>>(),
            vec![0, 1, 2]
        );
        assert!(!reopened[2].enabled);

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn removal_deletes_only_the_owned_dictionary_and_compacts_persisted_order() {
        let root = test_root("remove");
        let mut store = current_store(&root);
        let first = store
            .register(registration("First"))
            .expect("first dictionary should register");
        let second = store
            .register(registration("Second"))
            .expect("second dictionary should register");
        let first_path = store
            .installed_path(&first.id)
            .expect("first installed path should resolve");
        let second_path = store
            .installed_path(&second.id)
            .expect("second installed path should resolve");
        fs::create_dir_all(&first_path).expect("first dictionary files should exist");
        fs::create_dir_all(&second_path).expect("second dictionary files should exist");
        fs::write(first_path.join("dictionary.dict"), b"remove")
            .expect("first payload should exist");
        fs::write(second_path.join("dictionary.dict"), b"preserve")
            .expect("second payload should exist");

        let remaining = store
            .remove_dictionary(&first.id)
            .expect("owned dictionary should be removed");
        drop(store);

        assert!(!first_path.exists());
        assert_eq!(
            fs::read(second_path.join("dictionary.dict"))
                .expect("unrelated dictionary payload should remain"),
            b"preserve"
        );
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, second.id);
        assert_eq!(remaining[0].order, 0);
        assert_eq!(
            current_store(&root)
                .list()
                .expect("removal should persist after reopening"),
            remaining
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn generated_ids_keep_installed_paths_inside_the_dictionary_root() {
        let root = test_root("owned-paths");
        let mut store = current_store(&root);
        let first = store
            .register(registration("First"))
            .expect("first dictionary should register");
        let second = store
            .register(registration("Second"))
            .expect("second dictionary should register");

        assert_ne!(first.id, second.id);
        for dictionary in [first, second] {
            assert!(dictionary.id.starts_with("dict-"));
            assert_eq!(dictionary.id.len(), 37);
            let installed_path = store
                .installed_path(&dictionary.id)
                .expect("generated id should resolve");
            assert!(installed_path
                .starts_with(DictionaryStoragePaths::from_app_data_root(&root).root()));
            assert_eq!(
                installed_path.file_name().and_then(|name| name.to_str()),
                Some(dictionary.id.as_str())
            );
        }
        assert!(store.installed_path("../outside").is_err());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn untrusted_display_metadata_never_controls_storage_paths() {
        let root = test_root("display-path");
        let mut malicious = registration("../Outside\\Dictionary");
        malicious.catalog_id = Some("../../catalog-id".to_string());
        let mut store = current_store(&root);
        let installed = store
            .register(malicious)
            .expect("display metadata should remain data");
        let path = store
            .installed_path(&installed.id)
            .expect("owned id should resolve");

        assert_eq!(installed.display_name, "../Outside\\Dictionary");
        assert_eq!(
            installed.storage_relative_path,
            format!("installed/{}", installed.id)
        );
        assert!(path.starts_with(DictionaryStoragePaths::from_app_data_root(&root).root()));
        assert!(!path.to_string_lossy().contains("Outside"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn altered_stored_path_enters_recovery_without_touching_installed_data() {
        let root = test_root("altered-storage-path");
        let installed = {
            let mut store = current_store(&root);
            store
                .register(registration("Safe Dictionary"))
                .expect("dictionary should register")
        };
        let paths = DictionaryStoragePaths::from_app_data_root(&root);
        let installed_path = paths
            .installed_path(&installed.id)
            .expect("installed path should resolve");
        fs::create_dir_all(&installed_path).expect("installed directory should exist");
        fs::write(installed_path.join("content.dict"), b"preserve me")
            .expect("installed data should exist");
        let connection = Connection::open(paths.database()).expect("database should open");
        connection
            .execute(
                "UPDATE installed_dictionaries
                 SET storage_relative_path = '../outside'
                 WHERE dictionary_id = ?1",
                [&installed.id],
            )
            .expect("stored path should be altered for the recovery test");
        drop(connection);

        let state = DictionaryStore::open(&root).expect("recovery should be contained");
        let recovery = match state {
            DictionaryStoreOpen::RecoveryRequired(recovery) => recovery,
            DictionaryStoreOpen::Current(_) => panic!("altered path must require recovery"),
        };
        assert_eq!(recovery.reason, DictionaryRecoveryReason::CorruptDatabase);
        assert_eq!(
            fs::read(installed_path.join("content.dict")).expect("installed data should remain"),
            b"preserve me"
        );

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn unsupported_and_corrupt_databases_preserve_installed_files() {
        for (label, corrupt) in [("unsupported", false), ("corrupt", true)] {
            let root = test_root(label);
            let paths = DictionaryStoragePaths::from_app_data_root(&root);
            fs::create_dir_all(paths.root()).expect("dictionary root should exist");
            let installed = paths.root().join("installed").join("dict-preserved");
            fs::create_dir_all(&installed).expect("installed directory should exist");
            fs::write(installed.join("content.dict"), b"preserve me")
                .expect("installed data should exist");

            if corrupt {
                fs::write(paths.database(), b"not a sqlite database")
                    .expect("corrupt database should be written");
            } else {
                let connection = Connection::open(paths.database()).expect("database should open");
                connection
                    .pragma_update(None, "user_version", 99_i64)
                    .expect("unsupported version should be written");
            }

            let state = DictionaryStore::open(&root).expect("recovery should be contained");
            let recovery = match state {
                DictionaryStoreOpen::RecoveryRequired(recovery) => recovery,
                DictionaryStoreOpen::Current(_) => panic!("invalid database must require recovery"),
            };
            assert_eq!(
                recovery.reason,
                if corrupt {
                    DictionaryRecoveryReason::CorruptDatabase
                } else {
                    DictionaryRecoveryReason::UnsupportedSchema
                }
            );
            assert_eq!(
                fs::read(installed.join("content.dict")).expect("installed data should remain"),
                b"preserve me"
            );

            let _ = fs::remove_dir_all(root);
        }
    }

    #[test]
    fn registry_remains_application_level_across_archive_switches() {
        let app_data_root = test_root("archive-independent");
        let first_archive = test_root("archive-a");
        let second_archive = test_root("archive-b");
        fs::create_dir_all(first_archive.join(".archeion"))
            .expect("first archive metadata should exist");
        fs::create_dir_all(second_archive.join(".archeion"))
            .expect("second archive metadata should exist");

        let installed = {
            let mut store = current_store(&app_data_root);
            store
                .register(registration("Application Dictionary"))
                .expect("dictionary should register")
        };
        for _active_archive in [&first_archive, &second_archive] {
            let dictionaries = current_store(&app_data_root)
                .list()
                .expect("application registry should remain available");
            assert_eq!(dictionaries, vec![installed.clone()]);
        }
        let database = DictionaryStoragePaths::from_app_data_root(&app_data_root)
            .database()
            .to_path_buf();
        assert!(!database.starts_with(&first_archive));
        assert!(!database.starts_with(&second_archive));

        let _ = fs::remove_dir_all(app_data_root);
        let _ = fs::remove_dir_all(first_archive);
        let _ = fs::remove_dir_all(second_archive);
    }

    #[test]
    fn missing_or_corrupt_lookup_rows_rebuild_without_changing_registry_metadata() {
        let root = test_root("missing-index-recovery");
        let first_id;
        let second_id;
        {
            let mut store = current_store(&root);
            let first = install_test_package(&mut store, "First", "alpha", b"first");
            let second = install_test_package(&mut store, "Second", "beta", b"second");
            first_id = first.id.clone();
            second_id = second.id.clone();
            store.set_enabled(&first.id, false).unwrap();
            store
                .set_order(&[second.id.clone(), first.id.clone()])
                .unwrap();
        }
        let expected = DictionaryStore::snapshot(&root).unwrap().dictionaries;
        {
            let store = current_store(&root);
            store
                .connection()
                .execute(
                    "DELETE FROM dictionary_entries WHERE dictionary_id = ?1",
                    [&first_id],
                )
                .unwrap();
            store
                .connection()
                .execute(
                    "UPDATE dictionary_entries
                     SET normalized_headword = 'wrong'
                     WHERE dictionary_id = ?1",
                    [&second_id],
                )
                .unwrap();
        }

        let snapshot = DictionaryStore::snapshot(&root).unwrap();

        assert_eq!(snapshot.status, DictionaryRegistryStatus::Ready);
        assert_eq!(snapshot.dictionaries, expected);
        let store = current_store(&root);
        assert_eq!(store.lookup_exact("beta", 8).unwrap().len(), 1);
        assert!(store.lookup_exact("alpha", 8).unwrap().is_empty());
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn corrupt_database_recovers_from_legacy_single_language_registry() {
        let root = test_root("legacy-registry-database-recovery");
        let expected = {
            let mut store = current_store(&root);
            install_test_package(&mut store, "Legacy", "alpha", b"first")
        };
        let paths = DictionaryStoragePaths::from_app_data_root(&root);
        let recovery_path = paths.root().join("registry-recovery-v1.json");
        let mut registry: serde_json::Value =
            serde_json::from_slice(&fs::read(&recovery_path).unwrap()).unwrap();
        registry["schemaVersion"] = serde_json::json!(1);
        let dictionaries = registry["dictionaries"].as_array_mut().unwrap();
        for dictionary in dictionaries {
            let object = dictionary.as_object_mut().unwrap();
            let language = object.remove("sourceLanguage").unwrap();
            object.remove("targetLanguage");
            object.insert("language".to_string(), language);
        }
        fs::write(
            &recovery_path,
            serde_json::to_vec_pretty(&registry).unwrap(),
        )
        .unwrap();
        fs::write(paths.database(), b"not a sqlite database").unwrap();

        let snapshot = DictionaryStore::snapshot(&root).unwrap();

        assert_eq!(snapshot.status, DictionaryRegistryStatus::Ready);
        assert_eq!(snapshot.dictionaries.len(), 1);
        assert_eq!(snapshot.dictionaries[0].id, expected.id);
        assert_eq!(snapshot.dictionaries[0].source_language, "en");
        assert_eq!(snapshot.dictionaries[0].target_language, "en");
        let store = current_store(&root);
        assert_eq!(store.lookup_exact("alpha", 8).unwrap().len(), 1);
        drop(store);

        let rewritten: serde_json::Value =
            serde_json::from_slice(&fs::read(&recovery_path).unwrap()).unwrap();
        assert_eq!(rewritten["schemaVersion"], serde_json::json!(2));
        assert_eq!(rewritten["dictionaries"][0]["sourceLanguage"], "en");
        assert_eq!(rewritten["dictionaries"][0]["targetLanguage"], "en");
        assert!(rewritten["dictionaries"][0].get("language").is_none());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn corrupt_database_rebuilds_registry_and_indexes_from_owned_recovery_state() {
        let root = test_root("database-recovery");
        {
            let mut store = current_store(&root);
            let first = install_test_package(&mut store, "First", "alpha", b"first");
            let second = install_test_package(&mut store, "Second", "beta", b"second");
            store.set_enabled(&first.id, false).unwrap();
            store
                .set_order(&[second.id.clone(), first.id.clone()])
                .unwrap();
        }
        let expected = DictionaryStore::snapshot(&root).unwrap().dictionaries;
        let database = DictionaryStoragePaths::from_app_data_root(&root)
            .database()
            .to_path_buf();
        fs::write(&database, b"not a sqlite database").unwrap();

        let snapshot = DictionaryStore::snapshot(&root).unwrap();

        assert_eq!(snapshot.status, DictionaryRegistryStatus::Ready);
        assert_eq!(snapshot.dictionaries, expected);
        let store = current_store(&root);
        assert_eq!(store.lookup_exact("beta", 8).unwrap().len(), 1);
        assert!(store.lookup_exact("alpha", 8).unwrap().is_empty());
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_definition_data_marks_only_the_affected_dictionary_unavailable() {
        let root = test_root("missing-definition");
        let first;
        let second;
        {
            let mut store = current_store(&root);
            first = install_test_package(&mut store, "First", "alpha", b"first");
            second = install_test_package(&mut store, "Second", "beta", b"second");
            let first_path = store.installed_path(&first.id).unwrap();
            fs::remove_file(first_path.join("dictionary.dict")).unwrap();
        }

        let snapshot = DictionaryStore::snapshot(&root).unwrap();

        assert_eq!(snapshot.status, DictionaryRegistryStatus::Ready);
        assert_eq!(snapshot.dictionaries.len(), 2);
        assert_eq!(snapshot.dictionaries[0].id, first.id);
        assert_eq!(
            snapshot.dictionaries[0].index_state,
            DictionaryIndexState::Unavailable
        );
        assert_eq!(snapshot.dictionaries[1].id, second.id);
        assert_eq!(
            snapshot.dictionaries[1].index_state,
            DictionaryIndexState::Ready
        );
        let store = current_store(&root);
        assert!(store.lookup_exact("alpha", 8).unwrap().is_empty());
        assert_eq!(store.lookup_exact("beta", 8).unwrap().len(), 1);
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn missing_installed_directory_remains_visible_and_removable() {
        let root = test_root("missing-directory");
        let dictionary;
        {
            let mut store = current_store(&root);
            dictionary = install_test_package(&mut store, "Missing", "alpha", b"first");
            fs::remove_dir_all(store.installed_path(&dictionary.id).unwrap()).unwrap();
        }

        let snapshot = DictionaryStore::snapshot(&root).unwrap();
        assert_eq!(snapshot.dictionaries.len(), 1);
        assert_eq!(
            snapshot.dictionaries[0].index_state,
            DictionaryIndexState::Unavailable
        );
        let mut store = current_store(&root);
        let remaining = store.remove_dictionary(&dictionary.id).unwrap();
        assert!(remaining.is_empty());
        drop(store);
        fs::remove_dir_all(root).unwrap();
    }
}
