use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::{
    filesystem,
    themes::{
        ensure_owned_directory, resolve_app_data_root, themes_root_at, transaction_suffix,
        validate_theme_id, write_new_synced_file, MAX_THEME_MANIFEST_BYTES, THEMES_DIRECTORY,
        THEME_MANIFEST_FILE,
    },
};

const MAX_THEME_PACKAGE_BYTES: u64 = 64 * 1024 * 1024;
const MAX_THEME_PACKAGE_ENTRIES: usize = 2_048;
const THEME_MIGRATION_VERSION: u8 = 1;
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThemeMigrationReport {
    pub version: u8,
    pub records: Vec<ThemeMigrationRecord>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) enum ThemeMigrationAction {
    Copied,
    ConflictCopied,
    Deduplicated,
    Skipped,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ThemeMigrationRecord {
    pub action: ThemeMigrationAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub package_sha256: Option<String>,
    pub source_archive: String,
    pub source_id: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ThemePackageFile {
    bytes: Vec<u8>,
    relative_path: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ThemePackageContent {
    directories: Vec<String>,
    files: Vec<ThemePackageFile>,
}

impl ThemePackageContent {
    fn sha256(&self) -> String {
        let mut hasher = Sha256::new();
        for directory in &self.directories {
            hasher.update(b"directory\0");
            hasher.update(directory.as_bytes());
            hasher.update(b"\0");
        }
        for file in &self.files {
            hasher.update(b"file\0");
            hasher.update(file.relative_path.as_bytes());
            hasher.update(b"\0");
            hasher.update((file.bytes.len() as u64).to_le_bytes());
            hasher.update(&file.bytes);
        }
        format!("{:x}", hasher.finalize())
    }

    fn with_manifest_id(&self, destination_id: &str) -> Result<Self, String> {
        let mut content = self.clone();
        let manifest = content
            .files
            .iter_mut()
            .find(|file| file.relative_path == THEME_MANIFEST_FILE)
            .ok_or_else(|| "The legacy theme package has no theme.json file.".to_string())?;
        let mut value: Value = serde_json::from_slice(&manifest.bytes)
            .map_err(|error| format!("The legacy theme manifest is not valid JSON. {error}"))?;
        let object = value
            .as_object_mut()
            .ok_or_else(|| "The legacy theme manifest must be a JSON object.".to_string())?;
        object.insert("id".to_string(), Value::String(destination_id.to_string()));
        manifest.bytes = serde_json::to_vec_pretty(&value).map_err(|error| error.to_string())?;
        manifest.bytes.push(b'\n');
        if manifest.bytes.len() > MAX_THEME_MANIFEST_BYTES {
            return Err("The migrated theme manifest is too large.".to_string());
        }
        Ok(content)
    }
}

fn package_relative_path(root: &Path, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(root)
        .map_err(|_| "A legacy theme package path escaped its package root.".to_string())?;
    let components = relative
        .components()
        .map(|component| {
            component
                .as_os_str()
                .to_str()
                .ok_or_else(|| "Legacy theme package paths must use UTF-8.".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(components.join("/"))
}

fn read_package_directory(
    package_root: &Path,
    directory: &Path,
    content: &mut ThemePackageContent,
    entry_count: &mut usize,
    total_bytes: &mut u64,
) -> Result<(), String> {
    let mut entries = fs::read_dir(directory)
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    entries.sort_by_key(std::fs::DirEntry::file_name);

    for entry in entries {
        *entry_count += 1;
        if *entry_count > MAX_THEME_PACKAGE_ENTRIES {
            return Err("The legacy theme package contains too many entries.".to_string());
        }
        let path = entry.path();
        let metadata = fs::symlink_metadata(&path).map_err(|error| error.to_string())?;
        if metadata.file_type().is_symlink() {
            return Err("Legacy theme packages cannot contain symbolic links.".to_string());
        }
        let relative_path = package_relative_path(package_root, &path)?;
        if metadata.is_dir() {
            content.directories.push(relative_path);
            read_package_directory(package_root, &path, content, entry_count, total_bytes)?;
        } else if metadata.is_file() {
            *total_bytes = total_bytes
                .checked_add(metadata.len())
                .ok_or_else(|| "The legacy theme package is too large.".to_string())?;
            if *total_bytes > MAX_THEME_PACKAGE_BYTES {
                return Err("The legacy theme package is too large.".to_string());
            }
            let bytes = fs::read(&path).map_err(|error| error.to_string())?;
            if bytes.len() as u64 != metadata.len() {
                return Err("A legacy theme package file changed while it was read.".to_string());
            }
            content.files.push(ThemePackageFile {
                bytes,
                relative_path,
            });
        } else {
            return Err(
                "Legacy theme packages can contain only files and directories.".to_string(),
            );
        }
    }
    Ok(())
}

fn read_theme_package_content(package: &Path) -> Result<ThemePackageContent, String> {
    let metadata = fs::symlink_metadata(package).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err("The legacy theme package must be a regular directory.".to_string());
    }
    let mut content = ThemePackageContent {
        directories: Vec::new(),
        files: Vec::new(),
    };
    read_package_directory(package, package, &mut content, &mut 0, &mut 0)?;
    content.directories.sort();
    content
        .files
        .sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    Ok(content)
}

fn validate_legacy_theme_package(id: &str, content: &ThemePackageContent) -> Result<(), String> {
    validate_theme_id(id)?;
    let manifest = content
        .files
        .iter()
        .find(|file| file.relative_path == THEME_MANIFEST_FILE)
        .ok_or_else(|| "The legacy theme package has no theme.json file.".to_string())?;
    if manifest.bytes.len() > MAX_THEME_MANIFEST_BYTES {
        return Err("The legacy theme manifest is too large.".to_string());
    }
    let value: Value = serde_json::from_slice(&manifest.bytes)
        .map_err(|error| format!("The legacy theme manifest is not valid JSON. {error}"))?;
    let manifest_id = value
        .as_object()
        .and_then(|object| object.get("id"))
        .and_then(Value::as_str)
        .ok_or_else(|| "The legacy theme manifest must contain a string id.".to_string())?;
    if manifest_id != id {
        return Err(format!(
            "Theme id \"{manifest_id}\" must match package directory \"{id}\"."
        ));
    }
    Ok(())
}

fn path_exists_without_following(path: &Path) -> Result<bool, String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.to_string()),
    }
}

fn copy_theme_package_content(
    themes_root: &Path,
    destination_id: &str,
    content: &ThemePackageContent,
) -> Result<(), String> {
    let destination = themes_root.join(destination_id);
    if path_exists_without_following(&destination)? {
        return Err("A theme package with this identifier already exists.".to_string());
    }
    let temporary = themes_root.join(format!(
        ".{destination_id}.migrate-{}.tmp",
        transaction_suffix()
    ));
    fs::create_dir(&temporary).map_err(|error| error.to_string())?;
    let result = (|| -> Result<(), String> {
        for relative_path in &content.directories {
            fs::create_dir(temporary.join(relative_path)).map_err(|error| error.to_string())?;
        }
        for file in &content.files {
            write_new_synced_file(&temporary.join(&file.relative_path), &file.bytes)?;
        }
        fs::rename(&temporary, &destination).map_err(|error| error.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&temporary);
    }
    result
}

fn legacy_themes_root(archive_root: &Path) -> Result<Option<PathBuf>, String> {
    let archive_metadata = match fs::symlink_metadata(archive_root) {
        Ok(metadata) if !metadata.file_type().is_symlink() && metadata.is_dir() => metadata,
        Ok(_) => return Err("The registered archive is not a regular directory.".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    let _ = archive_metadata;
    let canonical_archive = fs::canonicalize(archive_root).map_err(|error| error.to_string())?;
    let metadata_root = canonical_archive.join(filesystem::METADATA_DIRECTORY);
    if !ensure_owned_directory(&metadata_root, false, "legacy archive metadata directory")? {
        return Ok(None);
    }
    let canonical_metadata = fs::canonicalize(&metadata_root).map_err(|error| error.to_string())?;
    if canonical_metadata.parent() != Some(canonical_archive.as_path()) {
        return Err("Legacy archive metadata is outside the archive.".to_string());
    }
    let themes_root = canonical_metadata.join(THEMES_DIRECTORY);
    if !ensure_owned_directory(&themes_root, false, "legacy themes directory")? {
        return Ok(None);
    }
    let canonical_themes = fs::canonicalize(&themes_root).map_err(|error| error.to_string())?;
    if canonical_themes.parent() != Some(canonical_metadata.as_path()) {
        return Err("Legacy themes are outside archive metadata.".to_string());
    }
    Ok(Some(canonical_themes))
}

fn conflict_theme_id(id: &str, digest: &str, digest_length: usize) -> String {
    let base_length = 64_usize.saturating_sub(digest_length + 1).min(id.len());
    format!("{}-{}", &id[..base_length], &digest[..digest_length])
}

fn migration_record(
    source_archive: &Path,
    source_id: String,
    action: ThemeMigrationAction,
    destination_id: Option<String>,
    package_sha256: Option<String>,
    error: Option<String>,
) -> ThemeMigrationRecord {
    ThemeMigrationRecord {
        action,
        destination_id,
        error,
        package_sha256,
        source_archive: source_archive.to_string_lossy().into_owned(),
        source_id,
    }
}

fn existing_content(path: &Path) -> Result<Option<ThemePackageContent>, String> {
    if !path_exists_without_following(path)? {
        return Ok(None);
    }
    read_theme_package_content(path).map(Some)
}

fn migrate_legacy_package(
    themes_root: &Path,
    source_archive: &Path,
    source_id: String,
    source_package: &Path,
) -> ThemeMigrationRecord {
    let content = match read_theme_package_content(source_package)
        .and_then(|content| validate_legacy_theme_package(&source_id, &content).map(|()| content))
    {
        Ok(content) => content,
        Err(error) => {
            return migration_record(
                source_archive,
                source_id,
                ThemeMigrationAction::Skipped,
                None,
                None,
                Some(error),
            );
        }
    };
    let digest = content.sha256();
    let direct_destination = themes_root.join(&source_id);
    match existing_content(&direct_destination) {
        Ok(None) => {
            return match copy_theme_package_content(themes_root, &source_id, &content) {
                Ok(()) => migration_record(
                    source_archive,
                    source_id.clone(),
                    ThemeMigrationAction::Copied,
                    Some(source_id),
                    Some(digest),
                    None,
                ),
                Err(error) => migration_record(
                    source_archive,
                    source_id,
                    ThemeMigrationAction::Skipped,
                    None,
                    Some(digest),
                    Some(error),
                ),
            };
        }
        Ok(Some(existing)) if existing == content => {
            return migration_record(
                source_archive,
                source_id.clone(),
                ThemeMigrationAction::Deduplicated,
                Some(source_id),
                Some(digest),
                None,
            );
        }
        Ok(Some(_)) | Err(_) => {}
    }

    for digest_length in [12_usize, 16, 24, 32] {
        let destination_id = conflict_theme_id(&source_id, &digest, digest_length);
        let migrated_content = match content.with_manifest_id(&destination_id) {
            Ok(content) => content,
            Err(error) => {
                return migration_record(
                    source_archive,
                    source_id,
                    ThemeMigrationAction::Skipped,
                    None,
                    Some(digest),
                    Some(error),
                );
            }
        };
        let destination = themes_root.join(&destination_id);
        match existing_content(&destination) {
            Ok(None) => {
                return match copy_theme_package_content(
                    themes_root,
                    &destination_id,
                    &migrated_content,
                ) {
                    Ok(()) => migration_record(
                        source_archive,
                        source_id,
                        ThemeMigrationAction::ConflictCopied,
                        Some(destination_id),
                        Some(digest),
                        None,
                    ),
                    Err(error) => migration_record(
                        source_archive,
                        source_id,
                        ThemeMigrationAction::Skipped,
                        None,
                        Some(digest),
                        Some(error),
                    ),
                };
            }
            Ok(Some(existing)) if existing == migrated_content => {
                return migration_record(
                    source_archive,
                    source_id,
                    ThemeMigrationAction::Deduplicated,
                    Some(destination_id),
                    Some(digest),
                    None,
                );
            }
            Ok(Some(_)) | Err(_) => continue,
        }
    }

    migration_record(
        source_archive,
        source_id,
        ThemeMigrationAction::Skipped,
        None,
        Some(digest),
        Some("No deterministic destination is available for this theme package.".to_string()),
    )
}

pub(crate) fn migrate_legacy_theme_packages_at(
    app_data_root: &Path,
    archive_roots: &[PathBuf],
) -> Result<ThemeMigrationReport, String> {
    let themes_root = themes_root_at(app_data_root, true)?
        .ok_or_else(|| "The themes directory is unavailable.".to_string())?;
    let mut roots = archive_roots.to_vec();
    roots.sort_by_key(|path| path.to_string_lossy().to_lowercase());
    roots.dedup_by(|left, right| {
        if cfg!(windows) {
            left.to_string_lossy()
                .eq_ignore_ascii_case(&right.to_string_lossy())
        } else {
            left == right
        }
    });
    let mut records = Vec::new();

    for archive_root in roots {
        let themes = match legacy_themes_root(&archive_root) {
            Ok(Some(themes)) => themes,
            Ok(None) => continue,
            Err(error) => {
                records.push(migration_record(
                    &archive_root,
                    "*".to_string(),
                    ThemeMigrationAction::Skipped,
                    None,
                    None,
                    Some(error),
                ));
                continue;
            }
        };
        let mut packages = match fs::read_dir(&themes) {
            Ok(entries) => {
                let mut packages = Vec::new();
                for entry in entries {
                    match entry {
                        Ok(entry) => packages.push(entry),
                        Err(error) => records.push(migration_record(
                            &archive_root,
                            "<unreadable>".to_string(),
                            ThemeMigrationAction::Skipped,
                            None,
                            None,
                            Some(error.to_string()),
                        )),
                    }
                }
                packages
            }
            Err(error) => {
                records.push(migration_record(
                    &archive_root,
                    "*".to_string(),
                    ThemeMigrationAction::Skipped,
                    None,
                    None,
                    Some(error.to_string()),
                ));
                continue;
            }
        };
        packages.sort_by_key(std::fs::DirEntry::file_name);
        for package in packages {
            let Some(source_id) = package.file_name().to_str().map(str::to_string) else {
                records.push(migration_record(
                    &archive_root,
                    "<non-utf8>".to_string(),
                    ThemeMigrationAction::Skipped,
                    None,
                    None,
                    Some("Legacy theme package names must use UTF-8.".to_string()),
                ));
                continue;
            };
            if source_id.starts_with('.') {
                continue;
            }
            records.push(migrate_legacy_package(
                &themes_root,
                &archive_root,
                source_id,
                &package.path(),
            ));
        }
    }

    Ok(ThemeMigrationReport {
        version: THEME_MIGRATION_VERSION,
        records,
    })
}

pub(crate) fn migrate_registered_legacy_theme_packages(
    app: &tauri::AppHandle,
    archive_roots: &[PathBuf],
) -> Result<ThemeMigrationReport, String> {
    migrate_legacy_theme_packages_at(&resolve_app_data_root(app)?, archive_roots)
}
