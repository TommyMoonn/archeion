use std::{
    fs,
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::Manager;

const APP_SETTINGS_FILE: &str = "settings.json";

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceSettings {
    #[serde(default)]
    pub animations_enabled: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryFilterSettings {
    #[serde(default)]
    pub series: Vec<String>,
    #[serde(default)]
    pub subjects: Vec<String>,
    #[serde(default)]
    pub languages: Vec<String>,
    #[serde(default)]
    pub publishers: Vec<String>,
    #[serde(default)]
    pub reading_statuses: Vec<String>,
    #[serde(default)]
    pub favorites_only: bool,
    #[serde(default)]
    pub missing_metadata: bool,
    #[serde(default)]
    pub missing_cover: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibrarySmartViewSettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default = "default_visible_smart_views")]
    pub visible: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDisplaySettings {
    #[serde(default)]
    pub filters: LibraryFilterSettings,
    #[serde(default = "default_library_sort")]
    pub sort_by: String,
    #[serde(default)]
    pub smart_views: LibrarySmartViewSettings,
    #[serde(default = "default_library_view")]
    pub view_mode: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
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
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FilesAndMetadataSettings {
    #[serde(default)]
    pub keep_epub_writeback_backup: bool,
    #[serde(default = "default_true")]
    pub live_watcher_enabled: bool,
    #[serde(default = "default_true")]
    pub scan_on_startup: bool,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GlobalImportSettings {
    #[serde(default = "default_import_conflict_action")]
    pub default_conflict_action: String,
    #[serde(default = "default_import_mode")]
    pub default_mode: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RememberedNavigationState {
    pub archive_id: String,
    pub book_id: String,
    pub last_route: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PersistedWindowState {
    pub height: f64,
    #[serde(default)]
    pub maximized: bool,
    pub width: f64,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppPreferences {
    #[serde(default = "default_app_theme_preset")]
    pub app_theme_preset: String,
    #[serde(default)]
    pub appearance: AppearanceSettings,
    #[serde(default = "default_book_card_size")]
    pub book_card_size: String,
    #[serde(default = "default_true")]
    pub confirm_destructive_file_actions: bool,
    #[serde(default = "default_density")]
    pub density: String,
    #[serde(default)]
    pub files_and_metadata: FilesAndMetadataSettings,
    #[serde(default)]
    pub import: GlobalImportSettings,
    #[serde(default)]
    pub library: LibraryDisplaySettings,
    #[serde(default)]
    pub navigation: Option<RememberedNavigationState>,
    #[serde(default)]
    pub reader: ReaderSettings,
    #[serde(default)]
    pub remember_window_state: bool,
    #[serde(default)]
    pub restore_last_reader: bool,
    #[serde(default = "default_true")]
    pub show_continue_reading: bool,
    #[serde(default = "default_startup_behavior")]
    pub startup_behavior: String,
    #[serde(default)]
    pub window: Option<PersistedWindowState>,
    #[serde(default = "default_window_frame_style")]
    pub window_frame_style: String,
}

fn default_app_theme_preset() -> String {
    "dark".to_string()
}
fn default_book_card_size() -> String {
    "medium".to_string()
}
fn default_density() -> String {
    "comfortable".to_string()
}
fn default_import_conflict_action() -> String {
    "keepBoth".to_string()
}
fn default_import_mode() -> String {
    "copy".to_string()
}
fn default_library_sort() -> String {
    "title".to_string()
}
fn default_library_view() -> String {
    "grid".to_string()
}
fn default_visible_smart_views() -> Vec<String> {
    [
        "unread",
        "in-progress",
        "completed",
        "needs-metadata",
        "needs-cover",
    ]
    .into_iter()
    .map(str::to_string)
    .collect()
}
fn default_reader_font_family() -> String {
    "serif".to_string()
}
fn default_reader_font_size() -> f64 {
    18.0
}
fn default_reader_line_height() -> f64 {
    1.6
}
fn default_reader_margin() -> f64 {
    48.0
}
fn default_reader_progress_placement() -> String {
    "top".to_string()
}
fn default_reader_theme() -> String {
    "dark".to_string()
}
fn default_startup_behavior() -> String {
    "open-last-archive".to_string()
}
fn default_true() -> bool {
    true
}
fn default_window_frame_style() -> String {
    "hidden".to_string()
}

impl Default for LibraryDisplaySettings {
    fn default() -> Self {
        Self {
            filters: LibraryFilterSettings::default(),
            sort_by: default_library_sort(),
            smart_views: LibrarySmartViewSettings::default(),
            view_mode: default_library_view(),
        }
    }
}

impl Default for LibrarySmartViewSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            visible: default_visible_smart_views(),
        }
    }
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
        }
    }
}

impl Default for FilesAndMetadataSettings {
    fn default() -> Self {
        Self {
            keep_epub_writeback_backup: false,
            live_watcher_enabled: true,
            scan_on_startup: true,
        }
    }
}

impl Default for GlobalImportSettings {
    fn default() -> Self {
        Self {
            default_conflict_action: default_import_conflict_action(),
            default_mode: default_import_mode(),
        }
    }
}

impl Default for AppPreferences {
    fn default() -> Self {
        Self {
            app_theme_preset: default_app_theme_preset(),
            appearance: AppearanceSettings::default(),
            book_card_size: default_book_card_size(),
            confirm_destructive_file_actions: true,
            density: default_density(),
            files_and_metadata: FilesAndMetadataSettings::default(),
            import: GlobalImportSettings::default(),
            library: LibraryDisplaySettings::default(),
            navigation: None,
            reader: ReaderSettings::default(),
            remember_window_state: false,
            restore_last_reader: false,
            show_continue_reading: true,
            startup_behavior: default_startup_behavior(),
            window: None,
            window_frame_style: default_window_frame_style(),
        }
    }
}

fn settings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(APP_SETTINGS_FILE))
        .map_err(|error| format!("App settings directory is unavailable: {error}"))
}

fn app_settings_corrupt_path(path: &Path) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_default();
    path.with_file_name(format!("{file_name}.corrupt-{timestamp}.bak"))
}

fn read_settings(path: &Path) -> Result<AppPreferences, String> {
    if !path.exists() {
        return Ok(AppPreferences::default());
    }

    let contents =
        fs::read(path).map_err(|error| format!("App settings could not be read: {error}"))?;
    match serde_json::from_slice(&contents) {
        Ok(preferences) => Ok(preferences),
        Err(_) => {
            fs::rename(path, app_settings_corrupt_path(path)).map_err(|error| {
                format!("Corrupted app settings could not be preserved: {error}")
            })?;
            let preferences = AppPreferences::default();
            write_settings(path, &preferences)?;
            Ok(preferences)
        }
    }
}

fn app_settings_write_backup_path(path: &Path) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy())
        .unwrap_or_default();
    path.with_file_name(format!("{file_name}.write-backup-{timestamp}"))
}

fn replace_settings_file(temporary_path: &Path, destination_path: &Path) -> Result<(), String> {
    if !destination_path.exists() {
        return fs::rename(temporary_path, destination_path)
            .map_err(|error| format!("App settings file could not be replaced: {error}"));
    }

    if !destination_path.is_file() {
        return Err("App settings path is not a file.".to_string());
    }

    let backup_path = app_settings_write_backup_path(destination_path);
    fs::rename(destination_path, &backup_path)
        .map_err(|error| format!("App settings backup could not be created: {error}"))?;

    if let Err(replace_error) = fs::rename(temporary_path, destination_path) {
        return match fs::rename(&backup_path, destination_path) {
            Ok(()) => Err(format!(
                "App settings file could not be replaced and the previous file was restored: {replace_error}"
            )),
            Err(restore_error) => Err(format!(
                "App settings file could not be replaced and the previous file could not be restored: {restore_error}"
            )),
        };
    }

    fs::remove_file(&backup_path).map_err(|error| {
        format!("App settings transaction backup could not be removed: {error}")
    })?;
    Ok(())
}

fn remove_temporary_settings_file(path: &Path) {
    match fs::remove_file(path) {
        Ok(()) => {}
        Err(error) if error.kind() == ErrorKind::NotFound => {}
        Err(_) => {}
    }
}

fn write_settings(path: &Path, preferences: &AppPreferences) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("App settings directory could not be created: {error}"))?;
    }

    let contents = serde_json::to_vec_pretty(preferences)
        .map_err(|error| format!("App settings could not be serialized: {error}"))?;
    let temporary_path = path.with_extension("json.tmp");

    let result = (|| {
        let mut temporary_file = fs::File::create(&temporary_path).map_err(|error| {
            format!("App settings temporary file could not be created: {error}")
        })?;
        temporary_file.write_all(&contents).map_err(|error| {
            format!("App settings temporary file could not be written: {error}")
        })?;
        temporary_file
            .sync_all()
            .map_err(|error| format!("App settings temporary file could not be synced: {error}"))?;
        drop(temporary_file);

        replace_settings_file(&temporary_path, path)
    })();

    if result.is_err() {
        remove_temporary_settings_file(&temporary_path);
    }

    result
}

#[tauri::command]
pub fn load_app_settings(app: tauri::AppHandle) -> Result<AppPreferences, String> {
    read_settings(&settings_path(&app)?)
}

#[tauri::command]
pub fn save_app_settings(
    app: tauri::AppHandle,
    preferences: AppPreferences,
) -> Result<AppPreferences, String> {
    let path = settings_path(&app)?;
    write_settings(&path, &preferences)?;
    Ok(preferences)
}

#[cfg(test)]
mod tests {
    use super::{
        read_settings, write_settings, AppPreferences, AppearanceSettings, LibrarySmartViewSettings,
    };

    #[test]
    fn app_preferences_accept_missing_new_fields() {
        let parsed: AppPreferences = serde_json::from_value(serde_json::json!({
            "density": "compact",
            "bookCardSize": "large",
            "showContinueReading": false,
            "windowFrameStyle": "native",
            "library": {
                "sortBy": "author",
                "viewMode": "list"
            }
        }))
        .expect("old app preferences should parse");

        assert_eq!(parsed.density, "compact");
        assert_eq!(parsed.book_card_size, "large");
        assert!(!parsed.show_continue_reading);
        assert_eq!(parsed.window_frame_style, "native");
        assert_eq!(parsed.startup_behavior, "open-last-archive");
        assert!(!parsed.appearance.animations_enabled);
        assert!(parsed.confirm_destructive_file_actions);
        assert_eq!(parsed.library.sort_by, "author");
        assert_eq!(parsed.library.view_mode, "list");
        assert_eq!(
            parsed.library.smart_views,
            LibrarySmartViewSettings::default()
        );
        assert!(parsed.library.filters.series.is_empty());
        assert!(parsed.library.filters.reading_statuses.is_empty());
        assert!(!parsed.library.filters.favorites_only);
        assert!(parsed.navigation.is_none());
        assert_eq!(parsed.reader.progress_placement, "top");
        assert_eq!(parsed.import.default_mode, "copy");
        assert!(!parsed.files_and_metadata.keep_epub_writeback_backup);
        assert!(parsed.window.is_none());
    }

    #[test]
    fn app_preferences_round_trip_through_settings_file() {
        let path = temporary_settings_path("round-trip");
        let preferences = AppPreferences {
            density: "compact".to_string(),
            appearance: AppearanceSettings {
                animations_enabled: true,
            },
            library: super::LibraryDisplaySettings {
                filters: super::LibraryFilterSettings {
                    languages: vec!["en".to_string()],
                    missing_cover: true,
                    ..super::LibraryFilterSettings::default()
                },
                sort_by: "author".to_string(),
                smart_views: LibrarySmartViewSettings {
                    enabled: true,
                    visible: vec!["needs-cover".to_string(), "unread".to_string()],
                },
                view_mode: "list".to_string(),
            },
            ..AppPreferences::default()
        };

        write_settings(&path, &preferences).expect("settings should write");
        let loaded = read_settings(&path).expect("settings should read");
        let _ = std::fs::remove_file(&path);

        assert_eq!(loaded, preferences);
    }

    #[test]
    fn smart_view_preferences_round_trip_enabled_and_disabled_selections() {
        for (label, enabled, visible) in [
            (
                "enabled",
                true,
                vec!["completed".to_string(), "unread".to_string()],
            ),
            (
                "disabled",
                false,
                vec!["needs-metadata".to_string(), "in-progress".to_string()],
            ),
        ] {
            let path = temporary_settings_path(label);
            let preferences = AppPreferences {
                library: super::LibraryDisplaySettings {
                    smart_views: LibrarySmartViewSettings { enabled, visible },
                    ..super::LibraryDisplaySettings::default()
                },
                ..AppPreferences::default()
            };

            write_settings(&path, &preferences).expect("settings should write");
            let loaded = read_settings(&path).expect("settings should read");
            let _ = std::fs::remove_file(&path);

            assert_eq!(loaded.library.smart_views, preferences.library.smart_views);
            assert_eq!(loaded, preferences);
        }
    }

    #[test]
    fn app_preferences_replace_existing_settings_file() {
        let path = temporary_settings_path("replace");
        let first = AppPreferences {
            density: "compact".to_string(),
            ..AppPreferences::default()
        };
        let second = AppPreferences {
            window_frame_style: "native".to_string(),
            ..AppPreferences::default()
        };

        write_settings(&path, &first).expect("initial settings should write");
        write_settings(&path, &second).expect("replacement settings should write");
        let loaded = read_settings(&path).expect("settings should read");
        let write_backup_exists = path
            .parent()
            .expect("settings path should have parent")
            .read_dir()
            .expect("settings directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .contains(".write-backup-")
            });
        let _ = std::fs::remove_file(&path);

        assert_eq!(loaded, second);
        assert!(!write_backup_exists);
    }

    #[test]
    fn app_preferences_recover_from_corrupted_settings_file() {
        let path = temporary_settings_path("corrupt");
        std::fs::write(&path, b"{not-json").expect("corrupt settings should be written");

        let loaded = read_settings(&path).expect("settings should recover");

        assert_eq!(loaded, AppPreferences::default());
        assert!(path.is_file());
        let backup_exists = path
            .parent()
            .expect("settings path should have parent")
            .read_dir()
            .expect("settings directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-"));
        assert!(backup_exists);
        let _ = std::fs::remove_file(&path);
    }

    fn temporary_settings_path(label: &str) -> std::path::PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "archeion-app-settings-{label}-{}.json",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("time should be available")
                .as_nanos()
        ));
        path
    }
}
