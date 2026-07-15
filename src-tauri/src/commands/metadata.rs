use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};

use super::{archive_root, epub_metadata};

pub(crate) const METADATA_DIRECTORY: &str = ".archeion";
const LIBRARY_FILE: &str = "library.json";
const PROGRESS_FILE: &str = "progress.json";
const SETTINGS_FILE: &str = "settings.json";
const ANNOTATIONS_FILE: &str = "annotations.json";
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
    pub appearance: ArchiveAppearanceSettings,
}

impl From<StoredSettingsMetadata> for SettingsMetadata {
    fn from(stored: StoredSettingsMetadata) -> Self {
        Self {
            version: 2,
            import: stored.import,
            appearance: if stored.version == 2 {
                stored.appearance.unwrap_or_default()
            } else {
                ArchiveAppearanceSettings::default()
            },
        }
    }
}

impl Default for SettingsMetadata {
    fn default() -> Self {
        Self {
            version: 2,
            import: ImportSettings::default(),
            appearance: ArchiveAppearanceSettings::default(),
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

fn timestamped_metadata_path(path: &Path, marker: &str) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_default();
    path.with_file_name(format!("{file_name}.{marker}-{}.bak", timestamp_suffix()))
}

fn corruption_backup_path(path: &Path) -> PathBuf {
    timestamped_metadata_path(path, "corrupt")
}

fn stable_backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
}

fn timestamped_backup_path(path: &Path) -> PathBuf {
    timestamped_metadata_path(path, "backup")
}

fn timestamped_backup_prefix(path: &Path, marker: &str) -> Option<String> {
    path.file_name()
        .map(|name| format!("{}.{marker}-", name.to_string_lossy()))
}

fn prune_timestamped_backups(path: &Path, marker: &str, max_backups: usize) -> Result<(), String> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    let Some(prefix) = timestamped_backup_prefix(path, marker) else {
        return Ok(());
    };

    let mut backups = Vec::new();
    for entry in fs::read_dir(parent).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if !file_name.starts_with(&prefix) || !file_name.ends_with(".bak") {
            continue;
        }
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_file()
        {
            backups.push((file_name, entry.path()));
        }
    }

    backups.sort_by(|left, right| left.0.cmp(&right.0));
    let stale_count = backups.len().saturating_sub(max_backups);
    for (_, backup_path) in backups.into_iter().take(stale_count) {
        fs::remove_file(backup_path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn backup_existing_json(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    let existing_contents = fs::read(path).map_err(|error| error.to_string())?;
    if serde_json::from_slice::<serde_json::Value>(&existing_contents).is_err() {
        fs::rename(path, corruption_backup_path(path)).map_err(|error| error.to_string())?;
        prune_timestamped_backups(path, "corrupt", MAX_METADATA_BACKUPS)?;
        return Ok(());
    }

    fs::copy(path, stable_backup_path(path)).map_err(|error| error.to_string())?;
    fs::copy(path, timestamped_backup_path(path)).map_err(|error| error.to_string())?;
    prune_timestamped_backups(path, "backup", MAX_METADATA_BACKUPS)
}

trait MetadataFileSystem {
    fn rename(&self, source: &Path, destination: &Path) -> Result<(), String>;
    fn remove_file(&self, path: &Path) -> Result<(), String>;
}

struct RealMetadataFileSystem;

impl MetadataFileSystem for RealMetadataFileSystem {
    fn rename(&self, source: &Path, destination: &Path) -> Result<(), String> {
        fs::rename(source, destination).map_err(|error| error.to_string())
    }

    fn remove_file(&self, path: &Path) -> Result<(), String> {
        fs::remove_file(path).map_err(|error| error.to_string())
    }
}

fn metadata_transaction_path(path: &Path, marker: &str) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_default();
    path.with_file_name(format!("{file_name}.{marker}-{}", timestamp_suffix()))
}

fn replace_json_file_with_fs(
    temporary_path: &Path,
    destination_path: &Path,
    fs_ops: &impl MetadataFileSystem,
) -> Result<(), String> {
    if !destination_path.exists() {
        return fs_ops.rename(temporary_path, destination_path);
    }

    if !destination_path.is_file() {
        return Err("Metadata path is not a file.".to_string());
    }

    let transaction_backup_path = metadata_transaction_path(destination_path, "write-backup");
    fs_ops.rename(destination_path, &transaction_backup_path)?;

    if let Err(rename_error) = fs_ops.rename(temporary_path, destination_path) {
        return match fs_ops.rename(&transaction_backup_path, destination_path) {
            Ok(()) => Err(format!(
                "Metadata save failed and the previous file was restored: {rename_error}"
            )),
            Err(restore_error) => Err(format!(
                "Metadata save failed and the previous file could not be restored: {restore_error}"
            )),
        };
    }

    fs_ops.remove_file(&transaction_backup_path)?;
    Ok(())
}

fn replace_json_file(temporary_path: &Path, destination_path: &Path) -> Result<(), String> {
    replace_json_file_with_fs(temporary_path, destination_path, &RealMetadataFileSystem)
}

fn write_json<T: Serialize>(path: &Path, value: &T, backup: bool) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Metadata directory is unavailable.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let contents = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    serde_json::from_slice::<serde_json::Value>(&contents)
        .map_err(|error| format!("Metadata JSON could not be validated: {error}"))?;
    let temporary_path = metadata_transaction_path(path, "tmp-write");

    let write_result = (|| -> Result<(), String> {
        let mut temporary = File::create(&temporary_path).map_err(|error| error.to_string())?;
        temporary
            .write_all(&contents)
            .map_err(|error| error.to_string())?;
        temporary.sync_all().map_err(|error| error.to_string())?;
        drop(temporary);
        let temporary_contents = fs::read(&temporary_path).map_err(|error| error.to_string())?;
        serde_json::from_slice::<serde_json::Value>(&temporary_contents)
            .map_err(|error| format!("Metadata JSON could not be validated: {error}"))?;

        if backup {
            backup_existing_json(path)?;
        }
        replace_json_file(&temporary_path, path)
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }

    write_result
}

fn backup_candidates(path: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let stable = stable_backup_path(path);
    if stable.exists() {
        candidates.push(stable);
    }

    let Some(parent) = path.parent() else {
        return candidates;
    };
    let Some(prefix) = timestamped_backup_prefix(path, "backup") else {
        return candidates;
    };

    let Ok(entries) = fs::read_dir(parent) else {
        return candidates;
    };

    let mut timestamped = entries
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_name = entry.file_name().to_string_lossy().to_string();
            (file_name.starts_with(&prefix) && file_name.ends_with(".bak"))
                .then_some((file_name, entry.path()))
        })
        .collect::<Vec<_>>();
    timestamped.sort_by(|left, right| right.0.cmp(&left.0));
    candidates.extend(timestamped.into_iter().map(|(_, path)| path));
    candidates
}

fn recover_json_from_backup<T>(path: &Path) -> Option<T>
where
    T: DeserializeOwned,
{
    backup_candidates(path).into_iter().find_map(|backup_path| {
        fs::read(backup_path)
            .ok()
            .and_then(|contents| serde_json::from_slice(&contents).ok())
    })
}

struct JsonReadResult<T> {
    value: T,
    recovered: bool,
}

fn read_json_with_recovery<T>(path: &Path) -> Result<JsonReadResult<T>, String>
where
    T: Default + DeserializeOwned + Serialize,
{
    if !path.exists() {
        let value = T::default();
        write_json(path, &value, false)?;
        return Ok(JsonReadResult {
            value,
            recovered: false,
        });
    }

    let contents = fs::read(path).map_err(|error| error.to_string())?;
    match serde_json::from_slice(&contents) {
        Ok(value) => Ok(JsonReadResult {
            value,
            recovered: false,
        }),
        Err(_) => {
            let corrupt_path = corruption_backup_path(path);
            fs::rename(path, &corrupt_path).map_err(|error| error.to_string())?;
            prune_timestamped_backups(path, "corrupt", MAX_METADATA_BACKUPS)?;
            let value = recover_json_from_backup(path).unwrap_or_default();
            write_json(path, &value, false)?;
            Ok(JsonReadResult {
                value,
                recovered: true,
            })
        }
    }
}

fn read_json<T>(path: &Path) -> Result<T, String>
where
    T: Default + DeserializeOwned + Serialize,
{
    read_json_with_recovery(path).map(|result| result.value)
}

fn read_optional_json_with_recovery<T>(path: &Path, default_value: T) -> Result<T, String>
where
    T: Clone + DeserializeOwned + Serialize,
{
    if !path.exists() {
        return Ok(default_value);
    }

    let contents = fs::read(path).map_err(|error| error.to_string())?;
    match serde_json::from_slice(&contents) {
        Ok(value) => Ok(value),
        Err(_) => {
            let corrupt_path = corruption_backup_path(path);
            fs::rename(path, &corrupt_path).map_err(|error| error.to_string())?;
            prune_timestamped_backups(path, "corrupt", MAX_METADATA_BACKUPS)?;
            let value = recover_json_from_backup(path).unwrap_or(default_value);
            write_json(path, &value, false)?;
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
        &metadata_path(root).join(ANNOTATIONS_FILE),
        default_annotations_metadata(),
    )
}

pub(crate) fn save_annotations_at(root: &Path, metadata: &serde_json::Value) -> Result<(), String> {
    let path = metadata_path(root).join(ANNOTATIONS_FILE);
    write_json(&path, metadata, true)
}

pub(crate) fn initialize_at(root: &Path) -> Result<(), String> {
    if !root.is_dir() {
        return Err("The selected archive folder is unavailable.".to_string());
    }

    let directory = metadata_path(root);
    fs::create_dir_all(directory.join("covers")).map_err(|error| error.to_string())?;
    read_json::<LibraryMetadata>(&directory.join(LIBRARY_FILE))?;
    read_json::<ProgressMetadata>(&directory.join(PROGRESS_FILE))?;
    read_json::<SettingsMetadata>(&directory.join(SETTINGS_FILE))?;
    Ok(())
}

pub(crate) fn load_settings_at(root: &Path) -> Result<SettingsMetadata, String> {
    if !root.is_dir() {
        return Err("The selected archive folder is unavailable.".to_string());
    }

    let directory = metadata_path(root);
    fs::create_dir_all(&directory).map_err(|error| error.to_string())?;
    read_json::<SettingsMetadata>(&directory.join(SETTINGS_FILE))
}

pub(crate) fn load_scanner_cache_at(root: &Path) -> Result<ScannerCache, String> {
    read_json(&metadata_path(root).join(SCANNER_CACHE_FILE))
}

pub(crate) fn load_scanner_cache_with_recovery_at(
    root: &Path,
) -> Result<(ScannerCache, bool), String> {
    let result = read_json_with_recovery(&metadata_path(root).join(SCANNER_CACHE_FILE))?;
    Ok((result.value, result.recovered))
}

pub(crate) fn save_scanner_cache_at(root: &Path, cache: &ScannerCache) -> Result<(), String> {
    write_json(&metadata_path(root).join(SCANNER_CACHE_FILE), cache, false)
}

pub(crate) fn update_scanner_cache_entry_at(
    root: &Path,
    relative_path: &str,
    entry: ScannerCacheEntry,
) -> Result<(), String> {
    let mut cache = load_scanner_cache_at(root)?;
    if cache.entries.get(relative_path) == Some(&entry) {
        return Ok(());
    }

    cache.entries.insert(relative_path.to_string(), entry);
    save_scanner_cache_at(root, &cache)
}

pub(crate) fn clear_scanner_cache_at(root: &Path) -> Result<(), String> {
    let path = metadata_path(root).join(SCANNER_CACHE_FILE);
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) fn invalidate_scanner_cache_entries_at(
    root: &Path,
    relative_paths: &[String],
) -> Result<(), String> {
    let mut cache = load_scanner_cache_at(root)?;
    let mut changed = false;
    for relative_path in relative_paths {
        changed |= cache.entries.remove(relative_path).is_some();
    }
    if changed {
        save_scanner_cache_at(root, &cache)?;
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
    let directory = metadata_path(&root);

    let metadata = MetadataBundle {
        library: read_json(&directory.join(LIBRARY_FILE))?,
        progress: read_json(&directory.join(PROGRESS_FILE))?,
        settings: read_json(&directory.join(SETTINGS_FILE))?,
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
    let path = metadata_path(&resolve_command_archive_root(&app, root_path)?).join(LIBRARY_FILE);
    write_json(&path, &metadata, true)
}

#[tauri::command]
pub fn save_progress_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
    metadata: ProgressMetadata,
) -> Result<(), String> {
    let path = metadata_path(&resolve_command_archive_root(&app, root_path)?).join(PROGRESS_FILE);
    write_json(&path, &metadata, true)
}

#[tauri::command]
pub fn save_settings_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
    metadata: SettingsMetadata,
) -> Result<(), String> {
    let path = metadata_path(&resolve_command_archive_root(&app, root_path)?).join(SETTINGS_FILE);
    write_json(&path, &metadata, true)
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
        initialize_at, load_annotations_at, load_settings_at, metadata_path, read_json,
        replace_json_file_with_fs, save_annotations_at, write_json, ArchiveAppThemeSelection,
        ArchiveReaderThemeSelection, BuiltInReaderThemeId, LibraryBookMetadata, LibraryMetadata,
        MetadataFileSystem, SettingsMetadata,
    };

    fn test_root(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-metadata-{label}-{nonce}"))
    }

    struct FailingMetadataRenameFileSystem;

    impl MetadataFileSystem for FailingMetadataRenameFileSystem {
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
        assert_eq!(settings["version"], 2);
        assert_eq!(settings["appearance"]["appTheme"]["kind"], "inherit");
        assert_eq!(settings["appearance"]["readerTheme"]["kind"], "inherit");
        assert!(!metadata.join("scanner-cache.json").exists());
        assert!(metadata.join("covers").is_dir());
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
        assert!(metadata_path(&root).join("annotations.json.bak").is_file());
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
        assert!(fs::read_dir(metadata_path(&root))
            .expect("metadata directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .contains("annotations.json.corrupt-")));
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
        assert_eq!(settings.version, 2);
        assert_eq!(
            settings.appearance.app_theme,
            ArchiveAppThemeSelection::Inherit
        );
        assert_eq!(
            settings.appearance.reader_theme,
            ArchiveReaderThemeSelection::Inherit
        );
        assert!(!metadata_path(&root).join("library.json").exists());
        assert!(!metadata_path(&root).join("progress.json").exists());
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

        assert_eq!(settings.version, 2);
        assert_eq!(
            settings.appearance.app_theme,
            ArchiveAppThemeSelection::Inherit
        );
        assert_eq!(
            settings.appearance.reader_theme,
            ArchiveReaderThemeSelection::Inherit
        );
        assert_eq!(
            fs::read(&settings_path).expect("settings should remain readable"),
            source
        );
        assert!(!settings_path.with_extension("json.bak").exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn preserves_version_two_selections_and_persists_the_normalized_shape_on_write() {
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
        assert_eq!(
            settings.appearance.app_theme,
            ArchiveAppThemeSelection::Custom {
                id: "moon-ink".to_string()
            }
        );
        assert_eq!(
            settings.appearance.reader_theme,
            ArchiveReaderThemeSelection::Builtin {
                id: BuiltInReaderThemeId::Sepia
            }
        );

        write_json(&settings_path, &settings, true).expect("settings should save");
        let serialized: serde_json::Value = serde_json::from_slice(
            &fs::read(&settings_path).expect("settings should remain readable"),
        )
        .expect("settings should remain valid JSON");
        assert_eq!(serialized["version"], 2);
        assert_eq!(
            serialized["import"]["defaultDestinationFolderPath"],
            "Fiction"
        );
        assert_eq!(serialized["appearance"]["appTheme"]["kind"], "custom");
        assert_eq!(serialized["appearance"]["appTheme"]["id"], "moon-ink");
        assert_eq!(serialized["appearance"]["readerTheme"]["id"], "sepia");
        assert!(settings_path.with_extension("json.bak").is_file());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn backs_up_existing_metadata_before_writing() {
        let root = test_root("backup");
        fs::create_dir_all(&root).expect("test archive should be created");
        let path = root.join("library.json");
        write_json(&path, &LibraryMetadata::default(), false).expect("initial write should work");

        write_json(&path, &LibraryMetadata::default(), true).expect("second write should work");

        assert!(root.join("library.json.bak").is_file());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn removes_temporary_file_when_metadata_write_fails() {
        let root = test_root("failed-write-cleanup");
        fs::create_dir_all(&root).expect("test archive should be created");
        let path = root.join("library.json");
        fs::create_dir_all(&path).expect("conflicting directory should be created");

        let result = write_json(&path, &LibraryMetadata::default(), false);

        assert!(result.is_err());
        assert!(!root
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
        let path = root.join("library.json");
        let temporary_path = root.join("library.json.tmp-write-test");
        fs::write(&path, br#"{"version":1,"books":{}}"#)
            .expect("active metadata should be written");
        fs::write(&temporary_path, br#"{"version":1,"books":{"new":{}}}"#)
            .expect("temporary metadata should be written");

        let result =
            replace_json_file_with_fs(&temporary_path, &path, &FailingMetadataRenameFileSystem);

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(&path).expect("active metadata should remain readable"),
            r#"{"version":1,"books":{}}"#
        );
        assert!(!root
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
        let path = root.join("library.json");
        write_json(&path, &LibraryMetadata::default(), false).expect("initial write should work");
        write_json(&path, &LibraryMetadata::default(), true).expect("second write should work");

        assert!(!root
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
        let path = root.join("library.json");
        fs::write(&path, b"{not-json").expect("corrupt file should be written");

        let recovered: LibraryMetadata = read_json(&path).expect("metadata should recover");

        assert_eq!(recovered.version, 1);
        assert!(root
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
        let path = root.join("library.json");
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
        write_json(&path, &library, false).expect("initial write should work");
        write_json(&path, &library, true).expect("backup write should work");
        fs::write(&path, b"{not-json").expect("corrupt file should be written");

        let recovered: LibraryMetadata = read_json(&path).expect("metadata should recover");

        let book = recovered
            .books
            .get("book-1")
            .expect("book should be restored from backup");
        assert_eq!(book.relative_path, "Books/Recovered.epub");
        assert!(book.is_favorite);
        assert!(root.join("library.json.bak").is_file());
        assert!(root
            .read_dir()
            .expect("directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-")));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn keeps_metadata_backup_history_bounded() {
        let root = test_root("bounded-backups");
        fs::create_dir_all(&root).expect("test archive should be created");
        let path = root.join("library.json");

        write_json(&path, &LibraryMetadata::default(), false).expect("initial write should work");
        for _ in 0..8 {
            write_json(&path, &LibraryMetadata::default(), true).expect("backup write should work");
        }

        let timestamped_backups = root
            .read_dir()
            .expect("directory should be readable")
            .filter_map(Result::ok)
            .filter(|entry| {
                let file_name = entry.file_name().to_string_lossy().to_string();
                file_name.starts_with("library.json.backup-") && file_name.ends_with(".bak")
            })
            .count();
        assert!(timestamped_backups <= 5);
        assert!(root.join("library.json.bak").is_file());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn write_backup_does_not_replace_valid_backup_with_corrupted_active_file() {
        let root = test_root("corrupt-active-backup");
        fs::create_dir_all(&root).expect("test archive should be created");
        let path = root.join("library.json");
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
        write_json(&path, &library, false).expect("initial write should work");
        write_json(&path, &library, true).expect("valid backup should be created");
        fs::write(&path, b"{not-json").expect("corrupt active file should be written");

        write_json(&path, &LibraryMetadata::default(), true).expect("write should recover safely");

        let backup_contents = fs::read(root.join("library.json.bak"))
            .expect("stable backup should still be readable");
        let backup: LibraryMetadata = serde_json::from_slice(&backup_contents)
            .expect("stable backup should remain valid JSON");
        assert!(backup.books.contains_key("book-1"));
        assert!(root
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
        assert_eq!(serialized["version"], 2);
        assert_eq!(serialized["appearance"]["appTheme"]["kind"], "inherit");
        assert_eq!(serialized["appearance"]["readerTheme"]["kind"], "inherit");
        assert!(serialized.get("reader").is_none());
        assert!(serialized.get("library").is_none());
        assert!(serialized.get("filesAndMetadata").is_none());
        assert!(serialized["import"].get("defaultMode").is_none());
        assert!(serialized["import"].get("defaultConflictAction").is_none());
    }
}
