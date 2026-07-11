use std::{
    fs::{self, File},
    io::Write,
    path::{Component, Path, PathBuf},
    time::{Instant, SystemTime, UNIX_EPOCH},
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
pub struct EpubMetadataWritebackFileStat {
    relative_path: String,
    file_name: String,
    folder_path: String,
    size: u64,
    modified_at: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubMetadataWritebackResult {
    backup_path: Option<String>,
    source_metadata: epub_metadata::EpubPackageMetadata,
    file_stat: EpubMetadataWritebackFileStat,
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

fn create_epub_transaction_backup_path(
    root: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let backup_dir = match safe_existing_backup_directory(root)? {
        Some(existing_backup_dir) => existing_backup_dir,
        None => {
            let backup_dir = backup_directory(root);
            fs::create_dir_all(&backup_dir).map_err(|error| error.to_string())?;
            let canonical_root = fs::canonicalize(root).map_err(|error| error.to_string())?;
            let canonical_backup_dir =
                fs::canonicalize(&backup_dir).map_err(|error| error.to_string())?;
            let expected_backup_dir = canonical_root
                .join(metadata::METADATA_DIRECTORY)
                .join(BACKUP_DIRECTORY);
            if canonical_backup_dir != expected_backup_dir {
                return Err(
                    "EPUB writeback backup folder is outside the active archive.".to_string(),
                );
            }
            canonical_backup_dir
        }
    };

    Ok(backup_dir.join(backup_file_name(relative_path)))
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

fn file_modified_at_millis(path: &Path) -> Result<u64, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    Ok(metadata
        .modified()
        .map_err(|error| error.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis()
        .min(u128::from(u64::MAX)) as u64)
}

fn folder_path_from_relative_path(relative_path: &str) -> String {
    relative_path
        .rsplit_once('/')
        .map(|(folder_path, _)| folder_path.to_string())
        .unwrap_or_default()
}

fn file_name_from_relative_path(relative_path: &str) -> String {
    relative_path
        .rsplit('/')
        .next()
        .filter(|file_name| !file_name.is_empty())
        .unwrap_or(relative_path)
        .to_string()
}

fn writeback_file_stat(
    relative_path: &str,
    epub_path: &Path,
) -> Result<EpubMetadataWritebackFileStat, String> {
    let metadata = fs::metadata(epub_path).map_err(|error| error.to_string())?;
    Ok(EpubMetadataWritebackFileStat {
        relative_path: relative_path.to_string(),
        file_name: file_name_from_relative_path(relative_path),
        folder_path: folder_path_from_relative_path(relative_path),
        size: metadata.len(),
        modified_at: file_modified_at_millis(epub_path)?,
    })
}

fn update_writeback_scanner_cache_entry(
    root: &Path,
    relative_path: &str,
    file_stat: &EpubMetadataWritebackFileStat,
    source_metadata: &epub_metadata::EpubPackageMetadata,
) -> Result<(), String> {
    metadata::update_scanner_cache_entry_at(
        root,
        relative_path,
        metadata::ScannerCacheEntry {
            size: file_stat.size,
            modified_at: file_stat.modified_at,
            source_metadata: (!source_metadata.is_empty()).then_some(source_metadata.clone()),
            metadata_error: None,
        },
    )
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
                if let Err(cleanup_error) = remove(backup_path) {
                    eprintln!(
                        "EPUB writeback transaction backup could not be cleaned up after retention failure: {cleanup_error}"
                    );
                }
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
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    Ok(epub_path.with_file_name(format!("{file_name}.tmp-{timestamp}")))
}

fn move_original_to_transaction_backup(epub_path: &Path, backup_path: &Path) -> Result<(), String> {
    fs::rename(epub_path, backup_path).map_err(|error| error.to_string())
}

fn replace_original_with_temp(temp_path: &Path, epub_path: &Path) -> Result<(), String> {
    fs::rename(temp_path, epub_path).map_err(|error| error.to_string())
}

fn restore_epub_from_backup(backup_path: &Path, epub_path: &Path) -> Result<(), String> {
    if epub_path.exists() {
        fs::remove_file(epub_path).map_err(|error| error.to_string())?;
    }
    fs::rename(backup_path, epub_path).map_err(|error| error.to_string())
}

fn write_error_without_swap(kind: &str, write_error: &str) -> String {
    format!("EPUB {kind} write failed before replacing the active file. {write_error}")
}

fn temp_validation_error(kind: &str, validation_error: &str) -> String {
    format!(
        "EPUB {kind} validation failed before replacing the active file. The original EPUB was not modified. {validation_error}"
    )
}

fn restored_write_error(kind: &str, write_error: &str) -> String {
    format!("EPUB {kind} write failed. The backup was restored. {write_error}")
}

fn failed_write_restore_error(
    kind: &str,
    write_error: &str,
    restore_error: &str,
    backup_path: &Path,
) -> String {
    format!(
        "EPUB {kind} write failed, and automatic restore failed. Backup is available at {}. Write error: {write_error}. Restore error: {restore_error}",
        backup_path.display()
    )
}

fn debug_writeback_timing(stage: &str, started_at: Instant) {
    #[cfg(debug_assertions)]
    eprintln!("write_epub_metadata {stage}: {:?}", started_at.elapsed());

    #[cfg(not(debug_assertions))]
    let _ = (stage, started_at);
}

fn rewrite_epub_package_document(
    epub_path: &Path,
    package_path: &str,
    package_xml: &str,
) -> Result<PathBuf, String> {
    let temporary_path = temporary_epub_path(epub_path)?;
    let write_result = (|| -> Result<PathBuf, String> {
        let source = File::open(epub_path).map_err(|error| error.to_string())?;
        let mut archive = ZipArchive::new(source).map_err(|error| error.to_string())?;
        let temporary = File::create(&temporary_path).map_err(|error| error.to_string())?;
        let mut writer = ZipWriter::new(temporary);
        let mut package_entry_count = 0_usize;

        for index in 0..archive.len() {
            let (name, is_package, options) = {
                let entry = archive.by_index(index).map_err(|error| error.to_string())?;
                let name = entry.name().to_string();
                let is_package = name == package_path;
                let options = SimpleFileOptions::default().compression_method(entry.compression());
                (name, is_package, options)
            };

            if is_package {
                package_entry_count += 1;
                writer
                    .start_file(name, options)
                    .map_err(|error| error.to_string())?;
                writer
                    .write_all(package_xml.as_bytes())
                    .map_err(|error| error.to_string())?;
                continue;
            }

            let entry = archive
                .by_index_raw(index)
                .map_err(|error| error.to_string())?;
            writer
                .raw_copy_file(entry)
                .map_err(|error| error.to_string())?;
        }

        if package_entry_count != 1 {
            return Err(format!(
                "EPUB package document entry was expected once but found {package_entry_count} times."
            ));
        }

        let output = writer.finish().map_err(|error| error.to_string())?;
        output.sync_all().map_err(|error| error.to_string())?;
        Ok(temporary_path.clone())
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
        WritebackTransactionOps {
            rewrite_package_document: rewrite_epub_package_document,
            move_original_to_backup: move_original_to_transaction_backup,
            replace_original_with_temp,
            restore_backup: restore_epub_from_backup,
        },
    )
}

type RewritePackageDocument =
    for<'a, 'b, 'c> fn(&'a Path, &'b str, &'c str) -> Result<PathBuf, String>;
type MoveEpubFile = for<'a, 'b> fn(&'a Path, &'b Path) -> Result<(), String>;
type RetainWritebackBackup = for<'a, 'b> fn(&'a Path, &'b Path) -> Result<PathBuf, String>;
type RemoveWritebackBackup = for<'a> fn(&'a Path) -> std::io::Result<()>;
type UpdateWritebackScannerCache = for<'a, 'b, 'c, 'd> fn(
    &'a Path,
    &'b str,
    &'c EpubMetadataWritebackFileStat,
    &'d epub_metadata::EpubPackageMetadata,
) -> Result<(), String>;

struct WritebackTransactionOps {
    rewrite_package_document: RewritePackageDocument,
    move_original_to_backup: MoveEpubFile,
    replace_original_with_temp: MoveEpubFile,
    restore_backup: MoveEpubFile,
}

fn write_epub_metadata_at_with_ops(
    root: &Path,
    relative_path: &str,
    metadata_update: epub_metadata::EpubPackageMetadata,
    keep_successful_backup: bool,
    transaction_ops: WritebackTransactionOps,
) -> Result<EpubMetadataWritebackResult, String> {
    write_epub_metadata_at_with_backup_ops(
        root,
        relative_path,
        metadata_update,
        keep_successful_backup,
        transaction_ops,
        WritebackMaintenanceOps {
            retain_backup: retain_epub_writeback_backup_at,
            remove_backup: remove_epub_writeback_backup_file,
            update_scanner_cache: update_writeback_scanner_cache_entry,
        },
    )
}

struct WritebackMaintenanceOps {
    retain_backup: RetainWritebackBackup,
    remove_backup: RemoveWritebackBackup,
    update_scanner_cache: UpdateWritebackScannerCache,
}

pub(crate) fn commit_epub_rewrite_at(
    root: &Path,
    normalized_relative_path: &str,
    epub_path: &Path,
    temporary_path: &Path,
    source_metadata: epub_metadata::EpubPackageMetadata,
    keep_successful_backup: bool,
    writeback_kind: &str,
) -> Result<EpubMetadataWritebackResult, String> {
    commit_epub_rewrite_at_with_ops(
        root,
        normalized_relative_path,
        epub_path,
        temporary_path,
        source_metadata,
        keep_successful_backup,
        writeback_kind,
        WritebackTransactionOps {
            rewrite_package_document: rewrite_epub_package_document,
            move_original_to_backup: move_original_to_transaction_backup,
            replace_original_with_temp,
            restore_backup: restore_epub_from_backup,
        },
        WritebackMaintenanceOps {
            retain_backup: retain_epub_writeback_backup_at,
            remove_backup: remove_epub_writeback_backup_file,
            update_scanner_cache: update_writeback_scanner_cache_entry,
        },
    )
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
pub(super) fn commit_epub_rewrite_at_with_test_ops(
    root: &Path,
    normalized_relative_path: &str,
    epub_path: &Path,
    temporary_path: &Path,
    source_metadata: epub_metadata::EpubPackageMetadata,
    writeback_kind: &str,
    replace_original_with_temp: for<'a, 'b> fn(&'a Path, &'b Path) -> Result<(), String>,
    restore_backup: for<'a, 'b> fn(&'a Path, &'b Path) -> Result<(), String>,
    update_scanner_cache: for<'a, 'b, 'c, 'd> fn(
        &'a Path,
        &'b str,
        &'c EpubMetadataWritebackFileStat,
        &'d epub_metadata::EpubPackageMetadata,
    ) -> Result<(), String>,
) -> Result<EpubMetadataWritebackResult, String> {
    commit_epub_rewrite_at_with_ops(
        root,
        normalized_relative_path,
        epub_path,
        temporary_path,
        source_metadata,
        false,
        writeback_kind,
        WritebackTransactionOps {
            rewrite_package_document: rewrite_epub_package_document,
            move_original_to_backup: move_original_to_transaction_backup,
            replace_original_with_temp,
            restore_backup,
        },
        WritebackMaintenanceOps {
            retain_backup: retain_epub_writeback_backup_at,
            remove_backup: remove_epub_writeback_backup_file,
            update_scanner_cache,
        },
    )
}

#[allow(clippy::too_many_arguments)]
fn commit_epub_rewrite_at_with_ops(
    root: &Path,
    normalized_relative_path: &str,
    epub_path: &Path,
    temporary_path: &Path,
    source_metadata: epub_metadata::EpubPackageMetadata,
    keep_successful_backup: bool,
    writeback_kind: &str,
    transaction_ops: WritebackTransactionOps,
    maintenance_ops: WritebackMaintenanceOps,
) -> Result<EpubMetadataWritebackResult, String> {
    let WritebackTransactionOps {
        move_original_to_backup,
        replace_original_with_temp,
        restore_backup,
        ..
    } = transaction_ops;
    let WritebackMaintenanceOps {
        retain_backup,
        remove_backup,
        update_scanner_cache,
    } = maintenance_ops;
    let backup_path = create_epub_transaction_backup_path(root, normalized_relative_path)?;

    let stage_started_at = Instant::now();
    if let Err(error) = move_original_to_backup(epub_path, &backup_path) {
        let _ = fs::remove_file(temporary_path);
        return Err(write_error_without_swap(writeback_kind, &error));
    }
    debug_writeback_timing("original-to-backup rename", stage_started_at);

    let stage_started_at = Instant::now();
    if let Err(error) = replace_original_with_temp(temporary_path, epub_path) {
        let _ = fs::remove_file(temporary_path);
        return match restore_backup(&backup_path, epub_path) {
            Ok(()) => Err(restored_write_error(writeback_kind, &error)),
            Err(restore_error) => Err(failed_write_restore_error(
                writeback_kind,
                &error,
                &restore_error,
                &backup_path,
            )),
        };
    }
    debug_writeback_timing("temp-to-original rename", stage_started_at);

    let file_stat = writeback_file_stat(normalized_relative_path, epub_path)?;

    let stage_started_at = Instant::now();
    let backup_path = finalize_successful_backup_at(
        root,
        &backup_path,
        keep_successful_backup,
        retain_backup,
        remove_backup,
    );
    debug_writeback_timing("backup cleanup or retention", stage_started_at);

    let stage_started_at = Instant::now();
    if let Err(error) =
        update_scanner_cache(root, normalized_relative_path, &file_stat, &source_metadata)
    {
        eprintln!(
            "EPUB writeback scanner cache could not be updated after successful write: {error}"
        );
    }
    debug_writeback_timing("scanner cache update", stage_started_at);

    Ok(EpubMetadataWritebackResult {
        backup_path,
        source_metadata,
        file_stat,
    })
}

fn write_epub_metadata_at_with_backup_ops(
    root: &Path,
    relative_path: &str,
    metadata_update: epub_metadata::EpubPackageMetadata,
    keep_successful_backup: bool,
    transaction_ops: WritebackTransactionOps,
    maintenance_ops: WritebackMaintenanceOps,
) -> Result<EpubMetadataWritebackResult, String> {
    let total_started_at = Instant::now();
    let rewrite_package_document = transaction_ops.rewrite_package_document;
    validate_writeback_metadata(&metadata_update)?;
    let normalized_relative_path = filesystem::normalize_archive_relative_path(relative_path)?;
    let epub_path = epub::resolve_epub_path(root, &normalized_relative_path)?;
    let metadata_update = normalize_writeback_metadata(metadata_update);

    let stage_started_at = Instant::now();
    let package = {
        let file = File::open(&epub_path).map_err(|error| error.to_string())?;
        let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
        epub_metadata::read_package_document(&mut archive)?
    };
    debug_writeback_timing("package document read", stage_started_at);

    let stage_started_at = Instant::now();
    let updated_package_xml =
        epub_metadata::update_package_metadata_xml(&package.xml, &metadata_update)?;
    let source_metadata = epub_metadata::parse_core_metadata(&updated_package_xml)?;
    debug_writeback_timing("package XML update", stage_started_at);

    let stage_started_at = Instant::now();
    let temporary_path =
        match rewrite_package_document(&epub_path, &package.path, &updated_package_xml) {
            Ok(path) => path,
            Err(error) => return Err(write_error_without_swap("metadata", &error)),
        };
    debug_writeback_timing("temp EPUB rewrite", stage_started_at);

    let stage_started_at = Instant::now();
    if let Err(error) = epub_metadata::read_core_metadata(&temporary_path) {
        let _ = fs::remove_file(&temporary_path);
        return Err(temp_validation_error("metadata", &error));
    }
    debug_writeback_timing("temp validation", stage_started_at);

    let result = commit_epub_rewrite_at_with_ops(
        root,
        &normalized_relative_path,
        &epub_path,
        &temporary_path,
        source_metadata,
        keep_successful_backup,
        "metadata",
        transaction_ops,
        maintenance_ops,
    )?;
    debug_writeback_timing("total", total_started_at);

    Ok(result)
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
        epub_writeback_backup_status_at, metadata, restore_epub_from_backup,
        write_epub_metadata_at, write_epub_metadata_at_with_backup_ops,
        write_epub_metadata_at_with_ops, WritebackMaintenanceOps, WritebackTransactionOps,
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

    fn write_epub_with_binary_entry(
        path: &std::path::Path,
        package_xml: &[u8],
        binary_entry_name: &str,
        binary_contents: &[u8],
    ) {
        let file = fs::File::create(path).expect("EPUB should be created");
        let mut archive = zip::ZipWriter::new(file);
        let stored_options = zip::write::SimpleFileOptions::default();
        let deflated_options = stored_options.compression_method(zip::CompressionMethod::Deflated);
        archive
            .start_file("META-INF/container.xml", stored_options)
            .expect("container entry should start");
        archive
            .write_all(
                br#"<?xml version="1.0"?>
                <container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#,
            )
            .expect("container should be written");
        archive
            .start_file("OEBPS/content.opf", deflated_options)
            .expect("package entry should start");
        archive
            .write_all(package_xml)
            .expect("package should be written");
        archive
            .start_file(binary_entry_name, deflated_options)
            .expect("binary entry should start");
        archive
            .write_all(binary_contents)
            .expect("binary entry should be written");
        archive.finish().expect("EPUB should finish");
    }

    fn compressed_entry_size(path: &Path, entry_name: &str) -> u64 {
        let file = fs::File::open(path).expect("EPUB should be readable");
        let mut archive = zip::ZipArchive::new(file).expect("EPUB should open");
        let entry = archive
            .by_name(entry_name)
            .expect("ZIP entry should be readable");
        entry.compressed_size()
    }

    fn update_title() -> epub_metadata::EpubPackageMetadata {
        epub_metadata::EpubPackageMetadata {
            title: Some("New Title".to_string()),
            ..epub_metadata::EpubPackageMetadata::default()
        }
    }

    fn simulated_retain_failure(_root: &Path, _backup_path: &Path) -> Result<PathBuf, String> {
        Err("simulated retain failure".to_string())
    }

    fn no_op_scanner_cache_update(
        _root: &Path,
        _relative_path: &str,
        _file_stat: &super::EpubMetadataWritebackFileStat,
        _source_metadata: &epub_metadata::EpubPackageMetadata,
    ) -> Result<(), String> {
        Ok(())
    }

    fn failing_scanner_cache_update(
        _root: &Path,
        _relative_path: &str,
        _file_stat: &super::EpubMetadataWritebackFileStat,
        _source_metadata: &epub_metadata::EpubPackageMetadata,
    ) -> Result<(), String> {
        Err("simulated scanner cache update failure".to_string())
    }

    fn invalid_rewrite_package_document(
        epub_path: &Path,
        _package_path: &str,
        _package_xml: &str,
    ) -> Result<PathBuf, String> {
        let temporary_path = super::temporary_epub_path(epub_path)?;
        fs::write(&temporary_path, b"not a zip").map_err(|error| error.to_string())?;
        Ok(temporary_path)
    }

    fn failing_rewrite_package_document(
        _epub_path: &Path,
        _package_path: &str,
        _package_xml: &str,
    ) -> Result<PathBuf, String> {
        Err("simulated rewrite failure".to_string())
    }

    fn failing_replace_original_with_temp(
        _temporary_path: &Path,
        _epub_path: &Path,
    ) -> Result<(), String> {
        Err("simulated replace failure".to_string())
    }

    fn failing_restore_backup(_backup_path: &Path, _epub_path: &Path) -> Result<(), String> {
        Err("simulated restore failure".to_string())
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
        assert_eq!(result.file_stat.relative_path, "book.epub");
        assert_eq!(result.file_stat.file_name, "book.epub");
        assert_eq!(result.file_stat.folder_path, "");
        assert!(result.file_stat.size > 0);
        assert!(result.file_stat.modified_at > 0);
        assert!(result.backup_path.is_none());
        assert!(backup_file_names(&root).is_empty());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn unchanged_zip_entries_keep_their_compressed_representation() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        let image_bytes = vec![42_u8; 256 * 1024];
        write_epub_with_binary_entry(
            &epub_path,
            br#"<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Old</dc:title></metadata></package>"#,
            "OEBPS/images/cover.bin",
            &image_bytes,
        );
        let original_compressed_size = compressed_entry_size(&epub_path, "OEBPS/images/cover.bin");

        write_epub_metadata_at(&root, "book.epub", update_title(), false)
            .expect("metadata should write");

        let next_compressed_size = compressed_entry_size(&epub_path, "OEBPS/images/cover.bin");
        assert_eq!(next_compressed_size, original_compressed_size);
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn writeback_updates_only_edited_scanner_cache_entry() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        write_epub(
            &epub_path,
            br#"<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Old</dc:title></metadata></package>"#,
        );
        metadata::save_scanner_cache_at(
            &root,
            &metadata::ScannerCache {
                version: 1,
                entries: [
                    (
                        "book.epub".to_string(),
                        metadata::ScannerCacheEntry {
                            size: 1,
                            modified_at: 1,
                            source_metadata: Some(epub_metadata::EpubPackageMetadata {
                                title: Some("Old".to_string()),
                                ..epub_metadata::EpubPackageMetadata::default()
                            }),
                            metadata_error: None,
                        },
                    ),
                    (
                        "other.epub".to_string(),
                        metadata::ScannerCacheEntry {
                            size: 99,
                            modified_at: 99,
                            source_metadata: Some(epub_metadata::EpubPackageMetadata {
                                title: Some("Other".to_string()),
                                ..epub_metadata::EpubPackageMetadata::default()
                            }),
                            metadata_error: None,
                        },
                    ),
                ]
                .into_iter()
                .collect(),
            },
        )
        .expect("scanner cache should be seeded");

        let result = write_epub_metadata_at(&root, "book.epub", update_title(), false)
            .expect("metadata should write");
        let cache =
            metadata::load_scanner_cache_at(&root).expect("scanner cache should remain readable");
        let edited = cache
            .entries
            .get("book.epub")
            .expect("edited cache entry should be present");
        let other = cache
            .entries
            .get("other.epub")
            .expect("unrelated cache entry should remain present");

        assert_eq!(cache.entries.len(), 2);
        assert_eq!(edited.size, result.file_stat.size);
        assert_eq!(edited.modified_at, result.file_stat.modified_at);
        assert_eq!(
            edited
                .source_metadata
                .as_ref()
                .and_then(|metadata| metadata.title.as_deref()),
            Some("New Title"),
        );
        assert_eq!(other.size, 99);
        assert_eq!(
            other
                .source_metadata
                .as_ref()
                .and_then(|metadata| metadata.title.as_deref()),
            Some("Other"),
        );
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
            WritebackTransactionOps {
                rewrite_package_document: super::rewrite_epub_package_document,
                move_original_to_backup: super::move_original_to_transaction_backup,
                replace_original_with_temp: super::replace_original_with_temp,
                restore_backup: restore_epub_from_backup,
            },
            WritebackMaintenanceOps {
                retain_backup: simulated_retain_failure,
                remove_backup: super::remove_epub_writeback_backup_file,
                update_scanner_cache: no_op_scanner_cache_update,
            },
        )
        .expect("metadata write should still succeed");

        let metadata =
            epub_metadata::read_core_metadata(&epub_path).expect("updated metadata should parse");
        assert_eq!(metadata.title.as_deref(), Some("New Title"));
        assert!(result.backup_path.is_none());
        assert!(backup_file_names(&root).is_empty());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn scanner_cache_update_failure_does_not_fail_validated_metadata_write() {
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
            WritebackTransactionOps {
                rewrite_package_document: super::rewrite_epub_package_document,
                move_original_to_backup: super::move_original_to_transaction_backup,
                replace_original_with_temp: super::replace_original_with_temp,
                restore_backup: restore_epub_from_backup,
            },
            WritebackMaintenanceOps {
                retain_backup: super::retain_epub_writeback_backup_at,
                remove_backup: super::remove_epub_writeback_backup_file,
                update_scanner_cache: failing_scanner_cache_update,
            },
        )
        .expect("metadata write should still succeed");

        let metadata = epub_metadata::read_core_metadata(&epub_path)
            .expect("updated metadata should parse after cache update failure");
        assert_eq!(result.source_metadata.title.as_deref(), Some("New Title"));
        assert_eq!(metadata.title.as_deref(), Some("New Title"));
        assert!(result.backup_path.is_none());
        assert!(backup_file_names(&root).is_empty());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn temp_validation_failure_leaves_original_epub_unchanged() {
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
            WritebackTransactionOps {
                rewrite_package_document: invalid_rewrite_package_document,
                move_original_to_backup: super::move_original_to_transaction_backup,
                replace_original_with_temp: super::replace_original_with_temp,
                restore_backup: restore_epub_from_backup,
            },
        )
        .expect_err("validation should fail");

        assert!(error.contains("validation failed"));
        assert!(error.contains("original EPUB was not modified"));
        assert_eq!(read_bytes(&epub_path), original);
        assert!(backup_file_names(&root).is_empty());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn rewrite_failure_before_swap_leaves_original_epub_unchanged() {
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
            WritebackTransactionOps {
                rewrite_package_document: failing_rewrite_package_document,
                move_original_to_backup: super::move_original_to_transaction_backup,
                replace_original_with_temp: super::replace_original_with_temp,
                restore_backup: restore_epub_from_backup,
            },
        )
        .expect_err("rewrite should fail");

        assert!(error.contains("write failed before replacing"));
        assert_eq!(read_bytes(&epub_path), original);
        assert!(backup_file_names(&root).is_empty());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn failure_after_original_is_moved_restores_original_epub() {
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
            WritebackTransactionOps {
                rewrite_package_document: super::rewrite_epub_package_document,
                move_original_to_backup: super::move_original_to_transaction_backup,
                replace_original_with_temp: failing_replace_original_with_temp,
                restore_backup: restore_epub_from_backup,
            },
        )
        .expect_err("replace should fail");

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
            WritebackTransactionOps {
                rewrite_package_document: super::rewrite_epub_package_document,
                move_original_to_backup: super::move_original_to_transaction_backup,
                replace_original_with_temp: failing_replace_original_with_temp,
                restore_backup: failing_restore_backup,
            },
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
