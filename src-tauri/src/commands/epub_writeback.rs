use std::{
    fs::{self, File},
    io::Write,
    path::{Component, Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

use super::{archive_root, epub, epub_metadata, filesystem, metadata};

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubMetadataWritebackInput {
    relative_path: String,
    metadata: epub_metadata::EpubPackageMetadata,
    #[serde(default)]
    keep_successful_backup: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubMetadataWritebackResult {
    backup_path: Option<String>,
    source_metadata: epub_metadata::EpubPackageMetadata,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubWritebackBackupCleanupInput {
    backup_path: String,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EpubWritebackBackupStatus {
    file_count: usize,
    total_bytes: u64,
}

const LEGACY_WRITEBACK_BACKUP_MARKER: &str = ".metadata-writeback-";
const TRANSACTION_WRITEBACK_BACKUP_MARKER: &str = ".metadata-writeback-transaction-";
const RETAINED_WRITEBACK_BACKUP_MARKER: &str = ".metadata-writeback-retained-";
const WRITEBACK_BACKUP_EXTENSION: &str = ".epub.bak";
const BACKUP_DIRECTORY: &str = "backups";

fn clean_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|value| !value.is_empty())
}

fn validate_writeback_metadata(
    metadata: &epub_metadata::EpubPackageMetadata,
) -> Result<(), String> {
    if metadata.identifier.is_some() {
        return Err("EPUB identifier updates are not supported.".to_string());
    }
    Ok(())
}

fn normalize_writeback_metadata(
    metadata: epub_metadata::EpubPackageMetadata,
) -> epub_metadata::EpubPackageMetadata {
    let mut subjects = Vec::new();
    for subject in metadata.subjects {
        if let Some(subject) = clean_optional(Some(subject)) {
            if !subjects.iter().any(|existing| existing == &subject) {
                subjects.push(subject);
            }
        }
    }

    epub_metadata::EpubPackageMetadata {
        title: clean_optional(metadata.title),
        creator: clean_optional(metadata.creator),
        identifier: None,
        language: clean_optional(metadata.language),
        publisher: clean_optional(metadata.publisher),
        date: clean_optional(metadata.date),
        description: clean_optional(metadata.description),
        subjects,
        series: clean_optional(metadata.series),
        volume: clean_optional(metadata.volume),
    }
}

fn backup_file_stem(relative_path: &str) -> String {
    let safe_path = relative_path
        .chars()
        .map(|character| match character {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' => character,
            _ => '-',
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();

    let stem = safe_path.trim_end_matches(".epub").trim_matches('-');
    if stem.is_empty() {
        "book".to_string()
    } else {
        stem.to_string()
    }
}

fn backup_file_name(relative_path: &str) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    format!(
        "{}{}{}{}",
        backup_file_stem(relative_path),
        TRANSACTION_WRITEBACK_BACKUP_MARKER,
        timestamp,
        WRITEBACK_BACKUP_EXTENSION
    )
}

fn create_epub_backup(
    root: &Path,
    epub_path: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let backup_dir = root
        .join(metadata::METADATA_DIRECTORY)
        .join(BACKUP_DIRECTORY);
    fs::create_dir_all(&backup_dir).map_err(|error| error.to_string())?;
    let backup_path = backup_dir.join(backup_file_name(relative_path));
    fs::copy(epub_path, &backup_path).map_err(|error| error.to_string())?;
    Ok(backup_path)
}

fn is_transaction_epub_writeback_backup_name(file_name: &str) -> bool {
    file_name.contains(TRANSACTION_WRITEBACK_BACKUP_MARKER)
        && file_name.ends_with(WRITEBACK_BACKUP_EXTENSION)
}

fn is_retained_epub_writeback_backup_name(file_name: &str) -> bool {
    (file_name.contains(RETAINED_WRITEBACK_BACKUP_MARKER)
        || is_legacy_epub_writeback_backup_name(file_name))
        && file_name.ends_with(WRITEBACK_BACKUP_EXTENSION)
}

fn is_legacy_epub_writeback_backup_name(file_name: &str) -> bool {
    file_name.contains(LEGACY_WRITEBACK_BACKUP_MARKER)
        && !file_name.contains(TRANSACTION_WRITEBACK_BACKUP_MARKER)
        && !file_name.contains(RETAINED_WRITEBACK_BACKUP_MARKER)
        && file_name.ends_with(WRITEBACK_BACKUP_EXTENSION)
}

fn is_epub_writeback_backup_name(file_name: &str) -> bool {
    is_transaction_epub_writeback_backup_name(file_name)
        || is_retained_epub_writeback_backup_name(file_name)
}

fn resolve_epub_writeback_backup_path(root: &Path, backup_path: &str) -> Result<PathBuf, String> {
    let normalized_input = backup_path.replace('\\', "/");
    let candidate = Path::new(&normalized_input);
    if candidate.is_absolute() {
        return Err("Backup paths must be relative to the archive folder.".to_string());
    }

    let mut parts = Vec::new();
    for component in candidate.components() {
        match component {
            Component::Normal(part) => parts.push(part.to_string_lossy().to_string()),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err("Backup paths cannot leave the archive folder.".to_string());
            }
        }
    }

    if parts.len() != 3
        || parts[0] != metadata::METADATA_DIRECTORY
        || parts[1] != BACKUP_DIRECTORY
        || !is_epub_writeback_backup_name(&parts[2])
    {
        return Err("Only Archeion EPUB writeback backups can be cleaned up.".to_string());
    }

    let backup_dir = root
        .join(metadata::METADATA_DIRECTORY)
        .join(BACKUP_DIRECTORY);
    let backup_path = backup_dir.join(&parts[2]);
    if !backup_path.exists() {
        return Ok(backup_path);
    }

    let canonical_backup_dir = fs::canonicalize(&backup_dir).map_err(|error| error.to_string())?;
    let canonical_backup_path =
        fs::canonicalize(&backup_path).map_err(|error| error.to_string())?;
    if !canonical_backup_path.starts_with(&canonical_backup_dir) {
        return Err("Backup path is outside the EPUB writeback backup folder.".to_string());
    }

    Ok(canonical_backup_path)
}

fn cleanup_epub_writeback_backup_at(root: &Path, backup_path: &str) -> Result<(), String> {
    let backup_path = resolve_epub_writeback_backup_path(root, backup_path)?;
    if backup_path.exists() {
        fs::remove_file(&backup_path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn retained_backup_name(transaction_backup_name: &str) -> Result<String, String> {
    if !is_transaction_epub_writeback_backup_name(transaction_backup_name) {
        return Err("Only active EPUB writeback transaction backups can be retained.".to_string());
    }

    Ok(transaction_backup_name.replacen(
        TRANSACTION_WRITEBACK_BACKUP_MARKER,
        RETAINED_WRITEBACK_BACKUP_MARKER,
        1,
    ))
}

fn retained_backup_prefix(retained_backup_name: &str) -> Option<&str> {
    retained_backup_name
        .split_once(RETAINED_WRITEBACK_BACKUP_MARKER)
        .map(|(prefix, _)| prefix)
}

fn prune_previous_retained_backups(
    backup_dir: &Path,
    retained_backup_name: &str,
) -> Result<(), String> {
    let Some(prefix) = retained_backup_prefix(retained_backup_name) else {
        return Ok(());
    };
    let retained_prefix = format!("{prefix}{RETAINED_WRITEBACK_BACKUP_MARKER}");

    for entry in fs::read_dir(backup_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if file_name == retained_backup_name
            || !file_name.starts_with(&retained_prefix)
            || !is_retained_epub_writeback_backup_name(&file_name)
        {
            continue;
        }

        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_file() {
            fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

fn retain_epub_writeback_backup_at(root: &Path, backup_path: &Path) -> Result<PathBuf, String> {
    let backup_dir = root
        .join(metadata::METADATA_DIRECTORY)
        .join(BACKUP_DIRECTORY);
    let transaction_name = backup_path
        .file_name()
        .ok_or_else(|| "The EPUB writeback backup is unavailable.".to_string())?
        .to_string_lossy()
        .to_string();
    let retained_name = retained_backup_name(&transaction_name)?;
    let retained_path = backup_dir.join(&retained_name);

    fs::rename(backup_path, &retained_path).map_err(|error| error.to_string())?;
    prune_previous_retained_backups(&backup_dir, &retained_name)?;

    Ok(retained_path)
}

fn remove_epub_writeback_backup_file(path: &Path) -> std::io::Result<()> {
    fs::remove_file(path)
}

fn finalize_successful_backup_at<Retain, Remove>(
    root: &Path,
    backup_path: &Path,
    keep_successful_backup: bool,
    retain: Retain,
    remove: Remove,
) -> Option<String>
where
    Retain: Fn(&Path, &Path) -> Result<PathBuf, String>,
    Remove: Fn(&Path) -> std::io::Result<()>,
{
    if keep_successful_backup {
        return match retain(root, backup_path) {
            Ok(retained_path) => match filesystem::path_relative_to(root, &retained_path) {
                Ok(path) => Some(path),
                Err(error) => {
                    eprintln!(
                        "EPUB writeback backup path could not be reported after successful write: {error}"
                    );
                    None
                }
            },
            Err(error) => {
                eprintln!(
                    "EPUB writeback backup could not be retained after successful write: {error}"
                );
                None
            }
        };
    }

    if let Err(error) = remove(backup_path) {
        eprintln!("EPUB writeback transaction backup could not be cleaned up: {error}");
    }
    None
}

fn backup_directory(root: &Path) -> PathBuf {
    root.join(metadata::METADATA_DIRECTORY)
        .join(BACKUP_DIRECTORY)
}

fn safe_existing_backup_directory(root: &Path) -> Result<Option<PathBuf>, String> {
    let backup_dir = backup_directory(root);
    if !backup_dir.exists() {
        return Ok(None);
    }

    let canonical_root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let canonical_backup_dir = fs::canonicalize(&backup_dir).map_err(|error| error.to_string())?;
    let expected_backup_dir = canonical_root
        .join(metadata::METADATA_DIRECTORY)
        .join(BACKUP_DIRECTORY);
    if canonical_backup_dir != expected_backup_dir {
        return Err("EPUB writeback backup folder is outside the active archive.".to_string());
    }

    Ok(Some(canonical_backup_dir))
}

fn epub_writeback_backup_status_at(root: &Path) -> Result<EpubWritebackBackupStatus, String> {
    let Some(backup_dir) = safe_existing_backup_directory(root)? else {
        return Ok(EpubWritebackBackupStatus {
            file_count: 0,
            total_bytes: 0,
        });
    };

    let mut file_count = 0;
    let mut total_bytes = 0;
    for entry in fs::read_dir(&backup_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if !is_retained_epub_writeback_backup_name(&file_name) {
            continue;
        }

        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_file() {
            let metadata = entry.metadata().map_err(|error| error.to_string())?;
            file_count += 1;
            total_bytes += metadata.len();
        }
    }

    Ok(EpubWritebackBackupStatus {
        file_count,
        total_bytes,
    })
}

fn clear_epub_writeback_backups_at(root: &Path) -> Result<EpubWritebackBackupStatus, String> {
    let Some(backup_dir) = safe_existing_backup_directory(root)? else {
        return epub_writeback_backup_status_at(root);
    };

    for entry in fs::read_dir(&backup_dir).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if !is_retained_epub_writeback_backup_name(&file_name) {
            continue;
        }

        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        if file_type.is_file() {
            fs::remove_file(entry.path()).map_err(|error| error.to_string())?;
        }
    }

    epub_writeback_backup_status_at(root)
}

fn temporary_epub_path(epub_path: &Path) -> Result<PathBuf, String> {
    let file_name = epub_path
        .file_name()
        .ok_or_else(|| "The EPUB file is unavailable.".to_string())?
        .to_string_lossy();
    Ok(epub_path.with_file_name(format!("{file_name}.tmp")))
}

fn restore_epub_from_backup(backup_path: &Path, epub_path: &Path) -> Result<(), String> {
    fs::copy(backup_path, epub_path).map_err(|error| error.to_string())?;
    Ok(())
}

fn restored_write_error(write_error: &str) -> String {
    format!("EPUB metadata write failed. The backup was restored. {write_error}")
}

fn failed_write_restore_error(
    write_error: &str,
    restore_error: &str,
    backup_path: &Path,
) -> String {
    format!(
        "EPUB metadata write failed, and automatic restore failed. Backup is available at {}. Write error: {write_error}. Restore error: {restore_error}",
        backup_path.display()
    )
}

fn restored_validation_error(validation_error: &str) -> String {
    format!(
        "EPUB metadata validation failed after write. The backup was restored. {validation_error}"
    )
}

fn failed_validation_restore_error(
    validation_error: &str,
    restore_error: &str,
    backup_path: &Path,
) -> String {
    format!(
        "EPUB metadata validation failed after write, and automatic restore failed. Backup is available at {}. Validation error: {validation_error}. Restore error: {restore_error}",
        backup_path.display()
    )
}

fn rewrite_epub_package_document(
    epub_path: &Path,
    package_path: &str,
    package_xml: &str,
) -> Result<(), String> {
    let temporary_path = temporary_epub_path(epub_path)?;
    let write_result = (|| -> Result<(), String> {
        let source = File::open(epub_path).map_err(|error| error.to_string())?;
        let mut archive = ZipArchive::new(source).map_err(|error| error.to_string())?;
        let temporary = File::create(&temporary_path).map_err(|error| error.to_string())?;
        let mut writer = ZipWriter::new(temporary);

        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
            let options = SimpleFileOptions::default().compression_method(entry.compression());
            let name = entry.name().to_string();
            let is_package = name == package_path;

            if entry.is_dir() {
                writer
                    .add_directory(name, options)
                    .map_err(|error| error.to_string())?;
                continue;
            }

            writer
                .start_file(name, options)
                .map_err(|error| error.to_string())?;
            if is_package {
                writer
                    .write_all(package_xml.as_bytes())
                    .map_err(|error| error.to_string())?;
            } else {
                std::io::copy(&mut entry, &mut writer).map_err(|error| error.to_string())?;
            }
        }

        let output = writer.finish().map_err(|error| error.to_string())?;
        output.sync_all().map_err(|error| error.to_string())?;
        if epub_path.exists() {
            fs::remove_file(epub_path).map_err(|error| error.to_string())?;
        }
        fs::rename(&temporary_path, epub_path).map_err(|error| error.to_string())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }

    write_result
}

fn write_epub_metadata_at(
    root: &Path,
    relative_path: &str,
    metadata_update: epub_metadata::EpubPackageMetadata,
    keep_successful_backup: bool,
) -> Result<EpubMetadataWritebackResult, String> {
    write_epub_metadata_at_with_ops(
        root,
        relative_path,
        metadata_update,
        keep_successful_backup,
        rewrite_epub_package_document,
        restore_epub_from_backup,
    )
}

fn write_epub_metadata_at_with_ops<Rewrite, Restore>(
    root: &Path,
    relative_path: &str,
    metadata_update: epub_metadata::EpubPackageMetadata,
    keep_successful_backup: bool,
    rewrite: Rewrite,
    restore: Restore,
) -> Result<EpubMetadataWritebackResult, String>
where
    Rewrite: Fn(&Path, &str, &str) -> Result<(), String>,
    Restore: Fn(&Path, &Path) -> Result<(), String>,
{
    write_epub_metadata_at_with_backup_ops(
        root,
        relative_path,
        metadata_update,
        keep_successful_backup,
        rewrite,
        restore,
        WritebackMaintenanceOps {
            retain_backup: retain_epub_writeback_backup_at,
            remove_backup: remove_epub_writeback_backup_file,
            clear_scanner_cache: metadata::clear_scanner_cache_at,
        },
    )
}

struct WritebackMaintenanceOps<Retain, Remove, ClearScannerCache> {
    retain_backup: Retain,
    remove_backup: Remove,
    clear_scanner_cache: ClearScannerCache,
}

fn write_epub_metadata_at_with_backup_ops<Rewrite, Restore, Retain, Remove, ClearScannerCache>(
    root: &Path,
    relative_path: &str,
    metadata_update: epub_metadata::EpubPackageMetadata,
    keep_successful_backup: bool,
    rewrite: Rewrite,
    restore: Restore,
    maintenance_ops: WritebackMaintenanceOps<Retain, Remove, ClearScannerCache>,
) -> Result<EpubMetadataWritebackResult, String>
where
    Rewrite: Fn(&Path, &str, &str) -> Result<(), String>,
    Restore: Fn(&Path, &Path) -> Result<(), String>,
    Retain: Fn(&Path, &Path) -> Result<PathBuf, String>,
    Remove: Fn(&Path) -> std::io::Result<()>,
    ClearScannerCache: Fn(&Path) -> Result<(), String>,
{
    let WritebackMaintenanceOps {
        retain_backup,
        remove_backup,
        clear_scanner_cache,
    } = maintenance_ops;
    validate_writeback_metadata(&metadata_update)?;
    let epub_path = epub::resolve_epub_path(root, relative_path)?;
    let backup_path = create_epub_backup(root, &epub_path, relative_path)?;
    let metadata_update = normalize_writeback_metadata(metadata_update);

    let package = {
        let file = File::open(&epub_path).map_err(|error| error.to_string())?;
        let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
        epub_metadata::read_package_document(&mut archive)?
    };
    let updated_package_xml =
        epub_metadata::update_package_metadata_xml(&package.xml, &metadata_update)?;

    if let Err(error) = rewrite(&epub_path, &package.path, &updated_package_xml) {
        return match restore(&backup_path, &epub_path) {
            Ok(()) => Err(restored_write_error(&error)),
            Err(restore_error) => Err(failed_write_restore_error(
                &error,
                &restore_error,
                &backup_path,
            )),
        };
    }

    match epub_metadata::read_core_metadata(&epub_path) {
        Ok(source_metadata) => {
            let backup_path = finalize_successful_backup_at(
                root,
                &backup_path,
                keep_successful_backup,
                retain_backup,
                remove_backup,
            );
            if let Err(error) = clear_scanner_cache(root) {
                eprintln!(
                    "EPUB writeback scanner cache could not be cleared after successful write: {error}"
                );
            }
            Ok(EpubMetadataWritebackResult {
                backup_path,
                source_metadata,
            })
        }
        Err(error) => match restore(&backup_path, &epub_path) {
            Ok(()) => Err(restored_validation_error(&error)),
            Err(restore_error) => Err(failed_validation_restore_error(
                &error,
                &restore_error,
                &backup_path,
            )),
        },
    }
}

#[tauri::command]
pub async fn write_epub_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
    input: EpubMetadataWritebackInput,
) -> Result<EpubMetadataWritebackResult, String> {
    let root = archive_root::resolve_archive_root(&app, root_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        write_epub_metadata_at(
            &root,
            &input.relative_path,
            input.metadata,
            input.keep_successful_backup,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn cleanup_epub_writeback_backup(
    app: tauri::AppHandle,
    root_path: Option<String>,
    input: EpubWritebackBackupCleanupInput,
) -> Result<(), String> {
    let root = archive_root::resolve_archive_root(&app, root_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        cleanup_epub_writeback_backup_at(&root, &input.backup_path)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn get_epub_writeback_backup_status(
    app: tauri::AppHandle,
    root_path: Option<String>,
) -> Result<EpubWritebackBackupStatus, String> {
    let root = archive_root::resolve_archive_root(&app, root_path)?;
    tauri::async_runtime::spawn_blocking(move || epub_writeback_backup_status_at(&root))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn clear_epub_writeback_backups(
    app: tauri::AppHandle,
    root_path: Option<String>,
) -> Result<EpubWritebackBackupStatus, String> {
    let root = archive_root::resolve_archive_root(&app, root_path)?;
    tauri::async_runtime::spawn_blocking(move || clear_epub_writeback_backups_at(&root))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::Write,
        path::{Path, PathBuf},
    };

    use super::{
        cleanup_epub_writeback_backup_at, clear_epub_writeback_backups_at, epub_metadata,
        epub_writeback_backup_status_at, restore_epub_from_backup, write_epub_metadata_at,
        write_epub_metadata_at_with_backup_ops, write_epub_metadata_at_with_ops,
        WritebackMaintenanceOps,
    };

    fn test_root() -> std::path::PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-epub-writeback-{nonce}"))
    }

    fn write_epub(path: &std::path::Path, package_xml: &[u8]) {
        let file = fs::File::create(path).expect("EPUB should be created");
        let mut archive = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        archive
            .start_file("META-INF/container.xml", options)
            .expect("container entry should start");
        archive
            .write_all(
                br#"<?xml version="1.0"?>
                <container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#,
            )
            .expect("container should be written");
        archive
            .start_file("OEBPS/content.opf", options)
            .expect("package entry should start");
        archive
            .write_all(package_xml)
            .expect("package should be written");
        archive.finish().expect("EPUB should finish");
    }

    fn read_bytes(path: &Path) -> Vec<u8> {
        fs::read(path).expect("file should be readable")
    }

    fn update_title() -> epub_metadata::EpubPackageMetadata {
        epub_metadata::EpubPackageMetadata {
            title: Some("New Title".to_string()),
            ..epub_metadata::EpubPackageMetadata::default()
        }
    }

    fn backup_file_names(root: &Path) -> Vec<String> {
        let backup_dir = root.join(".archeion").join("backups");
        if !backup_dir.exists() {
            return Vec::new();
        }

        let mut names = fs::read_dir(backup_dir)
            .expect("backup directory should be readable")
            .map(|entry| {
                entry
                    .expect("backup entry should be readable")
                    .file_name()
                    .to_string_lossy()
                    .to_string()
            })
            .collect::<Vec<_>>();
        names.sort();
        names
    }

    #[test]
    fn writes_metadata_and_deletes_transaction_backup_when_retention_disabled() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        write_epub(
            &epub_path,
            br#"<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Old</dc:title></metadata></package>"#,
        );

        let result = write_epub_metadata_at(
            &root,
            "book.epub",
            epub_metadata::EpubPackageMetadata {
                title: Some("New Title".to_string()),
                creator: Some("New Author".to_string()),
                language: Some("en".to_string()),
                series: Some("Series".to_string()),
                volume: Some("2".to_string()),
                ..epub_metadata::EpubPackageMetadata::default()
            },
            false,
        )
        .expect("metadata should write");

        let metadata =
            epub_metadata::read_core_metadata(&epub_path).expect("updated metadata should parse");
        assert_eq!(metadata.title.as_deref(), Some("New Title"));
        assert_eq!(metadata.creator.as_deref(), Some("New Author"));
        assert_eq!(metadata.series.as_deref(), Some("Series"));
        assert!(result.backup_path.is_none());
        assert!(backup_file_names(&root).is_empty());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn preserves_existing_identifier_during_writeback() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        write_epub(
            &epub_path,
            br#"<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Old</dc:title><dc:identifier>urn:isbn:123</dc:identifier></metadata></package>"#,
        );

        write_epub_metadata_at(&root, "book.epub", update_title(), false)
            .expect("metadata should write");

        let metadata =
            epub_metadata::read_core_metadata(&epub_path).expect("updated metadata should parse");
        assert_eq!(metadata.title.as_deref(), Some("New Title"));
        assert_eq!(metadata.identifier.as_deref(), Some("urn:isbn:123"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn rejects_identifier_updates() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        write_epub(
            &epub_path,
            br#"<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Old</dc:title><dc:identifier>urn:isbn:123</dc:identifier></metadata></package>"#,
        );

        let error = write_epub_metadata_at(
            &root,
            "book.epub",
            epub_metadata::EpubPackageMetadata {
                identifier: Some("urn:isbn:456".to_string()),
                ..epub_metadata::EpubPackageMetadata::default()
            },
            false,
        )
        .expect_err("identifier updates should be rejected");

        let metadata =
            epub_metadata::read_core_metadata(&epub_path).expect("metadata should still parse");
        assert!(error.contains("identifier updates are not supported"));
        assert_eq!(metadata.identifier.as_deref(), Some("urn:isbn:123"));
        assert!(!root.join(".archeion").join("backups").exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn cleanup_removes_retained_writeback_backup() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        write_epub(
            &epub_path,
            br#"<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Old</dc:title></metadata></package>"#,
        );

        let result = write_epub_metadata_at(&root, "book.epub", update_title(), true)
            .expect("metadata should write");
        let backup_path = result
            .backup_path
            .expect("retained backup path should be returned");
        let absolute_backup_path = root.join(&backup_path);
        assert!(absolute_backup_path.is_file());

        cleanup_epub_writeback_backup_at(&root, &backup_path)
            .expect("backup cleanup should succeed");

        assert!(!absolute_backup_path.exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn cleanup_refuses_non_writeback_backup_paths() {
        let root = test_root();
        let backup_dir = root.join(".archeion").join("backups");
        fs::create_dir_all(&backup_dir).expect("backup directory should be created");
        let backup_path = backup_dir.join("manual.epub.bak");
        fs::write(&backup_path, b"manual").expect("manual backup should be written");

        let error = cleanup_epub_writeback_backup_at(&root, ".archeion/backups/manual.epub.bak")
            .expect_err("manual backup cleanup should be rejected");

        assert!(error.contains("Only Archeion EPUB writeback backups"));
        assert!(backup_path.is_file());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn retaining_successful_backup_prunes_previous_backup_for_same_book() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        write_epub(
            &epub_path,
            br#"<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Old</dc:title></metadata></package>"#,
        );

        let first = write_epub_metadata_at(&root, "book.epub", update_title(), true)
            .expect("first metadata write should succeed");
        let second = write_epub_metadata_at(
            &root,
            "book.epub",
            epub_metadata::EpubPackageMetadata {
                title: Some("Another Title".to_string()),
                ..epub_metadata::EpubPackageMetadata::default()
            },
            true,
        )
        .expect("second metadata write should succeed");
        let status =
            epub_writeback_backup_status_at(&root).expect("backup status should be readable");

        let first_backup_path = first
            .backup_path
            .expect("first retained backup path should be returned");
        let second_backup_path = second
            .backup_path
            .expect("second retained backup path should be returned");
        assert!(first_backup_path.contains("metadata-writeback-retained"));
        assert!(second_backup_path.contains("metadata-writeback-retained"));
        assert_eq!(status.file_count, 1);
        assert!(!root.join(first_backup_path).exists());
        assert!(root.join(second_backup_path).is_file());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn clear_backups_removes_retained_backups_but_keeps_transactions() {
        let root = test_root();
        let backup_dir = root.join(".archeion").join("backups");
        fs::create_dir_all(&backup_dir).expect("backup directory should be created");
        let retained = backup_dir.join("book.metadata-writeback-retained-1.epub.bak");
        let transaction = backup_dir.join("book.metadata-writeback-transaction-2.epub.bak");
        let manual = backup_dir.join("manual.epub.bak");
        fs::write(&retained, b"retained").expect("retained backup should be written");
        fs::write(&transaction, b"transaction").expect("transaction backup should be written");
        fs::write(&manual, b"manual").expect("manual backup should be written");

        let status =
            clear_epub_writeback_backups_at(&root).expect("retained backups should be cleared");

        assert_eq!(status.file_count, 0);
        assert!(!retained.exists());
        assert!(transaction.is_file());
        assert!(manual.is_file());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[cfg(unix)]
    #[test]
    fn clear_backups_rejects_backup_directory_symlink_outside_archive() {
        let root = test_root();
        let outside = test_root();
        let metadata_dir = root.join(".archeion");
        let outside_backup_dir = outside.join("backups");
        fs::create_dir_all(&metadata_dir).expect("metadata directory should be created");
        fs::create_dir_all(&outside_backup_dir)
            .expect("outside backup directory should be created");
        let outside_backup = outside_backup_dir.join("book.metadata-writeback-retained-1.epub.bak");
        fs::write(&outside_backup, b"outside").expect("outside backup should be written");
        std::os::unix::fs::symlink(&outside_backup_dir, metadata_dir.join("backups"))
            .expect("backup directory symlink should be created");

        let error = clear_epub_writeback_backups_at(&root)
            .expect_err("symlinked backup directory should be rejected");

        assert!(error.contains("outside the active archive"));
        assert!(outside_backup.is_file());
        fs::remove_dir_all(root).expect("test archive should be removed");
        fs::remove_dir_all(outside).expect("outside directory should be removed");
    }

    #[test]
    fn backup_status_handles_missing_backup_directory_as_empty() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");

        let status = epub_writeback_backup_status_at(&root)
            .expect("missing backup directory should be readable");

        assert_eq!(status.file_count, 0);
        assert_eq!(status.total_bytes, 0);
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn retained_backup_failure_does_not_fail_validated_metadata_write() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        write_epub(
            &epub_path,
            br#"<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Old</dc:title></metadata></package>"#,
        );

        let result = write_epub_metadata_at_with_backup_ops(
            &root,
            "book.epub",
            update_title(),
            true,
            super::rewrite_epub_package_document,
            restore_epub_from_backup,
            WritebackMaintenanceOps {
                retain_backup: |_root: &Path, _backup_path: &Path| -> Result<PathBuf, String> {
                    Err("simulated retain failure".to_string())
                },
                remove_backup: super::remove_epub_writeback_backup_file,
                clear_scanner_cache: |_root: &Path| Ok(()),
            },
        )
        .expect("metadata write should still succeed");

        let metadata =
            epub_metadata::read_core_metadata(&epub_path).expect("updated metadata should parse");
        assert_eq!(metadata.title.as_deref(), Some("New Title"));
        assert!(result.backup_path.is_none());
        assert_eq!(backup_file_names(&root).len(), 1);
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn scanner_cache_cleanup_failure_does_not_fail_validated_metadata_write() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        write_epub(
            &epub_path,
            br#"<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Old</dc:title></metadata></package>"#,
        );

        let result = write_epub_metadata_at_with_backup_ops(
            &root,
            "book.epub",
            update_title(),
            false,
            super::rewrite_epub_package_document,
            restore_epub_from_backup,
            WritebackMaintenanceOps {
                retain_backup: super::retain_epub_writeback_backup_at,
                remove_backup: super::remove_epub_writeback_backup_file,
                clear_scanner_cache: |_root: &Path| {
                    Err("simulated scanner cache cleanup failure".to_string())
                },
            },
        )
        .expect("metadata write should still succeed");

        let metadata = epub_metadata::read_core_metadata(&epub_path)
            .expect("updated metadata should parse after cache cleanup failure");
        assert_eq!(result.source_metadata.title.as_deref(), Some("New Title"));
        assert_eq!(metadata.title.as_deref(), Some("New Title"));
        assert!(result.backup_path.is_none());
        assert!(backup_file_names(&root).is_empty());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn validation_failure_restores_backup() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        write_epub(
            &epub_path,
            br#"<package><metadata><dc:title>Original</dc:title></metadata></package>"#,
        );
        let original = read_bytes(&epub_path);

        let error = write_epub_metadata_at_with_ops(
            &root,
            "book.epub",
            update_title(),
            false,
            |epub_path, _package_path, _package_xml| {
                fs::write(epub_path, b"not a zip").map_err(|error| error.to_string())?;
                Ok(())
            },
            restore_epub_from_backup,
        )
        .expect_err("validation should fail");

        assert!(error.contains("validation failed"));
        assert!(error.contains("backup was restored"));
        assert_eq!(read_bytes(&epub_path), original);
        let backup_dir = root.join(".archeion").join("backups");
        assert!(fs::read_dir(backup_dir)
            .expect("backup directory should be readable")
            .next()
            .is_some());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn rewrite_failure_after_backup_does_not_leave_active_epub_missing() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        write_epub(
            &epub_path,
            br#"<package><metadata><dc:title>Original</dc:title></metadata></package>"#,
        );
        let original = read_bytes(&epub_path);

        let error = write_epub_metadata_at_with_ops(
            &root,
            "book.epub",
            update_title(),
            false,
            |epub_path, _package_path, _package_xml| {
                fs::remove_file(epub_path).map_err(|error| error.to_string())?;
                Err("simulated rewrite failure".to_string())
            },
            restore_epub_from_backup,
        )
        .expect_err("rewrite should fail");

        assert!(error.contains("write failed"));
        assert!(error.contains("backup was restored"));
        assert_eq!(read_bytes(&epub_path), original);
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn restore_failure_returns_backup_path() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        write_epub(
            &epub_path,
            br#"<package><metadata><dc:title>Original</dc:title></metadata></package>"#,
        );

        let error = write_epub_metadata_at_with_ops(
            &root,
            "book.epub",
            update_title(),
            false,
            |epub_path, _package_path, _package_xml| {
                fs::remove_file(epub_path).map_err(|error| error.to_string())?;
                Err("simulated rewrite failure".to_string())
            },
            |_backup_path, _epub_path| Err("simulated restore failure".to_string()),
        )
        .expect_err("restore should fail");

        assert!(error.contains("automatic restore failed"));
        assert!(error.contains(".archeion"));
        assert!(error.contains("book"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn malformed_package_metadata_does_not_modify_original_epub() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        write_epub(
            &epub_path,
            br#"<package><metadata><dc:title>Broken</dc:creator></metadata></package>"#,
        );
        let original = read_bytes(&epub_path);

        let error = write_epub_metadata_at(&root, "book.epub", update_title(), false)
            .expect_err("malformed package should fail before rewrite");

        assert!(!error.is_empty());
        assert_eq!(read_bytes(&epub_path), original);
        fs::remove_dir_all(root).expect("test archive should be removed");
    }
}
