use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use super::{archive_root, epub_analysis, metadata};

const ARCHIVE_REGISTRY_FILE: &str = "archives.json";
const LEGACY_ARCHIVE_REGISTRY_FILE: &str = "vault.json";
const ARCHIVE_MANAGER_WINDOW_LABEL: &str = "archive-manager";
const ARCHIVE_REGISTRY_CHANGED_EVENT: &str = "archive-registry-changed";
const ARCHIVE_MANAGER_CLOSED_EVENT: &str = "archive-manager-closed";
const MAIN_WINDOW_LABEL: &str = "main";
const ARCHIVE_MANAGER_QUERY: &str = "window=archive-manager";
const ARCHIVE_MANAGER_APP_URL: &str = "index.html?window=archive-manager";
const ARCHIVE_MANAGER_WIDTH: f64 = 860.0;
const ARCHIVE_MANAGER_HEIGHT: f64 = 620.0;

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
    let path = archive_root::clean_user_facing_path(path);

    if cfg!(windows) {
        path.to_ascii_lowercase()
    } else {
        path
    }
}

fn archive_id_for_path(path: &str) -> String {
    format!(
        "archive-{:016x}",
        hash_archive_path(&archive_identity_path(path))
    )
}

fn archive_display_name(path: &Path) -> String {
    path.file_name()
        .and_then(|name| name.to_str())
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or("Archive")
        .to_string()
}

fn is_reserved_windows_name(name: &str) -> bool {
    let stem = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();

    matches!(
        stem.as_str(),
        "con"
            | "prn"
            | "aux"
            | "nul"
            | "com1"
            | "com2"
            | "com3"
            | "com4"
            | "com5"
            | "com6"
            | "com7"
            | "com8"
            | "com9"
            | "lpt1"
            | "lpt2"
            | "lpt3"
            | "lpt4"
            | "lpt5"
            | "lpt6"
            | "lpt7"
            | "lpt8"
            | "lpt9"
    )
}

fn validate_archive_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();

    if trimmed.is_empty() {
        return Err("Archive name is required.".to_string());
    }

    if name.trim_end() != name || trimmed.ends_with('.') {
        return Err("Archive name cannot end with a space or period.".to_string());
    }

    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Archive name cannot contain path separators.".to_string());
    }

    if trimmed.chars().any(|character| {
        matches!(
            character,
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
        )
    }) {
        return Err(
            "Archive name contains characters Windows cannot use in folder names.".to_string(),
        );
    }

    if trimmed.chars().any(char::is_control) {
        return Err("Archive name cannot contain control characters.".to_string());
    }

    if trimmed.eq_ignore_ascii_case(".archeion") {
        return Err("Archive name cannot be .archeion.".to_string());
    }

    if is_reserved_windows_name(trimmed) {
        return Err("Archive name is reserved on Windows.".to_string());
    }

    Ok(trimmed.to_string())
}

fn validated_parent_path(path: &str) -> Result<PathBuf, String> {
    if path.trim().is_empty() {
        return Err("Choose a location for the archive.".to_string());
    }

    let parent = PathBuf::from(path);
    if !parent.is_dir() {
        return Err("Archive location is unavailable.".to_string());
    }

    let normalized = parent.canonicalize().unwrap_or(parent);
    if archive_root::is_inside_archeion_metadata(&normalized) {
        return Err("Choose a location outside .archeion.".to_string());
    }

    Ok(normalized)
}

fn create_empty_archive_at_with_initializer<Initialize>(
    parent: &Path,
    name: &str,
    initialize: Initialize,
) -> Result<PathBuf, String>
where
    Initialize: Fn(&Path) -> Result<(), String>,
{
    let archive_name = validate_archive_name(name)?;
    let final_root = parent.join(&archive_name);

    if !final_root.starts_with(parent) {
        return Err("Archive location is unavailable.".to_string());
    }

    if final_root.exists() {
        return Err("Archive folder already exists.".to_string());
    }

    fs::create_dir(&final_root).map_err(|error| error.to_string())?;

    if let Err(error) = initialize(&final_root) {
        if let Err(cleanup_error) = fs::remove_dir_all(&final_root) {
            eprintln!("failed to clean up incomplete archive creation: {cleanup_error}");
        }
        return Err(error);
    }

    Ok(final_root)
}

fn create_empty_archive_at(parent: &Path, name: &str) -> Result<PathBuf, String> {
    create_empty_archive_at_with_initializer(parent, name, metadata::initialize_at)
}

fn validated_root_path(path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(path);
    if !root.is_dir() {
        return Err("The selected archive folder is unavailable.".to_string());
    }

    let normalized = root.canonicalize().unwrap_or(root);
    if archive_root::is_inside_archeion_metadata(&normalized) {
        return Err("Choose the archive folder, not an .archeion metadata folder.".to_string());
    }

    Ok(normalized)
}

fn validated_display_root_path(path: &str) -> Result<String, String> {
    let root = validated_root_path(path)?;
    Ok(archive_root::display_archive_path(&root))
}

fn normalize_registry_paths(registry: &mut ArchiveRegistry) -> bool {
    let mut changed = false;

    for archive in &mut registry.archives {
        let root_path = archive_root::clean_user_facing_path(&archive.root_path);
        if root_path != archive.root_path {
            archive.root_path = root_path;
            changed = true;
        }
    }

    changed
}

fn archive_paths_match(left: &str, right: &str) -> bool {
    let left = archive_root::clean_user_facing_path(left);
    let right = archive_root::clean_user_facing_path(right);

    if cfg!(windows) {
        left.eq_ignore_ascii_case(&right)
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
    let root_path = match validated_display_root_path(&legacy.archive_path) {
        Ok(path) => path,
        Err(_) => archive_root::clean_user_facing_path(&legacy.archive_path),
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

    let mut registry: ArchiveRegistry =
        serde_json::from_str(&contents).map_err(|error| error.to_string())?;

    if normalize_registry_paths(&mut registry) {
        write_registry(app, &registry)?;
    }

    Ok(registry)
}

pub(crate) fn registered_archive_roots(app: &tauri::AppHandle) -> Result<Vec<PathBuf>, String> {
    Ok(read_registry(app)?
        .archives
        .into_iter()
        .map(|archive| PathBuf::from(archive.root_path))
        .collect())
}

fn write_registry(app: &tauri::AppHandle, registry: &ArchiveRegistry) -> Result<(), String> {
    let path = registry_path(app)?;
    let directory = path
        .parent()
        .ok_or_else(|| "App config directory is unavailable.".to_string())?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;
    let contents = serde_json::to_string_pretty(registry).map_err(|error| error.to_string())?;
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
    let (kind, url) =
        archive_manager_url_parts(app.config().build.dev_url.as_ref(), cfg!(debug_assertions))?;

    let webview_url = match kind {
        ArchiveManagerUrlKind::External => WebviewUrl::External(
            url.parse()
                .map_err(|error| format!("The archive manager URL is invalid: {error}"))?,
        ),
        ArchiveManagerUrlKind::App => WebviewUrl::App(url.clone().into()),
    };

    Ok((webview_url, kind, url))
}

fn archive_manager_window_size() -> tauri::Size {
    tauri::Size::Logical(tauri::LogicalSize::new(
        ARCHIVE_MANAGER_WIDTH,
        ARCHIVE_MANAGER_HEIGHT,
    ))
}

fn apply_archive_manager_window_constraints(window: &tauri::WebviewWindow) -> Result<(), String> {
    let size = archive_manager_window_size();

    window.set_size(size).map_err(|error| error.to_string())?;
    window
        .set_min_size(Some(size))
        .map_err(|error| error.to_string())?;
    window
        .set_max_size(Some(size))
        .map_err(|error| error.to_string())?;
    window
        .set_resizable(false)
        .map_err(|error| error.to_string())
}

fn show_and_focus_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())?;
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ArchiveManagerCloseAction {
    Exit,
    FocusMain,
    ResumeStartup,
}

fn archive_manager_close_action(
    main_window_visible: bool,
    usable_active_archive: bool,
) -> ArchiveManagerCloseAction {
    if !usable_active_archive {
        ArchiveManagerCloseAction::Exit
    } else if main_window_visible {
        ArchiveManagerCloseAction::FocusMain
    } else {
        ArchiveManagerCloseAction::ResumeStartup
    }
}

fn has_usable_active_archive(app: &tauri::AppHandle) -> bool {
    read_registry(app)
        .ok()
        .and_then(|registry| active_archive(&registry))
        .is_some_and(|archive| validated_root_path(&archive.root_path).is_ok())
}

pub(crate) fn handle_archive_manager_window_destroyed(app: &tauri::AppHandle) {
    let Some(main_window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        app.exit(0);
        return;
    };

    match archive_manager_close_action(
        main_window.is_visible().unwrap_or(false),
        has_usable_active_archive(app),
    ) {
        ArchiveManagerCloseAction::FocusMain => {
            let _ = main_window.set_focus();
        }
        ArchiveManagerCloseAction::ResumeStartup => {
            if let Err(error) = main_window.emit(ARCHIVE_MANAGER_CLOSED_EVENT, ()) {
                eprintln!("archive manager close event failed: {error}");
                app.exit(1);
            }
        }
        ArchiveManagerCloseAction::Exit => app.exit(0),
    }
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
    let path = archive_root::clean_user_facing_path(&path);
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
    let root = validated_root_path(&path)?;
    metadata::initialize_at(&root)?;
    let root_path = archive_root::display_archive_path(&root);
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
    epub_analysis::retire_active_archive();
    let registry = read_registry(&app)?;
    emit_archive_registry_changed(&app, &registry);
    Ok(registry)
}

#[tauri::command]
pub fn create_empty_archive(
    app: tauri::AppHandle,
    parent_path: String,
    archive_name: String,
) -> Result<ArchiveRegistry, String> {
    let validated_name = validate_archive_name(&archive_name)?;
    let parent = validated_parent_path(&parent_path)?;
    let root = create_empty_archive_at(&parent, &validated_name)?;
    let root_path = archive_root::display_archive_path(&root);
    let mut registry = read_registry(&app)?;
    upsert_archive_at_path(&mut registry, root_path, Some(validated_name));
    write_registry(&app, &registry)?;
    epub_analysis::retire_active_archive();
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

    if let Err(error) = validated_root_path(&root_path) {
        registry.last_opened_archive_id = Some(registry.archives[index].id.clone());
        write_registry(&app, &registry)?;
        epub_analysis::retire_active_archive();
        emit_archive_registry_changed(&app, &registry);
        return Err(error);
    }

    registry.archives[index].last_opened_at = timestamp;
    registry.last_opened_archive_id = Some(registry.archives[index].id.clone());
    write_registry(&app, &registry)?;
    epub_analysis::retire_active_archive();
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
    let forgetting_active = registry.last_opened_archive_id.as_deref() == Some(archive_id.as_str());
    registry.archives.retain(|archive| archive.id != archive_id);
    if forgetting_active {
        registry.last_opened_archive_id = None;
    }
    write_registry(&app, &registry)?;
    if forgetting_active {
        epub_analysis::retire_active_archive();
    }
    emit_archive_registry_changed(&app, &registry);
    Ok(registry)
}

#[tauri::command]
pub async fn open_archive_manager_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(existing_window) = app.get_webview_window(ARCHIVE_MANAGER_WINDOW_LABEL) {
        if existing_archive_manager_is_unhealthy(&existing_window) {
            let _ = existing_window.close();
        } else {
            apply_archive_manager_window_constraints(&existing_window)?;
            show_and_focus_window(&existing_window)?;
            return Ok(());
        }
    }

    let (webview_url, _, _) = archive_manager_webview_url(&app)?;

    let window = WebviewWindowBuilder::new(&app, ARCHIVE_MANAGER_WINDOW_LABEL, webview_url)
        .title("Archive Manager")
        .inner_size(ARCHIVE_MANAGER_WIDTH, ARCHIVE_MANAGER_HEIGHT)
        .min_inner_size(ARCHIVE_MANAGER_WIDTH, ARCHIVE_MANAGER_HEIGHT)
        .max_inner_size(ARCHIVE_MANAGER_WIDTH, ARCHIVE_MANAGER_HEIGHT)
        .center()
        .resizable(false)
        .minimizable(true)
        .maximizable(false)
        .decorations(false)
        .closable(true)
        .visible(false)
        .build()
        .map_err(|error| error.to_string())?;

    apply_archive_manager_window_constraints(&window)?;
    show_and_focus_window(&window)
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
    let path = validated_root_path(&archive.root_path)?;

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
        archive_id_for_path, archive_manager_close_action, archive_manager_url_parts,
        archive_paths_match, archive_root, create_empty_archive_at,
        create_empty_archive_at_with_initializer, metadata, normalize_registry_paths,
        upsert_archive_at_path, validate_archive_name, validated_display_root_path,
        validated_parent_path, validated_root_path, ArchiveManagerCloseAction,
        ArchiveManagerUrlKind, ArchiveRecord, ArchiveRegistry,
    };

    #[test]
    fn archive_manager_close_lifecycle_requires_a_usable_archive() {
        assert_eq!(
            archive_manager_close_action(true, true),
            ArchiveManagerCloseAction::FocusMain
        );
        assert_eq!(
            archive_manager_close_action(false, true),
            ArchiveManagerCloseAction::ResumeStartup
        );
        assert_eq!(
            archive_manager_close_action(true, false),
            ArchiveManagerCloseAction::Exit
        );
        assert_eq!(
            archive_manager_close_action(false, false),
            ArchiveManagerCloseAction::Exit
        );
    }

    fn test_root(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-archive-{label}-{nonce}"))
    }

    #[test]
    fn archive_manager_close_lifecycle_rejects_missing_archive_roots() {
        let missing_root = test_root("missing-manager-close-root");
        let usable_active_archive = validated_root_path(&missing_root.to_string_lossy()).is_ok();

        assert!(!usable_active_archive);
        assert_eq!(
            archive_manager_close_action(true, usable_active_archive),
            ArchiveManagerCloseAction::Exit
        );
        assert_eq!(
            archive_manager_close_action(false, usable_active_archive),
            ArchiveManagerCloseAction::Exit
        );
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
    fn upserts_equivalent_extended_windows_paths_without_duplicate_archives() {
        let mut registry = ArchiveRegistry::default();

        let first =
            upsert_archive_at_path(&mut registry, r"\\?\C:\Users\Name\Books".to_string(), None);
        let second = upsert_archive_at_path(
            &mut registry,
            r"C:\Users\Name\Books".to_string(),
            Some("Books".to_string()),
        );

        assert_eq!(registry.archives.len(), 1);
        assert_eq!(first.id, second.id);
        assert_eq!(registry.archives[0].root_path, r"C:\Users\Name\Books");
    }

    #[test]
    fn archive_ids_ignore_extended_windows_path_prefixes() {
        assert_eq!(
            archive_id_for_path(r"\\?\C:\Users\Name\Books"),
            archive_id_for_path(r"C:\Users\Name\Books")
        );
        assert!(archive_paths_match(
            r"\\?\C:\Users\Name\Books",
            r"C:\Users\Name\Books"
        ));
    }

    #[test]
    fn registry_load_normalization_cleans_stored_extended_paths() {
        let mut registry = ArchiveRegistry {
            version: 1,
            last_opened_archive_id: Some("archive-books".to_string()),
            archives: vec![ArchiveRecord {
                id: "archive-books".to_string(),
                display_name: "Books".to_string(),
                root_path: r"\\?\UNC\server\share\Books".to_string(),
                created_at: "1".to_string(),
                last_opened_at: "2".to_string(),
            }],
        };

        assert!(normalize_registry_paths(&mut registry));
        assert_eq!(registry.archives[0].root_path, r"\\server\share\Books");
        assert_eq!(
            registry.last_opened_archive_id.as_deref(),
            Some("archive-books")
        );
    }

    #[test]
    fn accepts_existing_folder_without_metadata_directory() {
        let root = test_root("plain");
        fs::create_dir_all(&root).expect("test archive should be created");

        let display_path = validated_display_root_path(root.to_string_lossy().as_ref())
            .expect("plain archive folder should be accepted");
        let canonical_root = root.canonicalize().expect("root should canonicalize");

        assert_eq!(
            display_path,
            archive_root::display_archive_path(&canonical_root)
        );
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn initializes_metadata_for_plain_folder() {
        let root = test_root("initialize");
        fs::create_dir_all(&root).expect("test archive should be created");
        let canonical_root = validated_root_path(root.to_string_lossy().as_ref())
            .expect("plain archive folder should be accepted");

        metadata::initialize_at(&canonical_root).expect("archive metadata should initialize");

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

        let error = validated_display_root_path(metadata.to_string_lossy().as_ref())
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
        let (kind, url) =
            archive_manager_url_parts(None, false).expect("production manager URL should resolve");

        assert_eq!(kind, ArchiveManagerUrlKind::App);
        assert_eq!(url, "index.html?window=archive-manager");
    }

    #[test]
    fn archive_manager_debug_url_fails_without_dev_url() {
        let error =
            archive_manager_url_parts(None, true).expect_err("debug manager URL requires dev URL");

        assert!(error.contains("development URL"));
    }

    #[test]
    fn validates_archive_creation_names() {
        assert_eq!(
            validate_archive_name("Light Novels").as_deref(),
            Ok("Light Novels")
        );
        assert!(validate_archive_name("   ").is_err());
        assert!(validate_archive_name(".archeion").is_err());
        assert!(validate_archive_name("Books/Novels").is_err());
        assert!(validate_archive_name(r"Books\Novels").is_err());
        assert!(validate_archive_name("Books:").is_err());
        assert!(validate_archive_name("CON").is_err());
        assert!(validate_archive_name("LPT1.txt").is_err());
        assert!(validate_archive_name("Books.").is_err());
        assert!(validate_archive_name("Books ").is_err());
    }

    #[test]
    fn creates_empty_archive_as_child_folder() {
        let root = test_root("create-empty");
        fs::create_dir_all(&root).expect("parent should be created");

        let created = create_empty_archive_at(&root, "Light Novels")
            .expect("empty archive should be created");

        assert_eq!(created, root.join("Light Novels"));
        assert!(created.is_dir());
        assert!(created.join(".archeion").join("library.json").is_file());
        assert!(created.join(".archeion").join("progress.json").is_file());
        assert!(created.join(".archeion").join("settings.json").is_file());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn rejects_existing_empty_archive_target() {
        let root = test_root("create-collision");
        let existing = root.join("Books");
        fs::create_dir_all(&existing).expect("existing folder should be created");

        let error = create_empty_archive_at(&root, "Books")
            .expect_err("existing archive folder should be rejected");

        assert_eq!(error, "Archive folder already exists.");
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn rejects_archive_parent_inside_metadata_directory() {
        let root = test_root("metadata-parent");
        let metadata = root.join(".archeion");
        fs::create_dir_all(&metadata).expect("metadata directory should be created");

        let error = validated_parent_path(metadata.to_string_lossy().as_ref())
            .expect_err("metadata parent should be rejected");

        assert!(error.contains(".archeion"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn cleans_created_folder_when_metadata_initialization_fails() {
        let root = test_root("create-cleanup");
        fs::create_dir_all(&root).expect("parent should be created");

        let error = create_empty_archive_at_with_initializer(&root, "Broken", |_path| {
            Err("metadata initialization failed".to_string())
        })
        .expect_err("metadata failure should fail creation");

        assert_eq!(error, "metadata initialization failed");
        assert!(!root.join("Broken").exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn guided_creation_registry_record_uses_archive_name_and_final_path() {
        let root = test_root("registry-record");
        fs::create_dir_all(&root).expect("parent should be created");
        let created =
            create_empty_archive_at(&root, "Novels").expect("empty archive should be created");
        let mut registry = ArchiveRegistry::default();
        let root_path = archive_root::display_archive_path(&created);
        let archive =
            upsert_archive_at_path(&mut registry, root_path.clone(), Some("Novels".to_string()));

        assert_eq!(archive.display_name, "Novels");
        assert_eq!(archive.root_path, root_path);
        assert_eq!(
            registry.last_opened_archive_id.as_deref(),
            Some(archive.id.as_str())
        );
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    #[cfg(windows)]
    fn archive_ids_are_case_insensitive_on_windows() {
        assert_eq!(
            archive_id_for_path("C:/Books"),
            archive_id_for_path("C:/books")
        );
        assert!(archive_paths_match("C:/Books", "C:/books"));
    }

    #[test]
    #[cfg(not(windows))]
    fn archive_ids_are_case_sensitive_on_case_sensitive_platforms() {
        assert_ne!(archive_id_for_path("/Books"), archive_id_for_path("/books"));
        assert!(!archive_paths_match("/Books", "/books"));
    }
}
