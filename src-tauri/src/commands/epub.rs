use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    process::Command,
    time::UNIX_EPOCH,
};

use zip::ZipArchive;

use super::{
    archive_root, epub_cover_requests, epub_cover_resource, epub_file_resource, epub_metadata,
    filesystem,
};

pub(crate) fn resolve_epub_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    filesystem::resolve_existing_epub_path(root, relative_path)
}

fn extract_cover(epub_path: &Path) -> Result<Option<epub_cover_resource::CoverResource>, String> {
    let file = fs::File::open(epub_path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let package = epub_metadata::read_package_document(&mut archive)?;
    let elements = epub_metadata::xml_elements(&package.xml, &[b"meta", b"item"]);
    let cover_id = elements.iter().find_map(|(name, attributes)| {
        (name == "meta" && attributes.get("name").is_some_and(|value| value == "cover"))
            .then(|| attributes.get("content").cloned())
            .flatten()
    });
    let cover_href = elements.iter().find_map(|(name, attributes)| {
        if name != "item" {
            return None;
        }
        let is_cover_id = cover_id
            .as_ref()
            .is_some_and(|id| attributes.get("id") == Some(id));
        let is_cover_property = attributes
            .get("properties")
            .is_some_and(|value| value.split_whitespace().any(|part| part == "cover-image"));
        (is_cover_id || is_cover_property)
            .then(|| attributes.get("href").cloned())
            .flatten()
    });
    let Some(cover_href) = cover_href else {
        return Ok(None);
    };
    let decoded_href = epub_metadata::decode_archive_href(&cover_href);
    let cover_path = epub_metadata::resolve_zip_relative_path(&package.path, &decoded_href)?;
    let mut cover_entry = archive
        .by_name(&cover_path)
        .map_err(|error| error.to_string())?;
    let declared_size = cover_entry.size();
    let resource = epub_cover_resource::read_cover_resource(&mut cover_entry, declared_size)?;
    Ok((!resource.is_empty()).then_some(resource))
}

fn cover_cache_path(cache_dir: &Path, epub_path: &Path, book_id: &str) -> Result<PathBuf, String> {
    let metadata = fs::metadata(epub_path).map_err(|error| error.to_string())?;
    let modified = metadata
        .modified()
        .map_err(|error| error.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_nanos();
    Ok(cache_dir.join(format!("{book_id}-{}-{modified}.cover", metadata.len())))
}

fn temporary_cover_cache_path(cache_path: &Path) -> Result<PathBuf, String> {
    let file_name = cache_path
        .file_name()
        .ok_or_else(|| "The cover cache file is unavailable.".to_string())?
        .to_string_lossy();
    Ok(cache_path.with_file_name(format!("{file_name}.tmp")))
}

fn write_cover_cache_atomic(cache_path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary_path = temporary_cover_cache_path(cache_path)?;
    let write_result = (|| {
        let mut temporary = File::create(&temporary_path).map_err(|error| error.to_string())?;
        temporary
            .write_all(bytes)
            .map_err(|error| error.to_string())?;
        temporary.sync_all().map_err(|error| error.to_string())?;

        if cache_path.exists() {
            fs::remove_file(cache_path).map_err(|error| error.to_string())?;
        }
        fs::rename(&temporary_path, cache_path).map_err(|error| error.to_string())
    })();

    if write_result.is_err() {
        let _ = fs::remove_file(&temporary_path);
    }

    write_result
}

#[derive(Debug, Eq, PartialEq)]
enum CoverCacheRead {
    Missing,
    Hit(Vec<u8>),
    Oversized,
}

fn read_cover_cache(cache_path: &Path) -> Result<CoverCacheRead, String> {
    let mut cache_file = match File::open(cache_path) {
        Ok(file) => file,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(CoverCacheRead::Missing)
        }
        Err(_) => return Err("The cover cache entry could not be opened.".to_string()),
    };
    let declared_size = cache_file
        .metadata()
        .map_err(|_| "The cover cache entry could not be inspected.".to_string())?
        .len();
    let read_result = epub_cover_resource::read_bounded_cover_bytes(&mut cache_file, declared_size);
    drop(cache_file);

    match read_result {
        Ok(bytes) => Ok(CoverCacheRead::Hit(bytes)),
        Err(epub_cover_resource::CoverByteReadError::TooLarge) => Ok(CoverCacheRead::Oversized),
        Err(epub_cover_resource::CoverByteReadError::Allocation) => {
            Err("The cover cache entry could not be buffered safely.".to_string())
        }
        Err(epub_cover_resource::CoverByteReadError::Read) => {
            Err("The cover cache entry could not be read.".to_string())
        }
    }
}

fn load_epub_cover_uncached(
    epub_path: &Path,
    cache_dir: &Path,
    cache_path: &Path,
) -> Result<Vec<u8>, String> {
    match read_cover_cache(cache_path)? {
        CoverCacheRead::Hit(bytes) => return Ok(bytes),
        CoverCacheRead::Missing | CoverCacheRead::Oversized => {}
    }

    let extracted = extract_cover(epub_path)?;
    fs::create_dir_all(cache_dir).map_err(|error| error.to_string())?;
    let Some(extracted) = extracted else {
        write_cover_cache_atomic(cache_path, &[])?;
        return Ok(Vec::new());
    };

    let bytes = extracted.into_ipc_bytes()?;
    write_cover_cache_atomic(cache_path, &bytes)?;
    Ok(bytes)
}

fn load_epub_cover_at_with_loader<F>(
    root: &Path,
    relative_path: &str,
    book_id: &str,
    loader: F,
) -> Result<Vec<u8>, String>
where
    F: FnOnce(&Path, &Path, &Path) -> Result<Vec<u8>, String>,
{
    let epub_path = resolve_epub_path(root, relative_path)?;
    let cache_dir = root.join(".archeion").join("covers");
    let cache_path = cover_cache_path(&cache_dir, &epub_path, book_id)?;
    match read_cover_cache(&cache_path)? {
        CoverCacheRead::Hit(bytes) => return Ok(bytes),
        CoverCacheRead::Missing | CoverCacheRead::Oversized => {}
    }

    epub_cover_requests::load_once(cache_path.clone(), || {
        loader(&epub_path, &cache_dir, &cache_path)
    })
}

pub(crate) fn load_epub_cover_at(
    root: &Path,
    relative_path: &str,
    book_id: &str,
) -> Result<Vec<u8>, String> {
    load_epub_cover_at_with_loader(root, relative_path, book_id, load_epub_cover_uncached)
}

#[tauri::command]
pub async fn read_epub_file(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_path: String,
) -> Result<tauri::ipc::Response, String> {
    let root = archive_root::resolve_archive_root(&app, root_path)?;
    let path = resolve_epub_path(&root, &relative_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        epub_file_resource::read_epub_file_bytes(&path).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn reveal_epub_file(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_path: String,
) -> Result<(), String> {
    let root = archive_root::resolve_archive_root(&app, root_path)?;
    let path = resolve_epub_path(&root, &relative_path)?;

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg("/select,");
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg("-R");
        command
    };
    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = Command::new("xdg-open");

    #[cfg(all(unix, not(target_os = "macos")))]
    let target = path
        .parent()
        .ok_or_else(|| "The EPUB folder is unavailable.".to_string())?;
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    let target = &path;

    command
        .arg(target)
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn load_epub_cover(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_path: String,
    book_id: String,
) -> Result<tauri::ipc::Response, String> {
    if !book_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "-_".contains(character))
    {
        return Err("Invalid book identifier.".to_string());
    }
    let root = archive_root::resolve_archive_root(&app, root_path)?;
    let bytes = tauri::async_runtime::spawn_blocking(move || {
        load_epub_cover_at(&root, &relative_path, &book_id)
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::Write,
        sync::{
            atomic::{AtomicUsize, Ordering},
            mpsc, Arc, Barrier,
        },
        thread,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{
        cover_cache_path, extract_cover, load_epub_cover_at, load_epub_cover_at_with_loader,
        load_epub_cover_uncached, read_cover_cache, resolve_epub_path, temporary_cover_cache_path,
        write_cover_cache_atomic, CoverCacheRead,
    };
    use crate::commands::{epub_cover_requests, epub_cover_resource::MAX_COVER_RESOURCE_BYTES};

    fn test_root() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-epub-{nonce}"))
    }

    fn write_test_epub(path: &std::path::Path, cover_bytes: Option<&[u8]>) {
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
        if let Some(cover_bytes) = cover_bytes {
            archive
                .write_all(
                    br#"<package><manifest>
                    <item id="cover" href="images/cover.bin" media-type="image/jpeg" properties="cover-image"/>
                    </manifest></package>"#,
                )
                .expect("package should be written");
            archive
                .start_file("OEBPS/images/cover.bin", options)
                .expect("cover entry should start");
            archive
                .write_all(cover_bytes)
                .expect("cover should be written");
        } else {
            archive
                .write_all(br#"<package><manifest></manifest></package>"#)
                .expect("package should be written");
        }
        archive.finish().expect("EPUB should finish");
    }

    fn supported_cover_bytes() -> Vec<u8> {
        let source = image::DynamicImage::new_rgb8(1_200, 1_800);
        let mut source_bytes = std::io::Cursor::new(Vec::new());
        source
            .write_to(&mut source_bytes, image::ImageFormat::Png)
            .expect("source cover should encode");
        source_bytes.into_inner()
    }

    fn write_oversized_cache(path: &std::path::Path) {
        let file = fs::File::create(path).expect("oversized cache fixture should be created");
        file.set_len(MAX_COVER_RESOURCE_BYTES + 1)
            .expect("oversized cache fixture should be sparse");
    }

    fn read_cache_hit(path: &std::path::Path) -> Vec<u8> {
        match read_cover_cache(path).expect("cache should be readable") {
            CoverCacheRead::Hit(bytes) => bytes,
            CoverCacheRead::Missing => panic!("cache should exist"),
            CoverCacheRead::Oversized => panic!("cache should be bounded"),
        }
    }

    #[test]
    fn resolves_epubs_inside_the_archive() {
        let root = test_root();
        let book = root.join("Series").join("Volume.epub");
        fs::create_dir_all(book.parent().expect("book should have a parent"))
            .expect("series should be created");
        fs::write(&book, b"epub").expect("EPUB should be created");

        let resolved = resolve_epub_path(&root, "Series/Volume.epub").expect("EPUB should resolve");

        assert_eq!(
            resolved,
            fs::canonicalize(&book).expect("book path should canonicalize")
        );
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn rejects_traversal_metadata_and_non_epub_paths() {
        let root = test_root();
        fs::create_dir_all(root.join(".archeion")).expect("metadata should be created");
        fs::write(root.join(".archeion").join("hidden.epub"), b"hidden")
            .expect("metadata file should be created");
        fs::write(root.join("notes.txt"), b"notes").expect("text file should be created");

        assert!(resolve_epub_path(&root, "../outside.epub").is_err());
        assert!(resolve_epub_path(&root, ".archeion/hidden.epub").is_err());
        assert!(resolve_epub_path(&root, "notes.txt").is_err());
        assert!(resolve_epub_path(&root, "missing.epub").is_err());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn extracts_an_epub_three_cover() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("covered.epub");
        let file = fs::File::create(&epub_path).expect("EPUB should be created");
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
            .write_all(
                br#"<package><manifest>
                <item id="cover" href="../images/cover.jpg" media-type="image/jpeg" properties="cover-image"/>
                </manifest></package>"#,
            )
            .expect("package should be written");
        archive
            .start_file("images/cover.jpg", options)
            .expect("cover entry should start");
        archive
            .write_all(&[255, 216, 255, 217])
            .expect("cover should be written");
        archive.finish().expect("EPUB should finish");

        let cover = extract_cover(&epub_path)
            .expect("cover extraction should succeed")
            .expect("cover should exist");

        assert_eq!(
            cover
                .into_ipc_bytes()
                .expect("small malformed image should use safe fallback"),
            vec![255, 216, 255, 217]
        );
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn cover_cache_key_changes_with_source_file() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test root should be created");
        let epub_path = root.join("book.epub");
        let cache_dir = root.join(".archeion").join("covers");
        fs::write(&epub_path, [1, 2, 3]).expect("source should be written");
        let first =
            cover_cache_path(&cache_dir, &epub_path, "book-1").expect("cache path should resolve");

        fs::write(&epub_path, [1, 2, 3, 4]).expect("source should be updated");
        let second =
            cover_cache_path(&cache_dir, &epub_path, "book-1").expect("cache path should resolve");

        assert_ne!(first, second);
        let _ = fs::remove_dir_all(root);
    }
    #[test]
    fn reuses_cover_cache_when_file_signature_is_unchanged() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        write_test_epub(&epub_path, Some(&[1, 2, 3]));

        let first =
            load_epub_cover_at(&root, "book.epub", "book-1").expect("first cover load should work");
        let cache_dir = root.join(".archeion").join("covers");
        let cache_path =
            cover_cache_path(&cache_dir, &epub_path, "book-1").expect("cache path should resolve");
        fs::write(&cache_path, b"cached").expect("cache should be overwritten for reuse test");

        let second = load_epub_cover_at(&root, "book.epub", "book-1")
            .expect("second cover load should work");

        assert_eq!(first, vec![1, 2, 3]);
        assert_eq!(second, b"cached");
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn thumbnails_and_caches_a_supported_cover() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        let source_bytes = supported_cover_bytes();
        write_test_epub(&epub_path, Some(&source_bytes));

        let loaded = load_epub_cover_at(&root, "book.epub", "book-1").expect("cover should load");
        let decoded = image::load_from_memory(&loaded).expect("thumbnail should decode");
        let cache_path =
            cover_cache_path(&root.join(".archeion").join("covers"), &epub_path, "book-1")
                .expect("cache path should resolve");

        assert!(decoded.width() <= 320);
        assert!(decoded.height() <= 480);
        assert_eq!(
            fs::read(cache_path).expect("cached thumbnail should read"),
            loaded
        );
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn oversized_cache_inspection_is_non_mutating() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test root should be created");
        let cache_path = root.join("oversized.cover");
        write_oversized_cache(&cache_path);

        let result = read_cover_cache(&cache_path).expect("oversized cache should be classified");

        assert_eq!(result, CoverCacheRead::Oversized);
        assert!(cache_path.is_file());
        fs::remove_dir_all(root).expect("test root should be removed");
    }

    #[test]
    fn outer_cache_hit_invalidates_and_regenerates_an_oversized_exact_entry() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        let source_bytes = supported_cover_bytes();
        write_test_epub(&epub_path, Some(&source_bytes));
        let cache_dir = root.join(".archeion").join("covers");
        fs::create_dir_all(&cache_dir).expect("cover cache should be created");
        let cache_path =
            cover_cache_path(&cache_dir, &epub_path, "book-1").expect("cache path should resolve");
        write_oversized_cache(&cache_path);

        let loaded =
            load_epub_cover_at(&root, "book.epub", "book-1").expect("cover should regenerate");
        let cached = read_cache_hit(&cache_path);

        assert!(loaded.len() as u64 <= MAX_COVER_RESOURCE_BYTES);
        assert_eq!(cached, loaded);
        assert!(cache_path.is_file());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn authoritative_cache_recheck_invalidates_and_regenerates_an_oversized_entry() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        let source_bytes = supported_cover_bytes();
        write_test_epub(&epub_path, Some(&source_bytes));
        let cache_dir = root.join(".archeion").join("covers");
        fs::create_dir_all(&cache_dir).expect("cover cache should be created");
        let cache_path =
            cover_cache_path(&cache_dir, &epub_path, "book-1").expect("cache path should resolve");
        write_oversized_cache(&cache_path);

        let loaded = load_epub_cover_uncached(&epub_path, &cache_dir, &cache_path)
            .expect("owner cache recheck should regenerate the cover");
        let cached = read_cache_hit(&cache_path);

        assert!(loaded.len() as u64 <= MAX_COVER_RESOURCE_BYTES);
        assert_eq!(cached, loaded);
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn same_key_oversized_cache_recovery_runs_one_coordinated_loader() {
        const CALLERS: usize = 6;

        let root = Arc::new(test_root());
        fs::create_dir_all(root.as_path()).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        let source_bytes = supported_cover_bytes();
        write_test_epub(&epub_path, Some(&source_bytes));
        let cache_dir = root.join(".archeion").join("covers");
        fs::create_dir_all(&cache_dir).expect("cover cache should be created");
        let cache_path =
            cover_cache_path(&cache_dir, &epub_path, "book-1").expect("cache path should resolve");
        write_oversized_cache(&cache_path);

        let start = Arc::new(Barrier::new(CALLERS + 1));
        let release_loader = Arc::new(Barrier::new(2));
        let load_count = Arc::new(AtomicUsize::new(0));
        let (loader_started, loader_is_started) = mpsc::channel();
        let mut handles = Vec::new();
        for _ in 0..CALLERS {
            let root = Arc::clone(&root);
            let start = Arc::clone(&start);
            let release_loader = Arc::clone(&release_loader);
            let load_count = Arc::clone(&load_count);
            let loader_started = loader_started.clone();
            handles.push(thread::spawn(move || {
                start.wait();
                load_epub_cover_at_with_loader(
                    root.as_path(),
                    "book.epub",
                    "book-1",
                    |epub_path, cache_dir, cache_path| {
                        load_count.fetch_add(1, Ordering::SeqCst);
                        loader_started
                            .send(())
                            .expect("the test should observe the owner loader");
                        release_loader.wait();
                        load_epub_cover_uncached(epub_path, cache_dir, cache_path)
                    },
                )
            }));
        }

        start.wait();
        loader_is_started
            .recv()
            .expect("one caller should enter the loader");
        epub_cover_requests::wait_for_participants(&cache_path, CALLERS);
        release_loader.wait();

        let responses = handles
            .into_iter()
            .map(|handle| {
                handle
                    .join()
                    .expect("cover caller should finish")
                    .expect("cover caller should receive regenerated bytes")
            })
            .collect::<Vec<_>>();
        let cached = read_cache_hit(&cache_path);

        assert_eq!(load_count.load(Ordering::SeqCst), 1);
        assert!(responses.iter().all(|response| response == &cached));
        assert!(cached.len() as u64 <= MAX_COVER_RESOURCE_BYTES);
        assert!(cache_path.is_file());
        assert!(!epub_cover_requests::contains_request(&cache_path));
        fs::remove_dir_all(root.as_path()).expect("test archive should be removed");
    }

    #[test]
    fn failed_coordinated_recovery_leaves_oversized_cache_bounded_and_retryable() {
        const CALLERS: usize = 4;

        let root = Arc::new(test_root());
        fs::create_dir_all(root.as_path()).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        let source_bytes = supported_cover_bytes();
        write_test_epub(&epub_path, Some(&source_bytes));
        let cache_dir = root.join(".archeion").join("covers");
        fs::create_dir_all(&cache_dir).expect("cover cache should be created");
        let cache_path =
            cover_cache_path(&cache_dir, &epub_path, "book-1").expect("cache path should resolve");
        write_oversized_cache(&cache_path);

        let start = Arc::new(Barrier::new(CALLERS + 1));
        let release_loader = Arc::new(Barrier::new(2));
        let failure_count = Arc::new(AtomicUsize::new(0));
        let (loader_started, loader_is_started) = mpsc::channel();
        let mut handles = Vec::new();
        for _ in 0..CALLERS {
            let root = Arc::clone(&root);
            let start = Arc::clone(&start);
            let release_loader = Arc::clone(&release_loader);
            let failure_count = Arc::clone(&failure_count);
            let loader_started = loader_started.clone();
            handles.push(thread::spawn(move || {
                start.wait();
                load_epub_cover_at_with_loader(
                    root.as_path(),
                    "book.epub",
                    "book-1",
                    |_epub_path, _cache_dir, _cache_path| {
                        failure_count.fetch_add(1, Ordering::SeqCst);
                        loader_started
                            .send(())
                            .expect("the test should observe the failing owner");
                        release_loader.wait();
                        Err("simulated regeneration failure".to_string())
                    },
                )
            }));
        }

        start.wait();
        loader_is_started
            .recv()
            .expect("one caller should enter the failing loader");
        epub_cover_requests::wait_for_participants(&cache_path, CALLERS);
        release_loader.wait();

        let failures = handles
            .into_iter()
            .map(|handle| handle.join().expect("cover caller should finish"))
            .collect::<Vec<_>>();
        assert_eq!(failure_count.load(Ordering::SeqCst), 1);
        assert!(failures.iter().all(|result| result.is_err()));
        assert_eq!(
            read_cover_cache(&cache_path).expect("oversized cache should remain rejectable"),
            CoverCacheRead::Oversized
        );
        assert!(cache_path.is_file());
        assert!(!epub_cover_requests::contains_request(&cache_path));

        let retry = load_epub_cover_at(root.as_path(), "book.epub", "book-1")
            .expect("later owner should retry successfully");

        assert!(retry.len() as u64 <= MAX_COVER_RESOURCE_BYTES);
        assert_eq!(read_cache_hit(&cache_path), retry);
        assert!(!epub_cover_requests::contains_request(&cache_path));
        fs::remove_dir_all(root.as_path()).expect("test archive should be removed");
    }

    #[test]
    fn production_cache_hit_paths_do_not_use_unrestricted_file_reads() {
        let production = include_str!("epub.rs")
            .split("#[cfg(test)]")
            .next()
            .expect("production module should precede tests");
        let unrestricted_cache_read = concat!("fs::read", "(cache_path");

        assert!(!production.contains(unrestricted_cache_read));
        assert!(!production.contains("read_dir("));
        assert_eq!(production.matches("read_cover_cache(").count(), 3);
    }

    #[test]
    fn repeated_cover_generation_never_traverses_or_removes_stale_revisions() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        let cache_dir = root.join(".archeion").join("covers");
        let mut generated_paths = Vec::new();

        for byte_count in 1..=8 {
            let cover = vec![byte_count as u8; byte_count];
            write_test_epub(&epub_path, Some(&cover));
            assert_eq!(
                load_epub_cover_at(&root, "book.epub", "book-1").expect("cover load should work"),
                cover
            );
            generated_paths.push(
                cover_cache_path(&cache_dir, &epub_path, "book-1")
                    .expect("cache path should resolve"),
            );
        }

        assert!(generated_paths.iter().all(|path| path.is_file()));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn empty_cover_cache_remains_valid() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        write_test_epub(&epub_path, None);

        let first =
            load_epub_cover_at(&root, "book.epub", "book-1").expect("first cover load should work");
        let cache_dir = root.join(".archeion").join("covers");
        let cache_path =
            cover_cache_path(&cache_dir, &epub_path, "book-1").expect("cache path should resolve");
        let second = load_epub_cover_at(&root, "book.epub", "book-1")
            .expect("second cover load should work");

        assert!(first.is_empty());
        assert!(second.is_empty());
        assert!(cache_path.is_file());
        assert_eq!(
            fs::read(cache_path).expect("negative cache should read"),
            Vec::<u8>::new()
        );
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn cover_cache_writes_replace_through_temporary_files() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let cache_path = root.join("book-1-3-100.cover");
        let temporary_path =
            temporary_cover_cache_path(&cache_path).expect("temporary cache path should resolve");
        fs::write(&cache_path, b"old").expect("old cache should be written");
        fs::write(&temporary_path, b"partial").expect("stale temporary cache should be written");

        write_cover_cache_atomic(&cache_path, b"new cache")
            .expect("atomic cover cache write should work");

        assert_eq!(
            fs::read(&cache_path).expect("cache should read"),
            b"new cache"
        );
        assert!(!temporary_path.exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }
}
