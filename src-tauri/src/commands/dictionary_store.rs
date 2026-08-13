use std::{
    collections::HashSet,
    fmt, fs,
    path::{Path, PathBuf},
    time::Duration,
};

use rusqlite::{params, Connection, OpenFlags, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

const DATABASE_FILE_NAME: &str = "dictionaries.sqlite3";
const DICTIONARY_ROOT_NAME: &str = "dictionaries";
const INSTALLED_DIRECTORY_NAME: &str = "installed";
const SCHEMA_VERSION: i64 = 1;
const SQLITE_BUSY_TIMEOUT: Duration = Duration::from_secs(5);

const CREATE_SCHEMA: &str = r#"
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
"#;

const VERIFY_SCHEMA: &str = r#"
SELECT
    dictionary_id,
    display_name,
    language,
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
    pub language: String,
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
    #[allow(dead_code)]
    fn as_database_value(self) -> &'static str {
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
    pub language: String,
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
    Database(rusqlite::Error),
    Filesystem(std::io::Error),
    InvalidDictionaryId,
    InvalidOrder,
    InvalidStoredValue(&'static str),
    NumericOverflow(&'static str),
    RecoveryRequired(DictionaryRecoveryState),
}

impl fmt::Display for DictionaryStoreError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
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
            Self::NumericOverflow(field) => {
                write!(
                    formatter,
                    "Dictionary {field} is outside the supported range."
                )
            }
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
            Ok(DatabaseInspection::Empty) => initialize_schema(&connection)?,
            Ok(DatabaseInspection::Current) => {}
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
            DictionaryStoreOpen::Current(store) => {
                Ok(DictionaryRegistrySnapshot::ready(store.list()?))
            }
            DictionaryStoreOpen::RecoveryRequired(recovery) => {
                Ok(DictionaryRegistrySnapshot::recovery_required(recovery))
            }
        }
    }

    pub(crate) fn list(&self) -> Result<Vec<InstalledDictionary>, DictionaryStoreError> {
        list_with_connection(&self.connection)
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
        let entry_count = to_sql_integer(registration.entry_count, "entry count")?;
        let installed_size_bytes =
            to_sql_integer(registration.installed_size_bytes, "installed size")?;

        transaction.execute(
            "INSERT INTO installed_dictionaries (
                dictionary_id,
                display_name,
                language,
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
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15
            )",
            params![
                dictionary_id,
                registration.display_name,
                registration.language,
                registration.enabled,
                order,
                entry_count,
                installed_size_bytes,
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
        transaction.commit()?;

        self.get(&dictionary_id)?
            .ok_or(DictionaryStoreError::InvalidStoredValue("new dictionary"))
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
        transaction.commit()?;
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
        transaction.commit()?;
        self.list()
    }

    #[allow(dead_code)]
    fn get(
        &self,
        dictionary_id: &str,
    ) -> Result<Option<InstalledDictionary>, DictionaryStoreError> {
        let mut statement = self.connection.prepare(
            "SELECT
                dictionary_id,
                display_name,
                language,
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
}

enum DatabaseInspection {
    Empty,
    Current,
    Unsupported(i64),
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
            language,
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

fn read_dictionary(row: &rusqlite::Row<'_>) -> rusqlite::Result<InstalledDictionary> {
    let id: String = row.get(0)?;
    let source_kind: String = row.get(7)?;
    let index_state: String = row.get(13)?;
    let order: i64 = row.get(4)?;
    let entry_count: i64 = row.get(5)?;
    let installed_size_bytes: i64 = row.get(6)?;
    let storage_relative_path: String = row.get(14)?;
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
        language: row.get(2)?,
        enabled: row.get(3)?,
        order: to_u32(order, "order").map_err(to_sql_conversion_error)?,
        entry_count: to_u64(entry_count, "entry count").map_err(to_sql_conversion_error)?,
        installed_size_bytes: to_u64(installed_size_bytes, "installed size")
            .map_err(to_sql_conversion_error)?,
        source_kind: DictionarySourceKind::from_database_value(&source_kind)
            .map_err(to_sql_conversion_error)?,
        catalog_id: row.get(8)?,
        source_attribution: row.get(9)?,
        license_name: row.get(10)?,
        license_url: row.get(11)?,
        package_version: row.get(12)?,
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
            language: "en".to_string(),
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
        assert_eq!(version, 1);

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
        assert_eq!(
            reopened[0].storage_relative_path,
            format!("installed/{}", reopened[0].id)
        );

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
}
