use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

pub const ABOUT_WINDOW_LABEL: &str = "about";
pub const SETTINGS_WINDOW_LABEL: &str = "settings";
pub const THEME_MANAGER_WINDOW_LABEL: &str = "theme-manager";

const ABOUT_WINDOW_QUERY: &str = "window=about";
const ABOUT_WINDOW_APP_URL: &str = "index.html?window=about";
const ABOUT_WINDOW_WIDTH: f64 = 520.0;
const ABOUT_WINDOW_HEIGHT: f64 = 620.0;
const ABOUT_WINDOW_MIN_WIDTH: f64 = 420.0;
const ABOUT_WINDOW_MIN_HEIGHT: f64 = 420.0;
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
) -> Result<WebviewUrl, String> {
    let (kind, url) = window_url_parts(
        app.config().build.dev_url.as_ref(),
        cfg!(debug_assertions),
        query,
        app_url,
        title,
    )?;

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

fn existing_window_is_unhealthy(window: &tauri::WebviewWindow) -> bool {
    if !cfg!(debug_assertions) {
        return false;
    }

    window
        .url()
        .map(|url| url.as_str() == "about:blank")
        .unwrap_or(true)
}

fn apply_window_constraints(
    window: &tauri::WebviewWindow,
    min_width: f64,
    min_height: f64,
) -> Result<(), String> {
    window
        .set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize::new(
            min_width, min_height,
        ))))
        .map_err(|error| error.to_string())?;
    window
        .set_resizable(true)
        .map_err(|error| error.to_string())
}

fn show_and_focus_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

struct ManagedWindowSpec {
    app_url: &'static str,
    height: f64,
    label: &'static str,
    maximizable: bool,
    min_height: f64,
    min_width: f64,
    query: &'static str,
    title: &'static str,
    width: f64,
}

const ABOUT_WINDOW_SPEC: ManagedWindowSpec = ManagedWindowSpec {
    app_url: ABOUT_WINDOW_APP_URL,
    height: ABOUT_WINDOW_HEIGHT,
    label: ABOUT_WINDOW_LABEL,
    maximizable: false,
    min_height: ABOUT_WINDOW_MIN_HEIGHT,
    min_width: ABOUT_WINDOW_MIN_WIDTH,
    query: ABOUT_WINDOW_QUERY,
    title: "About Archeion",
    width: ABOUT_WINDOW_WIDTH,
};

fn open_managed_window(app: &tauri::AppHandle, spec: ManagedWindowSpec) -> Result<(), String> {
    let existing_window = app.get_webview_window(spec.label);
    let action = window_open_action(existing_window.as_ref().map(existing_window_is_unhealthy));

    match action {
        WindowOpenAction::FocusExisting => {
            let window = existing_window.expect("focus action requires an existing window");
            apply_window_constraints(&window, spec.min_width, spec.min_height)?;
            return show_and_focus_window(&window);
        }
        WindowOpenAction::ReplaceUnhealthy => {
            let window = existing_window.expect("replace action requires an existing window");
            let _ = window.close();
        }
        WindowOpenAction::Create => {}
    }

    let window = WebviewWindowBuilder::new(
        app,
        spec.label,
        managed_window_webview_url(app, spec.query, spec.app_url, spec.title)?,
    )
    .title(spec.title)
    .inner_size(spec.width, spec.height)
    .min_inner_size(spec.min_width, spec.min_height)
    .center()
    .resizable(true)
    .minimizable(true)
    .maximizable(spec.maximizable)
    .decorations(false)
    .closable(true)
    .visible(false)
    .build()
    .map_err(|error| error.to_string())?;

    apply_window_constraints(&window, spec.min_width, spec.min_height)?;
    show_and_focus_window(&window)
}

#[tauri::command]
pub async fn open_about_window(app: tauri::AppHandle) -> Result<(), String> {
    open_managed_window(&app, ABOUT_WINDOW_SPEC)
}

#[tauri::command]
pub async fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    open_managed_window(
        &app,
        ManagedWindowSpec {
            app_url: SETTINGS_WINDOW_APP_URL,
            height: SETTINGS_WINDOW_HEIGHT,
            label: SETTINGS_WINDOW_LABEL,
            maximizable: true,
            min_height: SETTINGS_WINDOW_MIN_HEIGHT,
            min_width: SETTINGS_WINDOW_MIN_WIDTH,
            query: SETTINGS_WINDOW_QUERY,
            title: "Settings",
            width: SETTINGS_WINDOW_WIDTH,
        },
    )
}

#[tauri::command]
pub async fn open_theme_manager_window(app: tauri::AppHandle) -> Result<(), String> {
    open_managed_window(
        &app,
        ManagedWindowSpec {
            app_url: THEME_MANAGER_WINDOW_APP_URL,
            height: THEME_MANAGER_WINDOW_HEIGHT,
            label: THEME_MANAGER_WINDOW_LABEL,
            maximizable: true,
            min_height: THEME_MANAGER_WINDOW_MIN_HEIGHT,
            min_width: THEME_MANAGER_WINDOW_MIN_WIDTH,
            query: THEME_MANAGER_WINDOW_QUERY,
            title: "Theme Manager",
            width: THEME_MANAGER_WINDOW_WIDTH,
        },
    )
}

#[cfg(test)]
mod tests {
    use super::{
        about_window_url_parts, settings_window_url_parts, theme_manager_window_url_parts,
        window_open_action, WindowOpenAction, WindowUrlKind, SETTINGS_WINDOW_HEIGHT,
        SETTINGS_WINDOW_MIN_HEIGHT, SETTINGS_WINDOW_MIN_WIDTH, SETTINGS_WINDOW_WIDTH,
        THEME_MANAGER_WINDOW_HEIGHT, THEME_MANAGER_WINDOW_MIN_HEIGHT,
        THEME_MANAGER_WINDOW_MIN_WIDTH, THEME_MANAGER_WINDOW_WIDTH,
    };

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
