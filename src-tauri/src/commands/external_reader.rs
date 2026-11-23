use serde::Serialize;
#[cfg(windows)]
use std::path::Path;
use std::{collections::HashMap, path::PathBuf, sync::Mutex};
use tauri::Manager;
#[cfg(windows)]
use tauri::{WebviewUrl, WebviewWindowBuilder};

#[cfg(windows)]
use super::cold_start_epub::resolve_cold_start_epub_in;

#[cfg(any(windows, test))]
const READER_LABEL_PREFIX: &str = "external-reader-";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalReaderRequest {
    pub token: String,
    pub file_name: String,
}

struct ReaderSession {
    path: String,
    request: ExternalReaderRequest,
    ready: bool,
}

fn reader_request(path: &str, id: u64) -> ExternalReaderRequest {
    ExternalReaderRequest {
        token: format!("reader-session-{}-{id}", std::process::id()),
        file_name: std::path::Path::new(path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("EPUB")
            .to_owned(),
    }
}

#[derive(Default)]
struct Registry {
    next_id: u64,
    sessions: HashMap<String, ReaderSession>,
    paths: HashMap<String, String>,
    focus_target: Option<String>,
}

pub struct ExternalReaderRegistry(Mutex<Registry>);

#[cfg(any(windows, test))]
#[derive(Debug, PartialEq)]
enum Route {
    Create(String),
    Focus(String),
}

fn file_key(path: &str) -> String {
    // Canonical paths resolve symlinks; Windows file lookup is case-insensitive.
    #[cfg(windows)]
    {
        path.to_lowercase()
    }
    #[cfg(not(windows))]
    {
        path.to_string()
    }
}

impl Registry {
    fn new(cold_start: Option<String>) -> Self {
        let mut registry = Self::default();
        if let Some(path) = cold_start {
            registry.focus_target = Some("main".into());
            registry.paths.insert(file_key(&path), "main".into());
            let request = reader_request(&path, registry.next_id);
            registry.sessions.insert(
                "main".into(),
                ReaderSession {
                    path,
                    request,
                    ready: true,
                },
            );
        }
        registry
    }

    #[cfg(any(windows, test))]
    fn route(&mut self, path: String) -> Route {
        let key = file_key(&path);
        if let Some(label) = self.paths.get(&key) {
            self.focus_target = Some(label.clone());
            return Route::Focus(label.clone());
        }
        self.next_id += 1;
        let label = format!("{READER_LABEL_PREFIX}{}", self.next_id);
        self.paths.insert(key, label.clone());
        let request = reader_request(&path, self.next_id);
        self.sessions.insert(
            label.clone(),
            ReaderSession {
                path,
                request,
                ready: false,
            },
        );
        self.focus_target = Some(label.clone());
        Route::Create(label)
    }

    fn retire(&mut self, label: &str) {
        let Some(session) = self.sessions.remove(label) else {
            return;
        };
        if self.paths.get(&file_key(&session.path)).map(String::as_str) == Some(label) {
            self.paths.remove(&file_key(&session.path));
        }
        if self.focus_target.as_deref() == Some(label) {
            self.focus_target = None;
        }
    }

    fn claim(&self, label: &str) -> Option<ExternalReaderRequest> {
        self.sessions
            .get(label)
            .map(|session| session.request.clone())
    }

    fn selected_path(&self, label: &str, token: &str) -> Result<PathBuf, String> {
        let session = self
            .sessions
            .get(label)
            .filter(|session| session.request.token == token)
            .ok_or("The external Reader session has ended.")?;
        let path = PathBuf::from(&session.path);
        let canonical = std::fs::canonicalize(&path)
            .map_err(|_| "The selected EPUB is no longer available.".to_string())?;
        if canonical != path
            || !canonical
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("epub"))
        {
            return Err("The selected EPUB has changed since it was opened.".into());
        }
        Ok(canonical)
    }

    fn mark_ready(&mut self, label: &str) -> Result<bool, String> {
        let session = self
            .sessions
            .get_mut(label)
            .ok_or("The Reader request is no longer active.")?;
        session.ready = true;
        Ok(self.focus_target.as_deref() == Some(label))
    }

    fn may_focus(&self, label: &str) -> bool {
        self.focus_target.as_deref() == Some(label)
            && self
                .sessions
                .get(label)
                .is_some_and(|session| session.ready)
    }
}

impl ExternalReaderRegistry {
    pub fn new(cold_start: Option<String>) -> Self {
        Self(Mutex::new(Registry::new(cold_start)))
    }

    pub fn request_for_window(&self, label: &str) -> Option<ExternalReaderRequest> {
        self.0.lock().unwrap().claim(label)
    }

    fn selected_path(&self, label: &str, token: &str) -> Result<PathBuf, String> {
        self.0.lock().unwrap().selected_path(label, token)
    }

    pub fn close_window(&self, label: &str) {
        self.0.lock().unwrap().retire(label);
    }
}

fn focus_window(app: &tauri::AppHandle, label: &str) {
    if !app
        .state::<ExternalReaderRegistry>()
        .0
        .lock()
        .unwrap()
        .may_focus(label)
    {
        return;
    }
    let Some(window) = app.get_webview_window(label) else {
        return;
    };
    if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
    }
    if let Err(error) = window.set_focus() {
        eprintln!("Could not focus external Reader: {error}");
    }
}

#[cfg(windows)]
fn reader_url(app: &tauri::AppHandle) -> Result<WebviewUrl, String> {
    if cfg!(debug_assertions) {
        let mut url = app
            .config()
            .build
            .dev_url
            .clone()
            .ok_or("Missing Tauri development URL")?;
        url.set_query(Some("window=standalone-reader"));
        Ok(WebviewUrl::External(url))
    } else {
        Ok(WebviewUrl::App(
            "index.html?window=standalone-reader".into(),
        ))
    }
}

#[cfg(windows)]
fn create_reader(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    let window = WebviewWindowBuilder::new(app, label, reader_url(app)?)
        .title("Archeion Reader")
        .inner_size(1080.0, 760.0)
        .min_inner_size(640.0, 480.0)
        .decorations(false)
        .visible(false)
        .focused(false)
        .background_color(super::app_appearance::native_background(app))
        .build()
        .map_err(|error| error.to_string())?;
    // The window is revealed only after the themed Reader shell has committed.
    drop(window);
    Ok(())
}

#[cfg(windows)]
pub fn handle_second_instance(app: &tauri::AppHandle, args: Vec<String>, cwd: String) {
    let Some(path) = resolve_cold_start_epub_in(
        args.into_iter().skip(1).map(Into::into),
        Some(Path::new(&cwd)),
    ) else {
        return;
    };
    let action = app
        .state::<ExternalReaderRegistry>()
        .0
        .lock()
        .unwrap()
        .route(path);
    match action {
        Route::Focus(label) => {
            let app = app.clone();
            let schedule = app.clone();
            if let Err(error) = schedule.run_on_main_thread(move || focus_window(&app, &label)) {
                eprintln!("Could not schedule Reader focus: {error}");
            }
        }
        Route::Create(label) => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = create_reader(&app, &label) {
                    app.state::<ExternalReaderRegistry>().close_window(&label);
                    eprintln!("Could not open external Reader: {error}");
                }
            });
        }
    }
}

#[tauri::command]
pub async fn read_external_reader_epub(
    window: tauri::WebviewWindow,
    readers: tauri::State<'_, ExternalReaderRegistry>,
    token: String,
) -> Result<tauri::ipc::Response, String> {
    // The window owns its token; webviews cannot request arbitrary filesystem paths.
    let path = readers.selected_path(window.label(), &token)?;
    tauri::async_runtime::spawn_blocking(move || {
        super::epub_file_resource::read_epub_file_bytes(&path).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn standalone_reader_window_ready(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    let label = window.label();
    let owner = app.state::<ExternalReaderRegistry>();
    let focus = owner.0.lock().unwrap().mark_ready(label)?;
    window.show().map_err(|error| error.to_string())?;
    if focus {
        focus_window(&app, label);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deduplicates_canonical_files_and_preserves_independent_sessions() {
        let mut registry = Registry::new(Some("C:/Books/first.epub".into()));
        assert_eq!(
            registry.route("C:/Books/first.epub".into()),
            Route::Focus("main".into())
        );
        let a = registry.route("C:/Books/second.epub".into());
        let b = registry.route("C:/Books/third.epub".into());
        assert_ne!(a, b);
        assert_eq!(
            registry.route("C:/Books/second.epub".into()),
            Route::Focus("external-reader-1".into())
        );
        assert_eq!(
            registry.claim("main").map(|request| request.file_name),
            Some("first.epub".into())
        );
        assert_eq!(
            registry
                .claim("external-reader-2")
                .map(|request| request.file_name),
            Some("third.epub".into())
        );
    }

    #[test]
    fn keeps_pending_requests_until_acknowledged_and_rejects_stale_closes() {
        let mut registry = Registry::new(None);
        assert_eq!(
            registry.route("first.epub".into()),
            Route::Create("external-reader-1".into())
        );
        assert!(!registry.may_focus("external-reader-1"));
        assert_eq!(
            registry
                .claim("external-reader-1")
                .map(|request| request.file_name),
            Some("first.epub".into())
        );
        assert_eq!(registry.mark_ready("external-reader-1"), Ok(true));
        assert!(registry.may_focus("external-reader-1"));
        registry.retire("external-reader-1");
        assert_eq!(
            registry.route("first.epub".into()),
            Route::Create("external-reader-2".into())
        );
        registry.retire("external-reader-1");
        assert_eq!(
            registry
                .claim("external-reader-2")
                .map(|request| request.file_name),
            Some("first.epub".into())
        );
        assert!(registry.mark_ready("external-reader-1").is_err());
    }

    #[test]
    fn latest_different_file_gets_focus_even_if_an_older_window_becomes_ready_late() {
        let mut registry = Registry::new(None);
        registry.route("first.epub".into());
        registry.route("second.epub".into());
        assert_eq!(registry.mark_ready("external-reader-1"), Ok(false));
        assert_eq!(registry.mark_ready("external-reader-2"), Ok(true));
        assert!(!registry.may_focus("external-reader-1"));
        assert!(registry.may_focus("external-reader-2"));
        registry.route("first.epub".into());
        assert!(registry.may_focus("external-reader-1"));
    }
    #[test]
    fn token_is_scoped_to_its_window_and_rejected_after_close() {
        let directory =
            std::env::temp_dir().join(format!("archeion-reader-token-{}", std::process::id()));
        std::fs::create_dir_all(&directory).unwrap();
        let file = directory.join("A book.epub");
        std::fs::write(&file, b"PK\x03\x04").unwrap();
        let path = std::fs::canonicalize(&file).unwrap();
        let mut registry = Registry::new(Some(path.to_string_lossy().into_owned()));
        let token = registry.claim("main").unwrap().token;
        assert_eq!(registry.selected_path("main", &token).unwrap(), path);
        assert!(registry.selected_path("another-window", &token).is_err());
        assert!(registry.selected_path("main", "unrelated-token").is_err());
        registry.retire("main");
        assert!(registry.selected_path("main", &token).is_err());
        std::fs::remove_dir_all(directory).unwrap();
    }
}
