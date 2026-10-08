use std::sync::Arc;

use tauri::Emitter;

use super::app_update_service::{AppUpdateSnapshot, CheckIntent};
use super::{app_update_backend::NativeUpdateBackend, app_update_service::AppUpdateService};

const APP_UPDATE_CHANGED_EVENT: &str = "app-update-changed";

impl AppUpdateService {
    pub(crate) fn from_app(app: &tauri::AppHandle) -> Self {
        let event_app = app.clone();
        Self::new(
            app.package_info().version.to_string(),
            cfg!(all(
                target_os = "windows",
                target_arch = "x86_64",
                not(debug_assertions)
            )) && !tauri::is_dev(),
            Arc::new(NativeUpdateBackend::new(app)),
            move |snapshot| {
                if let Err(error) = event_app.emit(APP_UPDATE_CHANGED_EVENT, snapshot) {
                    eprintln!("Update snapshot event could not be emitted: {error}");
                }
            },
        )
    }
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
