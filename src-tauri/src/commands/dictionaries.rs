use std::path::PathBuf;

use tauri::Manager;

use super::dictionary_catalog::{DictionaryCatalogService, DictionaryCatalogSnapshot};
use super::dictionary_store::{open_current_store, DictionaryRegistrySnapshot, DictionaryStore};

pub(crate) fn app_data_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| format!("Unable to resolve dictionary storage: {error}"))
}

#[tauri::command]
pub fn load_cached_dictionary_catalog(
    app: tauri::AppHandle,
) -> Result<Option<DictionaryCatalogSnapshot>, String> {
    DictionaryCatalogService::load_cached(&app_data_root(&app)?).map_err(|error| error.to_string())
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
pub fn list_installed_dictionaries(
    app: tauri::AppHandle,
) -> Result<DictionaryRegistrySnapshot, String> {
    DictionaryStore::snapshot(&app_data_root(&app)?).map_err(|error| error.to_string())
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
