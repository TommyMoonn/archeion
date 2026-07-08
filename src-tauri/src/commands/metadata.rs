use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    time::{Instant, SystemTime, UNIX_EPOCH},
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};

use super::{archive_root, epub_metadata};

pub(crate) const METADATA_DIRECTORY: &str = ".archeion";
const LIBRARY_FILE: &str = "library.json";
const PROGRESS_FILE: &str = "progress.json";
const SETTINGS_FILE: &str = "settings.json";
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

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_destination_folder_path: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SettingsMetadata {
    pub version: u8,
    #[serde(default)]
    pub import: ImportSettings,
}

impl Default for SettingsMetadata {
    fn default() -> Self {
        Self {
            version: 1,
            import: ImportSettings::default(),
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

fn log_metadata_command_timing(command: &str, started_at: Instant) {
    #[cfg(debug_assertions)]
    eprintln!("{command} completed in {:?}", started_at.elapsed());

    #[cfg(not(debug_assertions))]
    let _ = (command, started_at);
}

fn metadata_path(root: &Path) -> PathBuf {
    root.join(METADATA_DIRECTORY)
}

fn corruption_backup_path(path: &Path) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_default();
    path.with_file_name(format!("{file_name}.corrupt-{timestamp}.bak"))
}

fn write_json<T: Serialize>(path: &Path, value: &T, backup: bool) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Metadata directory is unavailable.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let contents = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    let temporary_path = path.with_extension("json.tmp");

    let write_result = (|| -> Result<(), String> {
        let mut temporary = File::create(&temporary_path).map_err(|error| error.to_string())?;
        temporary
            .write_all(&contents)
            .map_err(|error| error.to_string())?;
        temporary.sync_all().map_err(|error| error.to_string())?;

        if backup && path.exists() {
            fs::copy(path, path.with_extension("json.bak")).map_err(|error| error.to_string())?;
        }
        if path.exists() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
        fs::rename(&temporary_path, path).map_err(|error| error.to_string())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }

    write_result
}

fn read_json<T>(path: &Path) -> Result<T, String>
where
    T: Default + DeserializeOwned + Serialize,
{
    if !path.exists() {
        let value = T::default();
        write_json(path, &value, false)?;
        return Ok(value);
    }

    let contents = fs::read(path).map_err(|error| error.to_string())?;
    match serde_json::from_slice(&contents) {
        Ok(value) => Ok(value),
        Err(_) => {
            fs::rename(path, corruption_backup_path(path)).map_err(|error| error.to_string())?;
            let value = T::default();
            write_json(path, &value, false)?;
            Ok(value)
        }
    }
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

pub(crate) fn save_scanner_cache_at(root: &Path, cache: &ScannerCache) -> Result<(), String> {
    write_json(&metadata_path(root).join(SCANNER_CACHE_FILE), cache, false)
}

pub(crate) fn clear_scanner_cache_at(root: &Path) -> Result<(), String> {
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
    let started_at = Instant::now();
    let root = resolve_command_archive_root(&app, root_path)?;
    initialize_at(&root)?;
    let directory = metadata_path(&root);

    let metadata = MetadataBundle {
        library: read_json(&directory.join(LIBRARY_FILE))?,
        progress: read_json(&directory.join(PROGRESS_FILE))?,
        settings: read_json(&directory.join(SETTINGS_FILE))?,
    };
    log_metadata_command_timing("load_archive_metadata", started_at);
    Ok(metadata)
}

#[tauri::command]
pub fn load_settings_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
) -> Result<SettingsMetadata, String> {
    let started_at = Instant::now();
    let root = resolve_command_archive_root(&app, root_path)?;
    let metadata = load_settings_at(&root)?;
    log_metadata_command_timing("load_settings_metadata", started_at);
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

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{
        initialize_at, load_settings_at, metadata_path, read_json, write_json, LibraryMetadata,
        SettingsMetadata,
    };

    fn test_root(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-metadata-{label}-{nonce}"))
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
        assert!(!metadata.join("scanner-cache.json").exists());
        assert!(metadata.join("covers").is_dir());
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
        assert!(!metadata_path(&root).join("library.json").exists());
        assert!(!metadata_path(&root).join("progress.json").exists());
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
        let temporary_path = path.with_extension("json.tmp");

        let result = write_json(&path, &LibraryMetadata::default(), false);

        assert!(result.is_err());
        assert!(!temporary_path.exists());
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
        assert!(serialized.get("reader").is_none());
        assert!(serialized.get("library").is_none());
        assert!(serialized.get("filesAndMetadata").is_none());
        assert!(serialized["import"].get("defaultMode").is_none());
        assert!(serialized["import"].get("defaultConflictAction").is_none());
    }
}
