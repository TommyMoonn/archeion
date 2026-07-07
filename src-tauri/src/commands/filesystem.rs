use std::{
    fs,
    path::{Component, Path, PathBuf},
    process::Command,
};

use serde::Serialize;

use super::vault;

pub(crate) const METADATA_DIRECTORY: &str = ".archeion";
const RESERVED_ITEM_NAME_CHARS: [char; 9] = ['\\', '/', ':', '*', '?', '"', '<', '>', '|'];

pub(crate) fn path_relative_to(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path.strip_prefix(root).map_err(|error| error.to_string())?;
    Ok(relative
        .components()
        .map(|component| component.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/"))
}

pub(crate) fn is_reserved_archive_path(relative_path: &str) -> bool {
    relative_path
        .replace('\\', "/")
        .split('/')
        .find(|part| !part.is_empty())
        .is_some_and(|part| part.eq_ignore_ascii_case(METADATA_DIRECTORY))
}

pub(crate) fn normalize_archive_relative_path(relative_path: &str) -> Result<String, String> {
    let normalized_input = relative_path.replace('\\', "/");
    let path = Path::new(&normalized_input);
    if path.is_absolute() {
        return Err("Archive paths must be relative to the library folder.".to_string());
    }

    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().trim().to_string()),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Archive paths cannot leave the library folder.".to_string());
            }
        }
    }

    parts.retain(|part| !part.is_empty());
    if parts.is_empty() {
        return Err("Archive paths cannot be empty.".to_string());
    }
    let normalized = parts.join("/");
    if is_reserved_archive_path(&normalized) {
        return Err("The .archeion metadata folder is reserved.".to_string());
    }
    Ok(normalized)
}

fn is_windows_reserved_name(name: &str) -> bool {
    matches!(
        name.split('.')
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase()
            .as_str(),
        "con"
            | "prn"
            | "aux"
            | "nul"
            | "com1"
            | "com2"
            | "com3"
            | "com4"
            | "com5"
            | "com6"
            | "com7"
            | "com8"
            | "com9"
            | "lpt1"
            | "lpt2"
            | "lpt3"
            | "lpt4"
            | "lpt5"
            | "lpt6"
            | "lpt7"
            | "lpt8"
            | "lpt9"
    )
}

pub(crate) fn validate_archive_item_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err("Names cannot be empty.".to_string());
    }
    if trimmed == "." || trimmed == ".." {
        return Err("Names cannot use path traversal segments.".to_string());
    }
    if trimmed
        .chars()
        .any(|character| RESERVED_ITEM_NAME_CHARS.contains(&character))
    {
        return Err("Names cannot contain path separators or reserved characters.".to_string());
    }
    if trimmed.ends_with(' ') || trimmed.ends_with('.') {
        return Err("Names cannot end with a space or period.".to_string());
    }
    if trimmed.eq_ignore_ascii_case(METADATA_DIRECTORY) {
        return Err("The .archeion metadata folder is reserved.".to_string());
    }
    if is_windows_reserved_name(trimmed) {
        return Err("This name is reserved by Windows.".to_string());
    }
    Ok(trimmed.to_string())
}

pub(crate) fn validate_epub_file_name(name: &str) -> Result<String, String> {
    let trimmed = validate_archive_item_name(name)?;
    if !trimmed.to_ascii_lowercase().ends_with(".epub") {
        return Err("EPUB file names must end with .epub.".to_string());
    }
    Ok(trimmed)
}

pub(crate) fn resolve_existing_archive_path(
    root: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let relative_path = normalize_archive_relative_path(relative_path)?;
    let canonical_root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let resolved =
        fs::canonicalize(canonical_root.join(relative_path)).map_err(|error| error.to_string())?;
    if !resolved.starts_with(&canonical_root) {
        return Err("The selected path is outside the library folder.".to_string());
    }
    Ok(resolved)
}

pub(crate) fn resolve_existing_epub_path(
    root: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let normalized = normalize_archive_relative_path(relative_path)?;
    let file_name = Path::new(&normalized)
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| "The selected EPUB file is unavailable.".to_string())?;
    validate_epub_file_name(file_name)?;
    let resolved = resolve_existing_archive_path(root, &normalized)?;
    if !resolved.is_file() {
        return Err("The selected EPUB file is unavailable.".to_string());
    }
    Ok(resolved)
}

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ArchivePathChange {
    old_relative_path: String,
    new_relative_path: String,
}

fn vault_root(app: &tauri::AppHandle, root_path: Option<String>) -> Result<PathBuf, String> {
    vault::resolve_vault_root(app, root_path)
}

fn canonical_root(root: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(root).map_err(|_| "The saved library folder is unavailable.".to_string())
}

fn resolve_existing_folder_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let normalized = normalize_archive_relative_path(relative_path)?;
    let canonical_root = canonical_root(root)?;
    let resolved = fs::canonicalize(canonical_root.join(normalized))
        .map_err(|_| "The selected folder is unavailable.".to_string())?;

    if !resolved.starts_with(&canonical_root) || !resolved.is_dir() {
        return Err("The selected folder is unavailable.".to_string());
    }

    Ok(resolved)
}

fn resolve_destination_parent(
    root: &Path,
    relative_path: Option<&str>,
) -> Result<(PathBuf, String), String> {
    let canonical_root = canonical_root(root)?;
    let Some(relative_path) = relative_path.filter(|path| !path.trim().is_empty()) else {
        return Ok((canonical_root, String::new()));
    };
    let normalized = normalize_archive_relative_path(relative_path)?;
    let parent = fs::canonicalize(canonical_root.join(&normalized))
        .map_err(|_| "The destination folder is unavailable.".to_string())?;

    if !parent.starts_with(&canonical_root) || !parent.is_dir() {
        return Err("The destination folder is unavailable.".to_string());
    }

    Ok((parent, normalized))
}

fn join_archive_path(parent_path: &str, item_name: &str) -> String {
    if parent_path.is_empty() {
        item_name.to_string()
    } else {
        format!("{parent_path}/{item_name}")
    }
}

fn destination_available(source: &Path, destination: &Path) -> Result<bool, String> {
    if !destination.exists() {
        return Ok(true);
    }

    let destination = fs::canonicalize(destination).map_err(|error| error.to_string())?;
    Ok(destination == source)
}

fn rename_archive_path(source: &Path, destination: &Path) -> Result<(), String> {
    if source == destination {
        return Ok(());
    }

    fs::rename(source, destination).map_err(|error| error.to_string())
}

fn path_change(root: &Path, old_path: &Path, new_path: &Path) -> Result<ArchivePathChange, String> {
    Ok(ArchivePathChange {
        old_relative_path: path_relative_to(root, old_path)?,
        new_relative_path: path_relative_to(root, new_path)?,
    })
}

#[cfg(target_os = "windows")]
fn trash_with_platform(path: &Path, is_directory: bool) -> Result<(), String> {
    let method = if is_directory {
        "DeleteDirectory"
    } else {
        "DeleteFile"
    };
    let path = path.to_string_lossy();
    let script = format!(
        "Add-Type -AssemblyName Microsoft.VisualBasic\n[Microsoft.VisualBasic.FileIO.FileSystem]::{method}(@'\n{path}\n'@, 'OnlyErrorDialogs', 'SendToRecycleBin')"
    );
    let status = Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command", &script])
        .status()
        .map_err(|error| error.to_string())?;

    status
        .success()
        .then_some(())
        .ok_or_else(|| "The item could not be moved to the recycle bin.".to_string())
}

#[cfg(target_os = "macos")]
fn trash_with_platform(path: &Path, _is_directory: bool) -> Result<(), String> {
    let escaped = path
        .to_string_lossy()
        .replace('\\', "\\\\")
        .replace('"', "\\\"");
    let script = format!("tell application \"Finder\" to delete POSIX file \"{escaped}\"");
    let status = Command::new("osascript")
        .args(["-e", &script])
        .status()
        .map_err(|error| error.to_string())?;

    status
        .success()
        .then_some(())
        .ok_or_else(|| "The item could not be moved to Trash.".to_string())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn trash_with_platform(path: &Path, _is_directory: bool) -> Result<(), String> {
    let gio = Command::new("gio").arg("trash").arg(path).status();
    if gio.is_ok_and(|status| status.success()) {
        return Ok(());
    }

    for command_name in ["kioclient5", "kioclient"] {
        let status = Command::new(command_name)
            .arg("move")
            .arg(path)
            .arg("trash:/")
            .status();
        if status.is_ok_and(|status| status.success()) {
            return Ok(());
        }
    }

    Err("The item could not be moved to Trash.".to_string())
}

fn delete_archive_item(path: &Path, is_directory: bool) -> Result<(), String> {
    match trash_with_platform(path, is_directory) {
        Ok(()) => Ok(()),
        Err(_) if is_directory => fs::remove_dir_all(path).map_err(|error| error.to_string()),
        Err(_) => fs::remove_file(path).map_err(|error| error.to_string()),
    }
}

fn open_folder(path: &Path) -> Result<(), String> {
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

pub(crate) fn create_archive_folder_at(
    root: &Path,
    parent_relative_path: Option<&str>,
    name: &str,
) -> Result<String, String> {
    let (parent, parent_path) = resolve_destination_parent(root, parent_relative_path)?;
    let folder_name = validate_archive_item_name(name)?;
    let destination = parent.join(&folder_name);

    if destination.exists() {
        return Err("An item with this name already exists.".to_string());
    }

    fs::create_dir(&destination).map_err(|error| error.to_string())?;
    Ok(join_archive_path(&parent_path, &folder_name))
}

pub(crate) fn rename_archive_epub_at(
    root: &Path,
    relative_path: &str,
    new_file_name: &str,
) -> Result<ArchivePathChange, String> {
    let canonical_root = canonical_root(root)?;
    let source = resolve_existing_epub_path(&canonical_root, relative_path)?;
    let file_name = validate_epub_file_name(new_file_name)?;
    let parent = source
        .parent()
        .ok_or_else(|| "The EPUB folder is unavailable.".to_string())?;
    let destination = parent.join(file_name);

    if !destination_available(&source, &destination)? {
        return Err("An item with this name already exists.".to_string());
    }

    let change = path_change(&canonical_root, &source, &destination)?;
    rename_archive_path(&source, &destination)?;
    Ok(change)
}

pub(crate) fn move_archive_epub_at(
    root: &Path,
    relative_path: &str,
    destination_folder_path: Option<&str>,
) -> Result<ArchivePathChange, String> {
    let canonical_root = canonical_root(root)?;
    let source = resolve_existing_epub_path(&canonical_root, relative_path)?;
    let file_name = source
        .file_name()
        .ok_or_else(|| "The selected EPUB file is unavailable.".to_string())?;
    let (destination_parent, _) =
        resolve_destination_parent(&canonical_root, destination_folder_path)?;
    let destination = destination_parent.join(file_name);

    if !destination_available(&source, &destination)? {
        return Err("An EPUB with this name already exists in the destination folder.".to_string());
    }

    let change = path_change(&canonical_root, &source, &destination)?;
    rename_archive_path(&source, &destination)?;
    Ok(change)
}

pub(crate) fn rename_archive_folder_at(
    root: &Path,
    relative_path: &str,
    new_name: &str,
) -> Result<ArchivePathChange, String> {
    let canonical_root = canonical_root(root)?;
    let source = resolve_existing_folder_path(&canonical_root, relative_path)?;
    let folder_name = validate_archive_item_name(new_name)?;
    let parent = source
        .parent()
        .ok_or_else(|| "The selected folder is unavailable.".to_string())?;
    let destination = parent.join(folder_name);

    if !destination_available(&source, &destination)? {
        return Err("An item with this name already exists.".to_string());
    }

    let change = path_change(&canonical_root, &source, &destination)?;
    rename_archive_path(&source, &destination)?;
    Ok(change)
}

pub(crate) fn move_archive_folder_at(
    root: &Path,
    relative_path: &str,
    destination_parent_path: Option<&str>,
) -> Result<ArchivePathChange, String> {
    let canonical_root = canonical_root(root)?;
    let source = resolve_existing_folder_path(&canonical_root, relative_path)?;
    let (destination_parent, _) =
        resolve_destination_parent(&canonical_root, destination_parent_path)?;

    if destination_parent == source || destination_parent.starts_with(&source) {
        return Err("A folder cannot be moved into itself.".to_string());
    }

    let folder_name = source
        .file_name()
        .ok_or_else(|| "The selected folder is unavailable.".to_string())?;
    let destination = destination_parent.join(folder_name);

    if !destination_available(&source, &destination)? {
        return Err(
            "A folder with this name already exists in the destination folder.".to_string(),
        );
    }

    let change = path_change(&canonical_root, &source, &destination)?;
    rename_archive_path(&source, &destination)?;
    Ok(change)
}

pub(crate) fn delete_archive_epub_at(root: &Path, relative_path: &str) -> Result<(), String> {
    let canonical_root = canonical_root(root)?;
    let path = resolve_existing_epub_path(&canonical_root, relative_path)?;
    delete_archive_item(&path, false)
}

pub(crate) fn delete_archive_folder_at(root: &Path, relative_path: &str) -> Result<(), String> {
    let canonical_root = canonical_root(root)?;
    let path = resolve_existing_folder_path(&canonical_root, relative_path)?;
    delete_archive_item(&path, true)
}

#[tauri::command]
pub fn create_vault_folder(
    app: tauri::AppHandle,
    root_path: Option<String>,
    parent_relative_path: Option<String>,
    name: String,
) -> Result<String, String> {
    let root = vault_root(&app, root_path)?;
    create_archive_folder_at(&root, parent_relative_path.as_deref(), &name)
}

#[tauri::command]
pub fn rename_vault_epub_file(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_path: String,
    new_file_name: String,
) -> Result<ArchivePathChange, String> {
    let root = vault_root(&app, root_path)?;
    rename_archive_epub_at(&root, &relative_path, &new_file_name)
}

#[tauri::command]
pub fn move_vault_epub_file(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_path: String,
    destination_folder_path: Option<String>,
) -> Result<ArchivePathChange, String> {
    let root = vault_root(&app, root_path)?;
    move_archive_epub_at(&root, &relative_path, destination_folder_path.as_deref())
}

#[tauri::command]
pub fn rename_vault_folder(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_path: String,
    new_name: String,
) -> Result<ArchivePathChange, String> {
    let root = vault_root(&app, root_path)?;
    rename_archive_folder_at(&root, &relative_path, &new_name)
}

#[tauri::command]
pub fn move_vault_folder(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_path: String,
    destination_parent_path: Option<String>,
) -> Result<ArchivePathChange, String> {
    let root = vault_root(&app, root_path)?;
    move_archive_folder_at(&root, &relative_path, destination_parent_path.as_deref())
}

#[tauri::command]
pub fn delete_vault_epub_file(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_path: String,
) -> Result<(), String> {
    let root = vault_root(&app, root_path)?;
    delete_archive_epub_at(&root, &relative_path)
}

#[tauri::command]
pub fn delete_vault_folder(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_path: String,
) -> Result<(), String> {
    let root = vault_root(&app, root_path)?;
    delete_archive_folder_at(&root, &relative_path)
}

#[tauri::command]
pub fn reveal_vault_folder(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_path: String,
) -> Result<(), String> {
    let root = vault_root(&app, root_path)?;
    let path = resolve_existing_folder_path(&root, &relative_path)?;
    open_folder(&path)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{
        is_reserved_archive_path, normalize_archive_relative_path, resolve_existing_epub_path,
        validate_archive_item_name, validate_epub_file_name,
    };

    fn test_root() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-filesystem-{nonce}"))
    }

    #[test]
    fn normalizes_archive_relative_paths() {
        assert_eq!(
            normalize_archive_relative_path("Author\\Series/./Volume.epub")
                .expect("path should normalize"),
            "Author/Series/Volume.epub"
        );
        assert!(normalize_archive_relative_path("../outside.epub").is_err());
        assert!(normalize_archive_relative_path(".archeion/library.json").is_err());
        assert!(is_reserved_archive_path(".archeion/covers/book.cover"));
    }

    #[test]
    fn validates_file_and_folder_names() {
        assert_eq!(
            validate_archive_item_name("Series").expect("name should be valid"),
            "Series"
        );
        assert_eq!(
            validate_epub_file_name("Volume.EPUB").expect("EPUB name should be valid"),
            "Volume.EPUB"
        );
        assert!(validate_archive_item_name("CON").is_err());
        assert!(validate_archive_item_name("bad/name").is_err());
        assert!(validate_archive_item_name("name.").is_err());
        assert!(validate_epub_file_name("notes.txt").is_err());
    }

    #[test]
    fn resolves_only_epubs_inside_the_archive() {
        let root = test_root();
        let book = root.join("Series").join("Volume.epub");
        fs::create_dir_all(book.parent().expect("book should have a parent"))
            .expect("series should be created");
        fs::write(&book, b"epub").expect("EPUB should be created");
        fs::create_dir_all(root.join(".archeion")).expect("metadata should be created");
        fs::write(root.join(".archeion").join("hidden.epub"), b"hidden")
            .expect("metadata EPUB should be created");

        assert_eq!(
            resolve_existing_epub_path(&root, "Series/Volume.epub").expect("EPUB should resolve"),
            fs::canonicalize(&book).expect("book path should canonicalize")
        );
        assert!(resolve_existing_epub_path(&root, ".archeion/hidden.epub").is_err());
        assert!(resolve_existing_epub_path(&root, "../outside.epub").is_err());
        assert!(resolve_existing_epub_path(&root, "missing.epub").is_err());
        fs::remove_dir_all(root).expect("test vault should be removed");
    }
}
