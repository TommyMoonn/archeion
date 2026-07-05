use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

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
    read_vault_path(&app)
}

pub(crate) fn read_vault_path(app: &tauri::AppHandle) -> Result<Option<String>, String> {
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

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverCacheStatus {
    file_count: usize,
    total_bytes: u64,
}

fn archeion_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    read_vault_path(app)?
        .map(PathBuf::from)
        .map(|root| root.join(".archeion"))
        .ok_or_else(|| "No library folder has been selected.".to_string())
}

fn cover_cache_status_at(path: &Path) -> Result<CoverCacheStatus, String> {
    let mut status = CoverCacheStatus::default();
    let entries = match fs::read_dir(path) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(status);
        }
        Err(error) => return Err(error.to_string()),
    };

    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        if metadata.is_file() {
            status.file_count += 1;
            status.total_bytes += metadata.len();
        }
    }
    Ok(status)
}

#[tauri::command]
pub fn cover_cache_status(app: tauri::AppHandle) -> Result<CoverCacheStatus, String> {
    cover_cache_status_at(&archeion_path(&app)?.join("covers"))
}

#[tauri::command]
pub fn clear_cover_cache(app: tauri::AppHandle) -> Result<CoverCacheStatus, String> {
    let path = archeion_path(&app)?.join("covers");
    match fs::remove_dir_all(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    Ok(CoverCacheStatus::default())
}

#[tauri::command]
pub fn reveal_archeion_folder(app: tauri::AppHandle) -> Result<(), String> {
    let path = archeion_path(&app)?;
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;

    #[cfg(target_os = "windows")]
    let mut command = Command::new("explorer");
    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = Command::new("xdg-open");

    command
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::cover_cache_status_at;

    #[test]
    fn reports_cover_cache_files_and_bytes() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-cache-{nonce}"));
        fs::create_dir_all(&root).expect("cache directory should be created");
        fs::write(root.join("first.cover"), [1, 2, 3]).expect("first cover should be written");
        fs::write(root.join("second.cover"), [4, 5]).expect("second cover should be written");

        let status = cover_cache_status_at(&root).expect("status should load");

        assert_eq!(status.file_count, 2);
        assert_eq!(status.total_bytes, 5);
        fs::remove_dir_all(root).expect("test cache should be removed");
    }
}
