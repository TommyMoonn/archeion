use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

mod placement;
mod readiness;
pub use readiness::ManagedWindowState;

const SHELL_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(15);

pub const ABOUT_WINDOW_LABEL: &str = "about";
pub const SETTINGS_WINDOW_LABEL: &str = "settings";
pub const THEME_MANAGER_WINDOW_LABEL: &str = "theme-manager";
pub const ARCHIVE_MANAGER_WINDOW_LABEL: &str = "archive-manager";

const ABOUT_WINDOW_QUERY: &str = "window=about";
const ABOUT_WINDOW_APP_URL: &str = "index.html?window=about";
const ABOUT_WINDOW_WIDTH: f64 = 520.0;
const ABOUT_WINDOW_HEIGHT: f64 = 620.0;
const ABOUT_WINDOW_MIN_WIDTH: f64 = ABOUT_WINDOW_WIDTH;
const ABOUT_WINDOW_MIN_HEIGHT: f64 = ABOUT_WINDOW_HEIGHT;
const SETTINGS_WINDOW_QUERY: &str = "window=settings";
const SETTINGS_WINDOW_APP_URL: &str = "index.html?window=settings";
const SETTINGS_WINDOW_WIDTH: f64 = 1040.0;
const SETTINGS_WINDOW_HEIGHT: f64 = 720.0;
const SETTINGS_WINDOW_MIN_WIDTH: f64 = 640.0;
const SETTINGS_WINDOW_MIN_HEIGHT: f64 = 560.0;
const THEME_MANAGER_WINDOW_QUERY: &str = "window=theme-manager";
const THEME_MANAGER_WINDOW_APP_URL: &str = "index.html?window=theme-manager";
const THEME_MANAGER_WINDOW_WIDTH: f64 = 1080.0;
const THEME_MANAGER_WINDOW_HEIGHT: f64 = 760.0;
const THEME_MANAGER_WINDOW_MIN_WIDTH: f64 = 760.0;
const THEME_MANAGER_WINDOW_MIN_HEIGHT: f64 = 560.0;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WindowUrlKind {
    External,
    App,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum WindowOpenAction {
    Create,
    FocusExisting,
    ReplaceUnhealthy,
}

#[cfg(test)]
fn about_window_url_parts(
    dev_url: Option<&tauri::Url>,
    debug_build: bool,
) -> Result<(WindowUrlKind, String), String> {
    window_url_parts(
        dev_url,
        debug_build,
        ABOUT_WINDOW_QUERY,
        ABOUT_WINDOW_APP_URL,
        "About",
    )
}

#[cfg(test)]
fn settings_window_url_parts(
    dev_url: Option<&tauri::Url>,
    debug_build: bool,
) -> Result<(WindowUrlKind, String), String> {
    window_url_parts(
        dev_url,
        debug_build,
        SETTINGS_WINDOW_QUERY,
        SETTINGS_WINDOW_APP_URL,
        "Settings",
    )
}

#[cfg(test)]
fn theme_manager_window_url_parts(
    dev_url: Option<&tauri::Url>,
    debug_build: bool,
) -> Result<(WindowUrlKind, String), String> {
    window_url_parts(
        dev_url,
        debug_build,
        THEME_MANAGER_WINDOW_QUERY,
        THEME_MANAGER_WINDOW_APP_URL,
        "Theme Manager",
    )
}

fn window_url_parts(
    dev_url: Option<&tauri::Url>,
    debug_build: bool,
    query: &str,
    app_url: &str,
    title: &str,
) -> Result<(WindowUrlKind, String), String> {
    if debug_build {
        let mut url = dev_url
            .cloned()
            .ok_or_else(|| "The Tauri development URL is unavailable.".to_string())?;
        url.set_query(Some(query));
        return Ok((WindowUrlKind::External, url.to_string()));
    }

    if app_url.is_empty() {
        return Err(format!("The {title} window URL is unavailable."));
    }
    Ok((WindowUrlKind::App, app_url.to_string()))
}

fn managed_window_webview_url(
    app: &tauri::AppHandle,
    query: &str,
    app_url: &str,
    title: &str,
    generation: u64,
) -> Result<WebviewUrl, String> {
    let (kind, url) = window_url_parts(
        app.config().build.dev_url.as_ref(),
        cfg!(debug_assertions),
        query,
        app_url,
        title,
    )?;

    let url = format!("{url}&windowInstance={generation}");
    match kind {
        WindowUrlKind::External => url
            .parse()
            .map(WebviewUrl::External)
            .map_err(|error| format!("The {title} window URL is invalid: {error}")),
        WindowUrlKind::App => Ok(WebviewUrl::App(url.into())),
    }
}

fn window_open_action(existing_is_unhealthy: Option<bool>) -> WindowOpenAction {
    match existing_is_unhealthy {
        None => WindowOpenAction::Create,
        Some(true) => WindowOpenAction::ReplaceUnhealthy,
        Some(false) => WindowOpenAction::FocusExisting,
    }
}

fn window_instance_matches(url: &tauri::Url, generation: u64) -> bool {
    url.query_pairs()
        .any(|(key, value)| key == "windowInstance" && value == generation.to_string())
}

fn existing_window_is_unhealthy(window: &tauri::WebviewWindow, generation: Option<u64>) -> bool {
    window
        .url()
        .map(|url| generation.is_none_or(|generation| !window_instance_matches(&url, generation)))
        .unwrap_or(true)
}

fn apply_window_constraints(
    window: &tauri::WebviewWindow,
    spec: &ManagedWindowSpec,
) -> Result<(), String> {
    let (min_width, min_height) = if spec.resizable {
        (spec.min_width, spec.min_height)
    } else {
        window
            .set_size(tauri::Size::Logical(tauri::LogicalSize::new(
                spec.width,
                spec.height,
            )))
            .map_err(|error| error.to_string())?;
        window
            .set_max_size(Some(tauri::Size::Logical(tauri::LogicalSize::new(
                spec.width,
                spec.height,
            ))))
            .map_err(|error| error.to_string())?;
        (spec.width, spec.height)
    };

    window
        .set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize::new(
            min_width, min_height,
        ))))
        .map_err(|error| error.to_string())?;
    window
        .set_resizable(spec.resizable)
        .map_err(|error| error.to_string())
}

struct ManagedWindowSpec {
    app_url: &'static str,
    height: f64,
    label: &'static str,
    maximizable: bool,
    min_height: f64,
    min_width: f64,
    query: &'static str,
    resizable: bool,
    title: &'static str,
    width: f64,
}

fn about_window_spec() -> ManagedWindowSpec {
    ManagedWindowSpec {
        app_url: ABOUT_WINDOW_APP_URL,
        height: ABOUT_WINDOW_HEIGHT,
        label: ABOUT_WINDOW_LABEL,
        maximizable: false,
        min_height: ABOUT_WINDOW_MIN_HEIGHT,
        min_width: ABOUT_WINDOW_MIN_WIDTH,
        query: ABOUT_WINDOW_QUERY,
        resizable: false,
        title: "About Archeion",
        width: ABOUT_WINDOW_WIDTH,
    }
}

async fn open_managed_window(
    app: &tauri::AppHandle,
    spec: ManagedWindowSpec,
) -> Result<(), String> {
    let owner = app.state::<ManagedWindowState>();
    let operation = owner.operations.lock().await;
    owner.readiness.lock().unwrap().request_focus(spec.label);
    let existing_window = app.get_webview_window(spec.label);
    let generation = owner
        .readiness
        .lock()
        .unwrap()
        .current(spec.label)
        .map(|(generation, _)| generation);
    let action = window_open_action(
        existing_window
            .as_ref()
            .map(|window| existing_window_is_unhealthy(window, generation)),
    );

    match action {
        WindowOpenAction::FocusExisting => {
            let current = owner.readiness.lock().unwrap().current(spec.label);
            if let Some((generation, receiver)) = current {
                if receiver.borrow().is_some() {
                    project_ready_window(app, spec.label.to_string(), generation, false).await?;
                }
                drop(operation);
                return readiness::wait_for_shell(receiver).await;
            }
            // A close callback retired the instance after the health check.
            // This outstanding request must not recreate the user's closed window.
            return Err("The window was closed before it was ready.".to_string());
        }
        WindowOpenAction::ReplaceUnhealthy => {
            let window = existing_window.expect("replace action requires an existing window");
            let current = owner.readiness.lock().unwrap().current(spec.label);
            if let Some((generation, _)) = current {
                owner.readiness.lock().unwrap().retire(
                    spec.label,
                    generation,
                    "The window was replaced.",
                );
            }
            window.destroy().map_err(|error| error.to_string())?;
        }
        WindowOpenAction::Create => {}
    }

    let (generation, receiver) = owner.readiness.lock().unwrap().reserve(spec.label);
    let result = (|| {
        let builder = WebviewWindowBuilder::new(
            app,
            spec.label,
            managed_window_webview_url(app, spec.query, spec.app_url, spec.title, generation)?,
        )
        .title(spec.title)
        .inner_size(spec.width, spec.height)
        .resizable(spec.resizable)
        .minimizable(true)
        .maximizable(spec.maximizable)
        .decorations(false)
        .closable(true)
        .background_color(super::app_appearance::native_background(app))
        .focused(false)
        .visible(false);

        let builder = if spec.resizable {
            builder.min_inner_size(spec.min_width, spec.min_height)
        } else {
            builder
                .min_inner_size(spec.width, spec.height)
                .max_inner_size(spec.width, spec.height)
        };

        let window = builder.build().map_err(|error| error.to_string())?;

        let event_app = app.clone();
        let label = spec.label;
        let closing = std::sync::atomic::AtomicBool::new(false);
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                let retired = event_app
                    .state::<ManagedWindowState>()
                    .readiness
                    .lock()
                    .unwrap()
                    .retire(
                        label,
                        generation,
                        "The window was closed before it was ready.",
                    );
                closing.fetch_or(retired, std::sync::atomic::Ordering::Relaxed);
            }
            if matches!(event, tauri::WindowEvent::Destroyed) {
                let retired = event_app
                    .state::<ManagedWindowState>()
                    .readiness
                    .lock()
                    .unwrap()
                    .retire(
                        label,
                        generation,
                        "The window was closed before it was ready.",
                    );
                if (retired || closing.load(std::sync::atomic::Ordering::Relaxed))
                    && label == "archive-manager"
                {
                    super::archive::handle_archive_manager_window_destroyed(&event_app);
                }
            }
        });
        apply_window_constraints(&window, &spec)?;
        Ok::<_, String>(())
    })();
    if let Err(error) = result {
        owner
            .readiness
            .lock()
            .unwrap()
            .retire(spec.label, generation, &error);
        if let Some(window) = app.get_webview_window(spec.label) {
            let _ = window.destroy();
        }
        return Err(error);
    }
    let timeout_app = app.clone();
    let label = spec.label;
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SHELL_TIMEOUT).await;
        let owner = timeout_app.state::<ManagedWindowState>();
        let schedule_app = timeout_app.clone();
        let dispose_app = timeout_app.clone();
        owner
            .expire(
                label,
                generation,
                move |action| {
                    schedule_app
                        .run_on_main_thread(action)
                        .map_err(|error| error.to_string())
                },
                move || {
                    if let Some(window) = dispose_app.get_webview_window(label) {
                        let _ = window.destroy();
                    }
                },
            )
            .await;
    });
    drop(operation);
    readiness::wait_for_shell(receiver).await
}

async fn project_ready_window(
    app: &tauri::AppHandle,
    label: String,
    generation: u64,
    first: bool,
) -> Result<(), String> {
    let (complete, completed) = tokio::sync::oneshot::channel();
    let current_app = app.clone();
    app.run_on_main_thread(move || {
        let result = (|| {
            let owner = current_app.state::<ManagedWindowState>();
            let state = owner.readiness.lock().unwrap();
            let Some((current, _)) = state.current(&label) else {
                return Ok(());
            };
            if current != generation || (first && !state.is_pending(&label, generation)) {
                return Ok(());
            }
            let window = current_app
                .get_webview_window(&label)
                .ok_or("The window was closed.")?;
            // The caller is a WebView, but its label can be reused. Validate the
            // URL token again on the UI queue before any visible side effect.
            let url = window.url().map_err(|error| error.to_string())?;
            if !window_instance_matches(&url, generation) {
                return Err("The window instance is no longer current.".to_string());
            }
            let focus = state.owns_focus(&label);
            drop(state);
            if focus && !first && window.is_minimized().map_err(|error| error.to_string())? {
                window.unminimize().map_err(|error| error.to_string())?;
            }
            let spec = managed_window_spec(&label).ok_or("Unknown managed window.")?;
            placement::prepare_reveal(&current_app, &window, &spec, first)?;
            window.show().map_err(|error| error.to_string())?;
            if focus {
                window.set_focus().map_err(|error| error.to_string())?;
            }
            owner.readiness.lock().unwrap().complete(&label, generation);
            Ok(())
        })();
        let _ = complete.send(result);
    })
    .map_err(|error| error.to_string())?;
    completed
        .await
        .map_err(|_| "The window reveal was cancelled.".to_string())?
}

pub(crate) fn handle_window_focus(app: &tauri::AppHandle) {
    app.state::<ManagedWindowState>()
        .readiness
        .lock()
        .unwrap()
        .user_focused_window();
}

#[tauri::command]
pub async fn managed_window_shell_ready(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    instance: String,
) -> Result<(), String> {
    let generation = instance
        .parse::<u64>()
        .map_err(|_| "Invalid window instance.".to_string())?;
    let owner = app.state::<ManagedWindowState>();
    let _operation = owner.operations.lock().await;
    project_ready_window(&app, window.label().to_string(), generation, true).await
}

fn archive_manager_window_spec() -> ManagedWindowSpec {
    ManagedWindowSpec {
        app_url: "index.html?window=archive-manager",
        query: "window=archive-manager",
        label: ARCHIVE_MANAGER_WINDOW_LABEL,
        title: "Archive Manager",
        width: 860.0,
        height: 620.0,
        min_width: 860.0,
        min_height: 620.0,
        maximizable: false,
        resizable: false,
    }
}

pub(super) async fn open_archive_manager(app: &tauri::AppHandle) -> Result<(), String> {
    open_managed_window(app, archive_manager_window_spec()).await
}

#[tauri::command]
pub async fn open_about_window(app: tauri::AppHandle) -> Result<(), String> {
    open_managed_window(&app, about_window_spec()).await
}

#[tauri::command]
pub async fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    open_managed_window(&app, settings_window_spec()).await
}

fn settings_window_spec() -> ManagedWindowSpec {
    ManagedWindowSpec {
        app_url: SETTINGS_WINDOW_APP_URL,
        height: SETTINGS_WINDOW_HEIGHT,
        label: SETTINGS_WINDOW_LABEL,
        maximizable: true,
        min_height: SETTINGS_WINDOW_MIN_HEIGHT,
        min_width: SETTINGS_WINDOW_MIN_WIDTH,
        query: SETTINGS_WINDOW_QUERY,
        resizable: true,
        title: "Settings",
        width: SETTINGS_WINDOW_WIDTH,
    }
}

#[tauri::command]
pub async fn open_theme_manager_window(app: tauri::AppHandle) -> Result<(), String> {
    open_managed_window(&app, theme_manager_window_spec()).await
}

fn theme_manager_window_spec() -> ManagedWindowSpec {
    ManagedWindowSpec {
        app_url: THEME_MANAGER_WINDOW_APP_URL,
        height: THEME_MANAGER_WINDOW_HEIGHT,
        label: THEME_MANAGER_WINDOW_LABEL,
        maximizable: true,
        min_height: THEME_MANAGER_WINDOW_MIN_HEIGHT,
        min_width: THEME_MANAGER_WINDOW_MIN_WIDTH,
        query: THEME_MANAGER_WINDOW_QUERY,
        resizable: true,
        title: "Theme Manager",
        width: THEME_MANAGER_WINDOW_WIDTH,
    }
}

fn managed_window_spec(label: &str) -> Option<ManagedWindowSpec> {
    match label {
        ABOUT_WINDOW_LABEL => Some(about_window_spec()),
        SETTINGS_WINDOW_LABEL => Some(settings_window_spec()),
        THEME_MANAGER_WINDOW_LABEL => Some(theme_manager_window_spec()),
        ARCHIVE_MANAGER_WINDOW_LABEL => Some(archive_manager_window_spec()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        about_window_spec, about_window_url_parts, settings_window_url_parts,
        theme_manager_window_url_parts, window_open_action, WindowOpenAction, WindowUrlKind,
        ABOUT_WINDOW_HEIGHT, ABOUT_WINDOW_MIN_HEIGHT, ABOUT_WINDOW_MIN_WIDTH, ABOUT_WINDOW_WIDTH,
        SETTINGS_WINDOW_HEIGHT, SETTINGS_WINDOW_MIN_HEIGHT, SETTINGS_WINDOW_MIN_WIDTH,
        SETTINGS_WINDOW_WIDTH, THEME_MANAGER_WINDOW_HEIGHT, THEME_MANAGER_WINDOW_MIN_HEIGHT,
        THEME_MANAGER_WINDOW_MIN_WIDTH, THEME_MANAGER_WINDOW_WIDTH,
    };

    #[test]
    fn readiness_identity_rejects_blank_and_replaced_webviews() {
        assert!(!super::window_instance_matches(
            &tauri::Url::parse("about:blank").unwrap(),
            4
        ));
        let url =
            tauri::Url::parse("http://tauri.localhost/index.html?window=settings&windowInstance=4")
                .unwrap();
        assert!(super::window_instance_matches(&url, 4));
        assert!(!super::window_instance_matches(&url, 5));
    }

    #[test]
    fn archive_manager_keeps_fixed_geometry_and_mode_in_shared_builder() {
        let spec = super::archive_manager_window_spec();
        assert_eq!((spec.width, spec.height), (860.0, 620.0));
        assert_eq!((spec.min_width, spec.min_height), (spec.width, spec.height));
        assert!(!spec.resizable && !spec.maximizable);
        let dev = tauri::Url::parse("http://localhost:1420").unwrap();
        for (debug, expected) in [
            (true, "http://localhost:1420/?window=archive-manager"),
            (false, "index.html?window=archive-manager"),
        ] {
            let (_, url) =
                super::window_url_parts(Some(&dev), debug, spec.query, spec.app_url, spec.title)
                    .unwrap();
            assert_eq!(url, expected);
        }
        assert!(super::window_url_parts(None, true, spec.query, spec.app_url, spec.title).is_err());
    }

    #[test]
    fn managed_window_lifecycle_creates_focuses_or_replaces_one_window() {
        assert_eq!(window_open_action(None), WindowOpenAction::Create);
        assert_eq!(
            window_open_action(Some(false)),
            WindowOpenAction::FocusExisting
        );
        assert_eq!(
            window_open_action(Some(true)),
            WindowOpenAction::ReplaceUnhealthy
        );
    }

    #[test]
    fn about_window_dev_url_uses_external_server_with_mode_marker() {
        let dev_url = tauri::Url::parse("http://localhost:1420").expect("dev URL should parse");

        let (kind, url) =
            about_window_url_parts(Some(&dev_url), true).expect("debug About URL should resolve");

        assert_eq!(kind, WindowUrlKind::External);
        assert_eq!(url, "http://localhost:1420/?window=about");
    }

    #[test]
    fn about_window_production_url_uses_bundled_entry_with_mode_marker() {
        let (kind, url) =
            about_window_url_parts(None, false).expect("production About URL should resolve");

        assert_eq!(kind, WindowUrlKind::App);
        assert_eq!(url, "index.html?window=about");
    }

    #[test]
    fn about_window_uses_one_fixed_supported_size() {
        let spec = about_window_spec();

        assert_eq!(
            (ABOUT_WINDOW_MIN_WIDTH, ABOUT_WINDOW_MIN_HEIGHT),
            (ABOUT_WINDOW_WIDTH, ABOUT_WINDOW_HEIGHT)
        );
        assert!(!spec.resizable);
    }

    #[test]
    fn settings_window_uses_supported_geometry_and_minimum_size() {
        assert_eq!(
            (SETTINGS_WINDOW_WIDTH, SETTINGS_WINDOW_HEIGHT),
            (1040.0, 720.0)
        );
        assert_eq!(
            (SETTINGS_WINDOW_MIN_WIDTH, SETTINGS_WINDOW_MIN_HEIGHT),
            (640.0, 560.0)
        );
    }

    #[test]
    fn settings_window_dev_url_uses_external_server_with_mode_marker() {
        let dev_url = tauri::Url::parse("http://localhost:1420").expect("dev URL should parse");

        let (kind, url) = settings_window_url_parts(Some(&dev_url), true)
            .expect("debug Settings URL should resolve");

        assert_eq!(kind, WindowUrlKind::External);
        assert_eq!(url, "http://localhost:1420/?window=settings");
    }

    #[test]
    fn settings_window_production_url_uses_bundled_entry_with_mode_marker() {
        let (kind, url) =
            settings_window_url_parts(None, false).expect("production Settings URL should resolve");

        assert_eq!(kind, WindowUrlKind::App);
        assert_eq!(url, "index.html?window=settings");
    }

    #[test]
    fn settings_window_debug_url_requires_the_dev_server() {
        let error = settings_window_url_parts(None, true)
            .expect_err("debug Settings URL requires a dev URL");

        assert!(error.contains("development URL"));
    }

    #[test]
    fn theme_manager_window_uses_supported_geometry_and_minimum_size() {
        assert_eq!(
            (THEME_MANAGER_WINDOW_WIDTH, THEME_MANAGER_WINDOW_HEIGHT),
            (1080.0, 760.0)
        );
        assert_eq!(
            (
                THEME_MANAGER_WINDOW_MIN_WIDTH,
                THEME_MANAGER_WINDOW_MIN_HEIGHT
            ),
            (760.0, 560.0)
        );
    }

    #[test]
    fn theme_manager_window_dev_url_uses_external_server_with_mode_marker() {
        let dev_url = tauri::Url::parse("http://localhost:1420").expect("dev URL should parse");

        let (kind, url) = theme_manager_window_url_parts(Some(&dev_url), true)
            .expect("debug Theme Manager URL should resolve");

        assert_eq!(kind, WindowUrlKind::External);
        assert_eq!(url, "http://localhost:1420/?window=theme-manager");
    }

    #[test]
    fn theme_manager_window_production_url_uses_bundled_entry_with_mode_marker() {
        let (kind, url) = theme_manager_window_url_parts(None, false)
            .expect("production Theme Manager URL should resolve");

        assert_eq!(kind, WindowUrlKind::App);
        assert_eq!(url, "index.html?window=theme-manager");
    }
}
