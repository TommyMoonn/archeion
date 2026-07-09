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
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubMetadataWritebackResult {
    backup_path: String,
    source_metadata: epub_metadata::EpubPackageMetadata,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubWritebackBackupCleanupInput {
    backup_path: String,
}

const WRITEBACK_BACKUP_MARKER: &str = ".metadata-writeback-";
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

fn backup_file_name(relative_path: &str) -> String {
    let safe_path = relative_path
        .chars()
        .map(|character| match character {
            'a'..='z' | 'A'..='Z' | '0'..='9' | '.' | '-' | '_' => character,
            _ => '-',
        })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!(
        "{}{}{}{}",
        safe_path.trim_end_matches(".epub"),
        WRITEBACK_BACKUP_MARKER,
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

fn is_epub_writeback_backup_name(file_name: &str) -> bool {
    file_name.contains(WRITEBACK_BACKUP_MARKER) && file_name.ends_with(WRITEBACK_BACKUP_EXTENSION)
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
) -> Result<EpubMetadataWritebackResult, String> {
    write_epub_metadata_at_with_ops(
        root,
        relative_path,
        metadata_update,
        rewrite_epub_package_document,
        restore_epub_from_backup,
    )
}

fn write_epub_metadata_at_with_ops<Rewrite, Restore>(
    root: &Path,
    relative_path: &str,
    metadata_update: epub_metadata::EpubPackageMetadata,
    rewrite: Rewrite,
    restore: Restore,
) -> Result<EpubMetadataWritebackResult, String>
where
    Rewrite: Fn(&Path, &str, &str) -> Result<(), String>,
    Restore: Fn(&Path, &Path) -> Result<(), String>,
{
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
            metadata::clear_scanner_cache_at(root)?;
            let backup_path = filesystem::path_relative_to(root, &backup_path)?;
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
        write_epub_metadata_at(&root, &input.relative_path, input.metadata)
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

#[cfg(test)]
mod tests {
    use std::{fs, io::Write, path::Path};

    use super::{
        cleanup_epub_writeback_backup_at, epub_metadata, restore_epub_from_backup,
        write_epub_metadata_at, write_epub_metadata_at_with_ops,
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

    #[test]
    fn writes_metadata_and_creates_backup() {
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
        )
        .expect("metadata should write");

        let metadata =
            epub_metadata::read_core_metadata(&epub_path).expect("updated metadata should parse");
        assert_eq!(metadata.title.as_deref(), Some("New Title"));
        assert_eq!(metadata.creator.as_deref(), Some("New Author"));
        assert_eq!(metadata.series.as_deref(), Some("Series"));
        assert!(result.backup_path.contains("metadata-writeback"));
        assert!(root.join(&result.backup_path).is_file());
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

        write_epub_metadata_at(&root, "book.epub", update_title()).expect("metadata should write");

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
    fn cleanup_removes_successful_writeback_backup() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        write_epub(
            &epub_path,
            br#"<package><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Old</dc:title></metadata></package>"#,
        );

        let result = write_epub_metadata_at(&root, "book.epub", update_title())
            .expect("metadata should write");
        let backup_path = root.join(&result.backup_path);
        assert!(backup_path.is_file());

        cleanup_epub_writeback_backup_at(&root, &result.backup_path)
            .expect("backup cleanup should succeed");

        assert!(!backup_path.exists());
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

        let error = write_epub_metadata_at(&root, "book.epub", update_title())
            .expect_err("malformed package should fail before rewrite");

        assert!(!error.is_empty());
        assert_eq!(read_bytes(&epub_path), original);
        fs::remove_dir_all(root).expect("test archive should be removed");
    }
}
