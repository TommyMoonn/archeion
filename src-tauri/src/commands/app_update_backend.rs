#[cfg(target_os = "windows")]
use std::sync::Arc;

#[cfg(target_os = "windows")]
use super::app_update_service::DownloadProgress;
use super::app_update_service::{PendingUpdate, UpdateBackend, UpdateFuture};

pub(crate) struct NativeUpdateBackend {
    #[cfg(target_os = "windows")]
    app: tauri::AppHandle,
}

impl NativeUpdateBackend {
    pub(crate) fn new(app: &tauri::AppHandle) -> Self {
        #[cfg(not(target_os = "windows"))]
        let _ = app;
        Self {
            #[cfg(target_os = "windows")]
            app: app.clone(),
        }
    }
}

impl UpdateBackend for NativeUpdateBackend {
    fn check(&self) -> UpdateFuture<Option<PendingUpdate>> {
        #[cfg(target_os = "windows")]
        {
            use tauri_plugin_updater::UpdaterExt;
            let app = self.app.clone();
            Box::pin(async move {
                let updater = app
                    .updater_builder()
                    .configure_client(|client| {
                        // Bound stalled transport, not the duration of a progressing download.
                        client
                            .connect_timeout(std::time::Duration::from_secs(15))
                            .read_timeout(std::time::Duration::from_secs(60))
                    })
                    .restart_after_install(true)
                    .build()
                    .map_err(|error| error.to_string())?;
                let update = updater.check().await.map_err(|error| error.to_string())?;
                Ok(update.map(|update| PendingUpdate {
                    metadata: super::app_update_service::UpdateMetadata {
                        version: update.version.clone(),
                        notes: update.body.clone(),
                        published_at: update
                            .raw_json
                            .get("pub_date")
                            .and_then(|date| date.as_str())
                            .map(str::to_owned),
                    },
                    handle: Arc::new(PluginUpdateHandle(update)),
                }))
            })
        }
        #[cfg(not(target_os = "windows"))]
        Box::pin(async { Err("Updates are unavailable on this platform.".to_string()) })
    }
}

#[cfg(target_os = "windows")]
struct PluginUpdateHandle(tauri_plugin_updater::Update);

#[cfg(target_os = "windows")]
impl super::app_update_service::UpdateHandle for PluginUpdateHandle {
    fn download(&self, progress: DownloadProgress) -> UpdateFuture<Vec<u8>> {
        let update = self.0.clone();
        Box::pin(async move {
            // Only the plugin's signature/version-verified result can become ready.
            update
                .download(move |chunk, total| progress(chunk as u64, total), || {})
                .await
                .map_err(|error| error.to_string())
        })
    }

    fn install(&self, bytes: Vec<u8>) -> UpdateFuture<()> {
        let update = self.0.clone().restart_after_install(true);
        Box::pin(async move {
            // UpdaterExt supplies Tauri cleanup_before_exit. The plugin owns Windows exit/relaunch.
            tauri::async_runtime::spawn_blocking(move || update.install(bytes))
                .await
                .map_err(|error| error.to_string())?
                .map_err(|error| error.to_string())
        })
    }
}
