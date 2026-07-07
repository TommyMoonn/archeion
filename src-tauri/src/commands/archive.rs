use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use super::metadata;

const ARCHIVE_REGISTRY_FILE: &str = "archives.json";
const LEGACY_ARCHIVE_REGISTRY_FILE: &str = "vault.json";
const ARCHIVE_MANAGER_WINDOW_LABEL: &str = "archive-manager";
const ARCHIVE_REGISTRY_CHANGED_EVENT: &str = "archive-registry-changed";
const MAIN_WINDOW_LABEL: &str = "main";
const ARCHIVE_MANAGER_QUERY: &str = "window=archive-manager";
const ARCHIVE_MANAGER_APP_URL: &str = "index.html?window=archive-manager";

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveRecord {
    pub id: String,
    pub display_name: String,
    pub root_path: String,
    pub last_opened_at: String,
    pub created_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveRegistry {
    pub version: u8,
    pub archives: Vec<ArchiveRecord>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_opened_archive_id: Option<String>,
}

impl Default for ArchiveRegistry {
    fn default() -> Self {
        Self {
            version: 1,
            archives: Vec::new(),
            last_opened_archive_id: None,
        }
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LegacyArchiveConfig {
    #[serde(rename = "vaultPath")]
    archive_path: String,
}

fn app_config_path(app: &tauri::AppHandle, file_name: &str) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(file_name))
        .map_err(|error| error.to_string())
}

fn now_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

fn hash_archive_path(path: &str) -> u64 {
    path.as_bytes()
        .iter()
        .fold(0xcbf29ce484222325_u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        })
}

fn archive_identity_path(path: &str) -> String {
    if cfg!(windows) {
        path.to_ascii_lowercase()
    } else {
        path.to_string()
    }
}

fn archive_id_for_path(path: &str) -> String {
    format!("archive-{:016x}", hash_archive_path(&archive_identity_path(path)))
}

fn archive_display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("Archive")
        .to_string()
}

fn is_inside_archeion_metadata(path: &Path) -> bool {
    path.components().any(|component| component.as_os_str() == ".archeion")
}

fn normalized_root_path(path: &str) -> Result<String, String> {
    let root = PathBuf::from(path);
    if !root.is_dir() {
        return Err("The selected archive folder is unavailable.".to_string());
    }

    let normalized = root.canonicalize().unwrap_or(root);
    if is_inside_archeion_metadata(&normalized) {
        return Err("Choose the archive folder, not an .archeion metadata folder.".to_string());
    }

    Ok(normalized.to_string_lossy().into_owned())
}

fn archive_paths_match(left: &str, right: &str) -> bool {
    if cfg!(windows) {
        left.eq_ignore_ascii_case(right)
    } else {
        left == right
    }
}

fn registry_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app_config_path(app, ARCHIVE_REGISTRY_FILE)
}

fn legacy_archive_registry_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app_config_path(app, LEGACY_ARCHIVE_REGISTRY_FILE)
}

fn read_legacy_registry(app: &tauri::AppHandle) -> Result<Option<ArchiveRegistry>, String> {
    let path = legacy_archive_registry_path(app)?;
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let legacy: LegacyArchiveConfig =
        serde_json::from_str(&contents).map_err(|error| error.to_string())?;
    let root_path = match normalized_root_path(&legacy.archive_path) {
        Ok(path) => path,
        Err(_) => legacy.archive_path,
    };
    let timestamp = now_timestamp();
    let archive = ArchiveRecord {
        id: archive_id_for_path(&root_path),
        display_name: archive_display_name(Path::new(&root_path)),
        root_path,
        created_at: timestamp.clone(),
        last_opened_at: timestamp,
    };

    Ok(Some(ArchiveRegistry {
        version: 1,
        last_opened_archive_id: Some(archive.id.clone()),
        archives: vec![archive],
    }))
}

fn read_registry(app: &tauri::AppHandle) -> Result<ArchiveRegistry, String> {
    let path = registry_path(app)?;
    let contents = match fs::read_to_string(&path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if let Some(registry) = read_legacy_registry(app)? {
                write_registry(app, &registry)?;
                return Ok(registry);
            }
            return Ok(ArchiveRegistry::default());
        }
        Err(error) => return Err(error.to_string()),
    };

    serde_json::from_str(&contents).map_err(|error| error.to_string())
}

fn write_registry(app: &tauri::AppHandle, registry: &ArchiveRegistry) -> Result<(), String> {
    let path = registry_path(app)?;
    let directory = path
        .parent()
        .ok_or_else(|| "App config directory is unavailable.".to_string())?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let contents =
        serde_json::to_string_pretty(registry).map_err(|error| error.to_string())?;
    fs::write(path, contents).map_err(|error| error.to_string())
}

fn emit_archive_registry_changed(app: &tauri::AppHandle, registry: &ArchiveRegistry) {
    if let Err(error) = app.emit(ARCHIVE_REGISTRY_CHANGED_EVENT, registry) {
        eprintln!("archive registry change event failed: {error}");
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ArchiveManagerUrlKind {
    External,
    App,
}

fn archive_manager_url_parts(
    dev_url: Option<&tauri::Url>,
    debug_build: bool,
) -> Result<(ArchiveManagerUrlKind, String), String> {
    if debug_build {
        let mut url = dev_url
            .cloned()
            .ok_or_else(|| "The Tauri development URL is unavailable.".to_string())?;
        url.set_query(Some(ARCHIVE_MANAGER_QUERY));
        return Ok((ArchiveManagerUrlKind::External, url.to_string()));
    }

    Ok((
        ArchiveManagerUrlKind::App,
        ARCHIVE_MANAGER_APP_URL.to_string(),
    ))
}

fn archive_manager_webview_url(
    app: &tauri::AppHandle,
) -> Result<(WebviewUrl, ArchiveManagerUrlKind, String), String> {
    let (kind, url) = archive_manager_url_parts(
        app.config().build.dev_url.as_ref(),
        cfg!(debug_assertions),
    )?;

    let webview_url = match kind {
        ArchiveManagerUrlKind::External => WebviewUrl::External(
            url.parse()
                .map_err(|error| format!("The archive manager URL is invalid: {error}"))?,
        ),
        ArchiveManagerUrlKind::App => WebviewUrl::App(url.clone().into()),
    };

    Ok((webview_url, kind, url))
}

fn show_and_focus_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

fn existing_archive_manager_is_unhealthy(window: &tauri::WebviewWindow) -> bool {
    if !cfg!(debug_assertions) {
        return false;
    }

    window
        .url()
        .map(|url| url.as_str() == "about:blank")
        .unwrap_or(true)
}

fn upsert_archive_at_path(
    registry: &mut ArchiveRegistry,
    path: String,
    display_name: Option<String>,
) -> ArchiveRecord {
    let timestamp = now_timestamp();

    if let Some(archive) = registry
        .archives
        .iter_mut()
        .find(|archive| archive_paths_match(&archive.root_path, &path))
    {
        archive.root_path = path;
        if let Some(display_name) = display_name.filter(|value| !value.trim().is_empty()) {
            archive.display_name = display_name.trim().to_string();
        }
        archive.last_opened_at = timestamp;
        registry.last_opened_archive_id = Some(archive.id.clone());
        return archive.clone();
    }

    let archive = ArchiveRecord {
        id: archive_id_for_path(&path),
        display_name: display_name
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| archive_display_name(Path::new(&path))),
        root_path: path,
        created_at: timestamp.clone(),
        last_opened_at: timestamp,
    };
    registry.last_opened_archive_id = Some(archive.id.clone());
    registry.archives.push(archive.clone());
    archive
}

fn active_archive(registry: &ArchiveRegistry) -> Option<ArchiveRecord> {
    let id = registry.last_opened_archive_id.as_ref()?;
    registry
        .archives
        .iter()
        .find(|archive| &archive.id == id)
        .cloned()
}

pub(crate) fn read_active_archive_path(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    Ok(active_archive(&read_registry(app)?).map(|archive| archive.root_path))
}

pub(crate) fn save_active_archive_path(
    app: &tauri::AppHandle,
    path: String,
) -> Result<ArchiveRecord, String> {
    let root_path = normalized_root_path(&path)?;
    metadata::initialize_at(Path::new(&root_path))?;
    let mut registry = read_registry(app)?;
    let archive = upsert_archive_at_path(&mut registry, root_path, None);
    write_registry(app, &registry)?;
    Ok(archive)
}

#[tauri::command]
pub fn load_archive_registry(app: tauri::AppHandle) -> Result<ArchiveRegistry, String> {
    read_registry(&app)
}

#[tauri::command]
pub fn open_archive(app: tauri::AppHandle, path: String) -> Result<ArchiveRegistry, String> {
    save_active_archive_path(&app, path)?;
    let registry = read_registry(&app)?;
    emit_archive_registry_changed(&app, &registry);
    Ok(registry)
}

#[tauri::command]
pub fn activate_archive(
    app: tauri::AppHandle,
    archive_id: String,
) -> Result<ArchiveRegistry, String> {
    let mut registry = read_registry(&app)?;
    let timestamp = now_timestamp();
    let index = registry
        .archives
        .iter()
        .position(|archive| archive.id == archive_id)
        .ok_or_else(|| "The selected archive is no longer registered.".to_string())?;
    let root_path = registry.archives[index].root_path.clone();

    if !PathBuf::from(&root_path).is_dir() {
        registry.last_opened_archive_id = Some(registry.archives[index].id.clone());
        write_registry(&app, &registry)?;
        emit_archive_registry_changed(&app, &registry);
        return Err("The selected archive folder is unavailable.".to_string());
    }

    registry.archives[index].last_opened_at = timestamp;
    registry.last_opened_archive_id = Some(registry.archives[index].id.clone());
    write_registry(&app, &registry)?;
    emit_archive_registry_changed(&app, &registry);
    Ok(registry)
}

#[tauri::command]
pub fn rename_archive(
    app: tauri::AppHandle,
    archive_id: String,
    display_name: String,
) -> Result<ArchiveRegistry, String> {
    let name = display_name.trim();
    if name.is_empty() {
        return Err("Archive names cannot be empty.".to_string());
    }

    let mut registry = read_registry(&app)?;
    let archive = registry
        .archives
        .iter_mut()
        .find(|archive| archive.id == archive_id)
        .ok_or_else(|| "The selected archive is no longer registered.".to_string())?;
    archive.display_name = name.to_string();
    write_registry(&app, &registry)?;
    emit_archive_registry_changed(&app, &registry);
    Ok(registry)
}

#[tauri::command]
pub fn forget_archive(
    app: tauri::AppHandle,
    archive_id: String,
) -> Result<ArchiveRegistry, String> {
    let mut registry = read_registry(&app)?;
    registry.archives.retain(|archive| archive.id != archive_id);
    if registry.last_opened_archive_id.as_deref() == Some(archive_id.as_str()) {
        registry.last_opened_archive_id = None;
    }
    write_registry(&app, &registry)?;
    emit_archive_registry_changed(&app, &registry);
    Ok(registry)
}

#[tauri::command]
pub async fn open_archive_manager_window(app: tauri::AppHandle) -> Result<(), String> {
    println!("[archive-manager] command entered");

    if let Some(existing_window) = app.get_webview_window(ARCHIVE_MANAGER_WINDOW_LABEL) {
        println!("[archive-manager] existing window found");
        if existing_archive_manager_is_unhealthy(&existing_window) {
            eprintln!("[archive-manager] existing window is unhealthy; closing before recreate");
            let _ = existing_window.close();
        } else {
            show_and_focus_window(&existing_window).map_err(|error| {
                eprintln!("[archive-manager] error details before returning: {error}");
                error
            })?;
            println!("[archive-manager] show/focus success");
            return Ok(());
        }
    }

    println!(
        "[archive-manager] debug or release mode: {}",
        if cfg!(debug_assertions) { "debug" } else { "release" }
    );
    println!(
        "[archive-manager] dev_url from config: {}",
        app.config()
            .build
            .dev_url
            .as_ref()
            .map(|url| url.as_str())
            .unwrap_or("<none>")
    );

    let (webview_url, url_kind, final_url) = archive_manager_webview_url(&app).map_err(|error| {
        eprintln!("[archive-manager] error details before returning: {error}");
        error
    })?;
    println!("[archive-manager] final URL: {final_url}");
    println!("[archive-manager] WebviewUrl variant: {url_kind:?}");
    println!("[archive-manager] builder start");

    let window = WebviewWindowBuilder::new(&app, ARCHIVE_MANAGER_WINDOW_LABEL, webview_url)
        .title("Archive Manager")
        .inner_size(800.0, 590.0)
        .min_inner_size(680.0, 460.0)
        .center()
        .resizable(true)
        .decorations(true)
        .closable(true)
        .visible(false)
        .build()
        .map_err(|error| {
            eprintln!("[archive-manager] error details before returning: {error}");
            error.to_string()
        })?;

    println!("[archive-manager] builder success");
    show_and_focus_window(&window).map_err(|error| {
        eprintln!("[archive-manager] error details before returning: {error}");
        error
    })?;
    println!("[archive-manager] show/focus success");
    Ok(())
}

#[tauri::command]
pub fn focus_main_window(app: tauri::AppHandle) -> Result<(), String> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Err("The main window is unavailable.".to_string());
    };

    show_and_focus_window(&window)
}

#[tauri::command]
pub fn reveal_archive(app: tauri::AppHandle, archive_id: String) -> Result<(), String> {
    let registry = read_registry(&app)?;
    let archive = registry
        .archives
        .iter()
        .find(|archive| archive.id == archive_id)
        .ok_or_else(|| "The selected archive is no longer registered.".to_string())?;
    let path = PathBuf::from(&archive.root_path);
    if !path.is_dir() {
        return Err("The selected archive folder is unavailable.".to_string());
    }

    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer");
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = Command::new("xdg-open");

    command
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{
        archive_id_for_path, archive_manager_url_parts, archive_paths_match, metadata,
        normalized_root_path, upsert_archive_at_path, ArchiveManagerUrlKind,
        ArchiveRegistry,
    };

    fn test_root(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-archive-{label}-{nonce}"))
    }

    #[test]
    fn upserts_archives_by_path_and_tracks_last_opened() {
        let mut registry = ArchiveRegistry::default();

        let first = upsert_archive_at_path(&mut registry, "/books".to_string(), None);
        let second = upsert_archive_at_path(
            &mut registry,
            "/books".to_string(),
            Some("Novels".to_string()),
        );

        assert_eq!(registry.archives.len(), 1);
        assert_eq!(first.id, second.id);
        assert_eq!(
            registry.last_opened_archive_id.as_deref(),
            Some(second.id.as_str())
        );
        assert_eq!(registry.archives[0].display_name, "Novels");
    }

    #[test]
    fn accepts_existing_folder_without_metadata_directory() {
        let root = test_root("plain");
        fs::create_dir_all(&root).expect("test archive should be created");

        let normalized = normalized_root_path(root.to_string_lossy().as_ref())
            .expect("plain archive folder should be accepted");

        assert_eq!(
            normalized,
            root.canonicalize()
                .expect("root should canonicalize")
                .to_string_lossy()
        );
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn initializes_metadata_for_plain_folder() {
        let root = test_root("initialize");
        fs::create_dir_all(&root).expect("test archive should be created");
        let normalized = normalized_root_path(root.to_string_lossy().as_ref())
            .expect("plain archive folder should be accepted");

        metadata::initialize_at(std::path::Path::new(&normalized))
            .expect("archive metadata should initialize");

        assert!(root.join(".archeion").join("library.json").is_file());
        assert!(root.join(".archeion").join("progress.json").is_file());
        assert!(root.join(".archeion").join("settings.json").is_file());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn rejects_metadata_directory_selection() {
        let root = test_root("metadata");
        let metadata = root.join(".archeion");
        fs::create_dir_all(&metadata).expect("metadata directory should be created");

        let error = normalized_root_path(metadata.to_string_lossy().as_ref())
            .expect_err("metadata directory should be rejected");

        assert!(error.contains("archive folder"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn archive_manager_dev_url_uses_external_dev_server_with_marker() {
        let dev_url = tauri::Url::parse("http://localhost:1420").expect("dev URL should parse");

        let (kind, url) = archive_manager_url_parts(Some(&dev_url), true)
            .expect("debug manager URL should resolve");

        assert_eq!(kind, ArchiveManagerUrlKind::External);
        assert_eq!(url, "http://localhost:1420/?window=archive-manager");
    }

    #[test]
    fn archive_manager_production_url_uses_bundled_entry_with_marker() {
        let (kind, url) = archive_manager_url_parts(None, false)
            .expect("production manager URL should resolve");

        assert_eq!(kind, ArchiveManagerUrlKind::App);
        assert_eq!(url, "index.html?window=archive-manager");
    }

    #[test]
    fn archive_manager_debug_url_fails_without_dev_url() {
        let error = archive_manager_url_parts(None, true)
            .expect_err("debug manager URL requires dev URL");

        assert!(error.contains("development URL"));
    }

    #[test]
    #[cfg(windows)]
    fn archive_ids_are_case_insensitive_on_windows() {
        assert_eq!(archive_id_for_path("C:/Books"), archive_id_for_path("C:/books"));
        assert!(archive_paths_match("C:/Books", "C:/books"));
    }

    #[test]
    #[cfg(not(windows))]
    fn archive_ids_are_case_sensitive_on_case_sensitive_platforms() {
        assert_ne!(archive_id_for_path("/Books"), archive_id_for_path("/books"));
        assert!(!archive_paths_match("/Books", "/books"));
    }
}
