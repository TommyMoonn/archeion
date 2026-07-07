use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};

use super::{epub_metadata, vault};

pub(crate) const METADATA_DIRECTORY: &str = ".archeion";
const LIBRARY_FILE: &str = "library.json";
const PROGRESS_FILE: &str = "progress.json";
const SETTINGS_FILE: &str = "settings.json";
pub(crate) const SCANNER_CACHE_FILE: &str = "scanner-cache.json";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryBookMetadata {
    pub relative_path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub display_author: Option<String>,
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReaderSettings {
    #[serde(default = "default_reader_font_size")]
    pub font_size: f64,
    #[serde(default = "default_reader_font_family")]
    pub font_family: String,
    #[serde(default = "default_reader_line_height")]
    pub line_height: f64,
    #[serde(default = "default_reader_margin")]
    pub margin: f64,
    #[serde(default = "default_reader_theme")]
    pub theme: String,
    #[serde(default = "default_reader_progress_placement")]
    pub progress_placement: String,
    #[serde(default = "default_reader_flow_mode")]
    pub flow_mode: String,
}

fn default_reader_font_size() -> f64 {
    18.0
}

fn default_reader_font_family() -> String {
    "serif".to_string()
}

fn default_reader_line_height() -> f64 {
    1.6
}

fn default_reader_margin() -> f64 {
    48.0
}

fn default_reader_theme() -> String {
    "dark".to_string()
}

fn default_reader_progress_placement() -> String {
    "top".to_string()
}

fn default_reader_flow_mode() -> String {
    "paginated".to_string()
}

impl Default for ReaderSettings {
    fn default() -> Self {
        Self {
            font_size: default_reader_font_size(),
            font_family: default_reader_font_family(),
            line_height: default_reader_line_height(),
            margin: default_reader_margin(),
            theme: default_reader_theme(),
            progress_placement: default_reader_progress_placement(),
            flow_mode: default_reader_flow_mode(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySettings {
    pub view_mode: String,
    pub sort_by: String,
}

impl Default for LibrarySettings {
    fn default() -> Self {
        Self {
            view_mode: "grid".to_string(),
            sort_by: "folder".to_string(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
pub struct AppSettings {
    pub reader: ReaderSettings,
    pub library: LibrarySettings,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct SettingsMetadata {
    pub version: u8,
    #[serde(flatten)]
    pub settings: AppSettings,
}

impl Default for SettingsMetadata {
    fn default() -> Self {
        Self {
            version: 1,
            settings: AppSettings::default(),
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

    {
        let mut temporary = File::create(&temporary_path).map_err(|error| error.to_string())?;
        temporary
            .write_all(&contents)
            .map_err(|error| error.to_string())?;
        temporary.sync_all().map_err(|error| error.to_string())?;
    }

    if backup && path.exists() {
        fs::copy(path, path.with_extension("json.bak")).map_err(|error| error.to_string())?;
    }
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    fs::rename(&temporary_path, path).map_err(|error| error.to_string())
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

pub(crate) fn load_scanner_cache_at(root: &Path) -> Result<ScannerCache, String> {
    read_json(&metadata_path(root).join(SCANNER_CACHE_FILE))
}

pub(crate) fn save_scanner_cache_at(root: &Path, cache: &ScannerCache) -> Result<(), String> {
    write_json(&metadata_path(root).join(SCANNER_CACHE_FILE), cache, false)
}

fn vault_root(
    app: &tauri::AppHandle,
    root_path: Option<String>,
) -> Result<PathBuf, String> {
    vault::resolve_vault_root(app, root_path)
}

#[tauri::command]
pub fn initialize_vault_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
) -> Result<(), String> {
    initialize_at(&vault_root(&app, root_path)?)
}

#[tauri::command]
pub fn load_vault_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
) -> Result<MetadataBundle, String> {
    let root = vault_root(&app, root_path)?;
    initialize_at(&root)?;
    let directory = metadata_path(&root);

    Ok(MetadataBundle {
        library: read_json(&directory.join(LIBRARY_FILE))?,
        progress: read_json(&directory.join(PROGRESS_FILE))?,
        settings: read_json(&directory.join(SETTINGS_FILE))?,
    })
}

#[tauri::command]
pub fn save_library_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
    metadata: LibraryMetadata,
) -> Result<(), String> {
    let path = metadata_path(&vault_root(&app, root_path)?).join(LIBRARY_FILE);
    write_json(&path, &metadata, true)
}

#[tauri::command]
pub fn save_progress_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
    metadata: ProgressMetadata,
) -> Result<(), String> {
    let path = metadata_path(&vault_root(&app, root_path)?).join(PROGRESS_FILE);
    write_json(&path, &metadata, true)
}

#[tauri::command]
pub fn save_settings_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
    metadata: SettingsMetadata,
) -> Result<(), String> {
    let path = metadata_path(&vault_root(&app, root_path)?).join(SETTINGS_FILE);
    write_json(&path, &metadata, true)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{
        initialize_at, metadata_path, read_json, write_json, LibraryMetadata, SettingsMetadata,
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
        fs::create_dir_all(&root).expect("test vault should be created");

        initialize_at(&root).expect("metadata should initialize");

        let metadata = metadata_path(&root);
        assert!(metadata.join("library.json").is_file());
        assert!(metadata.join("progress.json").is_file());
        assert!(metadata.join("settings.json").is_file());
        assert!(!metadata.join("scanner-cache.json").exists());
        assert!(metadata.join("covers").is_dir());
        fs::remove_dir_all(root).expect("test vault should be removed");
    }

    #[test]
    fn backs_up_existing_metadata_before_writing() {
        let root = test_root("backup");
        fs::create_dir_all(&root).expect("test vault should be created");
        let path = root.join("library.json");
        write_json(&path, &LibraryMetadata::default(), false).expect("initial write should work");

        write_json(&path, &LibraryMetadata::default(), true).expect("second write should work");

        assert!(root.join("library.json.bak").is_file());
        fs::remove_dir_all(root).expect("test vault should be removed");
    }

    #[test]
    fn preserves_corrupted_json_and_recovers_defaults() {
        let root = test_root("corrupt");
        fs::create_dir_all(&root).expect("test vault should be created");
        let path = root.join("library.json");
        fs::write(&path, b"{not-json").expect("corrupt file should be written");

        let recovered: LibraryMetadata = read_json(&path).expect("metadata should recover");

        assert_eq!(recovered.version, 1);
        assert!(root
            .read_dir()
            .expect("directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-")));
        fs::remove_dir_all(root).expect("test vault should be removed");
    }

    #[test]
    fn reader_settings_accept_frontend_shape_without_flow_mode() {
        let value = serde_json::json!({
            "version": 1,
            "reader": {
                "fontSize": 22.0,
                "fontFamily": "serif",
                "lineHeight": 1.8,
                "margin": 72.0,
                "theme": "sepia",
                "progressPlacement": "side"
            },
            "library": {
                "viewMode": "grid",
                "sortBy": "folder"
            }
        });

        let parsed: SettingsMetadata =
            serde_json::from_value(value).expect("frontend settings should deserialize");

        assert_eq!(parsed.settings.reader.font_size, 22.0);
        assert_eq!(parsed.settings.reader.progress_placement, "side");
        assert_eq!(parsed.settings.reader.flow_mode, "paginated");
    }
}
