use std::{collections::HashMap, fs, io::Read, path::Path};

use percent_encoding::percent_decode_str;
use quick_xml::{events::Event, Reader};
use serde::{Deserialize, Serialize};
use zip::ZipArchive;

const CONTAINER_PATH: &str = "META-INF/container.xml";
const CONTAINER_READ_LIMIT: u64 = 512 * 1024;
const PACKAGE_READ_LIMIT: u64 = 4 * 1024 * 1024;

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubPackageMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub creator: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub identifier: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
}

impl EpubPackageMetadata {
    pub(crate) fn is_empty(&self) -> bool {
        self.title.is_none()
            && self.creator.is_none()
            && self.identifier.is_none()
            && self.language.is_none()
    }
}

pub(crate) struct EpubPackageDocument {
    pub path: String,
    pub xml: String,
}

pub(crate) fn xml_elements(xml: &str, names: &[&[u8]]) -> Vec<(String, HashMap<String, String>)> {
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

pub(crate) fn read_zip_text(
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

fn sanitize_zip_path(path: &str) -> Result<String, String> {
    let mut parts = Vec::new();
    for part in path.split('/') {
        if part.is_empty() || part == "." || part == ".." || part.contains('\\') {
            return Err("EPUB package path is unsafe.".to_string());
        }
        parts.push(part);
    }
    if parts.is_empty() {
        return Err("EPUB package path is empty.".to_string());
    }
    Ok(parts.join("/"))
}

pub(crate) fn resolve_zip_relative_path(package_path: &str, href: &str) -> Result<String, String> {
    let href = href.split(['#', '?']).next().unwrap_or(href);
    let mut parts = package_path
        .rsplit_once('/')
        .map(|(directory, _)| directory)
        .unwrap_or("")
        .split('/')
        .filter(|part| !part.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();

    for part in href.split('/') {
        if part.is_empty() || part == "." {
            continue;
        }
        if part.contains('\\') {
            return Err("EPUB archive path is unsafe.".to_string());
        }
        if part == ".." {
            if parts.pop().is_none() {
                return Err("EPUB archive path escapes the package directory.".to_string());
            }
            continue;
        }
        parts.push(part.to_string());
    }

    if parts.is_empty() {
        return Err("EPUB archive path is empty.".to_string());
    }
    Ok(parts.join("/"))
}

fn package_path_from_container(container_xml: &str) -> Result<String, String> {
    let path = xml_elements(container_xml, &[b"rootfile"])
        .into_iter()
        .find_map(|(_, attributes)| attributes.get("full-path").cloned())
        .ok_or_else(|| "EPUB package document was not found.".to_string())?;
    sanitize_zip_path(&path)
}

pub(crate) fn read_package_document(
    archive: &mut ZipArchive<fs::File>,
) -> Result<EpubPackageDocument, String> {
    let container = read_zip_text(archive, CONTAINER_PATH, CONTAINER_READ_LIMIT)?;
    let path = package_path_from_container(&container)?;
    let xml = read_zip_text(archive, &path, PACKAGE_READ_LIMIT)?;
    Ok(EpubPackageDocument { path, xml })
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum MetadataField {
    Title,
    Creator,
    Identifier,
    Language,
}

fn metadata_field(name: &[u8]) -> Option<MetadataField> {
    match name {
        b"title" => Some(MetadataField::Title),
        b"creator" => Some(MetadataField::Creator),
        b"identifier" => Some(MetadataField::Identifier),
        b"language" => Some(MetadataField::Language),
        _ => None,
    }
}

fn decode_xml_text(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    text.replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn decode_xml_reference(bytes: &[u8]) -> String {
    match bytes {
        b"amp" => "&".to_string(),
        b"lt" => "<".to_string(),
        b"gt" => ">".to_string(),
        b"quot" => "\"".to_string(),
        b"apos" => "'".to_string(),
        _ => format!("&{};", String::from_utf8_lossy(bytes)),
    }
}

fn clean_metadata_value(value: &str) -> Option<String> {
    let cleaned = value.split_whitespace().collect::<Vec<_>>().join(" ");
    (!cleaned.is_empty()).then_some(cleaned)
}

fn assign_metadata_value(metadata: &mut EpubPackageMetadata, field: MetadataField, value: &str) {
    let Some(value) = clean_metadata_value(value) else {
        return;
    };
    match field {
        MetadataField::Title if metadata.title.is_none() => metadata.title = Some(value),
        MetadataField::Creator if metadata.creator.is_none() => metadata.creator = Some(value),
        MetadataField::Identifier if metadata.identifier.is_none() => {
            metadata.identifier = Some(value)
        }
        MetadataField::Language if metadata.language.is_none() => metadata.language = Some(value),
        _ => {}
    }
}

pub(crate) fn parse_core_metadata(package_xml: &str) -> Result<EpubPackageMetadata, String> {
    let mut reader = Reader::from_str(package_xml);
    let mut metadata = EpubPackageMetadata::default();
    let mut in_metadata = false;
    let mut current_field = None;
    let mut current_value = String::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                let local_name = event.local_name();
                let name = local_name.as_ref();
                if name == b"metadata" {
                    in_metadata = true;
                    current_field = None;
                    current_value.clear();
                } else if in_metadata {
                    current_field = metadata_field(name);
                    current_value.clear();
                }
            }
            Ok(Event::Empty(event)) if in_metadata => {
                if metadata_field(event.local_name().as_ref()).is_some() {
                    current_field = None;
                    current_value.clear();
                }
            }
            Ok(Event::Text(event)) => {
                if in_metadata && current_field.is_some() {
                    current_value.push_str(&decode_xml_text(event.as_ref()));
                }
            }
            Ok(Event::CData(event)) => {
                if in_metadata && current_field.is_some() {
                    current_value.push_str(&decode_xml_text(event.as_ref()));
                }
            }
            Ok(Event::GeneralRef(event)) => {
                if in_metadata && current_field.is_some() {
                    current_value.push_str(&decode_xml_reference(event.as_ref()));
                }
            }
            Ok(Event::End(event)) => {
                let local_name = event.local_name();
                let name = local_name.as_ref();
                if name == b"metadata" {
                    in_metadata = false;
                    current_field = None;
                    current_value.clear();
                } else if in_metadata {
                    if let Some(field) = metadata_field(name) {
                        assign_metadata_value(&mut metadata, field, &current_value);
                        current_field = None;
                        current_value.clear();
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(error.to_string()),
            _ => {}
        }
    }

    Ok(metadata)
}

pub(crate) fn read_core_metadata(epub_path: &Path) -> Result<EpubPackageMetadata, String> {
    let file = fs::File::open(epub_path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let package = read_package_document(&mut archive)?;
    parse_core_metadata(&package.xml)
}

pub(crate) fn decode_archive_href(href: &str) -> String {
    percent_decode_str(href).decode_utf8_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use std::{fs, io::Write};

    use super::{parse_core_metadata, read_core_metadata, resolve_zip_relative_path};

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

    #[test]
    fn parses_core_metadata_fields() {
        let metadata = parse_core_metadata(
            r#"<package>
                <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
                    <dc:title>  Volume &amp; One  </dc:title>
                    <dc:creator>Jane Author</dc:creator>
                    <dc:identifier>urn:isbn:123</dc:identifier>
                    <dc:language>en</dc:language>
                </metadata>
            </package>"#,
        )
        .expect("metadata should parse");

        assert_eq!(metadata.title.as_deref(), Some("Volume & One"));
        assert_eq!(metadata.creator.as_deref(), Some("Jane Author"));
        assert_eq!(metadata.identifier.as_deref(), Some("urn:isbn:123"));
        assert_eq!(metadata.language.as_deref(), Some("en"));
    }

    #[test]
    fn returns_empty_metadata_when_core_fields_are_missing() {
        let metadata = parse_core_metadata(
            r#"<package><metadata><meta name="cover" content="cover-image"/></metadata></package>"#,
        )
        .expect("package should parse");

        assert!(metadata.is_empty());
    }

    #[test]
    fn fails_on_malformed_package_metadata() {
        assert!(parse_core_metadata(
            "<package><metadata><dc:title>Broken</dc:creator></metadata></package>"
        )
        .is_err());
    }

    #[test]
    fn reads_metadata_from_minimal_epub() {
        let root = std::env::temp_dir().join(format!(
            "archeion-epub-metadata-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .expect("system clock should be valid")
                .as_nanos()
        ));
        fs::create_dir_all(&root).expect("test root should be created");
        let epub_path = root.join("book.epub");
        write_epub(
            &epub_path,
            br#"<package><metadata><dc:title>Scanned Title</dc:title><dc:creator>Scanned Author</dc:creator></metadata></package>"#,
        );

        let metadata = read_core_metadata(&epub_path).expect("metadata should be read");

        assert_eq!(metadata.title.as_deref(), Some("Scanned Title"));
        assert_eq!(metadata.creator.as_deref(), Some("Scanned Author"));
        fs::remove_dir_all(root).expect("test root should be removed");
    }

    #[test]
    fn rejects_archive_paths_that_escape_the_package_directory() {
        assert!(resolve_zip_relative_path("OEBPS/content.opf", "../../cover.jpg").is_err());
    }
}
