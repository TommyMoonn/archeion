use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::{Mutex, MutexGuard},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::atomic_file::{
    recover_atomic_replace, transaction_path, AtomicReplaceError, BackupCleanup,
    PreparedAtomicFile, RealAtomicFileSystem, TemporaryWriteError, TemporaryWriteStage,
};

use super::{archive_root, epub_analysis, metadata};

const ARCHIVE_REGISTRY_FILE: &str = "archives.json";
const ARCHIVE_REGISTRY_LAST_GOOD_FILE: &str = "archives.last-good.json";
const LEGACY_ARCHIVE_REGISTRY_FILE: &str = "vault.json";
const ARCHIVE_MANAGER_WINDOW_LABEL: &str = "archive-manager";
const ARCHIVE_REGISTRY_CHANGED_EVENT: &str = "archive-registry-changed";
const ARCHIVE_MANAGER_CLOSED_EVENT: &str = "archive-manager-closed";
const ARCHIVE_RECONCILIATION_REQUESTED_EVENT: &str = "archive-reconciliation-requested";
const ARCHIVE_RECONCILIATION_COMPLETED_EVENT: &str = "archive-reconciliation-completed";
const ARCHIVE_MAINTENANCE_RECONCILED_EVENT: &str = "archive-maintenance-reconciled";
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

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveReconciliationRequest {
    pub archive_id: String,
    pub request_id: String,
    pub root_path: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveReconciliationCompletion {
    pub archive_id: String,
    pub request_id: String,
    pub root_path: String,
    pub succeeded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveMaintenanceReconciled {
    archive_id: String,
    root_path: String,
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

#[derive(Clone, Debug)]
struct ArchiveRegistryPaths {
    current: PathBuf,
    last_good: PathBuf,
    legacy: PathBuf,
}

fn archive_registry_paths(app: &tauri::AppHandle) -> Result<ArchiveRegistryPaths, String> {
    Ok(ArchiveRegistryPaths {
        current: app_config_path(app, ARCHIVE_REGISTRY_FILE)?,
        last_good: app_config_path(app, ARCHIVE_REGISTRY_LAST_GOOD_FILE)?,
        legacy: app_config_path(app, LEGACY_ARCHIVE_REGISTRY_FILE)?,
    })
}

fn read_legacy_registry(path: &Path) -> Result<Option<ArchiveRegistry>, String> {
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

fn validate_registry(registry: &ArchiveRegistry) -> Result<(), String> {
    if registry.version != 1 {
        return Err(format!(
            "Unsupported archive registry version: {}.",
            registry.version
        ));
    }
    Ok(())
}

fn parse_registry(contents: &[u8]) -> Result<ArchiveRegistry, String> {
    let registry: ArchiveRegistry =
        serde_json::from_slice(contents).map_err(|error| error.to_string())?;
    validate_registry(&registry)?;
    Ok(registry)
}

fn archive_registry_temporary_write_error(error: TemporaryWriteError) -> String {
    let stage = error.stage();
    let source = error.into_source();
    match stage {
        TemporaryWriteStage::Create => {
            format!("Archive registry temporary file could not be created: {source}")
        }
        TemporaryWriteStage::Write => {
            format!("Archive registry temporary file could not be written: {source}")
        }
        TemporaryWriteStage::Sync => {
            format!("Archive registry temporary file could not be synced: {source}")
        }
    }
}

fn archive_registry_replace_error(error: AtomicReplaceError) -> String {
    match error {
        AtomicReplaceError::DestinationNotFile => {
            "Archive registry path is not a file.".to_string()
        }
        AtomicReplaceError::MoveDestinationToBackup(error) => {
            format!("Archive registry transaction backup could not be created: {error}")
        }
        AtomicReplaceError::ReplaceMissingDestination(error) => {
            format!("Archive registry could not be replaced: {error}")
        }
        AtomicReplaceError::ReplaceRestored { replace_error } => format!(
            "Archive registry could not be replaced and the previous registry was restored: {replace_error}"
        ),
        AtomicReplaceError::RestoreFailed { restore_error } => format!(
            "Archive registry could not be replaced and the previous registry could not be restored: {restore_error}"
        ),
        AtomicReplaceError::RemoveBackup(error) => {
            format!("Archive registry transaction backup could not be removed: {error}")
        }
        AtomicReplaceError::SyncDirectory(error) => {
            format!("Archive registry directory could not be synced: {error}")
        }
    }
}

fn write_registry_document(path: &Path, registry: &ArchiveRegistry) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("Archive registry directory could not be created: {error}"))?;
    }
    recover_atomic_replace(path)
        .map_err(|error| format!("Archive registry transaction could not be recovered: {error}"))?;
    validate_registry(registry)?;
    let contents = serde_json::to_vec_pretty(registry)
        .map_err(|error| format!("Archive registry could not be serialized: {error}"))?;
    parse_registry(&contents)
        .map_err(|error| format!("Archive registry could not be validated: {error}"))?;
    let temporary = PreparedAtomicFile::write(transaction_path(path, "tmp-write"), &contents)
        .map_err(archive_registry_temporary_write_error)?;
    let backup = transaction_path(path, "write-backup");
    temporary
        .replace(
            path,
            &backup,
            BackupCleanup::Required,
            &RealAtomicFileSystem,
        )
        .map_err(archive_registry_replace_error)
}

pub(crate) struct ArchiveRegistryService {
    paths: ArchiveRegistryPaths,
    operation: Mutex<()>,
}

impl ArchiveRegistryService {
    pub(crate) fn from_app(app: &tauri::AppHandle) -> Result<Self, String> {
        Ok(Self::new(archive_registry_paths(app)?))
    }

    fn new(paths: ArchiveRegistryPaths) -> Self {
        Self {
            paths,
            operation: Mutex::new(()),
        }
    }

    fn lock(&self) -> Result<MutexGuard<'_, ()>, String> {
        self.operation
            .lock()
            .map_err(|_| "Archive registry state is unavailable.".to_string())
    }

    fn load_last_good_locked(&self) -> Result<Option<ArchiveRegistry>, String> {
        recover_atomic_replace(&self.paths.last_good).map_err(|error| {
            format!("Archive registry last-known-good transaction could not be recovered: {error}")
        })?;
        let contents = match fs::read(&self.paths.last_good) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(format!(
                    "Archive registry last-known-good copy could not be read: {error}"
                ))
            }
        };
        parse_registry(&contents)
            .map(Some)
            .map_err(|error| format!("Archive registry last-known-good copy is invalid: {error}"))
    }

    fn restore_from_last_good_locked(
        &self,
        mut registry: ArchiveRegistry,
    ) -> Result<ArchiveRegistry, String> {
        normalize_registry_paths(&mut registry);
        write_registry_document(&self.paths.current, &registry)?;
        Ok(registry)
    }

    fn load_locked(&self) -> Result<ArchiveRegistry, String> {
        recover_atomic_replace(&self.paths.current).map_err(|error| {
            format!("Archive registry transaction could not be recovered: {error}")
        })?;

        let contents = match fs::read(&self.paths.current) {
            Ok(contents) => contents,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                if let Some(registry) = self.load_last_good_locked()? {
                    return self.restore_from_last_good_locked(registry);
                }
                if let Some(mut registry) = read_legacy_registry(&self.paths.legacy)? {
                    normalize_registry_paths(&mut registry);
                    write_registry_document(&self.paths.last_good, &registry)?;
                    write_registry_document(&self.paths.current, &registry)?;
                    return Ok(registry);
                }
                return Ok(ArchiveRegistry::default());
            }
            Err(error) => return Err(format!("Archive registry could not be read: {error}")),
        };

        let mut registry = match parse_registry(&contents) {
            Ok(registry) => registry,
            Err(current_error) => {
                let Some(last_good) = self.load_last_good_locked()? else {
                    return Err(format!("Archive registry is invalid: {current_error}"));
                };
                return self.restore_from_last_good_locked(last_good);
            }
        };

        if normalize_registry_paths(&mut registry) {
            let previous = parse_registry(&contents)?;
            self.persist_locked(&previous, &registry)?;
        }

        Ok(registry)
    }

    fn persist_locked(
        &self,
        previous: &ArchiveRegistry,
        next: &ArchiveRegistry,
    ) -> Result<(), String> {
        // One stable copy always records the last registry known-good before a mutation commits.
        write_registry_document(&self.paths.last_good, previous)?;
        write_registry_document(&self.paths.current, next)
    }

    fn load(&self) -> Result<ArchiveRegistry, String> {
        let _guard = self.lock()?;
        self.load_locked()
    }

    fn mutate<T>(
        &self,
        mutation: impl FnOnce(&mut ArchiveRegistry) -> Result<T, String>,
    ) -> Result<(ArchiveRegistry, T), String> {
        let _guard = self.lock()?;
        let mut registry = self.load_locked()?;
        let previous = registry.clone();
        let result = mutation(&mut registry)?;
        validate_registry(&registry)?;
        self.persist_locked(&previous, &registry)?;
        Ok((registry, result))
    }

    fn upsert(
        &self,
        root_path: String,
        display_name: Option<String>,
    ) -> Result<(ArchiveRegistry, ArchiveRecord), String> {
        self.mutate(|registry| Ok(upsert_archive_at_path(registry, root_path, display_name)))
    }

    fn activate(&self, archive_id: &str) -> Result<(ArchiveRegistry, Option<String>), String> {
        self.mutate(|registry| {
            let index = registry
                .archives
                .iter()
                .position(|archive| archive.id == archive_id)
                .ok_or_else(|| "The selected archive is no longer registered.".to_string())?;
            let root_path = registry.archives[index].root_path.clone();
            let validation_error = validated_root_path(&root_path).err();

            if validation_error.is_none() {
                registry.archives[index].last_opened_at = now_timestamp();
            }
            registry.last_opened_archive_id = Some(registry.archives[index].id.clone());
            Ok(validation_error)
        })
    }

    fn rename(&self, archive_id: &str, display_name: &str) -> Result<ArchiveRegistry, String> {
        let (registry, ()) = self.mutate(|registry| {
            let archive = registry
                .archives
                .iter_mut()
                .find(|archive| archive.id == archive_id)
                .ok_or_else(|| "The selected archive is no longer registered.".to_string())?;
            archive.display_name = display_name.to_string();
            Ok(())
        })?;
        Ok(registry)
    }

    fn forget(&self, archive_id: &str) -> Result<(ArchiveRegistry, bool), String> {
        self.mutate(|registry| {
            let forgetting_active = registry.last_opened_archive_id.as_deref() == Some(archive_id);
            registry.archives.retain(|archive| archive.id != archive_id);
            if forgetting_active {
                registry.last_opened_archive_id = None;
            }
            Ok(forgetting_active)
        })
    }
}

fn archive_registry_service(app: &tauri::AppHandle) -> tauri::State<'_, ArchiveRegistryService> {
    app.state::<ArchiveRegistryService>()
}

fn read_registry(app: &tauri::AppHandle) -> Result<ArchiveRegistry, String> {
    archive_registry_service(app).load()
}

pub(crate) fn registered_archive_roots(app: &tauri::AppHandle) -> Result<Vec<PathBuf>, String> {
    Ok(read_registry(app)?
        .archives
        .into_iter()
        .map(|archive| PathBuf::from(archive.root_path))
        .collect())
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
    let (_, archive) = archive_registry_service(app).upsert(root_path, None)?;
    Ok(archive)
}

#[tauri::command]
pub fn load_archive_registry(app: tauri::AppHandle) -> Result<ArchiveRegistry, String> {
    read_registry(&app)
}

fn validate_archive_invalidation_scope(
    registry: &ArchiveRegistry,
    archive_id: &str,
    root_path: &str,
) -> Result<(), String> {
    let active_id = registry
        .last_opened_archive_id
        .as_deref()
        .ok_or_else(|| "No active archive is available.".to_string())?;
    let active = registry
        .archives
        .iter()
        .find(|archive| archive.id == active_id)
        .ok_or_else(|| "The active archive is unavailable.".to_string())?;

    if active.id != archive_id || !archive_paths_match(&active.root_path, root_path) {
        return Err("The active archive changed before invalidation completed.".to_string());
    }

    Ok(())
}

#[tauri::command]
pub fn invalidate_archive_view(
    app: tauri::AppHandle,
    archive_id: String,
    root_path: String,
) -> Result<(), String> {
    let registry = read_registry(&app)?;
    validate_archive_invalidation_scope(&registry, &archive_id, &root_path)?;
    let main = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "The Main window is unavailable for archive synchronization.".to_string())?;
    main.emit(
        ARCHIVE_MAINTENANCE_RECONCILED_EVENT,
        ArchiveMaintenanceReconciled {
            archive_id,
            root_path,
        },
    )
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn request_archive_reconciliation(
    app: tauri::AppHandle,
    request: ArchiveReconciliationRequest,
) -> Result<(), String> {
    let registry = read_registry(&app)?;
    validate_archive_invalidation_scope(&registry, &request.archive_id, &request.root_path)?;
    let main = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "The Main window is unavailable for archive reconciliation.".to_string())?;
    main.emit(ARCHIVE_RECONCILIATION_REQUESTED_EVENT, request)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn complete_archive_reconciliation(
    app: tauri::AppHandle,
    mut completion: ArchiveReconciliationCompletion,
) -> Result<(), String> {
    let registry = read_registry(&app)?;
    if validate_archive_invalidation_scope(&registry, &completion.archive_id, &completion.root_path)
        .is_err()
    {
        completion.succeeded = false;
        completion.error =
            Some("The active archive changed before reconciliation completed.".to_string());
    }
    app.emit(ARCHIVE_RECONCILIATION_COMPLETED_EVENT, completion)
        .map_err(|error| error.to_string())
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
    let (registry, _) = archive_registry_service(&app).upsert(root_path, Some(validated_name))?;
    epub_analysis::retire_active_archive();
    emit_archive_registry_changed(&app, &registry);
    Ok(registry)
}

#[tauri::command]
pub fn activate_archive(
    app: tauri::AppHandle,
    archive_id: String,
) -> Result<ArchiveRegistry, String> {
    let (registry, validation_error) = archive_registry_service(&app).activate(&archive_id)?;
    epub_analysis::retire_active_archive();
    emit_archive_registry_changed(&app, &registry);
    if let Some(error) = validation_error {
        return Err(error);
    }
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

    let registry = archive_registry_service(&app).rename(&archive_id, name)?;
    emit_archive_registry_changed(&app, &registry);
    Ok(registry)
}

#[tauri::command]
pub fn forget_archive(
    app: tauri::AppHandle,
    archive_id: String,
) -> Result<ArchiveRegistry, String> {
    let (registry, forgetting_active) = archive_registry_service(&app).forget(&archive_id)?;
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
        sync::Arc,
        thread,
        time::{Duration, SystemTime, UNIX_EPOCH},
    };

    use crate::atomic_file::transaction_path;

    use super::{
        archive_id_for_path, archive_manager_close_action, archive_manager_url_parts,
        archive_paths_match, archive_root, create_empty_archive_at,
        create_empty_archive_at_with_initializer, metadata, normalize_registry_paths,
        upsert_archive_at_path, validate_archive_invalidation_scope, validate_archive_name,
        validated_display_root_path, validated_parent_path, validated_root_path,
        ArchiveManagerCloseAction, ArchiveManagerUrlKind, ArchiveRecord, ArchiveRegistry,
        ArchiveRegistryPaths, ArchiveRegistryService,
    };

    #[test]
    fn archive_invalidation_is_bound_to_the_current_registry_identity() {
        let archive = ArchiveRecord {
            id: "archive-a".to_string(),
            display_name: "Archive A".to_string(),
            root_path: r"C:\Archive A".to_string(),
            last_opened_at: "1".to_string(),
            created_at: "1".to_string(),
        };
        let registry = ArchiveRegistry {
            version: 1,
            archives: vec![archive],
            last_opened_archive_id: Some("archive-a".to_string()),
        };

        assert!(
            validate_archive_invalidation_scope(&registry, "archive-a", r"C:\Archive A").is_ok()
        );
        assert!(
            validate_archive_invalidation_scope(&registry, "archive-b", r"C:\Archive A").is_err()
        );
        assert!(
            validate_archive_invalidation_scope(&registry, "archive-a", r"D:\Archive B").is_err()
        );
    }

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

    fn test_registry_paths(root: &std::path::Path) -> ArchiveRegistryPaths {
        ArchiveRegistryPaths {
            current: root.join("archives.json"),
            last_good: root.join("archives.last-good.json"),
            legacy: root.join("vault.json"),
        }
    }

    fn archive_record(id: &str, root: &std::path::Path) -> ArchiveRecord {
        ArchiveRecord {
            id: id.to_string(),
            display_name: id.to_string(),
            root_path: root.to_string_lossy().into_owned(),
            created_at: "1".to_string(),
            last_opened_at: "1".to_string(),
        }
    }

    #[test]
    fn registry_service_routes_create_activate_rename_and_forget_mutations() {
        let root = test_root("registry-service-mutations");
        let first_root = root.join("First");
        let second_root = root.join("Second");
        fs::create_dir_all(&first_root).unwrap();
        fs::create_dir_all(&second_root).unwrap();
        let paths = test_registry_paths(&root);
        let service = ArchiveRegistryService::new(paths.clone());

        let (_, first) = service
            .upsert(
                first_root.to_string_lossy().into_owned(),
                Some("First".to_string()),
            )
            .unwrap();
        let (_, second) = service
            .upsert(
                second_root.to_string_lossy().into_owned(),
                Some("Second".to_string()),
            )
            .unwrap();
        let (activated, activation_error) = service.activate(&first.id).unwrap();
        assert!(activation_error.is_none());
        assert_eq!(
            activated.last_opened_archive_id.as_deref(),
            Some(first.id.as_str())
        );

        service.rename(&second.id, "Renamed").unwrap();
        let (_, forgetting_active) = service.forget(&first.id).unwrap();
        assert!(forgetting_active);

        let registry = service.load().unwrap();
        assert_eq!(registry.archives.len(), 1);
        assert_eq!(registry.archives[0].id, second.id);
        assert_eq!(registry.archives[0].display_name, "Renamed");
        assert!(registry.last_opened_archive_id.is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn registry_service_round_trips_through_durable_writer() {
        let root = test_root("registry-service-round-trip");
        fs::create_dir_all(&root).unwrap();
        let paths = test_registry_paths(&root);
        let service = ArchiveRegistryService::new(paths.clone());
        let archive_root = root.join("Books");
        fs::create_dir_all(&archive_root).unwrap();

        let (_, archive) = service
            .upsert(
                archive_root.to_string_lossy().into_owned(),
                Some("Books".to_string()),
            )
            .unwrap();
        let loaded = service.load().unwrap();

        assert_eq!(loaded.archives.len(), 1);
        assert_eq!(loaded.archives[0].id, archive.id);
        assert!(paths.current.is_file());
        assert!(paths.last_good.is_file());
        assert!(!fs::read_dir(&root).unwrap().any(|entry| {
            let name = entry.unwrap().file_name().to_string_lossy().into_owned();
            name.contains("tmp-write") || name.contains("write-backup")
        }));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn registry_service_recovers_interrupted_replacement_before_load() {
        let root = test_root("registry-service-interrupted");
        fs::create_dir_all(&root).unwrap();
        let paths = test_registry_paths(&root);
        let old_registry = ArchiveRegistry {
            version: 1,
            archives: vec![archive_record("old", &root.join("Old"))],
            last_opened_archive_id: Some("old".to_string()),
        };
        let pending_registry = ArchiveRegistry {
            version: 1,
            archives: vec![archive_record("new", &root.join("New"))],
            last_opened_archive_id: Some("new".to_string()),
        };
        fs::write(
            &paths.current,
            serde_json::to_vec_pretty(&old_registry).unwrap(),
        )
        .unwrap();
        let backup = transaction_path(&paths.current, "write-backup");
        fs::rename(&paths.current, &backup).unwrap();
        let temporary = transaction_path(&paths.current, "tmp-write");
        fs::write(
            &temporary,
            serde_json::to_vec_pretty(&pending_registry).unwrap(),
        )
        .unwrap();

        let loaded = ArchiveRegistryService::new(paths.clone()).load().unwrap();

        assert_eq!(loaded.archives[0].id, "old");
        assert!(paths.current.is_file());
        assert!(!backup.exists());
        assert!(!temporary.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn registry_service_recovers_corrupt_current_from_last_known_good() {
        let root = test_root("registry-service-corrupt");
        fs::create_dir_all(&root).unwrap();
        let paths = test_registry_paths(&root);
        let service = ArchiveRegistryService::new(paths.clone());
        let first_root = root.join("First");
        let second_root = root.join("Second");
        fs::create_dir_all(&first_root).unwrap();
        fs::create_dir_all(&second_root).unwrap();

        service
            .upsert(
                first_root.to_string_lossy().into_owned(),
                Some("First".to_string()),
            )
            .unwrap();
        service
            .upsert(
                second_root.to_string_lossy().into_owned(),
                Some("Second".to_string()),
            )
            .unwrap();
        fs::write(&paths.current, b"{ broken registry").unwrap();

        let recovered = service.load().unwrap();

        assert_eq!(recovered.archives.len(), 1);
        assert_eq!(recovered.archives[0].display_name, "First");
        assert_eq!(
            serde_json::from_slice::<ArchiveRegistry>(&fs::read(&paths.current).unwrap())
                .unwrap()
                .archives
                .len(),
            1
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn unrecoverable_registry_error_does_not_delete_archive_directories() {
        let root = test_root("registry-service-unrecoverable");
        let archive_root = root.join("Registered Books");
        fs::create_dir_all(&archive_root).unwrap();
        let paths = test_registry_paths(&root);
        fs::write(&paths.current, b"not json").unwrap();
        fs::write(&paths.last_good, b"also not json").unwrap();

        let error = ArchiveRegistryService::new(paths.clone())
            .load()
            .expect_err("unrecoverable registry should surface an error");

        assert!(error.contains("registry"));
        assert!(archive_root.is_dir());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn concurrent_registry_mutations_preserve_unrelated_changes() {
        let root = test_root("registry-service-concurrent");
        fs::create_dir_all(&root).unwrap();
        let paths = test_registry_paths(&root);
        let service = Arc::new(ArchiveRegistryService::new(paths.clone()));
        let first_paths = paths.clone();
        let second_paths = paths.clone();
        let first_service = Arc::clone(&service);
        let second_service = Arc::clone(&service);

        let first = thread::spawn(move || {
            first_service
                .mutate(|registry| {
                    thread::sleep(Duration::from_millis(40));
                    registry.archives.push(archive_record(
                        "first",
                        &first_paths.current.with_file_name("First"),
                    ));
                    Ok(())
                })
                .unwrap();
        });
        let second = thread::spawn(move || {
            second_service
                .mutate(|registry| {
                    registry.archives.push(archive_record(
                        "second",
                        &second_paths.current.with_file_name("Second"),
                    ));
                    Ok(())
                })
                .unwrap();
        });
        first.join().unwrap();
        second.join().unwrap();

        let loaded = service.load().unwrap();
        assert_eq!(loaded.archives.len(), 2);
        assert!(loaded.archives.iter().any(|archive| archive.id == "first"));
        assert!(loaded.archives.iter().any(|archive| archive.id == "second"));
        fs::remove_dir_all(root).unwrap();
    }
}
