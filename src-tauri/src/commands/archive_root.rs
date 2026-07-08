use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use serde::Serialize;

use super::archive;

pub(crate) fn read_archive_path(app: &tauri::AppHandle) -> Result<Option<String>, String> {
    archive::read_active_archive_path(app)
}

pub(crate) fn clean_user_facing_path(path: &str) -> String {
    const EXTENDED_UNC_PREFIX: &str = r"\\?\UNC\";
    const EXTENDED_PATH_PREFIX: &str = r"\\?\";

    if let Some(path_without_prefix) = path.strip_prefix(EXTENDED_UNC_PREFIX) {
        return format!(r"\\{}", path_without_prefix);
    }

    if let Some(path_without_prefix) = path.strip_prefix(EXTENDED_PATH_PREFIX) {
        return path_without_prefix.to_string();
    }

    path.to_string()
}

pub(crate) fn display_archive_path(path: &Path) -> String {
    clean_user_facing_path(path.to_string_lossy().as_ref())
}

pub(crate) fn is_inside_archeion_metadata(path: &Path) -> bool {
    path.components().any(|component| component.as_os_str() == ".archeion")
}

#[tauri::command]
pub fn validate_archive_path(path: String) -> bool {
    root_path_from_string(path).is_ok()
}

fn root_path_from_string(path: String) -> Result<PathBuf, String> {
    let root = PathBuf::from(path);
    if !root.is_dir() {
        return Err("The selected archive folder is unavailable.".to_string());
    }

    let normalized = root.canonicalize().unwrap_or(root);
    if is_inside_archeion_metadata(&normalized) {
        return Err("Choose the archive folder, not an .archeion metadata folder.".to_string());
    }

    Ok(normalized)
}

pub(crate) fn resolve_archive_root(
    app: &tauri::AppHandle,
    root_path: Option<String>,
) -> Result<PathBuf, String> {
    match root_path {
        Some(path) => root_path_from_string(path),
        None => read_archive_path(app)?
            .map(root_path_from_string)
            .transpose()?
            .ok_or_else(|| "No archive folder has been selected.".to_string()),
    }
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CoverCacheStatus {
    file_count: usize,
    total_bytes: u64,
}

fn archeion_path(app: &tauri::AppHandle, root_path: Option<String>) -> Result<PathBuf, String> {
    Ok(resolve_archive_root(app, root_path)?.join(".archeion"))
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
        if metadata.is_file()
            && entry
                .path()
                .extension()
                .and_then(|extension| extension.to_str())
                == Some("cover") {
            status.file_count += 1;
            status.total_bytes += metadata.len();
        }
    }
    Ok(status)
}

#[tauri::command]
pub fn cover_cache_status(
    app: tauri::AppHandle,
    root_path: Option<String>,
) -> Result<CoverCacheStatus, String> {
    cover_cache_status_at(&archeion_path(&app, root_path)?.join("covers"))
}

#[tauri::command]
pub fn clear_cover_cache(
    app: tauri::AppHandle,
    root_path: Option<String>,
) -> Result<CoverCacheStatus, String> {
    let path = archeion_path(&app, root_path)?.join("covers");
    match fs::remove_dir_all(&path) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }
    Ok(CoverCacheStatus::default())
}

#[tauri::command]
pub fn reveal_archeion_folder(
    app: tauri::AppHandle,
    root_path: Option<String>,
) -> Result<(), String> {
    let path = archeion_path(&app, root_path)?;
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

    use super::{clean_user_facing_path, cover_cache_status_at, root_path_from_string};

    #[test]
    fn keeps_normal_windows_paths_readable() {
        assert_eq!(
            clean_user_facing_path(r"C:\Users\Name\Books"),
            r"C:\Users\Name\Books"
        );
    }

    #[test]
    fn removes_extended_windows_drive_prefixes() {
        assert_eq!(
            clean_user_facing_path(r"\\?\C:\Users\Name\Books"),
            r"C:\Users\Name\Books"
        );
    }

    #[test]
    fn removes_extended_windows_unc_prefixes() {
        assert_eq!(
            clean_user_facing_path(r"\\?\UNC\server\share\Books"),
            r"\\server\share\Books"
        );
    }

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
        fs::write(root.join("partial.cover.tmp"), [9, 9, 9])
            .expect("temporary cover should be written");

        let status = cover_cache_status_at(&root).expect("status should load");

        assert_eq!(status.file_count, 2);
        assert_eq!(status.total_bytes, 5);
        fs::remove_dir_all(root).expect("test cache should be removed");
    }

    #[test]
    fn rejects_metadata_directory_as_archive_root() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-root-{nonce}"));
        let metadata = root.join(".archeion");
        fs::create_dir_all(&metadata).expect("metadata directory should be created");

        let error = root_path_from_string(metadata.to_string_lossy().into_owned())
            .expect_err("metadata directory should be rejected");

        assert!(error.contains("archive folder"));
        fs::remove_dir_all(root).expect("test root should be removed");
    }
}
