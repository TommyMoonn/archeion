use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::Serialize;

use super::{archive_root, epub_metadata, filesystem, metadata};

#[tauri::command]
pub fn invalidate_scanner_cache_entries(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_paths: Vec<String>,
) -> Result<(), String> {
    let root = archive_root::resolve_archive_root(&app, root_path)?;
    let normalized = relative_paths
        .iter()
        .map(|path| filesystem::normalize_archive_relative_path(path))
        .collect::<Result<Vec<_>, _>>()?;
    metadata::invalidate_scanner_cache_entries_at(&root, &normalized)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedBook {
    discovery_id: String,
    relative_path: String,
    file_name: String,
    folder_path: String,
    size: u64,
    modified_at: u64,
    source_metadata: Option<epub_metadata::EpubPackageMetadata>,
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
pub struct ArchiveScan {
    books: Vec<ScannedBook>,
    folders: Vec<ScannedFolder>,
    warnings: Vec<ArchiveScanWarning>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveScanWarning {
    relative_path: String,
    message: String,
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

#[derive(Clone, Debug, PartialEq, Eq)]
enum CachedMetadataResult {
    SourceMetadata(Option<Box<epub_metadata::EpubPackageMetadata>>),
    MetadataError(String),
}

fn cached_source_metadata_by_path(
    relative_path: &str,
    size: u64,
    modified_at: u64,
    cache: &metadata::ScannerCache,
) -> Option<CachedMetadataResult> {
    let entry = cache.entries.get(relative_path)?;
    if entry.size != size || entry.modified_at != modified_at {
        return None;
    }

    if let Some(error) = &entry.metadata_error {
        return Some(CachedMetadataResult::MetadataError(error.clone()));
    }

    Some(CachedMetadataResult::SourceMetadata(
        entry.source_metadata.clone().map(Box::new),
    ))
}

fn file_name_from_relative_path(relative_path: &str) -> Option<&str> {
    relative_path
        .rsplit('/')
        .next()
        .filter(|file_name| !file_name.is_empty())
}

fn cached_source_metadata_by_signature(
    relative_path: &str,
    size: u64,
    modified_at: u64,
    cache: &metadata::ScannerCache,
) -> Option<epub_metadata::EpubPackageMetadata> {
    let file_name = file_name_from_relative_path(relative_path)?;
    let mut matches = cache.entries.iter().filter(|(cached_path, entry)| {
        cached_path.as_str() != relative_path
            && file_name_from_relative_path(cached_path.as_str()) == Some(file_name)
            && entry.size == size
            && entry.modified_at == modified_at
            && entry.metadata_error.is_none()
            && entry
                .source_metadata
                .as_ref()
                .and_then(|metadata| metadata.identifier.as_ref())
                .is_some()
    });
    let (_, entry) = matches.next()?;

    if matches.next().is_some() {
        return None;
    }

    entry.source_metadata.clone()
}

fn cached_source_metadata(
    relative_path: &str,
    size: u64,
    modified_at: u64,
    cache: &metadata::ScannerCache,
) -> Option<CachedMetadataResult> {
    cached_source_metadata_by_path(relative_path, size, modified_at, cache).or_else(|| {
        cached_source_metadata_by_signature(relative_path, size, modified_at, cache)
            .map(|metadata| CachedMetadataResult::SourceMetadata(Some(Box::new(metadata))))
    })
}

fn scan_source_metadata(
    path: &Path,
    relative_path: &str,
    size: u64,
    modified_at: u64,
    cache: &metadata::ScannerCache,
    next_cache_entries: &mut BTreeMap<String, metadata::ScannerCacheEntry>,
    warnings: &mut Vec<ArchiveScanWarning>,
) -> Option<epub_metadata::EpubPackageMetadata> {
    if let Some(cached_metadata) = cached_source_metadata(relative_path, size, modified_at, cache) {
        match cached_metadata {
            CachedMetadataResult::SourceMetadata(source_metadata) => {
                next_cache_entries.insert(
                    relative_path.to_string(),
                    metadata::ScannerCacheEntry {
                        size,
                        modified_at,
                        source_metadata: source_metadata.as_deref().cloned(),
                        metadata_error: None,
                    },
                );
                return source_metadata.map(|metadata| *metadata);
            }
            CachedMetadataResult::MetadataError(error) => {
                warnings.push(ArchiveScanWarning {
                    relative_path: relative_path.to_string(),
                    message: error.clone(),
                });
                next_cache_entries.insert(
                    relative_path.to_string(),
                    metadata::ScannerCacheEntry {
                        size,
                        modified_at,
                        source_metadata: None,
                        metadata_error: Some(error),
                    },
                );
                return None;
            }
        }
    }

    match epub_metadata::read_core_metadata(path) {
        Ok(metadata) => {
            let source_metadata = (!metadata.is_empty()).then_some(metadata);
            next_cache_entries.insert(
                relative_path.to_string(),
                metadata::ScannerCacheEntry {
                    size,
                    modified_at,
                    source_metadata: source_metadata.clone(),
                    metadata_error: None,
                },
            );
            source_metadata
        }
        Err(error) => {
            warnings.push(ArchiveScanWarning {
                relative_path: relative_path.to_string(),
                message: error.clone(),
            });
            next_cache_entries.insert(
                relative_path.to_string(),
                metadata::ScannerCacheEntry {
                    size,
                    modified_at,
                    source_metadata: None,
                    metadata_error: Some(error),
                },
            );
            None
        }
    }
}

fn scan_directory(
    root: &Path,
    directory: &Path,
    cache: &metadata::ScannerCache,
    next_cache_entries: &mut BTreeMap<String, metadata::ScannerCacheEntry>,
    books: &mut Vec<ScannedBook>,
    folders: &mut Vec<ScannedFolder>,
    warnings: &mut Vec<ArchiveScanWarning>,
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
            scan_directory(
                root,
                &path,
                cache,
                next_cache_entries,
                books,
                folders,
                warnings,
            )?;
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

        let source_metadata = scan_source_metadata(
            &path,
            &relative_path,
            size,
            modified_at,
            cache,
            next_cache_entries,
            warnings,
        );

        books.push(ScannedBook {
            discovery_id: discovery_id(&relative_path, size, modified_at),
            relative_path,
            file_name,
            folder_path,
            size,
            modified_at,
            source_metadata,
        });
    }

    Ok(())
}

fn scan_path(root: PathBuf) -> Result<ArchiveScan, String> {
    if !root.is_dir() {
        return Err("The saved archive folder is unavailable.".to_string());
    }

    let mut warnings = Vec::new();
    let cache = match metadata::load_scanner_cache_with_recovery_at(&root) {
        Ok((cache, recovered)) => {
            if recovered {
                warnings.push(ArchiveScanWarning {
                    relative_path: format!(
                        "{}/{}",
                        metadata::METADATA_DIRECTORY,
                        metadata::SCANNER_CACHE_FILE
                    ),
                    message: "Scanner cache was rebuilt.".to_string(),
                });
            }
            cache
        }
        Err(_) => {
            warnings.push(ArchiveScanWarning {
                relative_path: format!(
                    "{}/{}",
                    metadata::METADATA_DIRECTORY,
                    metadata::SCANNER_CACHE_FILE
                ),
                message: "Scanner cache could not be read. It will be rebuilt.".to_string(),
            });
            metadata::ScannerCache::default()
        }
    };
    let mut next_cache = metadata::ScannerCache::default();
    let mut books = Vec::new();
    let mut folders = Vec::new();
    scan_directory(
        &root,
        &root,
        &cache,
        &mut next_cache.entries,
        &mut books,
        &mut folders,
        &mut warnings,
    )?;
    books.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    folders.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    if next_cache != cache && metadata::save_scanner_cache_at(&root, &next_cache).is_err() {
        warnings.push(ArchiveScanWarning {
            relative_path: format!(
                "{}/{}",
                metadata::METADATA_DIRECTORY,
                metadata::SCANNER_CACHE_FILE
            ),
            message: concat!(
                "Scanner cache could not be saved. ",
                "The library will rescan more work next time."
            )
            .to_string(),
        });
    }

    Ok(ArchiveScan {
        books,
        folders,
        warnings,
    })
}

#[tauri::command]
pub async fn scan_archive(
    app: tauri::AppHandle,
    root_path: Option<String>,
) -> Result<ArchiveScan, String> {
    let path = archive_root::resolve_archive_root(&app, root_path)?;
    tauri::async_runtime::spawn_blocking(move || scan_path(path))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn clear_scanner_cache(app: tauri::AppHandle, root_path: Option<String>) -> Result<(), String> {
    let path = archive_root::resolve_archive_root(&app, root_path)?;
    metadata::clear_scanner_cache_at(&path)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::Write,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::scan_path;

    fn write_minimal_epub(path: &std::path::Path, package_xml: &[u8]) {
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

    fn modified_at_millis(path: &std::path::Path) -> u64 {
        fs::metadata(path)
            .expect("file metadata should be readable")
            .modified()
            .expect("modified time should exist")
            .duration_since(UNIX_EPOCH)
            .expect("modified time should be after epoch")
            .as_millis()
            .min(u128::from(u64::MAX)) as u64
    }

    #[test]
    fn scans_core_epub_metadata_without_blocking_bad_epubs() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-metadata-{nonce}"));
        fs::create_dir_all(&root).expect("test archive should be created");
        write_minimal_epub(
            &root.join("metadata.epub"),
            br#"<package><metadata>
                <dc:title>Package Title</dc:title>
                <dc:creator>Package Author</dc:creator>
                <dc:identifier>urn:test:book</dc:identifier>
                <dc:language>en</dc:language>
            </metadata></package>"#,
        );
        fs::write(root.join("broken.epub"), b"not a zip").expect("bad EPUB should be written");

        let scan = scan_path(root.clone()).expect("archive scan should succeed");

        assert_eq!(scan.books.len(), 2);
        let book = scan
            .books
            .iter()
            .find(|book| book.file_name == "metadata.epub")
            .expect("metadata EPUB should be scanned");
        let metadata = book
            .source_metadata
            .as_ref()
            .expect("source metadata should be parsed");
        assert_eq!(metadata.title.as_deref(), Some("Package Title"));
        assert_eq!(metadata.creator.as_deref(), Some("Package Author"));
        assert_eq!(metadata.identifier.as_deref(), Some("urn:test:book"));
        assert_eq!(metadata.language.as_deref(), Some("en"));
        assert_eq!(scan.warnings.len(), 1);
        assert_eq!(scan.warnings[0].relative_path, "broken.epub");

        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn uses_cached_metadata_for_unchanged_epubs() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-cache-{nonce}"));
        fs::create_dir_all(root.join(".archeion")).expect("metadata directory should be created");
        let epub_path = root.join("cached.epub");
        fs::write(&epub_path, b"bad").expect("bad EPUB should be written");
        let modified_at = modified_at_millis(&epub_path);
        fs::write(
            root.join(".archeion").join("scanner-cache.json"),
            serde_json::json!({
                "version": 1,
                "entries": {
                    "cached.epub": {
                        "size": 3,
                        "modifiedAt": modified_at,
                        "sourceMetadata": {
                            "title": "Cached Title",
                            "creator": "Cached Author",
                            "identifier": "urn:cached"
                        }
                    }
                }
            })
            .to_string(),
        )
        .expect("scanner cache should be written");

        let scan = scan_path(root.clone()).expect("archive scan should succeed");

        assert_eq!(scan.warnings.len(), 0);
        let metadata = scan.books[0]
            .source_metadata
            .as_ref()
            .expect("cached metadata should be used");
        assert_eq!(metadata.title.as_deref(), Some("Cached Title"));
        assert_eq!(metadata.creator.as_deref(), Some("Cached Author"));
        assert_eq!(metadata.identifier.as_deref(), Some("urn:cached"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn reuses_cached_metadata_for_moved_unchanged_epubs() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-cache-moved-{nonce}"));
        let metadata_dir = root.join(".archeion");
        let moved_dir = root.join("Moved");
        fs::create_dir_all(&metadata_dir).expect("metadata directory should be created");
        fs::create_dir_all(&moved_dir).expect("moved directory should be created");
        let epub_path = moved_dir.join("cached.epub");
        fs::write(&epub_path, b"bad").expect("bad EPUB should be written");
        let modified_at = modified_at_millis(&epub_path);
        fs::write(
            metadata_dir.join("scanner-cache.json"),
            serde_json::json!({
                "version": 1,
                "entries": {
                    "Original/cached.epub": {
                        "size": 3,
                        "modifiedAt": modified_at,
                        "sourceMetadata": {
                            "title": "Moved Cached Title",
                            "identifier": "urn:moved-cache"
                        }
                    }
                }
            })
            .to_string(),
        )
        .expect("scanner cache should be written");

        let scan = scan_path(root.clone()).expect("archive scan should succeed");

        assert_eq!(scan.warnings.len(), 0);
        let metadata = scan.books[0]
            .source_metadata
            .as_ref()
            .expect("moved cached metadata should be used");
        assert_eq!(metadata.title.as_deref(), Some("Moved Cached Title"));
        assert_eq!(metadata.identifier.as_deref(), Some("urn:moved-cache"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn does_not_reuse_signature_cache_when_filename_differs() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("archeion-scanner-cache-different-name-{nonce}"));
        let metadata_dir = root.join(".archeion");
        fs::create_dir_all(&metadata_dir).expect("metadata directory should be created");
        let epub_path = root.join("different.epub");
        fs::write(&epub_path, b"bad").expect("bad EPUB should be written");
        let modified_at = modified_at_millis(&epub_path);
        fs::write(
            metadata_dir.join("scanner-cache.json"),
            serde_json::json!({
                "version": 1,
                "entries": {
                    "Original/cached.epub": {
                        "size": 3,
                        "modifiedAt": modified_at,
                        "sourceMetadata": {
                            "title": "Cached Title",
                            "identifier": "urn:cached"
                        }
                    }
                }
            })
            .to_string(),
        )
        .expect("scanner cache should be written");

        let scan = scan_path(root.clone()).expect("archive scan should succeed");

        assert_eq!(scan.books[0].source_metadata, None);
        assert_eq!(scan.warnings.len(), 1);
        assert_eq!(scan.warnings[0].relative_path, "different.epub");
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn ignores_ambiguous_signature_cache_matches() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-cache-ambiguous-{nonce}"));
        let metadata_dir = root.join(".archeion");
        fs::create_dir_all(&metadata_dir).expect("metadata directory should be created");
        let epub_path = root.join("ambiguous.epub");
        fs::write(&epub_path, b"bad").expect("bad EPUB should be written");
        let modified_at = modified_at_millis(&epub_path);
        fs::write(
            metadata_dir.join("scanner-cache.json"),
            serde_json::json!({
                "version": 1,
                "entries": {
                    "A/ambiguous.epub": {
                        "size": 3,
                        "modifiedAt": modified_at,
                        "sourceMetadata": {
                            "title": "First Cached Title",
                            "identifier": "urn:first-cache"
                        }
                    },
                    "B/ambiguous.epub": {
                        "size": 3,
                        "modifiedAt": modified_at,
                        "sourceMetadata": {
                            "title": "Second Cached Title",
                            "identifier": "urn:second-cache"
                        }
                    }
                }
            })
            .to_string(),
        )
        .expect("scanner cache should be written");

        let scan = scan_path(root.clone()).expect("archive scan should succeed");

        assert_eq!(scan.books[0].source_metadata, None);
        assert_eq!(scan.warnings.len(), 1);
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn caches_metadata_errors_for_unchanged_epubs() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-cache-errors-{nonce}"));
        fs::create_dir_all(&root).expect("test archive should be created");
        fs::write(root.join("broken.epub"), b"not a zip").expect("bad EPUB should be written");

        let first_scan = scan_path(root.clone()).expect("archive scan should succeed");

        assert_eq!(first_scan.warnings.len(), 1);
        let cache_contents = fs::read_to_string(root.join(".archeion/scanner-cache.json"))
            .expect("scanner cache should exist");
        let cache: serde_json::Value =
            serde_json::from_str(&cache_contents).expect("scanner cache should be valid JSON");
        let broken_entry = &cache["entries"]["broken.epub"];
        assert_eq!(broken_entry["size"], 9);
        assert!(broken_entry["metadataError"].as_str().is_some());
        assert!(broken_entry["sourceMetadata"].is_null());

        let second_scan = scan_path(root.clone()).expect("archive scan should succeed");

        assert_eq!(second_scan.warnings.len(), 1);
        assert_eq!(second_scan.warnings[0].relative_path, "broken.epub");
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn uses_cached_metadata_error_for_unchanged_epubs() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-cache-error-reuse-{nonce}"));
        let metadata_dir = root.join(".archeion");
        fs::create_dir_all(&metadata_dir).expect("metadata directory should be created");
        let epub_path = root.join("broken.epub");
        fs::write(&epub_path, b"not a zip").expect("bad EPUB should be written");
        let modified_at = modified_at_millis(&epub_path);
        fs::write(
            metadata_dir.join("scanner-cache.json"),
            serde_json::json!({
                "version": 1,
                "entries": {
                    "broken.epub": {
                        "size": 9,
                        "modifiedAt": modified_at,
                        "metadataError": "cached metadata failure"
                    }
                }
            })
            .to_string(),
        )
        .expect("scanner cache should be written");

        let scan = scan_path(root.clone()).expect("archive scan should succeed");

        assert_eq!(scan.books[0].source_metadata, None);
        assert_eq!(scan.warnings.len(), 1);
        assert_eq!(scan.warnings[0].relative_path, "broken.epub");
        assert_eq!(scan.warnings[0].message, "cached metadata failure");
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn refreshes_stale_metadata_error_cache_entries() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("archeion-scanner-cache-error-refresh-{nonce}"));
        let metadata_dir = root.join(".archeion");
        fs::create_dir_all(&metadata_dir).expect("metadata directory should be created");
        let epub_path = root.join("changed.epub");
        write_minimal_epub(
            &epub_path,
            br#"<package><metadata><dc:title>Recovered Title</dc:title></metadata></package>"#,
        );
        fs::write(
            metadata_dir.join("scanner-cache.json"),
            serde_json::json!({
                "version": 1,
                "entries": {
                    "changed.epub": {
                        "size": 1,
                        "modifiedAt": 1,
                        "metadataError": "stale metadata failure"
                    }
                }
            })
            .to_string(),
        )
        .expect("scanner cache should be written");

        let scan = scan_path(root.clone()).expect("archive scan should succeed");

        assert_eq!(scan.warnings.len(), 0);
        let metadata = scan.books[0]
            .source_metadata
            .as_ref()
            .expect("fresh metadata should be parsed after stale error cache");
        assert_eq!(metadata.title.as_deref(), Some("Recovered Title"));
        let cache_contents = fs::read_to_string(metadata_dir.join("scanner-cache.json"))
            .expect("scanner cache should exist");
        assert!(!cache_contents.contains("stale metadata failure"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn recovers_from_corrupted_scanner_cache() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-cache-corrupt-{nonce}"));
        let metadata_dir = root.join(".archeion");
        fs::create_dir_all(&metadata_dir).expect("metadata directory should be created");
        write_minimal_epub(
            &root.join("recovered.epub"),
            br#"<package><metadata><dc:title>Recovered Title</dc:title></metadata></package>"#,
        );
        fs::write(metadata_dir.join("scanner-cache.json"), b"{not-json")
            .expect("corrupted scanner cache should be written");

        let scan = scan_path(root.clone()).expect("archive scan should recover and succeed");

        assert_eq!(scan.books.len(), 1);
        assert!(scan.warnings.iter().any(|warning| {
            warning.relative_path == ".archeion/scanner-cache.json"
                && warning.message == "Scanner cache was rebuilt."
        }));
        let metadata = scan.books[0]
            .source_metadata
            .as_ref()
            .expect("metadata should be parsed after cache recovery");
        assert_eq!(metadata.title.as_deref(), Some("Recovered Title"));
        assert!(metadata_dir.join("scanner-cache.json").is_file());
        assert!(metadata_dir
            .read_dir()
            .expect("metadata directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .contains("scanner-cache.json.corrupt-")));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn returns_scan_results_with_warning_when_scanner_cache_save_fails() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-cache-save-fail-{nonce}"));
        let metadata_dir = root.join(".archeion");
        fs::create_dir_all(&metadata_dir).expect("metadata directory should be created");
        fs::create_dir_all(metadata_dir.join("scanner-cache.json"))
            .expect("conflicting scanner cache directory should be created");
        write_minimal_epub(
            &root.join("Novel.epub"),
            br#"<package><metadata><dc:title>Novel</dc:title></metadata></package>"#,
        );

        let scan = scan_path(root.clone()).expect("archive scan should still succeed");

        assert_eq!(scan.books.len(), 1);
        assert!(scan.warnings.iter().any(|warning| {
            warning.relative_path == ".archeion/scanner-cache.json"
                && warning.message
                    == concat!(
                        "Scanner cache could not be saved. ",
                        "The library will rescan more work next time."
                    )
        }));
        assert!(metadata_dir.join("scanner-cache.json").is_dir());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn refreshes_stale_scanner_cache_entries() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-cache-refresh-{nonce}"));
        fs::create_dir_all(root.join(".archeion")).expect("metadata directory should be created");
        write_minimal_epub(
            &root.join("changed.epub"),
            br#"<package><metadata><dc:title>Fresh Title</dc:title></metadata></package>"#,
        );
        fs::write(
            root.join(".archeion").join("scanner-cache.json"),
            serde_json::json!({
                "version": 1,
                "entries": {
                    "changed.epub": {
                        "size": 1,
                        "modifiedAt": 1,
                        "sourceMetadata": { "title": "Stale Title" }
                    }
                }
            })
            .to_string(),
        )
        .expect("scanner cache should be written");

        let scan = scan_path(root.clone()).expect("archive scan should succeed");

        let metadata = scan.books[0]
            .source_metadata
            .as_ref()
            .expect("fresh metadata should be parsed");
        assert_eq!(metadata.title.as_deref(), Some("Fresh Title"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

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

        let scan = scan_path(root.clone()).expect("archive scan should succeed");

        assert_eq!(scan.books.len(), 1);
        assert_eq!(scan.books[0].relative_path, "Author/Series/Volume 01.EPUB");
        assert_eq!(scan.folders.len(), 2);
        assert_eq!(scan.folders[1].parent_path.as_deref(), Some("Author"));

        fs::remove_dir_all(root).expect("test archive should be removed");
    }
}
