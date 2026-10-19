use std::sync::{Mutex, MutexGuard, OnceLock};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::Manager;

use super::app_settings::{
    AppSettingsService, AppSettingsSnapshot, AppThemeSelection, BuiltInAppThemeId,
};
use super::themes::{
    read_theme_manifest_at, resolve_app_data_root, ThemeCatalogService, MAX_THEME_MANIFEST_BYTES,
};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub(crate) struct ShellPalette {
    background: String,
    foreground: String,
}

#[derive(Clone, Deserialize, Serialize)]
struct ShellPalettes {
    dark: ShellPalette,
    light: ShellPalette,
}

fn palettes() -> &'static ShellPalettes {
    static PALETTES: OnceLock<ShellPalettes> = OnceLock::new();
    PALETTES.get_or_init(|| {
        serde_json::from_str(include_str!("../../../src/themes/appShellPalettes.json"))
            .expect("built-in shell palettes must be valid")
    })
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AppearancePresentation {
    selection: AppThemeSelection,
    settings_revision: u64,
    base: String,
    background: String,
    foreground: String,
    manifest_source: Option<String>,
}

struct PreparedPresentation {
    selection: AppThemeSelection,
    base: String,
    palette: ShellPalette,
    manifest_digest: Option<Vec<u8>>,
    catalog_revision: u64,
}

/// One process-local derived presentation. Canonical settings and catalog remain authoritative.
#[derive(Default)]
pub struct AppAppearanceService {
    state: Mutex<AppAppearanceState>,
}

#[derive(Default)]
struct AppAppearanceState {
    prepared: Option<PreparedPresentation>,
    system_scheme: Option<tauri::Theme>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PrepaintSnapshot {
    schema_version: u8,
    settings_revision: u64,
    selection: AppThemeSelection,
    base: String,
    #[serde(flatten)]
    palette: ShellPalette,
    #[serde(flatten)]
    system: ShellPalettes,
}

fn digest(source: Option<&str>) -> Option<Vec<u8>> {
    source.map(|text| Sha256::digest(text.as_bytes()).to_vec())
}

fn opaque_color(value: &str) -> bool {
    value.len() == 7
        && value.starts_with('#')
        && value.as_bytes()[1..].iter().all(u8::is_ascii_hexdigit)
}

impl AppAppearanceService {
    fn lock_state(&self) -> Result<MutexGuard<'_, AppAppearanceState>, String> {
        self.state
            .lock()
            .map_err(|_| "Appearance presentation state is unavailable.".into())
    }

    fn needs_system_initialization(&self) -> Result<bool, String> {
        Ok(self.lock_state()?.system_scheme.is_none())
    }

    fn initialize_system_scheme(&self, theme: tauri::Theme) -> Result<(), String> {
        // One native bootstrap observation may seed the state. An event, or another
        // completed native initialization, permanently retires outstanding seeds.
        self.lock_state()?.system_scheme.get_or_insert(theme);
        Ok(())
    }

    fn observe_system_event(&self, event: &tauri::WindowEvent) -> Result<(), String> {
        if let tauri::WindowEvent::ThemeChanged(theme) = event {
            // Native window events are serialized by the application event loop.
            // Frontend preparations never write this observation, regardless of
            // their window, lifecycle, settings revision or completion order.
            self.lock_state()?.system_scheme = Some(*theme);
        }
        Ok(())
    }

    fn prepare(
        &self,
        settings: &AppSettingsSnapshot,
        catalog_revision: u64,
        current_manifest: Option<&str>,
        value: AppearancePresentation,
    ) -> Result<(), String> {
        if value.settings_revision > settings.revision
            || value.selection != settings.preferences.app_theme
        {
            return Err("Appearance selection changed before presentation was prepared.".into());
        }
        if !opaque_color(&value.background)
            || !opaque_color(&value.foreground)
            || !matches!(value.base.as_str(), "dark" | "light")
        {
            return Err("Appearance presentation contains invalid shell colors.".into());
        }
        if let Some(source) = value.manifest_source.as_deref() {
            if !matches!(value.selection, AppThemeSelection::Custom { .. })
                || source.len() > MAX_THEME_MANIFEST_BYTES
                || Some(source) != current_manifest
            {
                return Err(
                    "The validated theme package changed before presentation was prepared.".into(),
                );
            }
        } else {
            let expected = match &value.selection {
                AppThemeSelection::Builtin {
                    id: BuiltInAppThemeId::Light,
                } => &palettes().light,
                AppThemeSelection::System if value.base == "light" => &palettes().light,
                _ => &palettes().dark,
            };
            if value.background != expected.background || value.foreground != expected.foreground {
                return Err(
                    "Unvalidated appearance presentation is not a built-in fallback.".into(),
                );
            }
        }
        let mut state = self.lock_state()?;
        if matches!(value.selection, AppThemeSelection::System) {
            let requested = if value.base == "light" {
                tauri::Theme::Light
            } else {
                tauri::Theme::Dark
            };
            if state.system_scheme != Some(requested) {
                return Err(
                    "The native system appearance changed before presentation was prepared.".into(),
                );
            }
        }
        state.prepared = Some(PreparedPresentation {
            selection: value.selection,
            base: value.base,
            palette: ShellPalette {
                background: value.background,
                foreground: value.foreground,
            },
            manifest_digest: digest(current_manifest),
            catalog_revision,
        });
        Ok(())
    }

    fn snapshot(
        &self,
        settings: &AppSettingsSnapshot,
        catalog_revision: u64,
        current_manifest: Option<&str>,
    ) -> Result<PrepaintSnapshot, String> {
        let state = self.lock_state()?;
        let system_light = state.system_scheme == Some(tauri::Theme::Light);
        let (mut base, mut palette) = match settings.preferences.app_theme {
            AppThemeSelection::Builtin {
                id: BuiltInAppThemeId::Light,
            } => ("light".to_string(), palettes().light.clone()),
            AppThemeSelection::System if system_light => {
                ("light".to_string(), palettes().light.clone())
            }
            _ => ("dark".to_string(), palettes().dark.clone()),
        };
        if matches!(
            settings.preferences.app_theme,
            AppThemeSelection::Custom { .. }
        ) {
            if let Some(prepared) = state.prepared.as_ref() {
                if prepared.selection == settings.preferences.app_theme
                    && prepared.catalog_revision == catalog_revision
                    && prepared.manifest_digest == digest(current_manifest)
                {
                    base.clone_from(&prepared.base);
                    palette = prepared.palette.clone();
                }
            }
        }
        Ok(PrepaintSnapshot {
            schema_version: 1,
            settings_revision: settings.revision,
            selection: settings.preferences.app_theme.clone(),
            base,
            palette,
            system: palettes().clone(),
        })
    }

    fn native_background(
        &self,
        settings: &AppSettingsSnapshot,
        catalog_revision: u64,
        current_manifest: Option<&str>,
    ) -> Result<tauri::window::Color, String> {
        self.snapshot(settings, catalog_revision, current_manifest)
            .map(|snapshot| palette_color(&snapshot.palette))
    }
}

fn current_manifest(app: &tauri::AppHandle, selection: &AppThemeSelection) -> Option<String> {
    let AppThemeSelection::Custom { id } = selection else {
        return None;
    };
    read_theme_manifest_at(&resolve_app_data_root(app).ok()?, id).ok()
}

fn settings(app: &tauri::AppHandle) -> Result<AppSettingsSnapshot, String> {
    app.try_state::<AppSettingsService>()
        .ok_or("Canonical appearance settings are unavailable.")?
        .snapshot()
}

fn catalog_revision(app: &tauri::AppHandle) -> Result<u64, String> {
    Ok(app
        .try_state::<ThemeCatalogService>()
        .ok_or("Theme catalog is unavailable.")?
        .snapshot()?
        .revision)
}

struct PresentationContext {
    settings: AppSettingsSnapshot,
    catalog_revision: u64,
    manifest: Option<String>,
}

fn presentation_context(app: &tauri::AppHandle) -> Result<PresentationContext, String> {
    let settings = settings(app)?;
    let manifest = current_manifest(app, &settings.preferences.app_theme);
    Ok(PresentationContext {
        settings,
        catalog_revision: catalog_revision(app)?,
        manifest,
    })
}

pub(crate) fn prepaint_snapshot(app: &tauri::AppHandle) -> Result<PrepaintSnapshot, String> {
    let context = presentation_context(app)?;
    app.state::<AppAppearanceService>().snapshot(
        &context.settings,
        context.catalog_revision,
        context.manifest.as_deref(),
    )
}

fn palette_color(palette: &ShellPalette) -> tauri::window::Color {
    let color = &palette.background;
    tauri::window::Color(
        u8::from_str_radix(&color[1..3], 16).expect("validated red"),
        u8::from_str_radix(&color[3..5], 16).expect("validated green"),
        u8::from_str_radix(&color[5..7], 16).expect("validated blue"),
        255,
    )
}

pub(crate) fn native_background(app: &tauri::AppHandle) -> tauri::window::Color {
    presentation_context(app)
        .and_then(|context| {
            app.state::<AppAppearanceService>().native_background(
                &context.settings,
                context.catalog_revision,
                context.manifest.as_deref(),
            )
        })
        .unwrap_or_else(|_| palette_color(&palettes().dark))
}

pub(crate) fn synchronize_native_backgrounds(app: &tauri::AppHandle) {
    for (label, window) in app.webview_windows() {
        if matches!(
            label.as_str(),
            "main" | "settings" | "about" | "theme-manager" | "archive-manager"
        ) {
            if let Err(error) = window.set_background_color(Some(native_background(app))) {
                eprintln!("appearance background could not be applied: {error}");
            }
        }
    }
}

pub(crate) fn system_scheme_changed(app: &tauri::AppHandle, theme: tauri::Theme) {
    if let Err(error) = app
        .state::<AppAppearanceService>()
        .observe_system_event(&tauri::WindowEvent::ThemeChanged(theme))
    {
        eprintln!("native system appearance could not be observed: {error}");
    }
    synchronize_native_backgrounds(app);
}

async fn commit_command_presentation(
    app: &tauri::AppHandle,
    presentation: AppearancePresentation,
) -> Result<(), String> {
    let (complete, completed) = tokio::sync::oneshot::channel();
    let current_app = app.clone();
    app.run_on_main_thread(move || {
        // Revalidate and commit on the UI queue, never capture old canonical
        // settings or a color. Settings changes, native events and application
        // then share one order, including non-system selection supersession.
        let result = (|| {
            let context = presentation_context(&current_app)?;
            current_app.state::<AppAppearanceService>().prepare(
                &context.settings,
                context.catalog_revision,
                context.manifest.as_deref(),
                presentation,
            )?;
            synchronize_native_backgrounds(&current_app);
            Ok(())
        })();
        let _ = complete.send(result);
    })
    .map_err(|error| format!("Native appearance could not be scheduled: {error}"))?;
    completed
        .await
        .map_err(|_| "Native appearance application was cancelled.".to_string())?
}

#[tauri::command]
pub async fn prepare_app_appearance(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    service: tauri::State<'_, AppAppearanceService>,
    presentation: AppearancePresentation,
) -> Result<(), String> {
    if matches!(presentation.selection, AppThemeSelection::System)
        && service.needs_system_initialization()?
    {
        // This IPC future, unlike the synchronous prepaint protocol or a native
        // navigation callback, may wait for a UI getter from the blocking pool.
        // Never hold the state lock while dispatching to the native UI thread.
        let theme = tauri::async_runtime::spawn_blocking(move || window.theme())
            .await
            .map_err(|error| format!("Native system appearance could not be read: {error}"))?
            .map_err(|error| format!("Native system appearance could not be read: {error}"))?;
        service.initialize_system_scheme(theme)?;
    }
    commit_command_presentation(&app, presentation).await
}

pub(crate) fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri::plugin::Builder::new("appearance-prepaint")
        .register_uri_scheme_protocol("archeion-appearance", |context, request| {
            let snapshot = if request.uri().path() == "/snapshot" && request.method() == "GET" {
                prepaint_snapshot(context.app_handle())
                    .and_then(|value| serde_json::to_vec(&value).map_err(|error| error.to_string()))
            } else {
                Err("Unknown appearance resource.".into())
            };
            let (status, body) = match snapshot {
                Ok(body) => (200, body),
                Err(_) => (503, b"{}".to_vec()),
            };
            tauri::http::Response::builder()
                .status(status)
                .header("Content-Type", "application/json")
                .header("Cache-Control", "no-store")
                .header("Access-Control-Allow-Origin", "*")
                .body(body)
                .expect("valid appearance response")
        })
        .build()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::app_settings::AppPreferences;

    pub(super) fn settings(selection: AppThemeSelection, revision: u64) -> AppSettingsSnapshot {
        AppSettingsSnapshot {
            revision,
            preferences: AppPreferences {
                app_theme: selection,
                ..AppPreferences::default()
            },
        }
    }
    pub(super) fn custom() -> AppThemeSelection {
        AppThemeSelection::Custom {
            id: "paper-night".into(),
        }
    }
    pub(super) fn presentation(source: &str) -> AppearancePresentation {
        AppearancePresentation {
            selection: custom(),
            settings_revision: 3,
            base: "dark".into(),
            background: "#253b47".into(),
            foreground: "#ffffff".into(),
            manifest_source: Some(source.into()),
        }
    }
    #[test]
    fn builtins_and_system_resolve_from_canonical_settings_without_a_cache() {
        let service = AppAppearanceService::default();
        for (selection, light, expected) in [
            (
                AppThemeSelection::Builtin {
                    id: BuiltInAppThemeId::Dark,
                },
                true,
                &palettes().dark,
            ),
            (
                AppThemeSelection::Builtin {
                    id: BuiltInAppThemeId::Light,
                },
                false,
                &palettes().light,
            ),
            (AppThemeSelection::System, true, &palettes().light),
            (AppThemeSelection::System, false, &palettes().dark),
        ] {
            service
                .observe_system_event(&tauri::WindowEvent::ThemeChanged(if light {
                    tauri::Theme::Light
                } else {
                    tauri::Theme::Dark
                }))
                .unwrap();
            assert_eq!(
                &service
                    .snapshot(&settings(selection, 0), 0, None)
                    .unwrap()
                    .palette,
                expected
            );
        }
    }
    #[test]
    fn custom_prepaint_reuses_only_the_validated_current_manifest_and_selection() {
        let service = AppAppearanceService::default();
        let settings = settings(custom(), 3);
        service
            .prepare(
                &settings,
                7,
                Some("validated manifest bytes"),
                presentation("validated manifest bytes"),
            )
            .unwrap();
        let valid = service
            .snapshot(&settings, 7, Some("validated manifest bytes"))
            .unwrap();
        assert_eq!(valid.palette.background, "#253b47");
        for (revision, source) in [
            (8, Some("validated manifest bytes")),
            (7, None),
            (7, Some("corrupt or replaced bytes")),
        ] {
            assert_eq!(
                service
                    .snapshot(&settings, revision, source)
                    .unwrap()
                    .palette,
                palettes().dark
            );
        }
    }
    #[test]
    fn unrelated_settings_revisions_do_not_discard_a_still_authoritative_custom_canvas() {
        let service = AppAppearanceService::default();
        service
            .prepare(
                &settings(custom(), 3),
                0,
                Some("source"),
                presentation("source"),
            )
            .unwrap();
        let snapshot = service
            .snapshot(&settings(custom(), 9), 0, Some("source"))
            .unwrap();
        assert_eq!(snapshot.settings_revision, 9);
        assert_eq!(snapshot.palette.background, "#253b47");
    }
    #[test]
    fn an_old_selection_or_manifest_cannot_prepare_a_new_native_background() {
        let service = AppAppearanceService::default();
        let light = settings(
            AppThemeSelection::Builtin {
                id: BuiltInAppThemeId::Light,
            },
            4,
        );
        assert!(service
            .prepare(&light, 0, Some("source"), presentation("source"))
            .is_err());
        assert!(service
            .prepare(
                &settings(custom(), 3),
                0,
                Some("replacement"),
                presentation("source")
            )
            .is_err());
        assert!(service
            .prepare(
                &settings(custom(), 2),
                0,
                Some("source"),
                presentation("source")
            )
            .is_err());
    }
    #[test]
    fn invalid_colors_and_unvalidated_custom_colors_are_not_admitted() {
        let service = AppAppearanceService::default();
        let mut value = presentation("source");
        value.background = "red; display:none".into();
        assert!(service
            .prepare(&settings(custom(), 3), 0, Some("source"), value)
            .is_err());
        let mut value = presentation("source");
        value.manifest_source = None;
        assert!(service
            .prepare(&settings(custom(), 3), 0, Some("source"), value)
            .is_err());
    }
    #[test]
    fn a_cache_miss_has_an_explicit_builtin_fallback_and_never_reads_optional_resources() {
        let snapshot = AppAppearanceService::default()
            .snapshot(&settings(custom(), 1), 0, None)
            .unwrap();
        assert_eq!(snapshot.base, "dark");
        assert_eq!(snapshot.palette, palettes().dark);
    }
}

#[cfg(test)]
#[path = "app_appearance_ordering_tests.rs"]
mod ordering_tests;
