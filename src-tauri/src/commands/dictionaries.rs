use std::path::PathBuf;

use tauri::Manager;

use super::dictionary_catalog::{DictionaryCatalogService, DictionaryCatalogSnapshot};
use super::dictionary_download::{
    cleanup_verified_download, DictionaryDownloadError, DictionaryDownloadOutcome,
    DictionaryDownloadProgress, DictionaryDownloadService,
};
use super::dictionary_install::DictionaryInstallService;
use super::dictionary_lookup::{DictionaryLookupResponse, DictionaryLookupService};
use super::dictionary_maintenance::DictionaryMaintenanceService;
use super::dictionary_store::{open_current_store, DictionaryRegistrySnapshot};

pub(crate) fn app_data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve dictionary storage: {error}"))
}

#[tauri::command]
pub fn load_cached_dictionary_catalog(
    app: tauri::AppHandle,
    service: tauri::State<'_, DictionaryCatalogService>,
) -> Result<Option<DictionaryCatalogSnapshot>, String> {
    service
        .load_cached(&app_data_root(&app)?)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn refresh_dictionary_catalog(
    app: tauri::AppHandle,
    service: tauri::State<'_, DictionaryCatalogService>,
) -> Result<DictionaryCatalogSnapshot, String> {
    let root = app_data_root(&app)?;
    service
        .inner()
        .clone()
        .refresh(&root)
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn cancel_dictionary_catalog_refresh(service: tauri::State<'_, DictionaryCatalogService>) {
    service.cancel_current();
}

#[tauri::command]
pub async fn download_dictionary_catalog_package(
    app: tauri::AppHandle,
    catalog_id: String,
    on_progress: tauri::ipc::Channel<DictionaryDownloadProgress>,
    catalog_service: tauri::State<'_, DictionaryCatalogService>,
    download_service: tauri::State<'_, DictionaryDownloadService>,
) -> Result<DictionaryDownloadOutcome, String> {
    let entry = match catalog_service.current_entry(&catalog_id) {
        Ok(entry) => entry,
        Err(error) => {
            return Ok(DictionaryDownloadOutcome::Failed {
                message: error.to_string(),
            });
        }
    };
    let root = match app_data_root(&app) {
        Ok(root) => root,
        Err(message) => return Ok(DictionaryDownloadOutcome::Failed { message }),
    };
    Ok(
        match download_service
            .inner()
            .clone()
            .download(&root, entry, move |progress| {
                on_progress
                    .send(progress)
                    .map_err(|_| DictionaryDownloadError::ProgressUnavailable)
            })
            .await
        {
            Ok(package) => DictionaryDownloadOutcome::Succeeded { package },
            Err(DictionaryDownloadError::Cancelled | DictionaryDownloadError::Superseded) => {
                DictionaryDownloadOutcome::Cancelled
            }
            Err(error) => DictionaryDownloadOutcome::Failed {
                message: error.to_string(),
            },
        },
    )
}

#[tauri::command]
pub fn cancel_dictionary_download(service: tauri::State<'_, DictionaryDownloadService>) {
    service.cancel_current();
}

#[tauri::command]
pub fn cleanup_verified_dictionary_download(
    app: tauri::AppHandle,
    staging_token: String,
) -> Result<bool, String> {
    cleanup_verified_download(&app_data_root(&app)?, &staging_token)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn install_catalog_dictionary(
    app: tauri::AppHandle,
    staging_token: String,
    install_service: tauri::State<'_, DictionaryInstallService>,
) -> Result<super::dictionary_store::InstalledDictionary, String> {
    let root = app_data_root(&app)?;
    let service = install_service.inner().clone();
    tokio::task::spawn_blocking(move || service.install_catalog(&root, &staging_token))
        .await
        .map_err(|error| format!("Dictionary installation task failed: {error}"))?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn import_stardict_dictionary(
    app: tauri::AppHandle,
    ifo_path: String,
    install_service: tauri::State<'_, DictionaryInstallService>,
) -> Result<super::dictionary_store::InstalledDictionary, String> {
    let root = app_data_root(&app)?;
    let source = PathBuf::from(ifo_path);
    let service = install_service.inner().clone();
    tokio::task::spawn_blocking(move || service.install_manual(&root, &source))
        .await
        .map_err(|error| format!("Dictionary import task failed: {error}"))?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_installed_dictionaries(
    app: tauri::AppHandle,
    maintenance_service: tauri::State<'_, DictionaryMaintenanceService>,
    download_service: tauri::State<'_, DictionaryDownloadService>,
    install_service: tauri::State<'_, DictionaryInstallService>,
) -> Result<DictionaryRegistrySnapshot, String> {
    maintain_dictionary_resources(
        app_data_root(&app)?,
        maintenance_service.inner().clone(),
        download_service.inner().clone(),
        install_service.inner().clone(),
    )
    .await
}

#[tauri::command]
pub async fn recover_dictionary_resources(
    app: tauri::AppHandle,
    maintenance_service: tauri::State<'_, DictionaryMaintenanceService>,
    download_service: tauri::State<'_, DictionaryDownloadService>,
    install_service: tauri::State<'_, DictionaryInstallService>,
) -> Result<DictionaryRegistrySnapshot, String> {
    maintain_dictionary_resources(
        app_data_root(&app)?,
        maintenance_service.inner().clone(),
        download_service.inner().clone(),
        install_service.inner().clone(),
    )
    .await
}

async fn maintain_dictionary_resources(
    root: PathBuf,
    maintenance_service: DictionaryMaintenanceService,
    download_service: DictionaryDownloadService,
    install_service: DictionaryInstallService,
) -> Result<DictionaryRegistrySnapshot, String> {
    tokio::task::spawn_blocking(move || {
        maintenance_service.maintain(&root, &download_service, &install_service)
    })
    .await
    .map_err(|error| format!("Dictionary maintenance task failed: {error}"))?
}

#[tauri::command]
pub fn set_dictionary_enabled(
    app: tauri::AppHandle,
    dictionary_id: String,
    enabled: bool,
) -> Result<DictionaryRegistrySnapshot, String> {
    let root = app_data_root(&app)?;
    let mut store = open_current_store(&root).map_err(|error| error.to_string())?;
    let dictionaries = store
        .set_enabled(&dictionary_id, enabled)
        .map_err(|error| error.to_string())?;
    Ok(DictionaryRegistrySnapshot {
        status: super::dictionary_store::DictionaryRegistryStatus::Ready,
        dictionaries,
        recovery: None,
    })
}

#[tauri::command]
pub fn set_dictionary_order(
    app: tauri::AppHandle,
    dictionary_ids: Vec<String>,
) -> Result<DictionaryRegistrySnapshot, String> {
    let root = app_data_root(&app)?;
    let mut store = open_current_store(&root).map_err(|error| error.to_string())?;
    let dictionaries = store
        .set_order(&dictionary_ids)
        .map_err(|error| error.to_string())?;
    Ok(DictionaryRegistrySnapshot {
        status: super::dictionary_store::DictionaryRegistryStatus::Ready,
        dictionaries,
        recovery: None,
    })
}

#[tauri::command]
pub async fn remove_dictionary(
    app: tauri::AppHandle,
    dictionary_id: String,
) -> Result<DictionaryRegistrySnapshot, String> {
    let root = app_data_root(&app)?;
    tokio::task::spawn_blocking(move || {
        let mut store = open_current_store(&root).map_err(|error| error.to_string())?;
        let dictionaries = store
            .remove_dictionary(&dictionary_id)
            .map_err(|error| error.to_string())?;
        Ok(DictionaryRegistrySnapshot {
            status: super::dictionary_store::DictionaryRegistryStatus::Ready,
            dictionaries,
            recovery: None,
        })
    })
    .await
    .map_err(|error| format!("Dictionary removal task failed: {error}"))?
}

#[tauri::command]
pub async fn rebuild_dictionary_index(
    app: tauri::AppHandle,
    dictionary_id: String,
) -> Result<DictionaryRegistrySnapshot, String> {
    let root = app_data_root(&app)?;
    tokio::task::spawn_blocking(move || {
        let mut store = open_current_store(&root).map_err(|error| error.to_string())?;
        store
            .rebuild_index(&dictionary_id)
            .map_err(|error| error.to_string())?;
        let dictionaries = store.list().map_err(|error| error.to_string())?;
        Ok(DictionaryRegistrySnapshot {
            status: super::dictionary_store::DictionaryRegistryStatus::Ready,
            dictionaries,
            recovery: None,
        })
    })
    .await
    .map_err(|error| format!("Dictionary index rebuild task failed: {error}"))?
}

#[tauri::command]
pub async fn lookup_dictionary_term(
    app: tauri::AppHandle,
    term: String,
    service: tauri::State<'_, DictionaryLookupService>,
) -> Result<DictionaryLookupResponse, String> {
    let root = app_data_root(&app)?;
    let service = service.inner().clone();
    tokio::task::spawn_blocking(move || service.lookup(&root, &term))
        .await
        .map_err(|error| format!("Dictionary lookup task failed: {error}"))?
        .map_err(|error| error.to_string())
}
