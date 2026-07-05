use std::{
    collections::HashMap,
    fs,
    io::{Cursor, Read},
    path::{Component, Path, PathBuf},
    process::Command,
    time::UNIX_EPOCH,
};

use image::{ImageFormat, ImageReader, Limits};
use percent_encoding::percent_decode_str;
use quick_xml::{events::Event, Reader};
use zip::ZipArchive;

use super::vault;

pub(crate) fn resolve_epub_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let relative = Path::new(relative_path);
    if relative.is_absolute() {
        return Err("EPUB paths must be relative to the library folder.".to_string());
    }
    if relative.components().any(|component| {
        matches!(
            component,
            Component::ParentDir | Component::RootDir | Component::Prefix(_)
        )
    }) {
        return Err("The EPUB path is outside the library folder.".to_string());
    }
    if relative
        .components()
        .next()
        .is_some_and(|component| component.as_os_str() == ".archeion")
    {
        return Err("App metadata cannot be opened as an EPUB.".to_string());
    }
    let is_epub = relative
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("epub"));
    if !is_epub {
        return Err("The selected file is not an EPUB.".to_string());
    }

    let canonical_root = fs::canonicalize(root).map_err(|error| error.to_string())?;
    let path =
        fs::canonicalize(canonical_root.join(relative)).map_err(|error| error.to_string())?;
    if !path.starts_with(&canonical_root) || !path.is_file() {
        return Err("The EPUB file is outside the library folder.".to_string());
    }

    Ok(path)
}

fn xml_elements(xml: &str, names: &[&[u8]]) -> Vec<(String, HashMap<String, String>)> {
    let mut reader = Reader::from_str(xml);
    let mut elements = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) | Ok(Event::Empty(event))
                if names
                    .iter()
                    .any(|name| event.local_name().as_ref() == *name) =>
            {
                let attributes = event
                    .attributes()
                    .filter_map(Result::ok)
                    .filter_map(|attribute| {
                        let key = String::from_utf8_lossy(attribute.key.local_name().as_ref())
                            .into_owned();
                        let value = attribute
                            .decoded_and_normalized_value(
                                quick_xml::XmlVersion::Implicit1_0,
                                reader.decoder(),
                            )
                            .ok()?
                            .into_owned();
                        Some((key, value))
                    })
                    .collect();
                elements.push((
                    String::from_utf8_lossy(event.local_name().as_ref()).into_owned(),
                    attributes,
                ));
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }
    elements
}

fn archive_relative_path(package_path: &str, href: &str) -> String {
    let mut parts = Path::new(package_path)
        .parent()
        .unwrap_or_else(|| Path::new(""))
        .components()
        .filter_map(|component| match component {
            Component::Normal(part) => Some(part.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect::<Vec<_>>();
    for component in Path::new(href).components() {
        match component {
            Component::ParentDir => {
                parts.pop();
            }
            Component::Normal(part) => parts.push(part.to_string_lossy().into_owned()),
            _ => {}
        }
    }
    parts.join("/")
}

fn read_zip_text(
    archive: &mut ZipArchive<fs::File>,
    path: &str,
    limit: u64,
) -> Result<String, String> {
    let entry = archive.by_name(path).map_err(|error| error.to_string())?;
    if entry.size() > limit {
        return Err("EPUB metadata file is too large.".to_string());
    }
    let mut text = String::new();
    entry
        .take(limit)
        .read_to_string(&mut text)
        .map_err(|error| error.to_string())?;
    Ok(text)
}

fn extract_cover(epub_path: &Path) -> Result<Option<Vec<u8>>, String> {
    let file = fs::File::open(epub_path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let container = read_zip_text(&mut archive, "META-INF/container.xml", 512 * 1024)?;
    let package_path = xml_elements(&container, &[b"rootfile"])
        .into_iter()
        .find_map(|(_, attributes)| attributes.get("full-path").cloned())
        .ok_or_else(|| "EPUB package document was not found.".to_string())?;
    let package = read_zip_text(&mut archive, &package_path, 4 * 1024 * 1024)?;
    let elements = xml_elements(&package, &[b"meta", b"item"]);
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
    let decoded_href = percent_decode_str(&cover_href).decode_utf8_lossy();
    let cover_path = archive_relative_path(&package_path, decoded_href.as_ref());
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

fn load_epub_cover_at(root: &Path, relative_path: &str, book_id: &str) -> Result<Vec<u8>, String> {
    let epub_path = resolve_epub_path(root, relative_path)?;
    let cache_dir = root.join(".archeion").join("covers");
    let cache_path = cover_cache_path(&cache_dir, &epub_path, book_id)?;
    if cache_path.is_file() {
        return fs::read(cache_path).map_err(|error| error.to_string());
    }

    let extracted = extract_cover(&epub_path)?.unwrap_or_default();
    fs::create_dir_all(&cache_dir).map_err(|error| error.to_string())?;
    remove_stale_covers(&cache_dir, book_id, &cache_path);
    if extracted.is_empty() {
        fs::write(&cache_path, &[] as &[u8]).map_err(|error| error.to_string())?;
        return Ok(extracted);
    }
    let bytes = thumbnail_cover(&extracted).unwrap_or(extracted);
    fs::write(&cache_path, &bytes).map_err(|error| error.to_string())?;
    Ok(bytes)
}

#[tauri::command]
pub fn read_epub_file(
    app: tauri::AppHandle,
    relative_path: String,
) -> Result<tauri::ipc::Response, String> {
    let root = vault::read_vault_path(&app)?
        .map(PathBuf::from)
        .ok_or_else(|| "No library folder has been selected.".to_string())?;
    let path = resolve_epub_path(&root, &relative_path)?;
    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    Ok(tauri::ipc::Response::new(bytes))
}

#[tauri::command]
pub fn reveal_epub_file(app: tauri::AppHandle, relative_path: String) -> Result<(), String> {
    let root = vault::read_vault_path(&app)?
        .map(PathBuf::from)
        .ok_or_else(|| "No library folder has been selected.".to_string())?;
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
    relative_path: String,
    book_id: String,
) -> Result<tauri::ipc::Response, String> {
    if !book_id
        .chars()
        .all(|character| character.is_ascii_alphanumeric() || "-_".contains(character))
    {
        return Err("Invalid book identifier.".to_string());
    }
    let root = vault::read_vault_path(&app)?
        .map(PathBuf::from)
        .ok_or_else(|| "No library folder has been selected.".to_string())?;
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

    use super::{cover_cache_path, extract_cover, resolve_epub_path, thumbnail_cover};

    fn test_root() -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-epub-{nonce}"))
    }

    #[test]
    fn resolves_epubs_inside_the_vault() {
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
        fs::remove_dir_all(root).expect("test vault should be removed");
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
        fs::remove_dir_all(root).expect("test vault should be removed");
    }

    #[test]
    fn extracts_an_epub_three_cover() {
        let root = test_root();
        fs::create_dir_all(&root).expect("test vault should be created");
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
        fs::remove_dir_all(root).expect("test vault should be removed");
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
}
