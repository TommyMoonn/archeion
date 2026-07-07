use std::{
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};

use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use tauri::{Emitter, State};

use super::archive_root;

const ARCHIVE_CHANGED_EVENT: &str = "archive://changed";
const ARCHIVE_WATCHER_ERROR_EVENT: &str = "archive://watcher-error";
const METADATA_DIRECTORY: &str = ".archeion";

#[derive(Default)]
pub struct ArchiveWatcherState {
    watcher: Mutex<Option<ActiveArchiveWatcher>>,
    next_id: AtomicU64,
}

impl ArchiveWatcherState {
    fn next_watcher_id(&self) -> String {
        let sequence = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        format!("archive-watcher-{sequence}")
    }
}

struct ActiveArchiveWatcher {
    id: String,
    root: PathBuf,
    _watcher: RecommendedWatcher,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveWatcherEvent {
    path: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveWatcherError {
    message: String,
}

fn path_is_inside_metadata_directory(root: &Path, path: &Path) -> bool {
    let relative = match path.strip_prefix(root) {
        Ok(relative) => relative,
        Err(_) => {
            return path
                .components()
                .any(|component| {
                    matches!(component, Component::Normal(name) if name == METADATA_DIRECTORY)
                });
        }
    };

    matches!(
        relative.components().next(),
        Some(Component::Normal(name)) if name == METADATA_DIRECTORY
    )
}

fn path_may_affect_archive_content(root: &Path, path: &Path) -> bool {
    if path_is_inside_metadata_directory(root, path) {
        return false;
    }

    if path
        .extension()
        .is_some_and(|extension| extension
            .to_string_lossy()
            .eq_ignore_ascii_case("epub"))
    {
        return true;
    }

    if path.exists() {
        return path.is_dir() || path.extension().is_none();
    }

    true
}

fn event_path_for_payload(root: &Path, event: &Event) -> Option<String> {
    event
        .paths
        .iter()
        .find(|path| path_may_affect_archive_content(root, path))
        .map(|path| path.to_string_lossy().into_owned())
}

fn event_touches_user_content(root: &Path, event: &Event) -> bool {
    event_path_for_payload(root, event).is_some()
}

#[tauri::command]
pub fn start_archive_watcher(
    app: tauri::AppHandle,
    state: State<'_, ArchiveWatcherState>,
) -> Result<String, String> {
    let root = archive_root::read_archive_path(&app)?
        .map(PathBuf::from)
        .ok_or_else(|| "No archive folder has been selected.".to_string())?;

    if !root.is_dir() {
        return Err("The selected archive folder is unavailable.".to_string());
    }

    let canonical_root = root.canonicalize().unwrap_or(root);
    let mut guard = state.watcher.lock().map_err(|error| error.to_string())?;
    if let Some(active) = guard.as_ref().filter(|active| active.root == canonical_root) {
        return Ok(active.id.clone());
    }

    *guard = None;

    let emit_app = app.clone();
    let watched_root = canonical_root.clone();
    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<Event>| match result {
            Ok(event) if event_touches_user_content(&watched_root, &event) => {
                let _ = emit_app.emit(
                    ARCHIVE_CHANGED_EVENT,
                    ArchiveWatcherEvent {
                        path: event_path_for_payload(&watched_root, &event),
                    },
                );
            }
            Ok(_) => {}
            Err(error) => {
                let _ = emit_app.emit(
                    ARCHIVE_WATCHER_ERROR_EVENT,
                    ArchiveWatcherError {
                        message: error.to_string(),
                    },
                );
            }
        },
        Config::default(),
    )
    .map_err(|error| error.to_string())?;

    watcher
        .watch(&canonical_root, RecursiveMode::Recursive)
        .map_err(|error| error.to_string())?;

    let watcher_id = state.next_watcher_id();
    *guard = Some(ActiveArchiveWatcher {
        id: watcher_id.clone(),
        root: canonical_root,
        _watcher: watcher,
    });

    Ok(watcher_id)
}

#[tauri::command]
pub fn stop_archive_watcher(
    state: State<'_, ArchiveWatcherState>,
    watcher_id: String,
) -> Result<(), String> {
    let mut guard = state.watcher.lock().map_err(|error| error.to_string())?;
    if guard.as_ref().is_some_and(|active| active.id == watcher_id) {
        *guard = None;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use notify::Event;

    use super::{
        event_touches_user_content, path_is_inside_metadata_directory,
        path_may_affect_archive_content,
    };

    #[test]
    fn ignores_metadata_directory_events() {
        let root = std::path::PathBuf::from("/archive");
        assert!(path_is_inside_metadata_directory(
            &root,
            &root.join(".archeion/library.json")
        ));
        assert!(!path_is_inside_metadata_directory(
            &root,
            &root.join("Author/Book.epub")
        ));
    }

    #[test]
    fn filters_existing_non_epub_files_but_keeps_archive_paths() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-watcher-filter-{nonce}"));
        std::fs::create_dir_all(root.join("Author/Series.v1"))
            .expect("test directory should be created");
        std::fs::write(root.join("notes.txt"), b"notes")
            .expect("test file should be written");

        assert!(!path_may_affect_archive_content(
            &root,
            &root.join("notes.txt")
        ));
        assert!(path_may_affect_archive_content(
            &root,
            &root.join("Author/Book.epub")
        ));
        assert!(path_may_affect_archive_content(
            &root,
            &root.join("Author/Series.v1")
        ));
        assert!(path_may_affect_archive_content(
            &root,
            &root.join("Author/Deleted.Series.v1")
        ));

        std::fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn reports_events_when_at_least_one_user_path_changed() {
        let root = std::path::PathBuf::from("/archive");
        let mut event = Event::new(notify::EventKind::Any);
        event.paths.push(root.join(".archeion/library.json"));
        assert!(!event_touches_user_content(&root, &event));

        event.paths.push(root.join("Author/Book.epub"));
        assert!(event_touches_user_content(&root, &event));
    }
}
