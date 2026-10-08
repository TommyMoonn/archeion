use std::sync::Arc;

use super::app_update_prompts::{utc_now_ms, FileUpdatePromptPersistence, UpdatePromptPolicy};
use tauri::{Emitter, Manager};

use super::app_update_service::{AppUpdateSnapshot, CheckIntent};
use super::{app_update_backend::NativeUpdateBackend, app_update_service::AppUpdateService};

const APP_UPDATE_CHANGED_EVENT: &str = "app-update-changed";

impl AppUpdateService {
    pub(crate) fn from_app(app: &tauri::AppHandle) -> Self {
        let event_app = app.clone();
        let current_version = app.package_info().version.to_string();
        let supported = cfg!(all(
            target_os = "windows",
            target_arch = "x86_64",
            not(debug_assertions)
        )) && !tauri::is_dev();
        // Development launches must not consume a production completion marker.
        let prompt = if supported {
            app.path()
                .app_data_dir()
                .map_err(|error| error.to_string())
                .and_then(|directory| {
                    UpdatePromptPolicy::load(
                        &current_version,
                        Arc::new(FileUpdatePromptPersistence(
                            directory.join("app-update-prompts.json"),
                        )),
                        utc_now_ms,
                    )
                })
        } else {
            Ok(UpdatePromptPolicy::unavailable())
        };
        let storage_available = prompt.is_ok();
        let prompt = prompt.unwrap_or_else(|error| {
            eprintln!("Update prompt storage is unavailable; updater disabled: {error}");
            UpdatePromptPolicy::unavailable()
        });
        Self::new(
            current_version,
            supported && storage_available,
            Arc::new(NativeUpdateBackend::new(app)),
            prompt,
            move |snapshot| {
                if let Err(error) = event_app.emit(APP_UPDATE_CHANGED_EVENT, snapshot) {
                    eprintln!("Update snapshot event could not be emitted: {error}");
                }
            },
        )
    }
}

#[tauri::command]
pub fn defer_app_update(
    service: tauri::State<'_, AppUpdateService>,
    version: String,
) -> Result<AppUpdateSnapshot, String> {
    service.defer(&version)
}

#[tauri::command]
pub fn acknowledge_completed_app_update(
    service: tauri::State<'_, AppUpdateService>,
    version: String,
) -> Result<AppUpdateSnapshot, String> {
    service.acknowledge_completed(&version)
}

#[tauri::command]
pub fn get_app_update_snapshot(
    service: tauri::State<'_, AppUpdateService>,
) -> Result<AppUpdateSnapshot, String> {
    service.snapshot()
}

#[tauri::command]
pub async fn check_app_update(
    service: tauri::State<'_, AppUpdateService>,
    intent: CheckIntent,
) -> Result<AppUpdateSnapshot, String> {
    service.check(intent).await
}

#[tauri::command]
pub async fn download_app_update(
    service: tauri::State<'_, AppUpdateService>,
) -> Result<AppUpdateSnapshot, String> {
    service.download().await
}

#[tauri::command]
pub async fn install_app_update(
    service: tauri::State<'_, AppUpdateService>,
) -> Result<AppUpdateSnapshot, String> {
    service.install().await
}
