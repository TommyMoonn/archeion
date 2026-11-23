#[cfg(windows)]
use std::path::Path;
use std::{collections::HashMap, sync::Mutex};
use tauri::Manager;
#[cfg(windows)]
use tauri::{WebviewUrl, WebviewWindowBuilder};

#[cfg(windows)]
use super::cold_start_epub::resolve_cold_start_epub_in;

#[cfg(any(windows, test))]
const READER_LABEL_PREFIX: &str = "external-reader-";

struct ReaderSession {
    path: String,
    ready: bool,
}

#[derive(Default)]
struct Registry {
    #[cfg(any(windows, test))]
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
            registry
                .sessions
                .insert("main".into(), ReaderSession { path, ready: true });
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
        self.sessions
            .insert(label.clone(), ReaderSession { path, ready: false });
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

    fn claim(&self, label: &str) -> Option<String> {
        self.sessions.get(label).map(|session| session.path.clone())
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

    pub fn file_for_window(&self, label: &str) -> Option<String> {
        self.0.lock().unwrap().claim(label)
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
        assert_eq!(registry.claim("main"), Some("C:/Books/first.epub".into()));
        assert_eq!(
            registry.claim("external-reader-2"),
            Some("C:/Books/third.epub".into())
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
            registry.claim("external-reader-1"),
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
            registry.claim("external-reader-2"),
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
}
