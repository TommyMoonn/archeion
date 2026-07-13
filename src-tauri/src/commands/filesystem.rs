use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::{Component, Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use super::archive_root;

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
        return Err("Archive paths must be relative to the archive folder.".to_string());
    }

    let mut parts = Vec::new();
    for component in path.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().trim().to_string()),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Archive paths cannot leave the archive folder.".to_string());
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
        return Err("The selected path is outside the archive folder.".to_string());
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

fn resolve_command_archive_root(
    app: &tauri::AppHandle,
    root_path: Option<String>,
) -> Result<PathBuf, String> {
    archive_root::resolve_archive_root(app, root_path)
}

#[tauri::command]
pub fn export_archive_epub_file(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_path: String,
    destination_path: String,
) -> Result<(), String> {
    let root = resolve_command_archive_root(&app, root_path)?;
    let source = resolve_existing_epub_path(&root, &relative_path)?;
    let destination_folder = PathBuf::from(destination_path);
    if !destination_folder.is_dir() {
        return Err("The export folder is unavailable.".to_string());
    }
    let file_name = source
        .file_name()
        .ok_or_else(|| "The EPUB file name is unavailable.".to_string())?;
    let destination = destination_folder.join(file_name);
    if destination.exists() {
        return Err("A file with this name already exists in the export folder.".to_string());
    }
    fs::copy(source, destination)
        .map(|_| ())
        .map_err(|error| error.to_string())
}

const MAX_ANNOTATION_EXPORT_BYTES: usize = 64 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AnnotationExportFormat {
    Json,
    Markdown,
}

impl AnnotationExportFormat {
    fn extension(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Markdown => "md",
        }
    }
}

fn annotation_export_destination_is_regular_file(destination: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(destination) {
        Ok(metadata) if metadata.file_type().is_file() => Ok(true),
        Ok(_) => Err("The annotation export destination must be a regular file.".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn write_annotation_export_file(
    path: String,
    contents: String,
    format: AnnotationExportFormat,
) -> Result<(), String> {
    if contents.len() > MAX_ANNOTATION_EXPORT_BYTES {
        return Err("The annotation export is too large to write safely.".to_string());
    }

    let destination = PathBuf::from(path);
    if !destination.is_absolute() {
        return Err("The annotation export destination must be an absolute path.".to_string());
    }
    let extension = destination
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !extension.eq_ignore_ascii_case(format.extension()) {
        return Err(format!(
            "This annotation export requires a .{} file name.",
            format.extension()
        ));
    }

    write_annotation_export_to_destination(&destination, &contents, |from, to| fs::rename(from, to))
}

fn write_annotation_export_to_destination<R>(
    destination: &Path,
    contents: &str,
    mut rename: R,
) -> Result<(), String>
where
    R: FnMut(&Path, &Path) -> std::io::Result<()>,
{
    let parent = destination
        .parent()
        .filter(|value| value.is_dir())
        .ok_or_else(|| "The annotation export folder is unavailable.".to_string())?;
    let file_name = destination
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "The annotation export file name is unavailable.".to_string())?;
    let replacing = annotation_export_destination_is_regular_file(destination)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    let temporary = parent.join(format!(".{file_name}.{nonce}.tmp"));
    let backup = parent.join(format!(".{file_name}.{nonce}.bak"));

    let write_result = (|| -> Result<(), String> {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(|error| error.to_string())?;
        file.write_all(contents.as_bytes())
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);

        if annotation_export_destination_is_regular_file(destination)? != replacing {
            return Err(
                "The annotation export destination changed before it was written.".to_string(),
            );
        }
        if replacing {
            rename(destination, &backup).map_err(|error| error.to_string())?;
        }
        if let Err(error) = rename(&temporary, destination) {
            if replacing {
                let _ = rename(&backup, destination);
            }
            return Err(error.to_string());
        }
        if replacing {
            let _ = fs::remove_file(&backup);
        }
        Ok(())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary);
        if backup.exists() && destination.exists() {
            let _ = fs::remove_file(backup);
        }
    }
    write_result
}

fn canonical_root(root: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(root).map_err(|_| "The saved archive folder is unavailable.".to_string())
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

#[cfg(any(target_os = "windows", test))]
const WINDOWS_EXTENDED_PATH_PREFIX: [u16; 4] =
    [b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16];
#[cfg(any(target_os = "windows", test))]
const WINDOWS_EXTENDED_UNC_PREFIX: [u16; 8] = [
    b'\\' as u16,
    b'\\' as u16,
    b'?' as u16,
    b'\\' as u16,
    b'U' as u16,
    b'N' as u16,
    b'C' as u16,
    b'\\' as u16,
];

#[cfg(any(target_os = "windows", test))]
fn ascii_uppercase_wide(value: u16) -> u16 {
    if (b'a' as u16..=b'z' as u16).contains(&value) {
        value - (b'a' - b'A') as u16
    } else {
        value
    }
}

#[cfg(any(target_os = "windows", test))]
fn wide_starts_with_ignore_ascii_case(value: &[u16], prefix: &[u16]) -> bool {
    value.len() >= prefix.len()
        && value
            .iter()
            .zip(prefix)
            .all(|(left, right)| ascii_uppercase_wide(*left) == ascii_uppercase_wide(*right))
}

#[cfg(any(target_os = "windows", test))]
fn normalize_windows_shell_path(mut path: Vec<u16>) -> Vec<u16> {
    if wide_starts_with_ignore_ascii_case(&path, &WINDOWS_EXTENDED_UNC_PREFIX) {
        let mut normalized = vec![b'\\' as u16, b'\\' as u16];
        normalized.extend_from_slice(&path[WINDOWS_EXTENDED_UNC_PREFIX.len()..]);
        path = normalized;
    } else if path.starts_with(&WINDOWS_EXTENDED_PATH_PREFIX) {
        path.drain(..WINDOWS_EXTENDED_PATH_PREFIX.len());
    }

    path.push(0);
    path
}

#[cfg(target_os = "windows")]
fn windows_shell_path(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;

    normalize_windows_shell_path(path.as_os_str().encode_wide().collect())
}

#[cfg(target_os = "windows")]
struct WindowsComApartment;

#[cfg(target_os = "windows")]
impl WindowsComApartment {
    fn initialize() -> Result<Self, String> {
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED};

        unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
            .ok()
            .map_err(|error| format!("Could not initialize Windows shell services. {error}"))?;
        Ok(Self)
    }
}

#[cfg(target_os = "windows")]
impl Drop for WindowsComApartment {
    fn drop(&mut self) {
        use windows::Win32::System::Com::CoUninitialize;

        unsafe { CoUninitialize() };
    }
}

#[cfg(target_os = "windows")]
fn move_to_windows_recycle_bin(path: &Path) -> Result<(), String> {
    use windows::{
        core::PCWSTR,
        Win32::{
            System::Com::{CoCreateInstance, CLSCTX_INPROC_SERVER},
            UI::Shell::{
                FileOperation, IFileOperation, IShellItem, SHCreateItemFromParsingName,
                FOFX_EARLYFAILURE, FOFX_RECYCLEONDELETE, FOF_NO_UI,
            },
        },
    };

    let _com_apartment = WindowsComApartment::initialize()?;
    let shell_path = windows_shell_path(path);

    unsafe {
        let operation: IFileOperation =
            CoCreateInstance(&FileOperation, None, CLSCTX_INPROC_SERVER).map_err(|error| {
                format!("Could not create the Windows recycle bin operation. {error}")
            })?;
        operation
            .SetOperationFlags(FOF_NO_UI | FOFX_EARLYFAILURE | FOFX_RECYCLEONDELETE)
            .map_err(|error| format!("Could not configure the recycle bin operation. {error}"))?;

        let item: IShellItem = SHCreateItemFromParsingName(PCWSTR(shell_path.as_ptr()), None)
            .map_err(|error| {
                format!("Could not prepare the selected item for the recycle bin. {error}")
            })?;
        operation
            .DeleteItem(&item, None)
            .map_err(|error| format!("Could not queue the recycle bin operation. {error}"))?;
        operation
            .PerformOperations()
            .map_err(|error| format!("Could not complete the recycle bin operation. {error}"))?;

        if operation
            .GetAnyOperationsAborted()
            .map_err(|error| format!("Could not confirm the recycle bin operation. {error}"))?
            .as_bool()
        {
            return Err("The recycle bin operation was cancelled.".to_string());
        }
    }

    Ok(())
}

#[cfg(target_os = "windows")]
fn trash_with_platform(path: &Path, _is_directory: bool) -> Result<(), String> {
    let path = path.to_path_buf();
    std::thread::Builder::new()
        .name("archeion-recycle-bin".to_string())
        .spawn(move || move_to_windows_recycle_bin(&path))
        .map_err(|error| format!("Could not start the recycle bin operation. {error}"))?
        .join()
        .map_err(|_| "The recycle bin operation stopped unexpectedly.".to_string())?
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

type TrashArchiveItem = fn(&Path, bool) -> Result<(), String>;

fn delete_archive_item_with_trash(
    path: &Path,
    is_directory: bool,
    trash_archive_item: TrashArchiveItem,
) -> Result<(), String> {
    trash_archive_item(path, is_directory).map_err(|error| {
        format!("Could not move this item to the trash. No files were deleted. {error}")
    })
}

fn delete_archive_item(path: &Path, is_directory: bool) -> Result<(), String> {
    delete_archive_item_with_trash(path, is_directory, trash_with_platform)
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
pub fn create_archive_folder(
    app: tauri::AppHandle,
    root_path: Option<String>,
    parent_relative_path: Option<String>,
    name: String,
) -> Result<String, String> {
    let root = resolve_command_archive_root(&app, root_path)?;
    create_archive_folder_at(&root, parent_relative_path.as_deref(), &name)
}

#[tauri::command]
pub fn rename_archive_epub_file(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_path: String,
    new_file_name: String,
) -> Result<ArchivePathChange, String> {
    let root = resolve_command_archive_root(&app, root_path)?;
    rename_archive_epub_at(&root, &relative_path, &new_file_name)
}

#[tauri::command]
pub fn move_archive_epub_file(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_path: String,
    destination_folder_path: Option<String>,
) -> Result<ArchivePathChange, String> {
    let root = resolve_command_archive_root(&app, root_path)?;
    move_archive_epub_at(&root, &relative_path, destination_folder_path.as_deref())
}

#[tauri::command]
pub fn rename_archive_folder(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_path: String,
    new_name: String,
) -> Result<ArchivePathChange, String> {
    let root = resolve_command_archive_root(&app, root_path)?;
    rename_archive_folder_at(&root, &relative_path, &new_name)
}

#[tauri::command]
pub fn move_archive_folder(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_path: String,
    destination_parent_path: Option<String>,
) -> Result<ArchivePathChange, String> {
    let root = resolve_command_archive_root(&app, root_path)?;
    move_archive_folder_at(&root, &relative_path, destination_parent_path.as_deref())
}

#[tauri::command]
pub fn delete_archive_epub_file(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_path: String,
) -> Result<(), String> {
    let root = resolve_command_archive_root(&app, root_path)?;
    delete_archive_epub_at(&root, &relative_path)
}

#[tauri::command]
pub fn delete_archive_folder(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_path: String,
) -> Result<(), String> {
    let root = resolve_command_archive_root(&app, root_path)?;
    delete_archive_folder_at(&root, &relative_path)
}

#[tauri::command]
pub fn reveal_archive_folder(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_path: String,
) -> Result<(), String> {
    let root = resolve_command_archive_root(&app, root_path)?;
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
        delete_archive_item_with_trash, is_reserved_archive_path, normalize_archive_relative_path,
        normalize_windows_shell_path, resolve_existing_epub_path, validate_archive_item_name,
        validate_epub_file_name, write_annotation_export_file,
        write_annotation_export_to_destination, AnnotationExportFormat,
    };

    fn test_root() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-filesystem-{nonce}"))
    }

    fn test_trash_success(path: &std::path::Path, is_directory: bool) -> Result<(), String> {
        if is_directory {
            fs::remove_dir_all(path).map_err(|error| error.to_string())
        } else {
            fs::remove_file(path).map_err(|error| error.to_string())
        }
    }

    fn test_trash_failure(_path: &std::path::Path, _is_directory: bool) -> Result<(), String> {
        Err("trash unavailable".to_string())
    }

    #[test]
    fn normalizes_extended_windows_paths_for_shell_operations() {
        let local =
            normalize_windows_shell_path(r"\\?\C:\Archive\Novel.epub".encode_utf16().collect());
        let unc =
            normalize_windows_shell_path(r"\\?\unc\server\library\Series".encode_utf16().collect());
        let regular =
            normalize_windows_shell_path(r"C:\Archive\Novel.epub".encode_utf16().collect());

        assert_eq!(
            local,
            r"C:\Archive\Novel.epub"
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            unc,
            r"\\server\library\Series"
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect::<Vec<_>>()
        );
        assert_eq!(
            regular,
            r"C:\Archive\Novel.epub"
                .encode_utf16()
                .chain(std::iter::once(0))
                .collect::<Vec<_>>()
        );
    }

    #[test]
    fn delete_file_uses_trash_without_permanent_fallback() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let path = root.join("Novel.epub");
        fs::write(&path, b"epub").expect("test EPUB should exist");

        delete_archive_item_with_trash(&path, false, test_trash_failure)
            .expect_err("trash failure should fail delete");

        assert!(path.is_file());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn delete_folder_uses_trash_without_permanent_fallback() {
        let root = test_root();
        let path = root.join("Series");
        fs::create_dir_all(&path).expect("test folder should exist");
        fs::write(path.join("Novel.epub"), b"epub").expect("test EPUB should exist");

        delete_archive_item_with_trash(&path, true, test_trash_failure)
            .expect_err("trash failure should fail delete");

        assert!(path.is_dir());
        assert!(path.join("Novel.epub").is_file());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn delete_file_succeeds_when_trash_succeeds() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let path = root.join("Novel.epub");
        fs::write(&path, b"epub").expect("test EPUB should exist");

        delete_archive_item_with_trash(&path, false, test_trash_success)
            .expect("trash success should delete file");

        assert!(!path.exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn delete_folder_succeeds_when_trash_succeeds() {
        let root = test_root();
        let path = root.join("Series");
        fs::create_dir_all(&path).expect("test folder should exist");

        delete_archive_item_with_trash(&path, true, test_trash_success)
            .expect("trash success should delete folder");

        assert!(!path.exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
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
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn writes_annotation_exports_only_after_the_complete_temporary_file_is_ready() {
        let root = test_root();
        fs::create_dir_all(&root).expect("export folder should be created");
        let destination = root.join("annotations.md");
        fs::write(&destination, "old export").expect("existing export should be created");

        write_annotation_export_file(
            destination.to_string_lossy().to_string(),
            "# Complete export\n".to_string(),
            AnnotationExportFormat::Markdown,
        )
        .expect("annotation export should be written");

        assert_eq!(
            fs::read_to_string(&destination).expect("export should be readable"),
            "# Complete export\n"
        );
        assert_eq!(
            fs::read_dir(&root)
                .expect("export folder should be readable")
                .count(),
            1
        );
        fs::remove_dir_all(root).expect("test export folder should be removed");
    }

    #[test]
    fn rejects_annotation_export_paths_without_a_supported_extension() {
        let root = test_root();
        fs::create_dir_all(&root).expect("export folder should be created");
        let destination = root.join("annotations.txt");

        assert!(write_annotation_export_file(
            destination.to_string_lossy().to_string(),
            "not written".to_string(),
            AnnotationExportFormat::Markdown,
        )
        .is_err());
        assert!(!destination.exists());
        fs::remove_dir_all(root).expect("test export folder should be removed");
    }

    #[test]
    fn rejects_annotation_export_format_extension_mismatches_before_writing() {
        let root = test_root();
        fs::create_dir_all(&root).expect("export folder should be created");
        let destination = root.join("annotations.json");

        assert!(write_annotation_export_file(
            destination.to_string_lossy().to_string(),
            "# Markdown".to_string(),
            AnnotationExportFormat::Markdown,
        )
        .is_err());
        assert!(fs::read_dir(&root)
            .expect("export folder should be readable")
            .next()
            .is_none());
        fs::remove_dir_all(root).expect("test export folder should be removed");
    }

    #[test]
    fn rejects_existing_non_file_annotation_export_destinations() {
        let root = test_root();
        let destination = root.join("annotations.md");
        fs::create_dir_all(&destination).expect("directory destination should be created");

        assert!(write_annotation_export_file(
            destination.to_string_lossy().to_string(),
            "# Markdown".to_string(),
            AnnotationExportFormat::Markdown,
        )
        .is_err());
        assert!(destination.is_dir());
        assert_eq!(
            fs::read_dir(&root)
                .expect("export folder should be readable")
                .count(),
            1
        );
        fs::remove_dir_all(root).expect("test export folder should be removed");
    }

    #[test]
    fn failed_annotation_export_replacement_restores_the_original_without_temporary_files() {
        let root = test_root();
        fs::create_dir_all(&root).expect("export folder should be created");
        let destination = root.join("annotations.md");
        fs::write(&destination, "original export").expect("original export should be created");
        let mut rename_count = 0;

        let result = write_annotation_export_to_destination(
            &destination,
            "replacement export",
            |from, to| {
                rename_count += 1;
                if rename_count == 2 {
                    return Err(std::io::Error::new(
                        std::io::ErrorKind::PermissionDenied,
                        "replacement blocked",
                    ));
                }
                fs::rename(from, to)
            },
        );

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(&destination).expect("original export should be restored"),
            "original export"
        );
        assert_eq!(
            fs::read_dir(&root)
                .expect("export folder should be readable")
                .count(),
            1
        );
        fs::remove_dir_all(root).expect("test export folder should be removed");
    }
}
