use std::{
    collections::HashMap,
    fs::{self, File},
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, Condvar, Mutex, OnceLock},
    time::UNIX_EPOCH,
};

use image::{ImageFormat, ImageReader, Limits};
use zip::ZipArchive;

use super::{archive_root, epub_metadata, filesystem};

pub(crate) fn resolve_epub_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    filesystem::resolve_existing_epub_path(root, relative_path)
}

fn extract_cover(epub_path: &Path) -> Result<Option<Vec<u8>>, String> {
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
    let mut bytes = Vec::new();
    archive
        .by_name(&cover_path)
        .map_err(|error| error.to_string())?
        .take(20 * 1024 * 1024)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    Ok((!bytes.is_empty()).then_some(bytes))
}

fn thumbnail_cover(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|error| error.to_string())?;
    let mut limits = Limits::default();
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode().map_err(|error| error.to_string())?;
    let thumbnail = image.thumbnail(320, 480);
    let mut output = Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok(output.into_inner())
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

fn remove_stale_covers(cache_dir: &Path, book_id: &str, keep: &Path) {
    let prefix = format!("{book_id}-");
    let legacy_name = format!("{book_id}.cover");
    let Ok(entries) = fs::read_dir(cache_dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if path != keep && (name == legacy_name || name.starts_with(&prefix)) {
            let _ = fs::remove_file(path);
        }
    }
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

struct CoverLoadWaiter {
    state: Mutex<Option<Result<Vec<u8>, String>>>,
    ready: Condvar,
}

impl CoverLoadWaiter {
    fn new() -> Self {
        Self {
            state: Mutex::new(None),
            ready: Condvar::new(),
        }
    }
}

fn cover_loads() -> &'static Mutex<HashMap<PathBuf, Arc<CoverLoadWaiter>>> {
    static COVER_LOADS: OnceLock<Mutex<HashMap<PathBuf, Arc<CoverLoadWaiter>>>> = OnceLock::new();
    COVER_LOADS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn wait_for_cover_load(waiter: &CoverLoadWaiter) -> Result<Vec<u8>, String> {
    let mut state = waiter
        .state
        .lock()
        .map_err(|_| "The cover cache load state is unavailable.".to_string())?;

    loop {
        if let Some(result) = state.clone() {
            return result;
        }
        state = waiter
            .ready
            .wait(state)
            .map_err(|_| "The cover cache load state is unavailable.".to_string())?;
    }
}

fn load_epub_cover_uncached(
    epub_path: &Path,
    cache_dir: &Path,
    cache_path: &Path,
    book_id: &str,
) -> Result<Vec<u8>, String> {
    if cache_path.is_file() {
        return fs::read(cache_path).map_err(|error| error.to_string());
    }

    let extracted = extract_cover(epub_path)?.unwrap_or_default();
    fs::create_dir_all(cache_dir).map_err(|error| error.to_string())?;
    if extracted.is_empty() {
        write_cover_cache_atomic(cache_path, &[])?;
        remove_stale_covers(cache_dir, book_id, cache_path);
        return Ok(extracted);
    }

    let bytes = thumbnail_cover(&extracted).unwrap_or(extracted);
    write_cover_cache_atomic(cache_path, &bytes)?;
    remove_stale_covers(cache_dir, book_id, cache_path);
    Ok(bytes)
}

fn load_epub_cover_at(root: &Path, relative_path: &str, book_id: &str) -> Result<Vec<u8>, String> {
    let epub_path = resolve_epub_path(root, relative_path)?;
    let cache_dir = root.join(".archeion").join("covers");
    let cache_path = cover_cache_path(&cache_dir, &epub_path, book_id)?;
    if cache_path.is_file() {
        return fs::read(cache_path).map_err(|error| error.to_string());
    }

    let (waiter, is_owner) = {
        let mut loads = cover_loads()
            .lock()
            .map_err(|_| "The cover cache load state is unavailable.".to_string())?;
        if let Some(waiter) = loads.get(&cache_path) {
            (Arc::clone(waiter), false)
        } else {
            let waiter = Arc::new(CoverLoadWaiter::new());
            loads.insert(cache_path.clone(), Arc::clone(&waiter));
            (waiter, true)
        }
    };

    if !is_owner {
        return wait_for_cover_load(&waiter);
    }

    let result = load_epub_cover_uncached(&epub_path, &cache_dir, &cache_path, book_id);
    {
        let mut state = waiter
            .state
            .lock()
            .map_err(|_| "The cover cache load state is unavailable.".to_string())?;
        *state = Some(result.clone());
        waiter.ready.notify_all();
    }

    if let Ok(mut loads) = cover_loads().lock() {
        if loads
            .get(&cache_path)
            .is_some_and(|current| Arc::ptr_eq(current, &waiter))
        {
            loads.remove(&cache_path);
        }
    }

    result
}

#[tauri::command]
pub fn read_epub_file(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_path: String,
) -> Result<tauri::ipc::Response, String> {
    let root = archive_root::resolve_archive_root(&app, root_path)?;
    let path = resolve_epub_path(&root, &relative_path)?;
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
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
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{
        cover_cache_path, extract_cover, load_epub_cover_at, resolve_epub_path,
        temporary_cover_cache_path, thumbnail_cover, write_cover_cache_atomic,
    };

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
        if cover_bytes.is_some() {
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
                .write_all(cover_bytes.expect("cover bytes should exist"))
                .expect("cover should be written");
        } else {
            archive
                .write_all(br#"<package><manifest></manifest></package>"#)
                .expect("package should be written");
        }
        archive.finish().expect("EPUB should finish");
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

        assert_eq!(cover, vec![255, 216, 255, 217]);
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn creates_bounded_cover_thumbnails() {
        let source = image::DynamicImage::new_rgb8(1200, 1800);
        let mut source_bytes = std::io::Cursor::new(Vec::new());
        source
            .write_to(&mut source_bytes, image::ImageFormat::Png)
            .expect("source image should encode");

        let thumbnail =
            thumbnail_cover(source_bytes.get_ref()).expect("thumbnail should be generated");
        let decoded =
            image::load_from_memory(&thumbnail).expect("thumbnail should be a readable image");

        assert!(decoded.width() <= 320);
        assert!(decoded.height() <= 480);
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

        let first = load_epub_cover_at(&root, "book.epub", "book-1")
            .expect("first cover load should work");
        let cache_dir = root.join(".archeion").join("covers");
        let cache_path = cover_cache_path(&cache_dir, &epub_path, "book-1")
            .expect("cache path should resolve");
        fs::write(&cache_path, b"cached").expect("cache should be overwritten for reuse test");

        let second = load_epub_cover_at(&root, "book.epub", "book-1")
            .expect("second cover load should work");

        assert_eq!(first, vec![1, 2, 3]);
        assert_eq!(second, b"cached");
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn removes_stale_cover_files_after_new_cache_file_is_written() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        write_test_epub(&epub_path, Some(&[1, 2, 3]));
        let first = load_epub_cover_at(&root, "book.epub", "book-1")
            .expect("first cover load should work");
        assert_eq!(first, vec![1, 2, 3]);
        let cache_dir = root.join(".archeion").join("covers");
        let old_cache_path = cover_cache_path(&cache_dir, &epub_path, "book-1")
            .expect("old cache path should resolve");
        assert!(old_cache_path.is_file());

        write_test_epub(&epub_path, Some(&[4, 5, 6, 7, 8]));
        let second = load_epub_cover_at(&root, "book.epub", "book-1")
            .expect("second cover load should work");

        assert_eq!(second, vec![4, 5, 6, 7, 8]);
        assert!(!old_cache_path.exists());
        assert!(cover_cache_path(&cache_dir, &epub_path, "book-1")
            .expect("new cache path should resolve")
            .is_file());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn empty_cover_cache_remains_valid() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let epub_path = root.join("book.epub");
        write_test_epub(&epub_path, None);

        let first = load_epub_cover_at(&root, "book.epub", "book-1")
            .expect("first cover load should work");
        let cache_dir = root.join(".archeion").join("covers");
        let cache_path = cover_cache_path(&cache_dir, &epub_path, "book-1")
            .expect("cache path should resolve");
        let second = load_epub_cover_at(&root, "book.epub", "book-1")
            .expect("second cover load should work");

        assert!(first.is_empty());
        assert!(second.is_empty());
        assert!(cache_path.is_file());
        assert_eq!(fs::read(cache_path).expect("negative cache should read"), Vec::<u8>::new());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn cover_cache_writes_replace_through_temporary_files() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test archive should be created");
        let cache_path = root.join("book-1-3-100.cover");
        let temporary_path = temporary_cover_cache_path(&cache_path)
            .expect("temporary cache path should resolve");
        fs::write(&cache_path, b"old").expect("old cache should be written");
        fs::write(&temporary_path, b"partial").expect("stale temporary cache should be written");

        write_cover_cache_atomic(&cache_path, b"new cache")
            .expect("atomic cover cache write should work");

        assert_eq!(fs::read(&cache_path).expect("cache should read"), b"new cache");
        assert!(!temporary_path.exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }
}

