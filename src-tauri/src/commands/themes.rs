use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use serde_json::Value;

use super::{archive_root, filesystem};

const THEMES_DIRECTORY: &str = "themes";
const THEME_MANIFEST_FILE: &str = "theme.json";
const MAX_THEME_MANIFEST_BYTES: usize = 256 * 1024;
static TRANSACTION_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn transaction_suffix() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let sequence = TRANSACTION_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{timestamp}-{sequence}")
}

fn validate_theme_id(id: &str) -> Result<String, String> {
    let bytes = id.as_bytes();
    let valid_contract = (3..=64).contains(&bytes.len())
        && bytes
            .first()
            .is_some_and(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit())
        && bytes.iter().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'_' | b'-')
        });
    if !valid_contract {
        return Err("The theme identifier is invalid.".to_string());
    }
    filesystem::validate_archive_item_name(id)
        .map_err(|error| format!("The theme identifier is invalid. {error}"))?;
    Ok(id.to_string())
}

fn ensure_owned_directory(path: &Path, create: bool, label: &str) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err(format!("The {label} cannot be a symbolic link."))
        }
        Ok(metadata) if metadata.is_dir() => Ok(true),
        Ok(_) => Err(format!("The {label} is not a directory.")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound && create => {
            fs::create_dir(path).map_err(|error| error.to_string())?;
            Ok(true)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

fn themes_root_at(root: &Path, create: bool) -> Result<Option<PathBuf>, String> {
    let archive_root = fs::canonicalize(root)
        .map_err(|_| "The selected archive folder is unavailable.".to_string())?;
    if !archive_root.is_dir() {
        return Err("The selected archive folder is unavailable.".to_string());
    }

    let metadata_root = archive_root.join(filesystem::METADATA_DIRECTORY);
    if !ensure_owned_directory(&metadata_root, create, "archive metadata directory")? {
        return Ok(None);
    }
    let canonical_metadata = fs::canonicalize(&metadata_root).map_err(|error| error.to_string())?;
    if canonical_metadata.parent() != Some(archive_root.as_path()) {
        return Err("The archive metadata directory is outside the archive.".to_string());
    }

    let themes_root = canonical_metadata.join(THEMES_DIRECTORY);
    if !ensure_owned_directory(&themes_root, create, "archive themes directory")? {
        return Ok(None);
    }
    let canonical_themes = fs::canonicalize(&themes_root).map_err(|error| error.to_string())?;
    if canonical_themes.parent() != Some(canonical_metadata.as_path()) {
        return Err("The archive themes directory is outside archive metadata.".to_string());
    }
    Ok(Some(canonical_themes))
}

fn resolve_existing_package_at(root: &Path, id: &str) -> Result<PathBuf, String> {
    let id = validate_theme_id(id)?;
    let themes_root = themes_root_at(root, false)?
        .ok_or_else(|| "The selected theme package does not exist.".to_string())?;
    let package = themes_root.join(id);
    let metadata = fs::symlink_metadata(&package)
        .map_err(|_| "The selected theme package does not exist.".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("The selected theme package must be a regular directory.".to_string());
    }
    let canonical_package = fs::canonicalize(&package)
        .map_err(|_| "The selected theme package is unavailable.".to_string())?;
    if canonical_package.parent() != Some(themes_root.as_path()) {
        return Err(
            "The selected theme package is outside the archive themes directory.".to_string(),
        );
    }
    Ok(canonical_package)
}

fn normalize_manifest_json(id: &str, manifest_json: &str) -> Result<Vec<u8>, String> {
    let id = validate_theme_id(id)?;
    if manifest_json.len() > MAX_THEME_MANIFEST_BYTES {
        return Err("The theme manifest is too large to store safely.".to_string());
    }
    let value: Value = serde_json::from_str(manifest_json)
        .map_err(|error| format!("The theme manifest is not valid JSON. {error}"))?;
    let manifest_id = value
        .as_object()
        .and_then(|object| object.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| "The theme manifest must contain a string id.".to_string())?;
    if manifest_id != id {
        return Err(format!(
            "Theme id \"{manifest_id}\" must match package directory \"{id}\"."
        ));
    }
    let mut normalized = serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?;
    normalized.push(b'\n');
    if normalized.len() > MAX_THEME_MANIFEST_BYTES {
        return Err("The normalized theme manifest is too large to store safely.".to_string());
    }
    Ok(normalized)
}

fn write_new_synced_file(path: &Path, contents: &[u8]) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|error| error.to_string())?;
    file.write_all(contents)
        .map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())
}

fn create_theme_package_at(root: &Path, id: &str, manifest_json: &str) -> Result<(), String> {
    let id = validate_theme_id(id)?;
    let normalized = normalize_manifest_json(&id, manifest_json)?;
    let themes_root = themes_root_at(root, true)?
        .ok_or_else(|| "The archive themes directory is unavailable.".to_string())?;
    let destination = themes_root.join(&id);
    match fs::symlink_metadata(&destination) {
        Ok(_) => {
            return Err("A theme package with this identifier already exists.".to_string());
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.to_string()),
    }

    let temporary = themes_root.join(format!(".{id}.create-{}.tmp", transaction_suffix()));
    fs::create_dir(&temporary).map_err(|error| error.to_string())?;
    let result = (|| -> Result<(), String> {
        write_new_synced_file(&temporary.join(THEME_MANIFEST_FILE), &normalized)?;
        fs::rename(&temporary, &destination).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&temporary);
    }
    result
}

trait ThemeFileSystem {
    fn rename(&self, source: &Path, destination: &Path) -> Result<(), String>;
}

struct RealThemeFileSystem;

impl ThemeFileSystem for RealThemeFileSystem {
    fn rename(&self, source: &Path, destination: &Path) -> Result<(), String> {
        fs::rename(source, destination).map_err(|error| error.to_string())
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ManifestState {
    Missing,
    RegularFile,
}

fn manifest_state(path: &Path) -> Result<ManifestState, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err("theme.json cannot be a symbolic link.".to_string())
        }
        Ok(metadata) if metadata.is_file() => Ok(ManifestState::RegularFile),
        Ok(_) => Err("theme.json must be a regular file.".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(ManifestState::Missing),
        Err(error) => Err(error.to_string()),
    }
}

fn replace_manifest_with_fs(
    package: &Path,
    contents: &[u8],
    fs_ops: &impl ThemeFileSystem,
) -> Result<(), String> {
    let manifest = package.join(THEME_MANIFEST_FILE);
    let initial_state = manifest_state(&manifest)?;
    let suffix = transaction_suffix();
    let temporary = package.join(format!(".{THEME_MANIFEST_FILE}.{suffix}.tmp"));
    let backup = package.join(format!(".{THEME_MANIFEST_FILE}.{suffix}.bak"));
    write_new_synced_file(&temporary, contents)?;

    let result = (|| -> Result<(), String> {
        if manifest_state(&manifest)? != initial_state {
            return Err("theme.json changed before it could be replaced.".to_string());
        }
        if initial_state == ManifestState::RegularFile {
            fs_ops.rename(&manifest, &backup)?;
        }
        if let Err(error) = fs_ops.rename(&temporary, &manifest) {
            if initial_state == ManifestState::RegularFile {
                return match fs_ops.rename(&backup, &manifest) {
                    Ok(()) => Err(format!(
                        "Theme replacement failed and the previous manifest was restored: {error}"
                    )),
                    Err(restore_error) => Err(format!(
                        "Theme replacement failed and the previous manifest could not be restored: {restore_error}"
                    )),
                };
            }
            return Err(error);
        }
        if initial_state == ManifestState::RegularFile {
            fs::remove_file(&backup).map_err(|error| error.to_string())?;
        }
        Ok(())
    })();

    if result.is_err() {
        let _ = fs::remove_file(&temporary);
        if backup.exists() && manifest.exists() {
            let _ = fs::remove_file(&backup);
        }
    }
    result
}

fn replace_theme_manifest_at(root: &Path, id: &str, manifest_json: &str) -> Result<(), String> {
    let normalized = normalize_manifest_json(id, manifest_json)?;
    let package = resolve_existing_package_at(root, id)?;
    replace_manifest_with_fs(&package, &normalized, &RealThemeFileSystem)
}

fn list_theme_packages_at(root: &Path) -> Result<Vec<String>, String> {
    let Some(themes_root) = themes_root_at(root, false)? else {
        return Ok(Vec::new());
    };
    let mut packages = Vec::new();
    for entry in fs::read_dir(&themes_root).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let Some(name) = entry.file_name().to_str().map(str::to_string) else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if !file_type.is_dir() || file_type.is_symlink() {
            continue;
        }
        let resolved = match fs::canonicalize(entry.path()) {
            Ok(path) => path,
            Err(_) => continue,
        };
        if resolved.parent() == Some(themes_root.as_path()) {
            packages.push(name);
        }
    }
    packages.sort();
    Ok(packages)
}

fn read_theme_manifest_at(root: &Path, id: &str) -> Result<String, String> {
    let package = resolve_existing_package_at(root, id)?;
    let manifest = package.join(THEME_MANIFEST_FILE);
    let metadata = fs::symlink_metadata(&manifest)
        .map_err(|_| "The selected theme manifest does not exist.".to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("theme.json must be a regular file.".to_string());
    }
    if metadata.len() > MAX_THEME_MANIFEST_BYTES as u64 {
        return Err("The theme manifest is too large to read safely.".to_string());
    }
    let canonical_manifest = fs::canonicalize(&manifest)
        .map_err(|_| "The selected theme manifest is unavailable.".to_string())?;
    if canonical_manifest.parent() != Some(package.as_path()) {
        return Err("The selected theme manifest is outside its package.".to_string());
    }

    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    File::open(&canonical_manifest)
        .map_err(|error| error.to_string())?
        .take((MAX_THEME_MANIFEST_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() > MAX_THEME_MANIFEST_BYTES {
        return Err("The theme manifest grew beyond the safe read limit.".to_string());
    }
    String::from_utf8(bytes).map_err(|_| "The theme manifest must use UTF-8.".to_string())
}

fn delete_theme_package_at(root: &Path, id: &str) -> Result<(), String> {
    let package = resolve_existing_package_at(root, id)?;
    let metadata = fs::symlink_metadata(&package).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("The selected theme package must be a regular directory.".to_string());
    }
    fs::remove_dir_all(package).map_err(|error| error.to_string())
}

fn resolve_command_archive_root(
    app: &tauri::AppHandle,
    root_path: Option<String>,
) -> Result<PathBuf, String> {
    archive_root::resolve_archive_root(app, root_path)
}

#[tauri::command]
pub fn list_archive_theme_packages(
    app: tauri::AppHandle,
    root_path: Option<String>,
) -> Result<Vec<String>, String> {
    list_theme_packages_at(&resolve_command_archive_root(&app, root_path)?)
}

#[tauri::command]
pub fn read_archive_theme_manifest(
    app: tauri::AppHandle,
    root_path: Option<String>,
    id: String,
) -> Result<String, String> {
    read_theme_manifest_at(&resolve_command_archive_root(&app, root_path)?, &id)
}

#[tauri::command]
pub fn store_archive_theme_manifest(
    app: tauri::AppHandle,
    root_path: Option<String>,
    id: String,
    manifest_json: String,
) -> Result<(), String> {
    create_theme_package_at(
        &resolve_command_archive_root(&app, root_path)?,
        &id,
        &manifest_json,
    )
}

#[tauri::command]
pub fn replace_archive_theme_manifest(
    app: tauri::AppHandle,
    root_path: Option<String>,
    id: String,
    manifest_json: String,
) -> Result<(), String> {
    replace_theme_manifest_at(
        &resolve_command_archive_root(&app, root_path)?,
        &id,
        &manifest_json,
    )
}

#[tauri::command]
pub fn delete_archive_theme_package(
    app: tauri::AppHandle,
    root_path: Option<String>,
    id: String,
) -> Result<(), String> {
    delete_theme_package_at(&resolve_command_archive_root(&app, root_path)?, &id)
}

#[tauri::command]
pub fn reveal_archive_themes_folder(
    app: tauri::AppHandle,
    root_path: Option<String>,
) -> Result<(), String> {
    let root = resolve_command_archive_root(&app, root_path)?;
    let themes = themes_root_at(&root, true)?
        .ok_or_else(|| "The archive themes directory is unavailable.".to_string())?;
    filesystem::open_folder(&themes)
}

#[cfg(test)]
mod tests {
    use std::{fs, path::Path, time::SystemTime};

    use super::{
        create_theme_package_at, delete_theme_package_at, list_theme_packages_at,
        normalize_manifest_json, read_theme_manifest_at, replace_manifest_with_fs,
        replace_theme_manifest_at, themes_root_at, validate_theme_id, ThemeFileSystem,
        MAX_THEME_MANIFEST_BYTES,
    };

    fn test_root(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-themes-{label}-{nonce}"));
        fs::create_dir_all(&root).expect("test archive should be created");
        root
    }

    fn manifest(id: &str, name: &str) -> String {
        serde_json::json!({
            "$schema": "https://tommymoonn.github.io/archeion/schemas/archeion-theme-v1.schema.json",
            "schemaVersion": 1,
            "id": id,
            "name": name,
            "base": "dark",
            "app": { "accent": "#8fc1e3" }
        })
        .to_string()
    }

    #[test]
    fn validates_contract_ids_and_rejects_windows_or_traversal_names() {
        assert_eq!(validate_theme_id("moon-ink").unwrap(), "moon-ink");
        for id in ["../outside", "ab", "Theme", "con", "com1.theme", "theme."] {
            assert!(validate_theme_id(id).is_err(), "{id} should be rejected");
        }
    }

    #[test]
    fn lists_only_direct_visible_owned_directories_without_creating_the_root() {
        let root = test_root("list");
        assert!(list_theme_packages_at(&root).unwrap().is_empty());
        assert!(!root.join(".archeion").join("themes").exists());
        let themes = themes_root_at(&root, true).unwrap().unwrap();
        fs::create_dir(themes.join("paper-light")).unwrap();
        fs::create_dir(themes.join("moon-ink")).unwrap();
        fs::create_dir(themes.join(".hidden")).unwrap();
        fs::write(themes.join("not-a-package"), b"file").unwrap();
        fs::create_dir_all(themes.join("moon-ink").join("nested-theme")).unwrap();

        assert_eq!(
            list_theme_packages_at(&root).unwrap(),
            vec!["moon-ink", "paper-light"]
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stores_normalized_json_and_reads_only_theme_json() {
        let root = test_root("store-read");
        create_theme_package_at(&root, "moon-ink", &manifest("moon-ink", "Moon Ink")).unwrap();
        let package = root.join(".archeion").join("themes").join("moon-ink");
        fs::write(package.join("ignored.txt"), b"ignored").unwrap();

        let source = read_theme_manifest_at(&root, "moon-ink").unwrap();
        let value: serde_json::Value = serde_json::from_str(&source).unwrap();
        assert_eq!(value["id"], "moon-ink");
        assert!(source.ends_with('\n'));
        assert_eq!(list_theme_packages_at(&root).unwrap(), vec!["moon-ink"]);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_or_mismatched_store_creates_no_package() {
        let root = test_root("invalid-store");
        for source in ["{invalid", &manifest("other-theme", "Other")] {
            assert!(create_theme_package_at(&root, "moon-ink", source).is_err());
        }
        assert!(!root
            .join(".archeion")
            .join("themes")
            .join("moon-ink")
            .exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_oversized_store_and_read_inputs() {
        let root = test_root("size-limit");
        let oversized = "x".repeat(MAX_THEME_MANIFEST_BYTES + 1);
        assert!(create_theme_package_at(&root, "moon-ink", &oversized).is_err());

        let themes = themes_root_at(&root, true).unwrap().unwrap();
        let package = themes.join("moon-ink");
        fs::create_dir(&package).unwrap();
        fs::write(
            package.join("theme.json"),
            vec![b'x'; MAX_THEME_MANIFEST_BYTES + 1],
        )
        .unwrap();
        assert!(read_theme_manifest_at(&root, "moon-ink").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_non_utf8_and_non_regular_manifests() {
        let root = test_root("manifest-file");
        let themes = themes_root_at(&root, true).unwrap().unwrap();
        let package = themes.join("moon-ink");
        fs::create_dir(&package).unwrap();
        fs::write(package.join("theme.json"), [0xff, 0xfe]).unwrap();
        assert!(read_theme_manifest_at(&root, "moon-ink").is_err());
        fs::remove_file(package.join("theme.json")).unwrap();
        fs::create_dir(package.join("theme.json")).unwrap();
        assert!(read_theme_manifest_at(&root, "moon-ink").is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn store_never_overwrites_an_existing_package() {
        let root = test_root("store-conflict");
        create_theme_package_at(&root, "moon-ink", &manifest("moon-ink", "First")).unwrap();
        assert!(
            create_theme_package_at(&root, "moon-ink", &manifest("moon-ink", "Second")).is_err()
        );
        let source = read_theme_manifest_at(&root, "moon-ink").unwrap();
        assert!(source.contains("First"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn read_returns_mismatched_json_for_catalog_validation() {
        let root = test_root("read-mismatch");
        let themes = themes_root_at(&root, true).unwrap().unwrap();
        let package = themes.join("moon-ink");
        fs::create_dir(&package).unwrap();
        fs::write(
            package.join("theme.json"),
            manifest("paper-light", "Mismatch"),
        )
        .unwrap();

        let source = read_theme_manifest_at(&root, "moon-ink").unwrap();
        let value: serde_json::Value = serde_json::from_str(&source).unwrap();

        assert_eq!(value["id"], "paper-light");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn read_returns_malformed_json_for_catalog_validation() {
        let root = test_root("read-malformed");
        let themes = themes_root_at(&root, true).unwrap().unwrap();
        let package = themes.join("moon-ink");
        fs::create_dir(&package).unwrap();
        fs::write(package.join("theme.json"), "{invalid").unwrap();

        assert_eq!(
            read_theme_manifest_at(&root, "moon-ink").unwrap(),
            "{invalid"
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn replacement_preserves_ignored_package_files() {
        let root = test_root("replace");
        create_theme_package_at(&root, "moon-ink", &manifest("moon-ink", "First")).unwrap();
        let extra = root
            .join(".archeion")
            .join("themes")
            .join("moon-ink")
            .join("LICENSE.txt");
        fs::write(&extra, b"keep").unwrap();

        replace_theme_manifest_at(&root, "moon-ink", &manifest("moon-ink", "Second")).unwrap();

        assert!(read_theme_manifest_at(&root, "moon-ink")
            .unwrap()
            .contains("Second"));
        assert_eq!(fs::read(extra).unwrap(), b"keep");
        fs::remove_dir_all(root).unwrap();
    }

    struct FailFinalManifestRename;

    impl ThemeFileSystem for FailFinalManifestRename {
        fn rename(&self, source: &Path, destination: &Path) -> Result<(), String> {
            let source_name = source
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            let destination_name = destination
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            if source_name.ends_with(".tmp") && destination_name == "theme.json" {
                return Err("simulated final rename failure".to_string());
            }
            fs::rename(source, destination).map_err(|error| error.to_string())
        }
    }

    #[test]
    fn failed_replacement_restores_the_previous_manifest_without_temporary_files() {
        let root = test_root("replace-restore");
        create_theme_package_at(&root, "moon-ink", &manifest("moon-ink", "First")).unwrap();
        let package = root.join(".archeion").join("themes").join("moon-ink");
        let replacement =
            normalize_manifest_json("moon-ink", &manifest("moon-ink", "Second")).unwrap();

        let error = replace_manifest_with_fs(&package, &replacement, &FailFinalManifestRename)
            .expect_err("replacement should fail");

        assert!(error.contains("restored"));
        assert!(read_theme_manifest_at(&root, "moon-ink")
            .unwrap()
            .contains("First"));
        assert_eq!(fs::read_dir(&package).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn deletion_removes_the_complete_managed_package() {
        let root = test_root("delete");
        create_theme_package_at(&root, "moon-ink", &manifest("moon-ink", "Moon Ink")).unwrap();
        let package = root.join(".archeion").join("themes").join("moon-ink");
        fs::create_dir(package.join("extra-assets")).unwrap();
        fs::write(package.join("extra-assets").join("ignored.bin"), b"ignored").unwrap();

        delete_theme_package_at(&root, "moon-ink").unwrap();

        assert!(!package.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(any(unix, windows))]
    fn create_directory_symlink(target: &Path, link: &Path) -> std::io::Result<()> {
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(target, link)
        }
        #[cfg(windows)]
        {
            match std::os::windows::fs::symlink_dir(target, link) {
                Ok(()) => Ok(()),
                Err(error) if error.raw_os_error() == Some(1314) => {
                    let status = std::process::Command::new("cmd")
                        .args(["/c", "mklink", "/J"])
                        .arg(link)
                        .arg(target)
                        .status()?;
                    status
                        .success()
                        .then_some(())
                        .ok_or_else(|| std::io::Error::other("junction creation failed"))
                }
                Err(error) => Err(error),
            }
        }
    }

    #[test]
    fn package_symlinks_cannot_escape_repository_ownership() {
        let root = test_root("package-symlink");
        let outside = test_root("outside-package");
        fs::write(outside.join("theme.json"), manifest("moon-ink", "Outside")).unwrap();
        let themes = themes_root_at(&root, true).unwrap().unwrap();
        let link = themes.join("moon-ink");
        create_directory_symlink(&outside, &link)
            .unwrap_or_else(|error| panic!("symlink setup failed: {error}"));

        assert!(list_theme_packages_at(&root).unwrap().is_empty());
        assert!(read_theme_manifest_at(&root, "moon-ink").is_err());
        assert!(delete_theme_package_at(&root, "moon-ink").is_err());
        assert!(outside.join("theme.json").is_file());
        fs::remove_file(&link).unwrap_or_else(|_| fs::remove_dir(&link).unwrap());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }

    #[test]
    fn themes_root_symlinks_cannot_redirect_package_creation() {
        let root = test_root("themes-root-symlink");
        let outside = test_root("outside-themes-root");
        let metadata = root.join(".archeion");
        fs::create_dir(&metadata).unwrap();
        let link = metadata.join("themes");
        create_directory_symlink(&outside, &link)
            .unwrap_or_else(|error| panic!("symlink setup failed: {error}"));

        assert!(list_theme_packages_at(&root).is_err());
        assert!(
            create_theme_package_at(&root, "moon-ink", &manifest("moon-ink", "Moon Ink")).is_err()
        );
        assert!(!outside.join("moon-ink").exists());
        fs::remove_file(&link).unwrap_or_else(|_| fs::remove_dir(&link).unwrap());
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(outside).unwrap();
    }
}
