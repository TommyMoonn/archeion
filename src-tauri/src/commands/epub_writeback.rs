use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
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

fn clean_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.split_whitespace().collect::<Vec<_>>().join(" "))
        .filter(|value| !value.is_empty())
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
        identifier: clean_optional(metadata.identifier),
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
        "{}-{timestamp}.epub.bak",
        safe_path.trim_end_matches(".epub")
    )
}

fn create_epub_backup(
    root: &Path,
    epub_path: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let backup_dir = root.join(metadata::METADATA_DIRECTORY).join("backups");
    fs::create_dir_all(&backup_dir).map_err(|error| error.to_string())?;
    let backup_path = backup_dir.join(backup_file_name(relative_path));
    fs::copy(epub_path, &backup_path).map_err(|error| error.to_string())?;
    Ok(backup_path)
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

#[cfg(test)]
mod tests {
    use std::{fs, io::Write, path::Path};

    use super::{
        epub_metadata, restore_epub_from_backup, write_epub_metadata_at,
        write_epub_metadata_at_with_ops,
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
        assert!(root.join(&result.backup_path).is_file());
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
