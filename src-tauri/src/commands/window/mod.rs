use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};

pub const SETTINGS_WINDOW_LABEL: &str = "settings";

const SETTINGS_WINDOW_QUERY: &str = "window=settings";
const SETTINGS_WINDOW_APP_URL: &str = "index.html?window=settings";
const SETTINGS_WINDOW_WIDTH: f64 = 1040.0;
const SETTINGS_WINDOW_HEIGHT: f64 = 720.0;
const SETTINGS_WINDOW_MIN_WIDTH: f64 = 640.0;
const SETTINGS_WINDOW_MIN_HEIGHT: f64 = 560.0;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SettingsWindowUrlKind {
    External,
    App,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SettingsWindowOpenAction {
    Create,
    FocusExisting,
    ReplaceUnhealthy,
}

fn settings_window_url_parts(
    dev_url: Option<&tauri::Url>,
    debug_build: bool,
) -> Result<(SettingsWindowUrlKind, String), String> {
    if debug_build {
        let mut url = dev_url
            .cloned()
            .ok_or_else(|| "The Tauri development URL is unavailable.".to_string())?;
        url.set_query(Some(SETTINGS_WINDOW_QUERY));
        return Ok((SettingsWindowUrlKind::External, url.to_string()));
    }

    Ok((
        SettingsWindowUrlKind::App,
        SETTINGS_WINDOW_APP_URL.to_string(),
    ))
}

fn settings_window_webview_url(app: &tauri::AppHandle) -> Result<WebviewUrl, String> {
    let (kind, url) =
        settings_window_url_parts(app.config().build.dev_url.as_ref(), cfg!(debug_assertions))?;

    match kind {
        SettingsWindowUrlKind::External => url
            .parse()
            .map(WebviewUrl::External)
            .map_err(|error| format!("The Settings window URL is invalid: {error}")),
        SettingsWindowUrlKind::App => Ok(WebviewUrl::App(url.into())),
    }
}

fn settings_window_open_action(existing_is_unhealthy: Option<bool>) -> SettingsWindowOpenAction {
    match existing_is_unhealthy {
        None => SettingsWindowOpenAction::Create,
        Some(true) => SettingsWindowOpenAction::ReplaceUnhealthy,
        Some(false) => SettingsWindowOpenAction::FocusExisting,
    }
}

fn existing_settings_window_is_unhealthy(window: &tauri::WebviewWindow) -> bool {
    if !cfg!(debug_assertions) {
        return false;
    }

    window
        .url()
        .map(|url| url.as_str() == "about:blank")
        .unwrap_or(true)
}

fn apply_settings_window_constraints(window: &tauri::WebviewWindow) -> Result<(), String> {
    window
        .set_min_size(Some(tauri::Size::Logical(tauri::LogicalSize::new(
            SETTINGS_WINDOW_MIN_WIDTH,
            SETTINGS_WINDOW_MIN_HEIGHT,
        ))))
        .map_err(|error| error.to_string())?;
    window
        .set_resizable(true)
        .map_err(|error| error.to_string())
}

fn show_and_focus_settings_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    let existing_window = app.get_webview_window(SETTINGS_WINDOW_LABEL);
    let action = settings_window_open_action(
        existing_window
            .as_ref()
            .map(existing_settings_window_is_unhealthy),
    );

    match action {
        SettingsWindowOpenAction::FocusExisting => {
            let window = existing_window.expect("focus action requires an existing window");
            apply_settings_window_constraints(&window)?;
            return show_and_focus_settings_window(&window);
        }
        SettingsWindowOpenAction::ReplaceUnhealthy => {
            let window = existing_window.expect("replace action requires an existing window");
            let _ = window.close();
        }
        SettingsWindowOpenAction::Create => {}
    }

    let window = WebviewWindowBuilder::new(
        &app,
        SETTINGS_WINDOW_LABEL,
        settings_window_webview_url(&app)?,
    )
    .title("Settings")
    .inner_size(SETTINGS_WINDOW_WIDTH, SETTINGS_WINDOW_HEIGHT)
    .min_inner_size(SETTINGS_WINDOW_MIN_WIDTH, SETTINGS_WINDOW_MIN_HEIGHT)
    .center()
    .resizable(true)
    .minimizable(true)
    .maximizable(true)
    .decorations(false)
    .closable(true)
    .visible(false)
    .build()
    .map_err(|error| error.to_string())?;

    apply_settings_window_constraints(&window)?;
    show_and_focus_settings_window(&window)
}

#[cfg(test)]
mod tests {
    use super::{
        settings_window_open_action, settings_window_url_parts, SettingsWindowOpenAction,
        SettingsWindowUrlKind, SETTINGS_WINDOW_HEIGHT, SETTINGS_WINDOW_MIN_HEIGHT,
        SETTINGS_WINDOW_MIN_WIDTH, SETTINGS_WINDOW_WIDTH,
    };

    #[test]
    fn settings_window_lifecycle_creates_focuses_or_replaces_one_window() {
        assert_eq!(
            settings_window_open_action(None),
            SettingsWindowOpenAction::Create
        );
        assert_eq!(
            settings_window_open_action(Some(false)),
            SettingsWindowOpenAction::FocusExisting
        );
        assert_eq!(
            settings_window_open_action(Some(true)),
            SettingsWindowOpenAction::ReplaceUnhealthy
        );
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

        assert_eq!(kind, SettingsWindowUrlKind::External);
        assert_eq!(url, "http://localhost:1420/?window=settings");
    }

    #[test]
    fn settings_window_production_url_uses_bundled_entry_with_mode_marker() {
        let (kind, url) =
            settings_window_url_parts(None, false).expect("production Settings URL should resolve");

        assert_eq!(kind, SettingsWindowUrlKind::App);
        assert_eq!(url, "index.html?window=settings");
    }

    #[test]
    fn settings_window_debug_url_requires_the_dev_server() {
        let error = settings_window_url_parts(None, true)
            .expect_err("debug Settings URL requires a dev URL");

        assert!(error.contains("development URL"));
    }
}
