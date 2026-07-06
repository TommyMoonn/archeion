use std::{
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::Serialize;

use super::{filesystem, vault};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedBook {
    discovery_id: String,
    relative_path: String,
    file_name: String,
    folder_path: String,
    size: u64,
    modified_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFolder {
    id: String,
    name: String,
    relative_path: String,
    parent_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultScan {
    books: Vec<ScannedBook>,
    folders: Vec<ScannedFolder>,
}

fn discovery_id(relative_path: &str, size: u64, modified_at: u64) -> String {
    let identity = format!("{relative_path}\0{size}\0{modified_at}");
    let hash = identity
        .as_bytes()
        .iter()
        .fold(0xcbf29ce484222325_u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        });
    format!("book-{hash:016x}")
}

fn scan_directory(
    root: &Path,
    directory: &Path,
    books: &mut Vec<ScannedBook>,
    folders: &mut Vec<ScannedFolder>,
) -> Result<(), String> {
    let entries = fs::read_dir(directory).map_err(|error| error.to_string())?;

    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        let path = entry.path();

        if file_type.is_dir() {
            if entry.file_name() == filesystem::METADATA_DIRECTORY {
                continue;
            }

            let relative_path = filesystem::path_relative_to(root, &path)?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let parent_path = path
                .parent()
                .filter(|parent| *parent != root)
                .map(|parent| filesystem::path_relative_to(root, parent))
                .transpose()?;

            folders.push(ScannedFolder {
                id: format!("folder:{relative_path}"),
                name,
                relative_path,
                parent_path,
            });
            scan_directory(root, &path, books, folders)?;
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !file_type.is_file() || filesystem::validate_epub_file_name(&file_name).is_err() {
            continue;
        }

        let metadata = entry.metadata().map_err(|error| error.to_string())?;
        let modified_at = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
            .unwrap_or_default();
        let relative_path = filesystem::path_relative_to(root, &path)?;
        let folder_path = path
            .parent()
            .map(|parent| filesystem::path_relative_to(root, parent))
            .transpose()?
            .unwrap_or_default();
        let size = metadata.len();

        books.push(ScannedBook {
            discovery_id: discovery_id(&relative_path, size, modified_at),
            relative_path,
            file_name,
            folder_path,
            size,
            modified_at,
        });
    }

    Ok(())
}

fn scan_path(root: PathBuf) -> Result<VaultScan, String> {
    if !root.is_dir() {
        return Err("The saved library folder is unavailable.".to_string());
    }

    let mut books = Vec::new();
    let mut folders = Vec::new();
    scan_directory(&root, &root, &mut books, &mut folders)?;
    books.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    folders.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    Ok(VaultScan { books, folders })
}

#[tauri::command]
pub fn scan_vault(app: tauri::AppHandle) -> Result<VaultScan, String> {
    let path = vault::read_vault_path(&app)?
        .ok_or_else(|| "No library folder has been selected.".to_string())?;
    scan_path(PathBuf::from(path))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::scan_path;

    #[test]
    fn scans_nested_epubs_and_ignores_metadata_directory() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-{nonce}"));
        let series = root.join("Author").join("Series");
        let metadata = root.join(".archeion");
        fs::create_dir_all(&series).expect("series directory should be created");
        fs::create_dir_all(&metadata).expect("metadata directory should be created");
        fs::write(series.join("Volume 01.EPUB"), b"epub").expect("test EPUB should be written");
        fs::write(series.join("notes.txt"), b"notes").expect("text file should be written");
        fs::write(metadata.join("hidden.epub"), b"hidden")
            .expect("metadata EPUB should be written");

        let scan = scan_path(root.clone()).expect("vault scan should succeed");

        assert_eq!(scan.books.len(), 1);
        assert_eq!(scan.books[0].relative_path, "Author/Series/Volume 01.EPUB");
        assert_eq!(scan.folders.len(), 2);
        assert_eq!(scan.folders[1].parent_path.as_deref(), Some("Author"));

        fs::remove_dir_all(root).expect("test vault should be removed");
    }
}
