use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};

use crate::atomic_file::{
    transaction_path, AtomicFileSystem, AtomicReplaceError, BackupCleanup, PreparedAtomicFile,
    RealAtomicFileSystem,
};

use super::{
    archive_backup::{ArchiveBackupLayout, MetadataDocument},
    archive_root, epub_metadata,
};

pub(crate) const METADATA_DIRECTORY: &str = ".archeion";
pub(crate) const SCANNER_CACHE_FILE: &str = "scanner-cache.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryBookMetadata {
    pub relative_path: String,
    #[serde(default)]
    pub is_favorite: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_metadata: Option<epub_metadata::EpubPackageMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_modified_at: Option<u64>,
    pub added_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct LibraryMetadata {
    pub version: u8,
    pub books: BTreeMap<String, LibraryBookMetadata>,
}

impl Default for LibraryMetadata {
    fn default() -> Self {
        Self {
            version: 1,
            books: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingProgress {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cfi: Option<String>,
    #[serde(default)]
    pub percent: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_opened_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ProgressMetadata {
    pub version: u8,
    pub progress: BTreeMap<String, ReadingProgress>,
}

impl Default for ProgressMetadata {
    fn default() -> Self {
        Self {
            version: 1,
            progress: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_destination_folder_path: Option<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BuiltInAppThemeId {
    Dark,
    Light,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum BuiltInReaderThemeId {
    Dark,
    Light,
    Sepia,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ArchiveAppThemeSelection {
    #[default]
    Inherit,
    System,
    Builtin {
        id: BuiltInAppThemeId,
    },
    Custom {
        id: String,
    },
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ArchiveReaderThemeSelection {
    #[default]
    Inherit,
    Builtin {
        id: BuiltInReaderThemeId,
    },
    Custom {
        id: String,
    },
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveAppearanceSettings {
    #[serde(default)]
    pub app_theme: ArchiveAppThemeSelection,
    #[serde(default)]
    pub reader_theme: ArchiveReaderThemeSelection,
}

#[derive(Clone, Debug, Deserialize)]
struct StoredSettingsMetadata {
    version: u8,
    #[serde(default)]
    import: ImportSettings,
    #[serde(default)]
    appearance: Option<ArchiveAppearanceSettings>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(from = "StoredSettingsMetadata")]
pub struct SettingsMetadata {
    pub version: u8,
    pub import: ImportSettings,
    #[serde(skip)]
    legacy_appearance: Option<ArchiveAppearanceSettings>,
}

impl From<StoredSettingsMetadata> for SettingsMetadata {
    fn from(stored: StoredSettingsMetadata) -> Self {
        Self {
            version: 3,
            import: stored.import,
            legacy_appearance: if stored.version == 2 {
                Some(stored.appearance.unwrap_or_default())
            } else {
                None
            },
        }
    }
}

impl SettingsMetadata {
    pub(crate) fn into_legacy_appearance(self) -> Option<ArchiveAppearanceSettings> {
        self.legacy_appearance
    }
}

impl Default for SettingsMetadata {
    fn default() -> Self {
        Self {
            version: 3,
            import: ImportSettings::default(),
            legacy_appearance: None,
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannerCacheEntry {
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub modified_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_metadata: Option<epub_metadata::EpubPackageMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct ScannerCache {
    pub version: u8,
    pub entries: BTreeMap<String, ScannerCacheEntry>,
}

impl Default for ScannerCache {
    fn default() -> Self {
        Self {
            version: 1,
            entries: BTreeMap::new(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataBundle {
    library: LibraryMetadata,
    progress: ProgressMetadata,
    settings: SettingsMetadata,
}

fn metadata_path(root: &Path) -> PathBuf {
    root.join(METADATA_DIRECTORY)
}

const MAX_METADATA_BACKUPS: usize = 5;

fn timestamp_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

fn backup_existing_json(root: &Path, document: MetadataDocument) -> Result<(), String> {
    let layout = ArchiveBackupLayout::new(root);
    let path = layout.active_document_path(document);
    if !path.exists() {
        return Ok(());
    }

    let existing_contents = fs::read(&path).map_err(|error| error.to_string())?;
    if serde_json::from_slice::<serde_json::Value>(&existing_contents).is_err() {
        let corrupt_path =
            layout.timestamped_backup_path(document, "corrupt", timestamp_suffix())?;
        fs::rename(&path, corrupt_path).map_err(|error| error.to_string())?;
        layout.prune_timestamped_backups(document, "corrupt", MAX_METADATA_BACKUPS)?;
        return Ok(());
    }

    let stable_backup = layout.stable_backup_path(document)?;
    let stable_contents = stable_backup
        .exists()
        .then(|| fs::read(&stable_backup).map_err(|error| error.to_string()))
        .transpose()?;
    if let Some(stable_contents) = stable_contents.as_deref() {
        if stable_contents != existing_contents
            && !layout.timestamped_backup_contains(document, "backup", stable_contents)?
        {
            let migrated_history =
                layout.timestamped_backup_path(document, "backup", timestamp_suffix())?;
            fs::copy(&stable_backup, migrated_history).map_err(|error| error.to_string())?;
        }
    }
    let timestamped_backup =
        layout.timestamped_backup_path(document, "backup", timestamp_suffix())?;
    fs::copy(&path, stable_backup).map_err(|error| error.to_string())?;
    fs::copy(&path, timestamped_backup).map_err(|error| error.to_string())?;
    layout.prune_timestamped_backups(document, "backup", MAX_METADATA_BACKUPS)
}

fn metadata_replace_error(error: AtomicReplaceError) -> String {
    match error {
        AtomicReplaceError::DestinationNotFile => "Metadata path is not a file.".to_string(),
        AtomicReplaceError::MoveDestinationToBackup(error)
        | AtomicReplaceError::ReplaceMissingDestination(error)
        | AtomicReplaceError::RemoveBackup(error) => error,
        AtomicReplaceError::ReplaceRestored { replace_error } => {
            format!("Metadata save failed and the previous file was restored: {replace_error}")
        }
        AtomicReplaceError::RestoreFailed { restore_error } => format!(
            "Metadata save failed and the previous file could not be restored: {restore_error}"
        ),
    }
}

fn write_json_with_fs<T: Serialize>(
    root: &Path,
    document: MetadataDocument,
    value: &T,
    backup: bool,
    fs_ops: &impl AtomicFileSystem,
) -> Result<(), String> {
    let layout = ArchiveBackupLayout::new(root);
    layout.migrate_metadata_document(document, MAX_METADATA_BACKUPS)?;
    let path = layout.active_document_path(document);
    let parent = path
        .parent()
        .ok_or_else(|| "Metadata directory is unavailable.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let contents = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    serde_json::from_slice::<serde_json::Value>(&contents)
        .map_err(|error| format!("Metadata JSON could not be validated: {error}"))?;

    let temporary = PreparedAtomicFile::write(transaction_path(&path, "tmp-write"), &contents)
        .map_err(|error| error.into_source().to_string())?;
    let temporary_contents = fs::read(temporary.path()).map_err(|error| error.to_string())?;
    serde_json::from_slice::<serde_json::Value>(&temporary_contents)
        .map_err(|error| format!("Metadata JSON could not be validated: {error}"))?;

    if backup {
        backup_existing_json(root, document)?;
    }

    let transaction_backup = transaction_path(&path, "write-backup");
    temporary
        .replace(&path, &transaction_backup, BackupCleanup::Required, fs_ops)
        .map_err(metadata_replace_error)
}

fn write_json<T: Serialize>(
    root: &Path,
    document: MetadataDocument,
    value: &T,
    backup: bool,
) -> Result<(), String> {
    write_json_with_fs(root, document, value, backup, &RealAtomicFileSystem)
}

fn recover_json_from_backup<T>(root: &Path, document: MetadataDocument) -> Result<Option<T>, String>
where
    T: DeserializeOwned,
{
    let candidates = ArchiveBackupLayout::new(root).metadata_backup_candidates(document)?;
    Ok(candidates.into_iter().find_map(|backup_path| {
        fs::read(&backup_path)
            .ok()
            .and_then(|contents| serde_json::from_slice(&contents).ok())
    }))
}

struct JsonReadResult<T> {
    value: T,
    recovered: bool,
}

fn read_json_with_recovery<T>(
    root: &Path,
    document: MetadataDocument,
) -> Result<JsonReadResult<T>, String>
where
    T: Default + DeserializeOwned + Serialize,
{
    let layout = ArchiveBackupLayout::new(root);
    let path = layout.checked_active_document_path(document)?;
    if !path.exists() {
        layout.migrate_metadata_document(document, MAX_METADATA_BACKUPS)?;
        let value = T::default();
        write_json(root, document, &value, false)?;
        return Ok(JsonReadResult {
            value,
            recovered: false,
        });
    }

    let contents = fs::read(&path).map_err(|error| error.to_string())?;
    match serde_json::from_slice(&contents) {
        Ok(value) => {
            layout.migrate_metadata_document(document, MAX_METADATA_BACKUPS)?;
            Ok(JsonReadResult {
                value,
                recovered: false,
            })
        }
        Err(_) => {
            let corrupt_path =
                layout.timestamped_backup_path(document, "corrupt", timestamp_suffix())?;
            fs::rename(&path, corrupt_path).map_err(|error| error.to_string())?;
            layout.prune_timestamped_backups(document, "corrupt", MAX_METADATA_BACKUPS)?;
            let value = recover_json_from_backup(root, document)?.unwrap_or_default();
            layout.migrate_metadata_document(document, MAX_METADATA_BACKUPS)?;
            write_json(root, document, &value, false)?;
            Ok(JsonReadResult {
                value,
                recovered: true,
            })
        }
    }
}

fn read_json<T>(root: &Path, document: MetadataDocument) -> Result<T, String>
where
    T: Default + DeserializeOwned + Serialize,
{
    read_json_with_recovery(root, document).map(|result| result.value)
}

fn read_optional_json_with_recovery<T>(
    root: &Path,
    document: MetadataDocument,
    default_value: T,
) -> Result<T, String>
where
    T: Clone + DeserializeOwned + Serialize,
{
    let layout = ArchiveBackupLayout::new(root);
    let path = layout.checked_active_document_path(document)?;
    if !path.exists() {
        layout.migrate_metadata_document(document, MAX_METADATA_BACKUPS)?;
        return Ok(default_value);
    }

    let contents = fs::read(&path).map_err(|error| error.to_string())?;
    match serde_json::from_slice(&contents) {
        Ok(value) => {
            layout.migrate_metadata_document(document, MAX_METADATA_BACKUPS)?;
            Ok(value)
        }
        Err(_) => {
            let corrupt_path =
                layout.timestamped_backup_path(document, "corrupt", timestamp_suffix())?;
            fs::rename(&path, corrupt_path).map_err(|error| error.to_string())?;
            layout.prune_timestamped_backups(document, "corrupt", MAX_METADATA_BACKUPS)?;
            let value = recover_json_from_backup(root, document)?.unwrap_or(default_value);
            layout.migrate_metadata_document(document, MAX_METADATA_BACKUPS)?;
            write_json(root, document, &value, false)?;
            Ok(value)
        }
    }
}

fn default_annotations_metadata() -> serde_json::Value {
    serde_json::json!({
        "version": 1,
        "books": {}
    })
}

pub(crate) fn load_annotations_at(root: &Path) -> Result<serde_json::Value, String> {
    if !root.is_dir() {
        return Err("The selected archive folder is unavailable.".to_string());
    }

    read_optional_json_with_recovery(
        root,
        MetadataDocument::Annotations,
        default_annotations_metadata(),
    )
}

pub(crate) fn save_annotations_at(root: &Path, metadata: &serde_json::Value) -> Result<(), String> {
    write_json(root, MetadataDocument::Annotations, metadata, true)
}

pub(crate) fn initialize_at(root: &Path) -> Result<(), String> {
    if !root.is_dir() {
        return Err("The selected archive folder is unavailable.".to_string());
    }

    let layout = ArchiveBackupLayout::new(root);
    for document in MetadataDocument::ALL {
        layout.migrate_metadata_document(document, MAX_METADATA_BACKUPS)?;
    }
    let directory = metadata_path(root);
    fs::create_dir_all(directory.join("covers")).map_err(|error| error.to_string())?;
    read_json::<LibraryMetadata>(root, MetadataDocument::Library)?;
    read_json::<ProgressMetadata>(root, MetadataDocument::Progress)?;
    read_json::<SettingsMetadata>(root, MetadataDocument::Settings)?;
    Ok(())
}

pub(crate) fn load_settings_at(root: &Path) -> Result<SettingsMetadata, String> {
    if !root.is_dir() {
        return Err("The selected archive folder is unavailable.".to_string());
    }

    read_json::<SettingsMetadata>(root, MetadataDocument::Settings)
}

#[cfg(test)]
pub(crate) fn load_scanner_cache_at(root: &Path) -> Result<ScannerCache, String> {
    read_json(root, MetadataDocument::ScannerCache)
}

pub(crate) fn load_scanner_cache_with_recovery_at(
    root: &Path,
) -> Result<(ScannerCache, bool), String> {
    let result = read_json_with_recovery(root, MetadataDocument::ScannerCache)?;
    Ok((result.value, result.recovered))
}

pub(crate) fn save_scanner_cache_at(root: &Path, cache: &ScannerCache) -> Result<(), String> {
    write_json(root, MetadataDocument::ScannerCache, cache, false)
}

pub(crate) fn clear_scanner_cache_at(root: &Path) -> Result<(), String> {
    ArchiveBackupLayout::new(root)
        .migrate_metadata_document(MetadataDocument::ScannerCache, MAX_METADATA_BACKUPS)?;
    let path = metadata_path(root).join(SCANNER_CACHE_FILE);
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn resolve_command_archive_root(
    app: &tauri::AppHandle,
    root_path: Option<String>,
) -> Result<PathBuf, String> {
    archive_root::resolve_archive_root(app, root_path)
}

#[tauri::command]
pub fn initialize_archive_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
) -> Result<(), String> {
    initialize_at(&resolve_command_archive_root(&app, root_path)?)
}

#[tauri::command]
pub fn load_archive_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
) -> Result<MetadataBundle, String> {
    let root = resolve_command_archive_root(&app, root_path)?;
    initialize_at(&root)?;
    let metadata = MetadataBundle {
        library: read_json(&root, MetadataDocument::Library)?,
        progress: read_json(&root, MetadataDocument::Progress)?,
        settings: read_json(&root, MetadataDocument::Settings)?,
    };
    Ok(metadata)
}

#[tauri::command]
pub fn load_settings_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
) -> Result<SettingsMetadata, String> {
    let root = resolve_command_archive_root(&app, root_path)?;
    let metadata = load_settings_at(&root)?;
    Ok(metadata)
}

#[tauri::command]
pub fn save_library_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
    metadata: LibraryMetadata,
) -> Result<(), String> {
    let root = resolve_command_archive_root(&app, root_path)?;
    write_json(&root, MetadataDocument::Library, &metadata, true)
}

#[tauri::command]
pub fn save_progress_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
    metadata: ProgressMetadata,
) -> Result<(), String> {
    let root = resolve_command_archive_root(&app, root_path)?;
    write_json(&root, MetadataDocument::Progress, &metadata, true)
}

#[tauri::command]
pub fn save_settings_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
    metadata: SettingsMetadata,
) -> Result<(), String> {
    let root = resolve_command_archive_root(&app, root_path)?;
    write_json(&root, MetadataDocument::Settings, &metadata, true)
}

#[tauri::command]
pub fn load_annotations_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
) -> Result<serde_json::Value, String> {
    load_annotations_at(&resolve_command_archive_root(&app, root_path)?)
}

#[tauri::command]
pub fn save_annotations_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
    metadata: serde_json::Value,
) -> Result<(), String> {
    save_annotations_at(&resolve_command_archive_root(&app, root_path)?, &metadata)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{
        initialize_at, load_annotations_at, load_scanner_cache_with_recovery_at, load_settings_at,
        metadata_path, read_json, save_annotations_at, write_json, write_json_with_fs,
        ArchiveAppThemeSelection, ArchiveAppearanceSettings, ArchiveReaderThemeSelection,
        BuiltInReaderThemeId, LibraryBookMetadata, LibraryMetadata, SettingsMetadata,
        MAX_METADATA_BACKUPS, SCANNER_CACHE_FILE,
    };
    use crate::commands::archive_backup::{ArchiveBackupLayout, MetadataDocument};

    fn test_root(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-metadata-{label}-{nonce}"))
    }

    struct FailingMetadataRenameFileSystem;

    impl crate::atomic_file::AtomicFileSystem for FailingMetadataRenameFileSystem {
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

            if source_name.contains("tmp-write") && !destination_name.contains("write-backup") {
                return Err("simulated final rename failure".to_string());
            }

            fs::rename(source, destination).map_err(|error| error.to_string())
        }

        fn remove_file(&self, path: &std::path::Path) -> Result<(), String> {
            fs::remove_file(path).map_err(|error| error.to_string())
        }
    }

    #[test]
    fn initializes_the_complete_metadata_layout() {
        let root = test_root("layout");
        fs::create_dir_all(&root).expect("test archive should be created");

        initialize_at(&root).expect("metadata should initialize");

        let metadata = metadata_path(&root);
        assert!(metadata.join("library.json").is_file());
        assert!(metadata.join("progress.json").is_file());
        assert!(metadata.join("settings.json").is_file());
        let settings: serde_json::Value = serde_json::from_slice(
            &fs::read(metadata.join("settings.json")).expect("settings should be readable"),
        )
        .expect("settings should be valid JSON");
        assert_eq!(settings["version"], 3);
        assert!(settings.get("appearance").is_none());
        assert!(!metadata.join("scanner-cache.json").exists());
        assert!(metadata.join("covers").is_dir());
        assert!(!metadata.join("backups").exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn retained_metadata_documents_use_independent_backup_categories() {
        let root = test_root("document-categories");
        fs::create_dir_all(&root).expect("test archive should be created");

        for (document, category) in [
            (MetadataDocument::Library, "library"),
            (MetadataDocument::Progress, "progress"),
            (MetadataDocument::Settings, "settings"),
            (MetadataDocument::Annotations, "annotations"),
        ] {
            write_json(&root, document, &serde_json::json!({ "version": 1 }), false)
                .expect("initial metadata should save");
            write_json(&root, document, &serde_json::json!({ "version": 2 }), true)
                .expect("updated metadata should save");

            let category_directory = metadata_path(&root).join("backups").join(category);
            assert!(category_directory
                .join(format!("{}.bak", document.file_name()))
                .is_file());
            assert!(category_directory
                .read_dir()
                .expect("backup category should be readable")
                .filter_map(Result::ok)
                .any(|entry| entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(&format!("{}.backup-", document.file_name()))));
        }

        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn metadata_backup_retention_is_bounded_per_document() {
        let root = test_root("independent-retention");
        fs::create_dir_all(&root).expect("test archive should be created");

        for document in [MetadataDocument::Library, MetadataDocument::Settings] {
            write_json(&root, document, &serde_json::json!({ "version": 1 }), false)
                .expect("initial metadata should save");
        }
        for revision in 0..8 {
            write_json(
                &root,
                MetadataDocument::Library,
                &serde_json::json!({ "version": revision }),
                true,
            )
            .expect("library metadata should save");
        }
        for revision in 0..3 {
            write_json(
                &root,
                MetadataDocument::Settings,
                &serde_json::json!({ "version": revision }),
                true,
            )
            .expect("settings metadata should save");
        }

        let count_history = |category: &str, prefix: &str| {
            metadata_path(&root)
                .join("backups")
                .join(category)
                .read_dir()
                .expect("backup category should be readable")
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().starts_with(prefix))
                .count()
        };
        assert_eq!(count_history("library", "library.json.backup-"), 5);
        assert_eq!(count_history("settings", "settings.json.backup-"), 3);

        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn missing_annotations_load_as_empty_without_creating_a_file() {
        let root = test_root("annotations-missing");
        fs::create_dir_all(&root).expect("test archive should be created");

        let annotations = load_annotations_at(&root).expect("annotations should load");

        assert_eq!(
            annotations,
            serde_json::json!({ "version": 1, "books": {} })
        );
        assert!(!metadata_path(&root).join("annotations.json").exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn annotations_preserve_unknown_fields_and_create_recovery_backups() {
        let root = test_root("annotations-save");
        fs::create_dir_all(&root).expect("test archive should be created");
        let first = serde_json::json!({
            "version": 1,
            "books": {},
            "futureField": { "preserved": true }
        });
        let second = serde_json::json!({
            "version": 1,
            "books": {
                "book-1": {
                    "annotations": [],
                    "futureBookField": "kept"
                }
            },
            "futureField": { "preserved": true }
        });

        save_annotations_at(&root, &first).expect("initial annotations should save");
        save_annotations_at(&root, &second).expect("updated annotations should save");

        assert_eq!(
            load_annotations_at(&root).expect("annotations should reload"),
            second
        );
        assert!(metadata_path(&root)
            .join("backups/annotations/annotations.json.bak")
            .is_file());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn corrupted_annotations_are_preserved_and_recovered_from_backup() {
        let root = test_root("annotations-recovery");
        fs::create_dir_all(&root).expect("test archive should be created");
        let annotations = serde_json::json!({
            "version": 1,
            "books": { "book-1": { "annotations": [] } }
        });
        save_annotations_at(&root, &annotations).expect("annotations should save");
        save_annotations_at(&root, &annotations).expect("annotations backup should save");
        let path = metadata_path(&root).join("annotations.json");
        fs::write(&path, b"{invalid").expect("annotations should be corrupted");

        let recovered = load_annotations_at(&root).expect("annotations should recover");

        assert_eq!(recovered, annotations);
        assert!(
            fs::read_dir(metadata_path(&root).join("backups/annotations"))
                .expect("metadata directory should be readable")
                .filter_map(Result::ok)
                .any(|entry| entry
                    .file_name()
                    .to_string_lossy()
                    .contains("annotations.json.corrupt-"))
        );
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn annotation_loading_migrates_and_recovers_independently() {
        let root = test_root("annotations-legacy-recovery");
        let directory = metadata_path(&root);
        fs::create_dir_all(&directory).expect("metadata directory should be created");
        let recovered = serde_json::json!({
            "version": 1,
            "books": { "book-1": { "annotations": [] } }
        });
        fs::write(directory.join("annotations.json"), b"{invalid")
            .expect("active annotations should be written");
        fs::write(
            directory.join("annotations.json.bak"),
            serde_json::to_vec(&recovered).expect("annotations should serialize"),
        )
        .expect("legacy annotations backup should be written");

        let annotations = load_annotations_at(&root).expect("annotations should recover");

        assert_eq!(annotations, recovered);
        assert!(directory
            .join("backups/annotations/annotations.json.bak")
            .is_file());
        assert!(!directory.join("annotations.json.bak").exists());
        assert!(!directory.join("library.json").exists());
        assert!(!directory.join("progress.json").exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn loads_archive_settings_without_initializing_library_or_progress_files() {
        let root = test_root("settings-only");
        fs::create_dir_all(&root).expect("test archive should be created");
        let settings_path = metadata_path(&root).join("settings.json");
        fs::create_dir_all(
            settings_path
                .parent()
                .expect("settings should have a parent"),
        )
        .expect("metadata directory should be created");
        fs::write(
            &settings_path,
            br#"{"version":1,"import":{"defaultDestinationFolderPath":"Fiction"}}"#,
        )
        .expect("settings metadata should be written");

        let settings = load_settings_at(&root).expect("settings should load");

        assert_eq!(
            settings.import.default_destination_folder_path.as_deref(),
            Some("Fiction")
        );
        assert_eq!(settings.version, 3);
        assert!(settings.legacy_appearance.is_none());
        assert!(!metadata_path(&root).join("library.json").exists());
        assert!(!metadata_path(&root).join("progress.json").exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn settings_only_loading_migrates_and_recovers_legacy_backup() {
        let root = test_root("settings-legacy-recovery");
        let directory = metadata_path(&root);
        fs::create_dir_all(&directory).expect("metadata directory should be created");
        fs::write(directory.join("settings.json"), b"{invalid")
            .expect("active settings should be written");
        fs::write(
            directory.join("settings.json.bak"),
            br#"{"version":2,"import":{"defaultDestinationFolderPath":"Recovered"},"appearance":{"appTheme":{"kind":"inherit"},"readerTheme":{"kind":"inherit"}}}"#,
        )
        .expect("legacy settings backup should be written");

        let settings = load_settings_at(&root).expect("settings should recover");

        assert_eq!(
            settings.import.default_destination_folder_path.as_deref(),
            Some("Recovered")
        );
        assert_eq!(
            settings
                .legacy_appearance
                .expect("recovered v2 appearance should remain readable"),
            ArchiveAppearanceSettings::default()
        );
        assert!(directory
            .join("backups/settings/settings.json.bak")
            .is_file());
        assert!(!directory.join("settings.json.bak").exists());
        assert!(!directory.join("library.json").exists());
        assert!(!directory.join("progress.json").exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn normalizes_version_one_settings_without_eagerly_rewriting_the_file() {
        let root = test_root("settings-v1-normalization");
        fs::create_dir_all(&root).expect("test archive should be created");
        let settings_path = metadata_path(&root).join("settings.json");
        fs::create_dir_all(
            settings_path
                .parent()
                .expect("settings should have a parent"),
        )
        .expect("metadata directory should be created");
        let source = br#"{
            "version": 1,
            "import": { "defaultDestinationFolderPath": "Fiction" },
            "appearance": {
                "appTheme": { "kind": "custom", "id": "ignored-v1" },
                "readerTheme": { "kind": "builtin", "id": "sepia" }
            }
        }"#;
        fs::write(&settings_path, source).expect("settings metadata should be written");

        let settings = load_settings_at(&root).expect("settings should load");

        assert_eq!(settings.version, 3);
        assert!(settings.legacy_appearance.is_none());
        assert_eq!(
            fs::read(&settings_path).expect("settings should remain readable"),
            source
        );
        assert!(!settings_path.with_extension("json.bak").exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn reads_version_two_appearance_for_migration_but_omits_it_from_current_writes() {
        let root = test_root("settings-v2-roundtrip");
        fs::create_dir_all(&root).expect("test archive should be created");
        let settings_path = metadata_path(&root).join("settings.json");
        fs::create_dir_all(
            settings_path
                .parent()
                .expect("settings should have a parent"),
        )
        .expect("metadata directory should be created");
        fs::write(
            &settings_path,
            br#"{
                "version": 2,
                "import": { "defaultDestinationFolderPath": "Fiction" },
                "appearance": {
                    "appTheme": { "kind": "custom", "id": "moon-ink" },
                    "readerTheme": { "kind": "builtin", "id": "sepia" }
                }
            }"#,
        )
        .expect("settings metadata should be written");

        let settings = load_settings_at(&root).expect("settings should load");
        let appearance = settings
            .legacy_appearance
            .as_ref()
            .expect("version two appearance should remain available for migration");
        assert_eq!(
            appearance.app_theme,
            ArchiveAppThemeSelection::Custom {
                id: "moon-ink".to_string()
            }
        );
        assert_eq!(
            appearance.reader_theme,
            ArchiveReaderThemeSelection::Builtin {
                id: BuiltInReaderThemeId::Sepia
            }
        );

        write_json(&root, MetadataDocument::Settings, &settings, true)
            .expect("settings should save");
        let serialized: serde_json::Value = serde_json::from_slice(
            &fs::read(&settings_path).expect("settings should remain readable"),
        )
        .expect("settings should remain valid JSON");
        assert_eq!(serialized["version"], 3);
        assert_eq!(
            serialized["import"]["defaultDestinationFolderPath"],
            "Fiction"
        );
        assert!(serialized.get("appearance").is_none());
        assert!(metadata_path(&root)
            .join("backups/settings/settings.json.bak")
            .is_file());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn legacy_appearance_is_retained_only_for_version_two_settings() {
        let root = test_root("legacy-appearance-migration");
        let settings_path = metadata_path(&root).join("settings.json");
        fs::create_dir_all(
            settings_path
                .parent()
                .expect("settings should have a parent"),
        )
        .expect("metadata directory should be created");
        fs::write(
            &settings_path,
            br#"{
                "version": 2,
                "import": {},
                "appearance": {
                    "appTheme": { "kind": "builtin", "id": "light" },
                    "readerTheme": { "kind": "builtin", "id": "sepia" }
                }
            }"#,
        )
        .expect("legacy settings should be written");

        let appearance = load_settings_at(&root)
            .expect("legacy settings should load")
            .into_legacy_appearance()
            .expect("version two appearance should be available");
        assert_eq!(
            appearance,
            ArchiveAppearanceSettings {
                app_theme: ArchiveAppThemeSelection::Builtin {
                    id: super::BuiltInAppThemeId::Light,
                },
                reader_theme: ArchiveReaderThemeSelection::Builtin {
                    id: BuiltInReaderThemeId::Sepia,
                },
            }
        );
        fs::write(
            &settings_path,
            br#"{"version":3,"import":{"defaultDestinationFolderPath":"Fiction"}}"#,
        )
        .expect("current settings should be written");
        assert_eq!(
            load_settings_at(&root)
                .expect("current settings should remain readable")
                .into_legacy_appearance(),
            None
        );
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn backs_up_existing_metadata_before_writing() {
        let root = test_root("backup");
        fs::create_dir_all(&root).expect("test archive should be created");
        write_json(
            &root,
            MetadataDocument::Library,
            &LibraryMetadata::default(),
            false,
        )
        .expect("initial write should work");

        write_json(
            &root,
            MetadataDocument::Library,
            &LibraryMetadata::default(),
            true,
        )
        .expect("second write should work");

        assert!(metadata_path(&root)
            .join("backups/library/library.json.bak")
            .is_file());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn removes_temporary_file_when_metadata_write_fails() {
        let root = test_root("failed-write-cleanup");
        fs::create_dir_all(&root).expect("test archive should be created");
        let path = metadata_path(&root).join("library.json");
        fs::create_dir_all(metadata_path(&root)).expect("metadata directory should be created");
        fs::create_dir_all(&path).expect("conflicting directory should be created");

        let result = write_json(
            &root,
            MetadataDocument::Library,
            &LibraryMetadata::default(),
            false,
        );

        assert!(result.is_err());
        assert!(!metadata_path(&root)
            .read_dir()
            .expect("metadata directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains("tmp-write")));
        assert!(path.is_dir());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn metadata_replace_restores_active_file_when_final_rename_fails() {
        let root = test_root("transaction-restore");
        fs::create_dir_all(&root).expect("test archive should be created");
        let path = metadata_path(&root).join("library.json");
        fs::create_dir_all(metadata_path(&root)).expect("metadata directory should be created");
        fs::write(&path, br#"{"version":1,"books":{}}"#)
            .expect("active metadata should be written");
        let mut replacement = LibraryMetadata::default();
        replacement.books.insert(
            "new".to_string(),
            LibraryBookMetadata {
                relative_path: "new.epub".to_string(),
                is_favorite: false,
                cover_path: None,
                source_metadata: None,
                file_size: None,
                file_modified_at: None,
                added_at: "now".to_string(),
                updated_at: "now".to_string(),
            },
        );
        let result = write_json_with_fs(
            &root,
            MetadataDocument::Library,
            &replacement,
            false,
            &FailingMetadataRenameFileSystem,
        );

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(&path).expect("active metadata should remain readable"),
            r#"{"version":1,"books":{}}"#
        );
        assert!(!metadata_path(&root)
            .read_dir()
            .expect("metadata directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains("write-backup")));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn successful_metadata_write_removes_transaction_backup() {
        let root = test_root("transaction-cleanup");
        fs::create_dir_all(&root).expect("test archive should be created");
        write_json(
            &root,
            MetadataDocument::Library,
            &LibraryMetadata::default(),
            false,
        )
        .expect("initial write should work");
        write_json(
            &root,
            MetadataDocument::Library,
            &LibraryMetadata::default(),
            true,
        )
        .expect("second write should work");

        assert!(!metadata_path(&root)
            .read_dir()
            .expect("metadata directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains("write-backup")));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn preserves_corrupted_json_and_recovers_defaults() {
        let root = test_root("corrupt");
        fs::create_dir_all(&root).expect("test archive should be created");
        let path = metadata_path(&root).join("library.json");
        fs::create_dir_all(metadata_path(&root)).expect("metadata directory should be created");
        fs::write(&path, b"{not-json").expect("corrupt file should be written");

        let recovered: LibraryMetadata =
            read_json(&root, MetadataDocument::Library).expect("metadata should recover");

        assert_eq!(recovered.version, 1);
        assert!(metadata_path(&root)
            .join("backups/library")
            .read_dir()
            .expect("directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-")));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn recovers_corrupted_json_from_valid_backup() {
        let root = test_root("backup-recovery");
        fs::create_dir_all(&root).expect("test archive should be created");
        let path = metadata_path(&root).join("library.json");
        let mut library = LibraryMetadata::default();
        library.books.insert(
            "book-1".to_string(),
            LibraryBookMetadata {
                relative_path: "Books/Recovered.epub".to_string(),
                is_favorite: true,
                cover_path: None,
                source_metadata: None,
                file_size: Some(100),
                file_modified_at: Some(200),
                added_at: "2026-07-01T00:00:00.000Z".to_string(),
                updated_at: "2026-07-01T00:00:00.000Z".to_string(),
            },
        );
        write_json(&root, MetadataDocument::Library, &library, false)
            .expect("initial write should work");
        write_json(&root, MetadataDocument::Library, &library, true)
            .expect("backup write should work");
        fs::write(&path, b"{not-json").expect("corrupt file should be written");

        let recovered: LibraryMetadata =
            read_json(&root, MetadataDocument::Library).expect("metadata should recover");

        let book = recovered
            .books
            .get("book-1")
            .expect("book should be restored from backup");
        assert_eq!(book.relative_path, "Books/Recovered.epub");
        assert!(book.is_favorite);
        assert!(metadata_path(&root)
            .join("backups/library/library.json.bak")
            .is_file());
        assert!(metadata_path(&root)
            .join("backups/library")
            .read_dir()
            .expect("directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-")));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn recovery_skips_malformed_candidates_in_documented_layout_order() {
        let root = test_root("recovery-order");
        let directory = metadata_path(&root);
        let backup_directory = directory.join("backups/library");
        fs::create_dir_all(&backup_directory).expect("backup category should be created");
        fs::write(directory.join("library.json"), b"{invalid")
            .expect("active metadata should be corrupted");
        fs::write(
            backup_directory.join("library.json.bak"),
            b"{invalid-stable",
        )
        .expect("new stable backup should be malformed");
        fs::write(
            backup_directory.join("library.json.backup-200.bak"),
            b"{invalid-newest",
        )
        .expect("newest history should be malformed");
        fs::write(
            backup_directory.join("library.json.backup-100.bak"),
            br#"{"version":1,"books":{"new-layout":{"relativePath":"New.epub","isFavorite":false,"addedAt":"now","updatedAt":"now"}}}"#,
        )
        .expect("older new-layout backup should be valid");
        fs::write(
            directory.join("library.json.bak"),
            br#"{"version":1,"books":{"legacy":{"relativePath":"Legacy.epub","isFavorite":false,"addedAt":"now","updatedAt":"now"}}}"#,
        )
        .expect("legacy stable backup should be valid");

        let recovered: LibraryMetadata = read_json(&root, MetadataDocument::Library)
            .expect("metadata should recover from the next valid candidate");

        assert!(recovered.books.contains_key("new-layout"));
        assert!(!recovered.books.contains_key("legacy"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn legacy_metadata_migration_is_collision_safe_idempotent_and_complete() {
        let root = test_root("legacy-collisions");
        let directory = metadata_path(&root);
        let backup_directory = directory.join("backups/library");
        fs::create_dir_all(&backup_directory).expect("backup category should be created");
        fs::write(backup_directory.join("library.json.bak"), b"new-stable")
            .expect("new stable backup should be written");
        fs::write(directory.join("library.json.bak"), b"legacy-stable")
            .expect("legacy stable backup should be written");
        fs::write(
            backup_directory.join("library.json.backup-100.bak"),
            b"new-history",
        )
        .expect("new history backup should be written");
        fs::write(
            directory.join("library.json.backup-100.bak"),
            b"legacy-history",
        )
        .expect("legacy history backup should be written");
        fs::write(
            directory.join("library.json.corrupt-100.bak"),
            b"legacy-corrupt",
        )
        .expect("legacy corruption backup should be written");

        ArchiveBackupLayout::new(&root)
            .migrate_metadata_document(MetadataDocument::Library, MAX_METADATA_BACKUPS)
            .expect("legacy backups should migrate");
        let first_entries = backup_directory
            .read_dir()
            .expect("backup category should be readable")
            .filter_map(Result::ok)
            .map(|entry| entry.file_name())
            .collect::<Vec<_>>();
        ArchiveBackupLayout::new(&root)
            .migrate_metadata_document(MetadataDocument::Library, MAX_METADATA_BACKUPS)
            .expect("repeated migration should be safe");
        let second_entries = backup_directory
            .read_dir()
            .expect("backup category should be readable")
            .filter_map(Result::ok)
            .map(|entry| entry.file_name())
            .collect::<Vec<_>>();

        assert_eq!(first_entries.len(), second_entries.len());
        let migrated_contents = backup_directory
            .read_dir()
            .expect("backup category should be readable")
            .filter_map(Result::ok)
            .map(|entry| fs::read(entry.path()).expect("backup should be readable"))
            .collect::<Vec<_>>();
        for expected in [
            b"new-stable".as_slice(),
            b"legacy-stable".as_slice(),
            b"new-history".as_slice(),
            b"legacy-history".as_slice(),
            b"legacy-corrupt".as_slice(),
        ] {
            assert!(migrated_contents
                .iter()
                .any(|contents| contents == expected));
        }
        assert!(!directory
            .read_dir()
            .expect("metadata directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| {
                let name = entry.file_name().to_string_lossy().to_string();
                name.starts_with("library.json.backup-")
                    || name.starts_with("library.json.corrupt-")
                    || name == "library.json.bak"
            }));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn saving_after_migration_preserves_a_different_legacy_stable_backup_as_history() {
        let root = test_root("legacy-stable-save");
        let directory = metadata_path(&root);
        fs::create_dir_all(&directory).expect("metadata directory should be created");
        fs::write(
            directory.join("library.json"),
            br#"{"version":1,"books":{}}"#,
        )
        .expect("active library should be written");
        let legacy_backup = br#"{"version":1,"books":{"legacy":{"relativePath":"Legacy.epub","isFavorite":false,"addedAt":"now","updatedAt":"now"}}}"#;
        fs::write(directory.join("library.json.bak"), legacy_backup)
            .expect("legacy stable backup should be written");

        write_json(
            &root,
            MetadataDocument::Library,
            &LibraryMetadata::default(),
            true,
        )
        .expect("library metadata should save");

        let backup_directory = directory.join("backups/library");
        assert!(backup_directory
            .read_dir()
            .expect("backup category should be readable")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("library.json.backup-")
            })
            .any(|entry| fs::read(entry.path()).is_ok_and(|contents| contents == legacy_backup)));
        assert!(!directory.join("library.json.bak").exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn archive_initialization_removes_all_recognized_legacy_backup_names_from_metadata_root() {
        let root = test_root("complete-legacy-migration");
        let directory = metadata_path(&root);
        fs::create_dir_all(&directory).expect("metadata directory should be created");
        for file_name in [
            "library.json.bak",
            "library.json.backup-1.bak",
            "library.json.corrupt-1.bak",
            "progress.json.bak",
            "progress.json.backup-1.bak",
            "progress.json.corrupt-1.bak",
            "settings.json.bak",
            "settings.json.backup-1.bak",
            "settings.json.corrupt-1.bak",
            "annotations.json.bak",
            "annotations.json.backup-1.bak",
            "annotations.json.corrupt-1.bak",
            "scanner-cache.json.corrupt-1.bak",
        ] {
            fs::write(directory.join(file_name), file_name.as_bytes())
                .expect("legacy backup should be written");
        }

        initialize_at(&root).expect("archive metadata should initialize and migrate");

        let root_file_names = directory
            .read_dir()
            .expect("metadata directory should be readable")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_ok_and(|file_type| file_type.is_file()))
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect::<Vec<_>>();
        assert!(!root_file_names.iter().any(|name| name.ends_with(".bak")));
        for category in [
            "library",
            "progress",
            "settings",
            "annotations",
            "scanner-cache",
        ] {
            assert!(directory.join("backups").join(category).is_dir());
        }
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[cfg(unix)]
    #[test]
    fn metadata_backup_category_symlink_outside_archive_is_rejected() {
        let root = test_root("category-symlink");
        let outside = test_root("category-symlink-outside");
        let backup_root = metadata_path(&root).join("backups");
        fs::create_dir_all(&backup_root).expect("backup root should be created");
        fs::create_dir_all(&outside).expect("outside directory should be created");
        fs::write(
            metadata_path(&root).join("library.json"),
            br#"{"version":1,"books":{}}"#,
        )
        .expect("active metadata should be written");
        std::os::unix::fs::symlink(&outside, backup_root.join("library"))
            .expect("backup category symlink should be created");

        let error = write_json(
            &root,
            MetadataDocument::Library,
            &LibraryMetadata::default(),
            true,
        )
        .expect_err("symlinked backup category should be rejected");

        assert!(error.contains("symbolic link"));
        fs::remove_dir_all(root).expect("test archive should be removed");
        fs::remove_dir_all(outside).expect("outside directory should be removed");
    }

    #[test]
    fn scanner_cache_corruption_is_preserved_only_in_its_backup_category() {
        let root = test_root("scanner-corruption");
        let directory = metadata_path(&root);
        fs::create_dir_all(&directory).expect("metadata directory should be created");
        fs::write(directory.join(SCANNER_CACHE_FILE), b"{invalid")
            .expect("scanner cache should be corrupted");

        let (_, recovered) =
            load_scanner_cache_with_recovery_at(&root).expect("scanner cache should recover");

        assert!(recovered);
        assert!(directory
            .join("backups/scanner-cache")
            .read_dir()
            .expect("scanner backup category should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with("scanner-cache.json.corrupt-")));
        assert!(!directory
            .read_dir()
            .expect("metadata directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with("scanner-cache.json.corrupt-")));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn keeps_metadata_backup_history_bounded() {
        let root = test_root("bounded-backups");
        fs::create_dir_all(&root).expect("test archive should be created");

        write_json(
            &root,
            MetadataDocument::Library,
            &LibraryMetadata::default(),
            false,
        )
        .expect("initial write should work");
        for _ in 0..8 {
            write_json(
                &root,
                MetadataDocument::Library,
                &LibraryMetadata::default(),
                true,
            )
            .expect("backup write should work");
        }

        let backup_directory = metadata_path(&root).join("backups/library");
        let timestamped_backups = backup_directory
            .read_dir()
            .expect("directory should be readable")
            .filter_map(Result::ok)
            .filter(|entry| {
                let file_name = entry.file_name().to_string_lossy().to_string();
                file_name.starts_with("library.json.backup-") && file_name.ends_with(".bak")
            })
            .count();
        assert!(timestamped_backups <= 5);
        assert!(backup_directory.join("library.json.bak").is_file());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn write_backup_does_not_replace_valid_backup_with_corrupted_active_file() {
        let root = test_root("corrupt-active-backup");
        fs::create_dir_all(&root).expect("test archive should be created");
        let path = metadata_path(&root).join("library.json");
        let mut library = LibraryMetadata::default();
        library.books.insert(
            "book-1".to_string(),
            LibraryBookMetadata {
                relative_path: "Books/Backup.epub".to_string(),
                is_favorite: true,
                cover_path: None,
                source_metadata: None,
                file_size: None,
                file_modified_at: None,
                added_at: "2026-07-01T00:00:00.000Z".to_string(),
                updated_at: "2026-07-01T00:00:00.000Z".to_string(),
            },
        );
        write_json(&root, MetadataDocument::Library, &library, false)
            .expect("initial write should work");
        write_json(&root, MetadataDocument::Library, &library, true)
            .expect("valid backup should be created");
        fs::write(&path, b"{not-json").expect("corrupt active file should be written");

        write_json(
            &root,
            MetadataDocument::Library,
            &LibraryMetadata::default(),
            true,
        )
        .expect("write should recover safely");

        let backup_directory = metadata_path(&root).join("backups/library");
        let backup_contents = fs::read(backup_directory.join("library.json.bak"))
            .expect("stable backup should still be readable");
        let backup: LibraryMetadata = serde_json::from_slice(&backup_contents)
            .expect("stable backup should remain valid JSON");
        assert!(backup.books.contains_key("book-1"));
        assert!(backup_directory
            .read_dir()
            .expect("directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-")));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn old_display_override_fields_are_ignored_when_serializing_library_metadata() {
        let value = serde_json::json!({
            "version": 1,
            "books": {
                "book-1": {
                    "relativePath": "Books/Example.epub",
                    "displayTitle": "Old app title",
                    "displayAuthor": "Old app author",
                    "isFavorite": true,
                    "addedAt": "2026-07-01T00:00:00.000Z",
                    "updatedAt": "2026-07-01T00:00:00.000Z"
                }
            }
        });

        let parsed: LibraryMetadata =
            serde_json::from_value(value).expect("old metadata should deserialize");
        let serialized = serde_json::to_value(parsed).expect("metadata should serialize");
        let book = &serialized["books"]["book-1"];

        assert_eq!(book["relativePath"], "Books/Example.epub");
        assert_eq!(book["isFavorite"], true);
        assert!(book.get("displayTitle").is_none());
        assert!(book.get("displayAuthor").is_none());
    }

    #[test]
    fn archive_settings_ignore_old_app_level_fields() {
        let value = serde_json::json!({
            "version": 1,
            "reader": {
                "fontSize": 22.0,
                "progressPlacement": "side"
            },
            "library": {
                "viewMode": "grid",
                "sortBy": "folder"
            },
            "filesAndMetadata": {
                "scanOnStartup": false
            },
            "import": {
                "defaultMode": "move",
                "defaultConflictAction": "replace",
                "defaultDestinationFolderPath": "Fiction"
            }
        });

        let parsed: SettingsMetadata =
            serde_json::from_value(value).expect("old settings should deserialize");
        let serialized = serde_json::to_value(parsed).expect("settings should serialize");

        assert_eq!(
            serialized["import"]["defaultDestinationFolderPath"],
            "Fiction"
        );
        assert_eq!(serialized["version"], 3);
        assert!(serialized.get("appearance").is_none());
        assert!(serialized.get("reader").is_none());
        assert!(serialized.get("library").is_none());
        assert!(serialized.get("filesAndMetadata").is_none());
        assert!(serialized["import"].get("defaultMode").is_none());
        assert!(serialized["import"].get("defaultConflictAction").is_none());
    }

    #[test]
    fn current_archive_settings_ignore_legacy_appearance_on_read_and_write() {
        let parsed: SettingsMetadata = serde_json::from_value(serde_json::json!({
            "version": 3,
            "import": { "defaultDestinationFolderPath": "Fiction" },
            "appearance": {
                "appTheme": { "kind": "custom", "id": "must-not-persist" },
                "readerTheme": { "kind": "builtin", "id": "sepia" }
            }
        }))
        .expect("current settings should deserialize");

        assert!(parsed.legacy_appearance.is_none());
        assert_eq!(
            serde_json::to_value(parsed).expect("current settings should serialize"),
            serde_json::json!({
                "version": 3,
                "import": { "defaultDestinationFolderPath": "Fiction" }
            })
        );
    }
}
