use std::{fs, path::PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

const CONFIG_FILE: &str = "vault.json";

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultConfig {
    vault_path: String,
}

fn config_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|directory| directory.join(CONFIG_FILE))
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn load_vault_path(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let path = config_path(&app)?;
    let contents = match fs::read_to_string(path) {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let config: VaultConfig = serde_json::from_str(&contents).map_err(|error| error.to_string())?;

    Ok(Some(config.vault_path))
}

#[tauri::command]
pub fn save_vault_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    if !PathBuf::from(&path).is_dir() {
        return Err("The selected library folder is unavailable.".to_string());
    }

    let config_path = config_path(&app)?;
    let directory = config_path
        .parent()
        .ok_or_else(|| "App config directory is unavailable.".to_string())?;
    fs::create_dir_all(directory).map_err(|error| error.to_string())?;

    let contents = serde_json::to_string_pretty(&VaultConfig { vault_path: path })
        .map_err(|error| error.to_string())?;
    fs::write(config_path, contents).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn validate_vault_path(path: String) -> bool {
    PathBuf::from(path).is_dir()
}
