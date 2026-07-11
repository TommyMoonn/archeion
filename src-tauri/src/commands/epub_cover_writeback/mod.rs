mod fingerprint;
mod image;
mod types;

use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use ::image::{GenericImageView, ImageReader, Limits};
use quick_xml::{
    events::{BytesEnd, BytesStart, Event},
    Reader, Writer,
};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

pub use self::types::{
    EpubCoverPreparation, EpubCoverPreparationInput, EpubCoverWritebackInput,
    EpubCoverWritebackResult,
};
use self::{
    fingerprint::{assert_fingerprint, file_fingerprint},
    image::{decode_cover_image, preview_bytes, process_cover_image, MAX_SOURCE_FILE_BYTES},
    types::{
        href_extension_matches_format, output_format_for_package, CoverImageFormat,
        EpubPackageVersion,
    },
};
use super::{archive_root, epub, epub_metadata, epub_writeback, filesystem};

const MAX_COVER_PAGE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_NAVIGATION_DOCUMENT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_COVER_STYLESHEET_BYTES: u64 = 512 * 1024;
const EPUB_OPS_NAMESPACE: &str = "http://www.idpf.org/2007/ops";
const PACKAGE_COVER_ID_BASE: &str = "archeion-cover-image";
const PACKAGE_COVER_FILE_BASE: &str = "archeion-cover";

#[derive(Clone, Debug)]
struct ManifestItem {
    id: String,
    href: String,
    media_type: String,
    properties: Vec<String>,
}

#[derive(Clone, Debug)]
struct PackageManifest {
    version: EpubPackageVersion,
    items: Vec<ManifestItem>,
    cover_meta_ids: Vec<String>,
    guide_cover_hrefs: Vec<String>,
}

#[derive(Clone, Debug)]
struct CoverPackagePlan {
    package_version: EpubPackageVersion,
    cover_item_id: String,
    cover_href: String,
    cover_zip_path: String,
    output_format: CoverImageFormat,
    existing_cover: bool,
    existing_media_type: Option<String>,
    had_cover_meta: bool,
    had_cover_property: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct CoverPageRelationship {
    page_item_id: String,
    image_item_id: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct CoverPageDependencies {
    image_href: String,
    stylesheet_hrefs: Vec<String>,
}

fn validate_book_id(book_id: &str) -> Result<(), String> {
    if book_id.is_empty()
        || !book_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_".contains(character))
    {
        return Err("The selected book identifier is invalid.".to_string());
    }
    Ok(())
}

fn ordered_attributes(reader: &Reader<&[u8]>, event: &BytesStart<'_>) -> Vec<(String, String)> {
    event
        .attributes()
        .filter_map(Result::ok)
        .filter_map(|attribute| {
            let key = String::from_utf8_lossy(attribute.key.as_ref()).into_owned();
            let value = attribute
                .decoded_and_normalized_value(quick_xml::XmlVersion::Implicit1_0, reader.decoder())
                .ok()?
                .into_owned();
            Some((key, value))
        })
        .collect()
}

fn attributes_map(reader: &Reader<&[u8]>, event: &BytesStart<'_>) -> HashMap<String, String> {
    ordered_attributes(reader, event).into_iter().collect()
}

fn strict_attributes_map(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
    resource_label: &str,
) -> Result<HashMap<String, String>, String> {
    event
        .attributes()
        .map(|attribute| {
            let attribute = attribute.map_err(|error| {
                format!(
                    "The EPUB {resource_label} contains a malformed attribute. The file was not modified. {error}"
                )
            })?;
            let key = String::from_utf8_lossy(attribute.key.as_ref()).into_owned();
            let value = attribute
                .decoded_and_normalized_value(quick_xml::XmlVersion::Implicit1_0, reader.decoder())
                .map_err(|error| {
                    format!(
                        "The EPUB {resource_label} contains an invalid attribute value. The file was not modified. {error}"
                    )
                })?
                .into_owned();
            Ok((key, value))
        })
        .collect()
}

fn local_attribute<'a>(attributes: &'a HashMap<String, String>, name: &str) -> Option<&'a String> {
    attributes.iter().find_map(|(key, value)| {
        key.rsplit(':')
            .next()
            .is_some_and(|local| local == name)
            .then_some(value)
    })
}

fn local_attribute_values(attributes: &HashMap<String, String>, name: &str) -> Vec<String> {
    let mut values = attributes
        .iter()
        .filter(|(key, _)| key.rsplit(':').next().is_some_and(|local| local == name))
        .map(|(_, value)| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    values.sort();
    values.dedup();
    values
}

fn unique_local_attribute(
    attributes: &HashMap<String, String>,
    name: &str,
    resource_label: &str,
) -> Result<Option<String>, String> {
    match local_attribute_values(attributes, name).as_slice() {
        [] => Ok(None),
        [value] => Ok(Some(value.clone())),
        _ => Err(format!(
            "The EPUB {resource_label} contains conflicting {name} attributes. The file was not modified."
        )),
    }
}

fn token_list_contains(value: &str, expected: &str) -> bool {
    value
        .split_whitespace()
        .any(|token| token.eq_ignore_ascii_case(expected))
}

fn apply_namespace_declarations(
    attributes: &HashMap<String, String>,
    bindings: &mut HashMap<String, String>,
) -> Result<(), String> {
    for (key, value) in attributes {
        let Some(prefix) = key.strip_prefix("xmlns:") else {
            continue;
        };
        let namespace = value.trim();
        if prefix.is_empty() || namespace.is_empty() {
            return Err(
                "The EPUB navigation document contains an invalid namespace declaration. The file was not modified."
                    .to_string(),
            );
        }
        bindings.insert(prefix.to_string(), namespace.to_string());
    }
    Ok(())
}

fn epub_type_contains(
    attributes: &HashMap<String, String>,
    namespace_bindings: &HashMap<String, String>,
    expected: &str,
) -> Result<bool, String> {
    let mut values = Vec::new();
    for (key, value) in attributes {
        let Some((prefix, local_name)) = key.split_once(':') else {
            continue;
        };
        if local_name != "type" {
            continue;
        }
        match namespace_bindings.get(prefix).map(String::as_str) {
            Some(EPUB_OPS_NAMESPACE) => values.push(value.trim().to_string()),
            None if prefix != "xml" && token_list_contains(value, expected) => {
                return Err(
                    "The EPUB navigation document uses a namespaced type without declaring its namespace. The file was not modified."
                        .to_string(),
                );
            }
            _ => {}
        }
    }
    values.sort();
    values.dedup();
    if values.len() > 1 {
        return Err(
            "The EPUB navigation document contains conflicting epub:type attributes. The file was not modified."
                .to_string(),
        );
    }
    Ok(values
        .first()
        .is_some_and(|value| token_list_contains(value, expected)))
}

fn manifest_item_has_property(item: &ManifestItem, expected: &str) -> bool {
    item.properties
        .iter()
        .any(|property| property.eq_ignore_ascii_case(expected))
}

fn package_manifest(package_xml: &str) -> Result<PackageManifest, String> {
    let mut reader = Reader::from_str(package_xml);
    let mut package_version = None;
    let mut in_metadata = false;
    let mut in_manifest = false;
    let mut in_guide = false;
    let mut manifest_items = Vec::new();
    let mut cover_meta_ids = Vec::new();
    let mut guide_cover_hrefs = Vec::new();

    loop {
        match reader.read_event().map_err(|error| error.to_string())? {
            Event::Start(event) => {
                let local_name = event.local_name();
                match local_name.as_ref() {
                    b"package" if package_version.is_none() => {
                        let attributes = attributes_map(&reader, &event);
                        let version = local_attribute(&attributes, "version")
                            .ok_or_else(|| "EPUB package version is missing.".to_string())?;
                        package_version = Some(EpubPackageVersion::parse(version)?);
                    }
                    b"metadata" => in_metadata = true,
                    b"manifest" => in_manifest = true,
                    b"guide" => in_guide = true,
                    b"item" if in_manifest => {
                        manifest_items.push(parse_manifest_item(&reader, &event)?);
                    }
                    b"meta" if in_metadata => {
                        collect_cover_meta(&reader, &event, &mut cover_meta_ids)?;
                    }
                    b"reference" if in_guide => {
                        collect_guide_cover_href(&reader, &event, &mut guide_cover_hrefs)?;
                    }
                    _ => {}
                }
            }
            Event::Empty(event) => match event.local_name().as_ref() {
                b"item" if in_manifest => {
                    manifest_items.push(parse_manifest_item(&reader, &event)?);
                }
                b"meta" if in_metadata => {
                    collect_cover_meta(&reader, &event, &mut cover_meta_ids)?;
                }
                b"reference" if in_guide => {
                    collect_guide_cover_href(&reader, &event, &mut guide_cover_hrefs)?;
                }
                _ => {}
            },
            Event::End(event) => match event.local_name().as_ref() {
                b"metadata" => in_metadata = false,
                b"manifest" => in_manifest = false,
                b"guide" => in_guide = false,
                _ => {}
            },
            Event::Eof => break,
            _ => {}
        }
    }

    let version =
        package_version.ok_or_else(|| "EPUB package element was not found.".to_string())?;
    if manifest_items.is_empty() {
        return Err("EPUB manifest is missing or empty.".to_string());
    }
    Ok(PackageManifest {
        version,
        items: manifest_items,
        cover_meta_ids,
        guide_cover_hrefs,
    })
}

fn parse_manifest_item(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
) -> Result<ManifestItem, String> {
    let attributes = attributes_map(reader, event);
    let id = local_attribute(&attributes, "id")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "An EPUB manifest item is missing its id.".to_string())?;
    let href = local_attribute(&attributes, "href")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("EPUB manifest item \"{id}\" is missing its href."))?;
    let media_type = local_attribute(&attributes, "media-type")
        .map(|value| value.trim().to_string())
        .unwrap_or_default();
    let properties = local_attribute(&attributes, "properties")
        .map(|value| value.split_whitespace().map(str::to_string).collect())
        .unwrap_or_default();
    Ok(ManifestItem {
        id,
        href,
        media_type,
        properties,
    })
}

fn collect_cover_meta(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
    cover_meta_ids: &mut Vec<String>,
) -> Result<(), String> {
    let attributes = attributes_map(reader, event);
    let is_cover = local_attribute(&attributes, "name")
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("cover"));
    if !is_cover {
        return Ok(());
    }
    let content = local_attribute(&attributes, "content")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "EPUB cover metadata is missing its manifest item reference.".to_string())?;
    cover_meta_ids.push(content);
    Ok(())
}

fn collect_guide_cover_href(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
    guide_cover_hrefs: &mut Vec<String>,
) -> Result<(), String> {
    let attributes = attributes_map(reader, event);
    let is_cover = local_attribute(&attributes, "type").is_some_and(|value| {
        value
            .split_whitespace()
            .any(|token| token.eq_ignore_ascii_case("cover"))
    });
    if !is_cover {
        return Ok(());
    }
    let href = local_attribute(&attributes, "href")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "EPUB cover guide reference is missing its href.".to_string())?;
    guide_cover_hrefs.push(href);
    Ok(())
}

fn unique_manifest_id(items: &[ManifestItem]) -> Result<(), String> {
    let mut ids = HashSet::new();
    for item in items {
        if !ids.insert(item.id.as_str()) {
            return Err(format!("EPUB manifest id \"{}\" is duplicated.", item.id));
        }
    }
    Ok(())
}

fn unique_value(base: &str, used: &HashSet<String>) -> String {
    if !used.contains(base) {
        return base.to_string();
    }
    for suffix in 2..=10_000 {
        let candidate = format!("{base}-{suffix}");
        if !used.contains(&candidate) {
            return candidate;
        }
    }
    format!(
        "{base}-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or_default()
    )
}

fn unique_cover_href(extension: &str, used: &HashSet<String>) -> String {
    let base = format!("images/{PACKAGE_COVER_FILE_BASE}.{extension}");
    if !used.contains(&base) {
        return base;
    }
    for suffix in 2..=10_000 {
        let candidate = format!("images/{PACKAGE_COVER_FILE_BASE}-{suffix}.{extension}");
        if !used.contains(&candidate) {
            return candidate;
        }
    }
    format!(
        "images/{PACKAGE_COVER_FILE_BASE}-{}.{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|value| value.as_nanos())
            .unwrap_or_default(),
        extension
    )
}

fn is_non_local_reference(value: &str) -> bool {
    let value = value.trim();
    if value.is_empty()
        || value.starts_with('/')
        || value.starts_with('\\')
        || value.starts_with('#')
    {
        return true;
    }

    value.split_once(':').is_some_and(|(scheme, _)| {
        !scheme.is_empty()
            && scheme.chars().enumerate().all(|(index, character)| {
                if index == 0 {
                    character.is_ascii_alphabetic()
                } else {
                    character.is_ascii_alphanumeric() || matches!(character, '+' | '-' | '.')
                }
            })
    })
}

fn manifest_item_for_zip_path<'a>(
    items: &'a [ManifestItem],
    package_path: &str,
    target_zip_path: &str,
) -> Result<&'a ManifestItem, String> {
    let matches = items
        .iter()
        .filter(|item| !is_non_local_reference(&item.href))
        .filter(|item| {
            let decoded_href = epub_metadata::decode_archive_href(&item.href);
            epub_metadata::resolve_zip_relative_path(package_path, &decoded_href)
                .is_ok_and(|path| path == target_zip_path)
        })
        .collect::<Vec<_>>();

    match matches.as_slice() {
        [item] => Ok(item),
        [] => Err(format!(
            "The EPUB cover resource \"{target_zip_path}\" is not tied to a manifest item. The file was not modified."
        )),
        _ => Err(format!(
            "The EPUB cover resource \"{target_zip_path}\" is tied to multiple manifest items. The file was not modified."
        )),
    }
}

fn contains_css_function(value: &str, function_name: &[u8]) -> bool {
    let bytes = value.as_bytes();
    let mut index = 0_usize;
    while index + function_name.len() <= bytes.len() {
        if !bytes[index..index + function_name.len()].eq_ignore_ascii_case(function_name) {
            index += 1;
            continue;
        }
        if index > 0
            && (bytes[index - 1].is_ascii_alphanumeric() || matches!(bytes[index - 1], b'-' | b'_'))
        {
            index += 1;
            continue;
        }
        let mut cursor = index + function_name.len();
        while cursor < bytes.len() && bytes[cursor].is_ascii_whitespace() {
            cursor += 1;
        }
        if cursor < bytes.len() && bytes[cursor] == b'(' {
            return true;
        }
        index += 1;
    }
    false
}

fn has_local_attribute(attributes: &HashMap<String, String>, name: &str) -> bool {
    attributes
        .keys()
        .any(|key| key.rsplit(':').next() == Some(name))
}

fn reject_unsafe_document_attributes(
    attributes: &HashMap<String, String>,
    document_label: &str,
    reject_event_handlers: bool,
) -> Result<(), String> {
    if attributes
        .keys()
        .any(|key| key.eq_ignore_ascii_case("xml:base"))
    {
        return Err(format!(
            "The EPUB {document_label} uses xml:base, so document-relative resources cannot be resolved safely. The file was not modified."
        ));
    }

    if reject_event_handlers
        && attributes.keys().any(|key| {
            key.rsplit(':').next().is_some_and(|local_name| {
                local_name
                    .as_bytes()
                    .get(..2)
                    .is_some_and(|prefix| prefix.eq_ignore_ascii_case(b"on"))
            })
        })
    {
        return Err(format!(
            "The EPUB {document_label} uses an event-handler attribute, so its displayed content cannot be resolved safely. The file was not modified."
        ));
    }

    Ok(())
}

fn inspect_cover_page_element(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
    image_hrefs: &mut Vec<String>,
    stylesheet_hrefs: &mut Vec<String>,
) -> Result<bool, String> {
    let attributes = strict_attributes_map(reader, event, "cover page")?;
    reject_unsafe_document_attributes(&attributes, "cover page", true)?;
    if event.local_name().as_ref().eq_ignore_ascii_case(b"base") {
        return Err(
            "The EPUB cover page contains a base element, so document-relative resources cannot be resolved safely. The file was not modified."
                .to_string(),
        );
    }
    if has_local_attribute(&attributes, "srcset") {
        return Err(
            "The EPUB cover page uses srcset, so its displayed image cannot be resolved safely. The file was not modified."
                .to_string(),
        );
    }
    if let Some(style) = unique_local_attribute(&attributes, "style", "cover page element")? {
        validate_cover_stylesheet(style.as_bytes())?;
    }

    match event.local_name().as_ref() {
        b"img" => {
            let href = unique_local_attribute(&attributes, "src", "cover page image")?
                .ok_or_else(|| {
                    "The EPUB cover page contains an image without a source. The file was not modified."
                        .to_string()
                })?;
            image_hrefs.push(href);
            Ok(false)
        }
        b"image" => {
            let href = unique_local_attribute(&attributes, "href", "cover page SVG image")?
                .ok_or_else(|| {
                    "The EPUB cover page contains an SVG image without an href. The file was not modified."
                        .to_string()
                })?;
            image_hrefs.push(href);
            Ok(false)
        }
        b"link" => {
            if unique_local_attribute(&attributes, "rel", "cover page link")?
                .as_deref()
                .is_some_and(|value| token_list_contains(value, "stylesheet"))
            {
                let href = unique_local_attribute(&attributes, "href", "cover page stylesheet")?
                    .ok_or_else(|| {
                        "The EPUB cover page contains a stylesheet link without an href. The file was not modified."
                            .to_string()
                    })?;
                stylesheet_hrefs.push(href);
            }
            Ok(false)
        }
        b"style" => Ok(true),
        b"picture" | b"source" => Err(
            "The EPUB cover page uses alternative image sources that Archeion cannot resolve safely. The file was not modified."
                .to_string(),
        ),
        b"script" => Err(
            "The EPUB cover page uses scripting that Archeion cannot resolve safely. The file was not modified."
                .to_string(),
        ),
        b"iframe" | b"object" | b"embed" => Err(
            "The EPUB cover page uses embedded content that Archeion cannot resolve safely. The file was not modified."
                .to_string(),
        ),
        _ => Ok(false),
    }
}

fn cover_page_dependencies(page_xml: &[u8]) -> Result<CoverPageDependencies, String> {
    let mut reader = Reader::from_reader(page_xml);
    let mut image_hrefs = Vec::new();
    let mut stylesheet_hrefs = Vec::new();
    let mut inline_style = None::<Vec<u8>>;

    loop {
        match reader.read_event().map_err(|error| {
            format!("The EPUB cover page is malformed and could not be analyzed safely. {error}")
        })? {
            Event::Start(event) => {
                if inspect_cover_page_element(
                    &reader,
                    &event,
                    &mut image_hrefs,
                    &mut stylesheet_hrefs,
                )? && inline_style.replace(Vec::new()).is_some()
                {
                    return Err(
                        "The EPUB cover page contains nested style elements and cannot be analyzed safely. The file was not modified."
                            .to_string(),
                    );
                }
            }
            Event::Empty(event) => {
                if inspect_cover_page_element(
                    &reader,
                    &event,
                    &mut image_hrefs,
                    &mut stylesheet_hrefs,
                )? {
                    validate_cover_stylesheet(&[])?;
                }
            }
            Event::Text(event) => {
                if let Some(style) = inline_style.as_mut() {
                    style.extend_from_slice(event.as_ref());
                }
            }
            Event::CData(event) => {
                if let Some(style) = inline_style.as_mut() {
                    style.extend_from_slice(event.as_ref());
                }
            }
            Event::End(event) if event.local_name().as_ref() == b"style" => {
                let style = inline_style.take().ok_or_else(|| {
                    "The EPUB cover page contains an unmatched style element. The file was not modified."
                        .to_string()
                })?;
                validate_cover_stylesheet(&style)?;
            }
            Event::Eof => break,
            _ => {}
        }
    }

    if inline_style.is_some() {
        return Err(
            "The EPUB cover page contains an unterminated style element. The file was not modified."
                .to_string(),
        );
    }
    if image_hrefs.len() != 1 {
        return Err(if image_hrefs.is_empty() {
            "The EPUB cover page does not contain one directly referenced image. The file was not modified."
                .to_string()
        } else {
            "The EPUB cover page contains multiple candidate images. The file was not modified."
                .to_string()
        });
    }

    let image_href = image_hrefs
        .pop()
        .expect("one cover page image was validated");
    if is_non_local_reference(&image_href) {
        return Err(
            "The EPUB cover page image uses an external, embedded, or unsafe reference. The file was not modified."
                .to_string(),
        );
    }

    stylesheet_hrefs.sort();
    stylesheet_hrefs.dedup();
    Ok(CoverPageDependencies {
        image_href,
        stylesheet_hrefs,
    })
}

fn validated_css_text(stylesheet_bytes: &[u8]) -> Result<String, String> {
    let stylesheet = std::str::from_utf8(stylesheet_bytes).map_err(|error| {
        format!(
            "The EPUB cover stylesheet is not valid UTF-8 and cannot be analyzed safely. The file was not modified. {error}"
        )
    })?;
    let mut output = String::with_capacity(stylesheet.len());
    let mut characters = stylesheet.chars().peekable();
    let mut quote = None;
    let mut escaped = false;
    let mut brace_depth = 0_i32;
    let mut parenthesis_depth = 0_i32;

    while characters.peek().is_some() {
        let character = characters
            .next()
            .expect("peeked stylesheet character should remain available");
        if let Some(quote_character) = quote {
            output.push(character);
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == quote_character {
                quote = None;
            }
            continue;
        }

        if character == '/' && characters.peek() == Some(&'*') {
            let _ = characters.next();
            let mut closed = false;
            while characters.peek().is_some() {
                let comment_character = characters
                    .next()
                    .expect("peeked comment character should remain available");
                if comment_character == '*' && characters.peek() == Some(&'/') {
                    let _ = characters.next();
                    closed = true;
                    break;
                }
            }
            if !closed {
                return Err(
                    "The EPUB cover stylesheet contains an unterminated comment. The file was not modified."
                        .to_string(),
                );
            }
            output.push(' ');
            continue;
        }

        match character {
            '\'' | '"' => {
                quote = Some(character);
                output.push(character);
            }
            '{' => {
                brace_depth += 1;
                output.push(character);
            }
            '}' => {
                brace_depth -= 1;
                if brace_depth < 0 {
                    return Err(
                        "The EPUB cover stylesheet is malformed and cannot be analyzed safely. The file was not modified."
                            .to_string(),
                    );
                }
                output.push(character);
            }
            '(' => {
                parenthesis_depth += 1;
                output.push(character);
            }
            ')' => {
                parenthesis_depth -= 1;
                if parenthesis_depth < 0 {
                    return Err(
                        "The EPUB cover stylesheet is malformed and cannot be analyzed safely. The file was not modified."
                            .to_string(),
                    );
                }
                output.push(character);
            }
            '\\' => {
                return Err(
                    "The EPUB cover stylesheet uses escaped syntax that cannot be analyzed safely. The file was not modified."
                        .to_string(),
                );
            }
            _ => output.push(character),
        }
    }

    if quote.is_some() || brace_depth != 0 || parenthesis_depth != 0 {
        return Err(
            "The EPUB cover stylesheet is malformed and cannot be analyzed safely. The file was not modified."
                .to_string(),
        );
    }
    Ok(output)
}

fn css_code_without_strings(stylesheet: &str) -> String {
    let mut output = String::with_capacity(stylesheet.len());
    let mut quote = None;
    let mut escaped = false;

    for character in stylesheet.chars() {
        if let Some(quote_character) = quote {
            output.push(' ');
            if escaped {
                escaped = false;
            } else if character == '\\' {
                escaped = true;
            } else if character == quote_character {
                quote = None;
            }
            continue;
        }

        match character {
            '\'' | '"' => {
                quote = Some(character);
                output.push(' ');
            }
            _ => output.push(character),
        }
    }
    output
}

fn validate_cover_stylesheet(stylesheet_bytes: &[u8]) -> Result<(), String> {
    let stylesheet = validated_css_text(stylesheet_bytes)?;
    let code = css_code_without_strings(&stylesheet).to_ascii_lowercase();

    if code.contains("@import") {
        return Err(
            "The EPUB cover stylesheet imports another stylesheet, so its dependencies cannot be resolved safely. The file was not modified."
                .to_string(),
        );
    }

    for function_name in [
        &b"url"[..],
        &b"image-set"[..],
        &b"cross-fade"[..],
        &b"element"[..],
        &b"image"[..],
    ] {
        if contains_css_function(&code, function_name) {
            return Err(
                "The EPUB cover stylesheet uses an image resource dependency that Archeion cannot resolve safely. The file was not modified."
                    .to_string(),
            );
        }
    }

    Ok(())
}

fn archive_entry_count(archive_name_counts: &HashMap<&str, usize>, path: &str) -> usize {
    archive_name_counts.get(path).copied().unwrap_or_default()
}

fn require_unique_archive_entry(
    archive_name_counts: &HashMap<&str, usize>,
    path: &str,
    resource_label: &str,
) -> Result<(), String> {
    match archive_entry_count(archive_name_counts, path) {
        1 => Ok(()),
        0 => Err(format!(
            "The EPUB {resource_label} \"{path}\" is missing. The file was not modified."
        )),
        _ => Err(format!(
            "The EPUB {resource_label} \"{path}\" appears more than once in the archive. The file was not modified."
        )),
    }
}

fn resolve_local_document_path(
    base_path: &str,
    href: &str,
    resource_label: &str,
) -> Result<String, String> {
    let href = href.trim();
    if is_non_local_reference(href) {
        return Err(format!(
            "The EPUB {resource_label} uses an external, embedded, or unsafe reference. The file was not modified."
        ));
    }
    let document_href = href.split('#').next().unwrap_or_default();
    if document_href.is_empty() || document_href.contains('?') {
        return Err(format!(
            "The EPUB {resource_label} uses an unsupported reference. The file was not modified."
        ));
    }
    let decoded_href = epub_metadata::decode_archive_href(document_href);
    epub_metadata::resolve_zip_relative_path(base_path, &decoded_href).map_err(|error| {
        format!(
            "The EPUB {resource_label} is outside the package or could not be resolved safely. The file was not modified. {error}"
        )
    })
}

fn validate_cover_page_stylesheets<R>(
    package_path: &str,
    manifest: &PackageManifest,
    cover_page_zip_path: &str,
    stylesheet_hrefs: &[String],
    archive_name_counts: &HashMap<&str, usize>,
    read_archive_entry: &mut R,
) -> Result<(), String>
where
    R: FnMut(&str, u64) -> Result<Vec<u8>, String>,
{
    let mut resolved_stylesheets = HashSet::new();
    for href in stylesheet_hrefs {
        let stylesheet_zip_path =
            resolve_local_document_path(cover_page_zip_path, href, "cover page stylesheet")?;
        if !resolved_stylesheets.insert(stylesheet_zip_path.clone()) {
            continue;
        }
        require_unique_archive_entry(
            archive_name_counts,
            &stylesheet_zip_path,
            "cover stylesheet resource",
        )?;
        let stylesheet_item =
            manifest_item_for_zip_path(&manifest.items, package_path, &stylesheet_zip_path)?;
        if !stylesheet_item
            .media_type
            .trim()
            .eq_ignore_ascii_case("text/css")
        {
            return Err(
                "The EPUB cover page stylesheet is not declared as text/css. The file was not modified."
                    .to_string(),
            );
        }
        let stylesheet_bytes =
            read_archive_entry(&stylesheet_zip_path, MAX_COVER_STYLESHEET_BYTES)?;
        validate_cover_stylesheet(&stylesheet_bytes)?;
    }
    Ok(())
}

fn resolve_cover_page_relationship<R>(
    package_path: &str,
    manifest: &PackageManifest,
    cover_page_zip_path: &str,
    archive_name_counts: &HashMap<&str, usize>,
    read_archive_entry: &mut R,
) -> Result<CoverPageRelationship, String>
where
    R: FnMut(&str, u64) -> Result<Vec<u8>, String>,
{
    let cover_page_item =
        manifest_item_for_zip_path(&manifest.items, package_path, cover_page_zip_path)?;
    if !cover_page_item
        .media_type
        .trim()
        .eq_ignore_ascii_case("application/xhtml+xml")
    {
        return Err(
            "The EPUB cover-page relationship does not reference a supported XHTML document. The file was not modified."
                .to_string(),
        );
    }
    if manifest_item_has_property(cover_page_item, "scripted") {
        return Err(
            "The EPUB cover page is marked as scripted and cannot be resolved safely. The file was not modified."
                .to_string(),
        );
    }
    if manifest_item_has_property(cover_page_item, "remote-resources") {
        return Err(
            "The EPUB cover page is marked with the remote-resources property and cannot be resolved safely. The file was not modified."
                .to_string(),
        );
    }
    require_unique_archive_entry(
        archive_name_counts,
        cover_page_zip_path,
        "cover page resource",
    )?;

    let cover_page_bytes = read_archive_entry(cover_page_zip_path, MAX_COVER_PAGE_BYTES)?;
    let dependencies = cover_page_dependencies(&cover_page_bytes)?;
    validate_cover_page_stylesheets(
        package_path,
        manifest,
        cover_page_zip_path,
        &dependencies.stylesheet_hrefs,
        archive_name_counts,
        read_archive_entry,
    )?;

    let image_zip_path = resolve_local_document_path(
        cover_page_zip_path,
        &dependencies.image_href,
        "cover page image",
    )?;
    require_unique_archive_entry(
        archive_name_counts,
        &image_zip_path,
        "cover page image resource",
    )?;
    let image_item = manifest_item_for_zip_path(&manifest.items, package_path, &image_zip_path)?;
    CoverImageFormat::from_media_type(&image_item.media_type).ok_or_else(|| {
        format!(
            "The EPUB cover page image uses unsupported media type \"{}\". The file was not modified.",
            if image_item.media_type.is_empty() {
                "missing"
            } else {
                image_item.media_type.as_str()
            }
        )
    })?;

    Ok(CoverPageRelationship {
        page_item_id: cover_page_item.id.clone(),
        image_item_id: image_item.id.clone(),
    })
}

fn resolve_guide_cover_relationship<R>(
    package_path: &str,
    manifest: &PackageManifest,
    archive_name_counts: &HashMap<&str, usize>,
    read_archive_entry: &mut R,
) -> Result<Option<CoverPageRelationship>, String>
where
    R: FnMut(&str, u64) -> Result<Vec<u8>, String>,
{
    let mut guide_hrefs = manifest
        .guide_cover_hrefs
        .iter()
        .map(|href| href.trim().to_string())
        .collect::<Vec<_>>();
    guide_hrefs.sort();
    guide_hrefs.dedup();
    if guide_hrefs.is_empty() {
        return Ok(None);
    }
    if guide_hrefs.len() != 1 {
        return Err(
            "The EPUB declares multiple cover guide references. The file was not modified."
                .to_string(),
        );
    }

    let cover_page_zip_path =
        resolve_local_document_path(package_path, &guide_hrefs[0], "cover guide")?;
    resolve_cover_page_relationship(
        package_path,
        manifest,
        &cover_page_zip_path,
        archive_name_counts,
        read_archive_entry,
    )
    .map(Some)
}

fn navigation_cover_page_href(navigation_xml: &[u8]) -> Result<Option<String>, String> {
    let mut reader = Reader::from_reader(navigation_xml);
    let mut namespace_stack = Vec::<HashMap<String, String>>::new();
    let mut landmarks_depth = None;
    let mut landmarks_count = 0_usize;
    let mut cover_hrefs = Vec::new();

    loop {
        match reader.read_event().map_err(|error| {
            format!(
                "The EPUB navigation document is malformed and could not be analyzed safely. The file was not modified. {error}"
            )
        })? {
            Event::Start(event) => {
                let attributes = strict_attributes_map(&reader, &event, "navigation document")?;
                reject_unsafe_document_attributes(&attributes, "navigation document", false)?;
                if event.local_name().as_ref().eq_ignore_ascii_case(b"base") {
                    return Err(
                        "The EPUB navigation document contains a base element, so document-relative resources cannot be resolved safely. The file was not modified."
                            .to_string(),
                    );
                }
                let mut namespace_bindings = namespace_stack.last().cloned().unwrap_or_default();
                apply_namespace_declarations(&attributes, &mut namespace_bindings)?;
                namespace_stack.push(namespace_bindings);
                let depth = namespace_stack.len();
                let namespace_bindings = namespace_stack
                    .last()
                    .expect("the current navigation element namespace scope should exist");

                if event.local_name().as_ref() == b"nav"
                    && epub_type_contains(&attributes, namespace_bindings, "landmarks")?
                {
                    landmarks_count += 1;
                    if landmarks_count > 1 {
                        return Err(
                            "The EPUB navigation document contains multiple landmarks navigation elements. The file was not modified."
                                .to_string(),
                        );
                    }
                    landmarks_depth = Some(depth);
                } else if event.local_name().as_ref() == b"a"
                    && landmarks_depth.is_some_and(|landmarks| depth > landmarks)
                    && epub_type_contains(&attributes, namespace_bindings, "cover")?
                {
                    let href =
                        unique_local_attribute(&attributes, "href", "cover landmark")?.ok_or_else(
                            || {
                                "The EPUB cover landmark is missing its href. The file was not modified."
                                    .to_string()
                            },
                        )?;
                    cover_hrefs.push(href);
                }
            }
            Event::Empty(event) => {
                let attributes = strict_attributes_map(&reader, &event, "navigation document")?;
                reject_unsafe_document_attributes(&attributes, "navigation document", false)?;
                if event.local_name().as_ref().eq_ignore_ascii_case(b"base") {
                    return Err(
                        "The EPUB navigation document contains a base element, so document-relative resources cannot be resolved safely. The file was not modified."
                            .to_string(),
                    );
                }
                let mut namespace_bindings = namespace_stack.last().cloned().unwrap_or_default();
                apply_namespace_declarations(&attributes, &mut namespace_bindings)?;

                if event.local_name().as_ref() == b"nav"
                    && epub_type_contains(&attributes, &namespace_bindings, "landmarks")?
                {
                    landmarks_count += 1;
                    if landmarks_count > 1 {
                        return Err(
                            "The EPUB navigation document contains multiple landmarks navigation elements. The file was not modified."
                                .to_string(),
                        );
                    }
                } else if event.local_name().as_ref() == b"a"
                    && landmarks_depth.is_some()
                    && epub_type_contains(&attributes, &namespace_bindings, "cover")?
                {
                    let href =
                        unique_local_attribute(&attributes, "href", "cover landmark")?.ok_or_else(
                            || {
                                "The EPUB cover landmark is missing its href. The file was not modified."
                                    .to_string()
                            },
                        )?;
                    cover_hrefs.push(href);
                }
            }
            Event::End(event) => {
                let depth = namespace_stack.len();
                if event.local_name().as_ref() == b"nav" && landmarks_depth == Some(depth) {
                    landmarks_depth = None;
                }
                if namespace_stack.pop().is_none() {
                    return Err(
                        "The EPUB navigation document contains an unmatched closing element. The file was not modified."
                            .to_string(),
                    );
                }
            }
            Event::Eof => break,
            _ => {}
        }
    }

    if !namespace_stack.is_empty() {
        return Err(
            "The EPUB navigation document contains an unterminated element. The file was not modified."
                .to_string(),
        );
    }
    if landmarks_count == 0 || cover_hrefs.is_empty() {
        return Ok(None);
    }
    if cover_hrefs.len() != 1 {
        return Err(
            "The EPUB navigation document contains multiple cover landmarks. The file was not modified."
                .to_string(),
        );
    }
    Ok(cover_hrefs.pop())
}

fn resolve_landmarks_cover_relationship<R>(
    package_path: &str,
    manifest: &PackageManifest,
    archive_name_counts: &HashMap<&str, usize>,
    read_archive_entry: &mut R,
) -> Result<Option<CoverPageRelationship>, String>
where
    R: FnMut(&str, u64) -> Result<Vec<u8>, String>,
{
    if !manifest.version.is_epub_three() {
        return Ok(None);
    }

    let navigation_items = manifest
        .items
        .iter()
        .filter(|item| manifest_item_has_property(item, "nav"))
        .collect::<Vec<_>>();
    let navigation_item = match navigation_items.as_slice() {
        [] => return Ok(None),
        [item] => *item,
        _ => {
            return Err(
                "The EPUB package declares multiple navigation documents, so cover landmarks cannot be resolved safely. The file was not modified."
                    .to_string(),
            )
        }
    };
    if !navigation_item
        .media_type
        .trim()
        .eq_ignore_ascii_case("application/xhtml+xml")
    {
        return Err(
            "The EPUB navigation document is not declared as application/xhtml+xml. The file was not modified."
                .to_string(),
        );
    }
    if manifest_item_has_property(navigation_item, "scripted") {
        return Err(
            "The EPUB navigation document is marked as scripted and cannot be resolved safely. The file was not modified."
                .to_string(),
        );
    }

    let navigation_zip_path =
        resolve_local_document_path(package_path, &navigation_item.href, "navigation document")?;
    let manifest_navigation_item =
        manifest_item_for_zip_path(&manifest.items, package_path, &navigation_zip_path)?;
    if manifest_navigation_item.id != navigation_item.id {
        return Err(
            "The EPUB navigation document identity is ambiguous. The file was not modified."
                .to_string(),
        );
    }
    require_unique_archive_entry(
        archive_name_counts,
        &navigation_zip_path,
        "navigation document resource",
    )?;
    let navigation_bytes = read_archive_entry(&navigation_zip_path, MAX_NAVIGATION_DOCUMENT_BYTES)?;
    let cover_href = match navigation_cover_page_href(&navigation_bytes)? {
        Some(href) => href,
        None => return Ok(None),
    };
    let cover_page_zip_path =
        resolve_local_document_path(&navigation_zip_path, &cover_href, "cover landmark")?;
    resolve_cover_page_relationship(
        package_path,
        manifest,
        &cover_page_zip_path,
        archive_name_counts,
        read_archive_entry,
    )
    .map(Some)
}

fn reconcile_cover_page_relationships(
    guide: Option<CoverPageRelationship>,
    landmarks: Option<CoverPageRelationship>,
) -> Result<Option<CoverPageRelationship>, String> {
    match (guide, landmarks) {
        (Some(guide), Some(landmarks)) => {
            if guide.page_item_id != landmarks.page_item_id {
                return Err(
                    "The EPUB guide and landmarks navigation identify different cover pages. The file was not modified."
                        .to_string(),
                );
            }
            if guide.image_item_id != landmarks.image_item_id {
                return Err(
                    "The EPUB guide and landmarks cover pages identify different image resources. The file was not modified."
                        .to_string(),
                );
            }
            Ok(Some(guide))
        }
        (Some(guide), None) => Ok(Some(guide)),
        (None, Some(landmarks)) => Ok(Some(landmarks)),
        (None, None) => Ok(None),
    }
}

fn plan_cover_package<R>(
    package_path: &str,
    package_xml: &str,
    archive_names: &[String],
    source_format: CoverImageFormat,
    mut read_archive_entry: R,
) -> Result<CoverPackagePlan, String>
where
    R: FnMut(&str, u64) -> Result<Vec<u8>, String>,
{
    let manifest = package_manifest(package_xml)?;
    unique_manifest_id(&manifest.items)?;
    let item_by_id = manifest
        .items
        .iter()
        .map(|item| (item.id.as_str(), item))
        .collect::<HashMap<_, _>>();
    let property_ids = manifest
        .items
        .iter()
        .filter(|item| manifest_item_has_property(item, "cover-image"))
        .map(|item| item.id.clone())
        .collect::<Vec<_>>();
    let mut active_ids = manifest.cover_meta_ids.clone();
    active_ids.extend(property_ids.iter().cloned());
    active_ids.sort();
    active_ids.dedup();

    for id in &manifest.cover_meta_ids {
        if !item_by_id.contains_key(id.as_str()) {
            return Err(format!(
                "EPUB cover metadata references missing manifest item \"{id}\". The file was not modified."
            ));
        }
    }
    if active_ids.len() > 1 {
        return Err(
            "The EPUB declares multiple active cover resources. Resolve the package references before replacing the cover."
                .to_string(),
        );
    }

    let archive_name_counts = archive_names
        .iter()
        .fold(HashMap::new(), |mut counts, name| {
            *counts.entry(name.as_str()).or_insert(0_usize) += 1;
            counts
        });
    let guide_relationship = resolve_guide_cover_relationship(
        package_path,
        &manifest,
        &archive_name_counts,
        &mut read_archive_entry,
    )?;
    let landmarks_relationship = resolve_landmarks_cover_relationship(
        package_path,
        &manifest,
        &archive_name_counts,
        &mut read_archive_entry,
    )?;
    let cover_page_relationship =
        reconcile_cover_page_relationships(guide_relationship, landmarks_relationship)?;
    if active_ids
        .first()
        .zip(cover_page_relationship.as_ref())
        .is_some_and(|(active_id, relationship)| active_id != &relationship.image_item_id)
    {
        return Err(
            "The EPUB cover declaration and visible cover page point to different image resources. The file was not modified."
                .to_string(),
        );
    }
    let selected_cover_id = active_ids
        .first()
        .cloned()
        .or_else(|| cover_page_relationship.map(|relationship| relationship.image_item_id));

    if let Some(active_id) = selected_cover_id {
        let item = item_by_id
            .get(active_id.as_str())
            .ok_or_else(|| "The EPUB cover manifest item is unavailable.".to_string())?;
        let existing_format = CoverImageFormat::from_media_type(&item.media_type).ok_or_else(|| {
            let media_type = if item.media_type.is_empty() {
                "a missing media type"
            } else {
                item.media_type.as_str()
            };
            format!(
                "The active EPUB cover uses unsupported media type \"{media_type}\". The file was not modified."
            )
        })?;
        if !href_extension_matches_format(&item.href, existing_format) {
            return Err(
                "The active EPUB cover href extension does not match its declared media type. The file was not modified."
                    .to_string(),
            );
        }
        let output_format =
            output_format_for_package(manifest.version, source_format, Some(existing_format))?;
        let decoded_href = epub_metadata::decode_archive_href(&item.href);
        if is_non_local_reference(&decoded_href) {
            return Err(
                "The active EPUB cover uses an external or unsafe href. The file was not modified."
                    .to_string(),
            );
        }
        let cover_zip_path = epub_metadata::resolve_zip_relative_path(package_path, &decoded_href)?;
        require_unique_archive_entry(&archive_name_counts, &cover_zip_path, "cover resource")?;
        return Ok(CoverPackagePlan {
            package_version: manifest.version,
            cover_item_id: item.id.clone(),
            cover_href: item.href.clone(),
            cover_zip_path,
            output_format,
            existing_cover: true,
            existing_media_type: Some(existing_format.media_type().to_string()),
            had_cover_meta: !manifest.cover_meta_ids.is_empty(),
            had_cover_property: !property_ids.is_empty(),
        });
    }

    let output_format = output_format_for_package(manifest.version, source_format, None)?;
    let used_ids = manifest
        .items
        .iter()
        .map(|item| item.id.clone())
        .collect::<HashSet<_>>();
    let used_hrefs = manifest
        .items
        .iter()
        .map(|item| item.href.clone())
        .collect::<HashSet<_>>();
    let cover_item_id = unique_value(PACKAGE_COVER_ID_BASE, &used_ids);
    let cover_href = unique_cover_href(output_format.extension(), &used_hrefs);
    let cover_zip_path = epub_metadata::resolve_zip_relative_path(package_path, &cover_href)?;
    if archive_name_counts.contains_key(cover_zip_path.as_str()) {
        return Err(
            "The generated EPUB cover path conflicts with an existing archive entry.".to_string(),
        );
    }

    Ok(CoverPackagePlan {
        package_version: manifest.version,
        cover_item_id,
        cover_href,
        cover_zip_path,
        output_format,
        existing_cover: false,
        existing_media_type: None,
        had_cover_meta: false,
        had_cover_property: false,
    })
}

fn child_element_name(parent_name: &[u8], local_name: &str) -> String {
    let parent_name = String::from_utf8_lossy(parent_name);
    parent_name
        .split_once(':')
        .map(|(prefix, _)| format!("{prefix}:{local_name}"))
        .unwrap_or_else(|| local_name.to_string())
}

fn is_cover_meta(reader: &Reader<&[u8]>, event: &BytesStart<'_>) -> bool {
    let attributes = attributes_map(reader, event);
    local_attribute(&attributes, "name")
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("cover"))
}

fn rewritten_item_event(
    reader: &Reader<&[u8]>,
    event: &BytesStart<'_>,
    plan: &CoverPackagePlan,
    output_format: CoverImageFormat,
) -> Result<BytesStart<'static>, String> {
    let attributes = ordered_attributes(reader, event);
    let item_id = attributes
        .iter()
        .find_map(|(key, value)| {
            key.rsplit(':')
                .next()
                .is_some_and(|local| local == "id")
                .then_some(value.as_str())
        })
        .unwrap_or_default();
    let event_name = String::from_utf8_lossy(event.name().as_ref()).into_owned();
    let mut rewritten = BytesStart::new(event_name);
    let selected = item_id == plan.cover_item_id;
    let mark_cover = plan.package_version.is_epub_three() || plan.had_cover_property;
    let mut media_type_written = false;
    let mut properties_written = false;

    for (key, value) in &attributes {
        let local = key.rsplit(':').next().unwrap_or(key.as_str());
        if selected && local == "media-type" {
            rewritten.push_attribute((key.as_str(), output_format.media_type()));
            media_type_written = true;
            continue;
        }
        if local == "properties" {
            let mut properties = value
                .split_whitespace()
                .filter(|property| !property.eq_ignore_ascii_case("cover-image"))
                .map(str::to_string)
                .collect::<Vec<_>>();
            if selected && mark_cover {
                properties.push("cover-image".to_string());
            }
            if !properties.is_empty() {
                let properties = properties.join(" ");
                rewritten.push_attribute((key.as_str(), properties.as_str()));
            }
            properties_written = true;
            continue;
        }
        rewritten.push_attribute((key.as_str(), value.as_str()));
    }

    if selected && !media_type_written {
        rewritten.push_attribute(("media-type", output_format.media_type()));
    }
    if selected && mark_cover && !properties_written {
        rewritten.push_attribute(("properties", "cover-image"));
    }
    Ok(rewritten.into_owned())
}

fn write_cover_meta(
    writer: &mut Writer<Vec<u8>>,
    element_name: &str,
    cover_item_id: &str,
) -> Result<(), String> {
    let mut meta = BytesStart::new(element_name);
    meta.push_attribute(("name", "cover"));
    meta.push_attribute(("content", cover_item_id));
    writer
        .write_event(Event::Empty(meta))
        .map_err(|error| error.to_string())
}

fn write_new_cover_item(
    writer: &mut Writer<Vec<u8>>,
    element_name: &str,
    plan: &CoverPackagePlan,
    output_format: CoverImageFormat,
) -> Result<(), String> {
    let mut item = BytesStart::new(element_name);
    item.push_attribute(("id", plan.cover_item_id.as_str()));
    item.push_attribute(("href", plan.cover_href.as_str()));
    item.push_attribute(("media-type", output_format.media_type()));
    if plan.package_version.is_epub_three() {
        item.push_attribute(("properties", "cover-image"));
    }
    writer
        .write_event(Event::Empty(item))
        .map_err(|error| error.to_string())
}

fn update_package_cover_xml(
    package_xml: &str,
    plan: &CoverPackagePlan,
    output_format: CoverImageFormat,
) -> Result<String, String> {
    let mut reader = Reader::from_str(package_xml);
    let mut writer = Writer::new(Vec::new());
    let mut in_metadata = false;
    let mut in_manifest = false;
    let mut metadata_found = false;
    let mut manifest_found = false;
    let mut selected_item_found = false;
    let mut skip_cover_meta_depth = 0_usize;
    let write_epub2_meta = plan.package_version.is_epub_two() || plan.had_cover_meta;
    let mut cover_meta_element_name = "meta".to_string();
    let mut cover_item_element_name = "item".to_string();

    loop {
        let event = reader.read_event().map_err(|error| error.to_string())?;
        if skip_cover_meta_depth > 0 {
            match event {
                Event::Start(_) => skip_cover_meta_depth += 1,
                Event::End(_) => skip_cover_meta_depth -= 1,
                Event::Eof => break,
                _ => {}
            }
            continue;
        }
        match event {
            Event::Start(event) => match event.local_name().as_ref() {
                b"metadata" => {
                    in_metadata = true;
                    metadata_found = true;
                    cover_meta_element_name = child_element_name(event.name().as_ref(), "meta");
                    writer
                        .write_event(Event::Start(event.into_owned()))
                        .map_err(|error| error.to_string())?;
                }
                b"manifest" => {
                    in_manifest = true;
                    manifest_found = true;
                    cover_item_element_name = child_element_name(event.name().as_ref(), "item");
                    writer
                        .write_event(Event::Start(event.into_owned()))
                        .map_err(|error| error.to_string())?;
                }
                b"meta" if in_metadata && is_cover_meta(&reader, &event) => {
                    skip_cover_meta_depth = 1;
                }
                b"item" if in_manifest => {
                    let attributes = attributes_map(&reader, &event);
                    let selected = local_attribute(&attributes, "id")
                        .is_some_and(|id| id == &plan.cover_item_id);
                    if selected {
                        selected_item_found = true;
                        let rewritten = rewritten_item_event(&reader, &event, plan, output_format)?;
                        writer
                            .write_event(Event::Start(rewritten))
                            .map_err(|error| error.to_string())?;
                    } else {
                        writer
                            .write_event(Event::Start(event.into_owned()))
                            .map_err(|error| error.to_string())?;
                    }
                }
                _ => writer
                    .write_event(Event::Start(event.into_owned()))
                    .map_err(|error| error.to_string())?,
            },
            Event::Empty(event) => match event.local_name().as_ref() {
                b"metadata" => {
                    metadata_found = true;
                    if write_epub2_meta {
                        let element_name =
                            String::from_utf8_lossy(event.name().as_ref()).into_owned();
                        let meta_element_name = child_element_name(event.name().as_ref(), "meta");
                        writer
                            .write_event(Event::Start(event.into_owned()))
                            .map_err(|error| error.to_string())?;
                        write_cover_meta(&mut writer, &meta_element_name, &plan.cover_item_id)?;
                        writer
                            .write_event(Event::End(BytesEnd::new(element_name)))
                            .map_err(|error| error.to_string())?;
                    } else {
                        writer
                            .write_event(Event::Empty(event.into_owned()))
                            .map_err(|error| error.to_string())?;
                    }
                }
                b"manifest" => {
                    manifest_found = true;
                    if !plan.existing_cover {
                        let element_name =
                            String::from_utf8_lossy(event.name().as_ref()).into_owned();
                        let item_element_name = child_element_name(event.name().as_ref(), "item");
                        writer
                            .write_event(Event::Start(event.into_owned()))
                            .map_err(|error| error.to_string())?;
                        write_new_cover_item(&mut writer, &item_element_name, plan, output_format)?;
                        writer
                            .write_event(Event::End(BytesEnd::new(element_name)))
                            .map_err(|error| error.to_string())?;
                        selected_item_found = true;
                    } else {
                        writer
                            .write_event(Event::Empty(event.into_owned()))
                            .map_err(|error| error.to_string())?;
                    }
                }
                b"meta" if in_metadata && is_cover_meta(&reader, &event) => {}
                b"item" if in_manifest => {
                    let attributes = attributes_map(&reader, &event);
                    let selected = local_attribute(&attributes, "id")
                        .is_some_and(|id| id == &plan.cover_item_id);
                    if selected {
                        selected_item_found = true;
                        let rewritten = rewritten_item_event(&reader, &event, plan, output_format)?;
                        writer
                            .write_event(Event::Empty(rewritten))
                            .map_err(|error| error.to_string())?;
                    } else {
                        writer
                            .write_event(Event::Empty(event.into_owned()))
                            .map_err(|error| error.to_string())?;
                    }
                }
                _ => writer
                    .write_event(Event::Empty(event.into_owned()))
                    .map_err(|error| error.to_string())?,
            },
            Event::End(event) if event.local_name().as_ref() == b"metadata" => {
                if write_epub2_meta {
                    write_cover_meta(&mut writer, &cover_meta_element_name, &plan.cover_item_id)?;
                }
                writer
                    .write_event(Event::End(event.into_owned()))
                    .map_err(|error| error.to_string())?;
                in_metadata = false;
            }
            Event::End(event) if event.local_name().as_ref() == b"manifest" => {
                if !plan.existing_cover {
                    write_new_cover_item(
                        &mut writer,
                        &cover_item_element_name,
                        plan,
                        output_format,
                    )?;
                    selected_item_found = true;
                }
                writer
                    .write_event(Event::End(event.into_owned()))
                    .map_err(|error| error.to_string())?;
                in_manifest = false;
            }
            Event::Eof => break,
            event => writer
                .write_event(event.into_owned())
                .map_err(|error| error.to_string())?,
        }
    }

    if !metadata_found {
        return Err("EPUB package metadata section was not found.".to_string());
    }
    if !manifest_found {
        return Err("EPUB package manifest section was not found.".to_string());
    }
    if !selected_item_found {
        return Err("EPUB cover manifest item could not be updated.".to_string());
    }
    String::from_utf8(writer.into_inner()).map_err(|error| error.to_string())
}

fn temporary_epub_path(epub_path: &Path) -> Result<PathBuf, String> {
    let file_name = epub_path
        .file_name()
        .ok_or_else(|| "The EPUB file is unavailable.".to_string())?
        .to_string_lossy();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    Ok(epub_path.with_file_name(format!("{file_name}.cover-writeback-{nonce}.tmp")))
}

fn rewrite_epub_cover(
    epub_path: &Path,
    package_path: &str,
    package_xml: &str,
    plan: &CoverPackagePlan,
    cover_bytes: &[u8],
) -> Result<PathBuf, String> {
    let temporary_path = temporary_epub_path(epub_path)?;
    let write_result = (|| -> Result<PathBuf, String> {
        let source = File::open(epub_path).map_err(|error| error.to_string())?;
        let mut archive = ZipArchive::new(source).map_err(|error| error.to_string())?;
        let temporary = File::create(&temporary_path).map_err(|error| error.to_string())?;
        let mut writer = ZipWriter::new(temporary);
        let mut package_entry_count = 0_usize;
        let mut cover_entry_count = 0_usize;

        for index in 0..archive.len() {
            let (name, compression) = {
                let entry = archive.by_index(index).map_err(|error| error.to_string())?;
                (entry.name().to_string(), entry.compression())
            };
            let options = SimpleFileOptions::default().compression_method(compression);
            if name == package_path {
                package_entry_count += 1;
                writer
                    .start_file(name, options)
                    .map_err(|error| error.to_string())?;
                writer
                    .write_all(package_xml.as_bytes())
                    .map_err(|error| error.to_string())?;
                continue;
            }
            if name == plan.cover_zip_path {
                cover_entry_count += 1;
                writer
                    .start_file(name, options)
                    .map_err(|error| error.to_string())?;
                writer
                    .write_all(cover_bytes)
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
        if plan.existing_cover && cover_entry_count != 1 {
            return Err(format!(
                "EPUB cover resource entry was expected once but found {cover_entry_count} times."
            ));
        }
        if !plan.existing_cover {
            if cover_entry_count != 0 {
                return Err("The generated EPUB cover path already exists.".to_string());
            }
            writer
                .start_file(
                    plan.cover_zip_path.as_str(),
                    SimpleFileOptions::default()
                        .compression_method(zip::CompressionMethod::Deflated),
                )
                .map_err(|error| error.to_string())?;
            writer
                .write_all(cover_bytes)
                .map_err(|error| error.to_string())?;
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

fn archive_names(archive: &mut ZipArchive<File>) -> Result<Vec<String>, String> {
    let mut names = Vec::with_capacity(archive.len());
    for index in 0..archive.len() {
        names.push(
            archive
                .by_index(index)
                .map_err(|error| error.to_string())?
                .name()
                .to_string(),
        );
    }
    Ok(names)
}

fn read_archive_entry_limited(
    archive: &mut ZipArchive<File>,
    path: &str,
    max_bytes: u64,
) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    archive
        .by_name(path)
        .map_err(|error| error.to_string())?
        .take(max_bytes + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > max_bytes {
        return Err(format!(
            "The EPUB resource \"{path}\" is too large to analyze safely. The file was not modified."
        ));
    }
    Ok(bytes)
}

fn read_package_and_plan(
    epub_path: &Path,
    source_format: CoverImageFormat,
) -> Result<(epub_metadata::EpubPackageDocument, CoverPackagePlan), String> {
    let file = File::open(epub_path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let package = epub_metadata::read_package_document(&mut archive)?;
    let names = archive_names(&mut archive)?;
    let plan = plan_cover_package(
        &package.path,
        &package.xml,
        &names,
        source_format,
        |path, max_bytes| read_archive_entry_limited(&mut archive, path, max_bytes),
    )?;
    Ok((package, plan))
}

fn validate_rewritten_cover(
    epub_path: &Path,
) -> Result<epub_metadata::EpubPackageMetadata, String> {
    let file = File::open(epub_path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;
    let package = epub_metadata::read_package_document(&mut archive)?;
    let names = archive_names(&mut archive)?;
    let plan = plan_cover_package(
        &package.path,
        &package.xml,
        &names,
        CoverImageFormat::Png,
        |path, max_bytes| read_archive_entry_limited(&mut archive, path, max_bytes),
    )?;
    if !plan.existing_cover {
        return Err("The rewritten EPUB does not declare an active cover resource.".to_string());
    }
    let mut cover_bytes = Vec::new();
    archive
        .by_name(&plan.cover_zip_path)
        .map_err(|error| error.to_string())?
        .take(MAX_SOURCE_FILE_BYTES + 1)
        .read_to_end(&mut cover_bytes)
        .map_err(|error| error.to_string())?;
    if cover_bytes.len() as u64 > MAX_SOURCE_FILE_BYTES {
        return Err("The rewritten EPUB cover resource is too large.".to_string());
    }
    let mut reader = ImageReader::new(Cursor::new(&cover_bytes))
        .with_guessed_format()
        .map_err(|error| error.to_string())?;
    let encoded_format = reader
        .format()
        .and_then(CoverImageFormat::from_image_format)
        .ok_or_else(|| "The rewritten EPUB cover format is unsupported.".to_string())?;
    let declared_format = plan
        .existing_media_type
        .as_deref()
        .and_then(CoverImageFormat::from_media_type)
        .ok_or_else(|| "The rewritten EPUB cover media type is unsupported.".to_string())?;
    if encoded_format != declared_format {
        return Err(
            "The rewritten EPUB cover bytes do not match the declared media type.".to_string(),
        );
    }
    let mut limits = Limits::default();
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let image = reader.decode().map_err(|error| error.to_string())?;
    let (width, height) = image.dimensions();
    if width == 0 || height == 0 || u64::from(width) * 3 != u64::from(height) * 2 {
        return Err("The rewritten EPUB cover has an invalid frame.".to_string());
    }
    epub_metadata::parse_core_metadata(&package.xml)
}

fn prepare_cover_writeback_at(
    root: &Path,
    input: &EpubCoverPreparationInput,
) -> Result<EpubCoverPreparation, String> {
    let normalized_relative_path =
        filesystem::normalize_archive_relative_path(&input.relative_path)?;
    let epub_path = epub::resolve_epub_path(root, &normalized_relative_path)?;
    let epub_fingerprint = file_fingerprint(&epub_path, "The selected EPUB file is unavailable.")?;
    let decoded = decode_cover_image(Path::new(&input.image_path))?;
    let (_, plan) = read_package_and_plan(&epub_path, decoded.format)?;
    let processed = process_cover_image(&decoded, input.framing, plan.output_format)?;
    let (source_width, source_height) = decoded.image.dimensions();
    let (output_width, output_height) = processed.image.dimensions();
    let epub_fingerprint_after_prepare =
        file_fingerprint(&epub_path, "The selected EPUB file is unavailable.")?;
    if epub_fingerprint_after_prepare.size != epub_fingerprint.size
        || epub_fingerprint_after_prepare.modified_at != epub_fingerprint.modified_at
    {
        return Err(
            "The EPUB file changed while the cover preview was being prepared. Review it again."
                .to_string(),
        );
    }

    Ok(EpubCoverPreparation {
        file_name: decoded.file_name,
        source_format: decoded.format.label().to_string(),
        output_format: processed.format.label().to_string(),
        source_width,
        source_height,
        output_width,
        output_height,
        image_size: decoded.fingerprint.size,
        image_modified_at: decoded.fingerprint.modified_at,
        epub_size: epub_fingerprint.size,
        epub_modified_at: epub_fingerprint.modified_at,
        replacing_existing_cover: plan.existing_cover,
        preview_mime_type: "image/png".to_string(),
        preview_bytes: preview_bytes(&processed.image)?,
    })
}

fn write_cover_at(
    root: &Path,
    input: EpubCoverWritebackInput,
) -> Result<EpubCoverWritebackResult, String> {
    validate_book_id(&input.book_id)?;
    let normalized_relative_path =
        filesystem::normalize_archive_relative_path(&input.relative_path)?;
    let epub_path = epub::resolve_epub_path(root, &normalized_relative_path)?;
    let epub_fingerprint = file_fingerprint(&epub_path, "The selected EPUB file is unavailable.")?;
    assert_fingerprint(
        "EPUB file",
        &epub_fingerprint,
        input.expected_epub_size,
        input.expected_epub_modified_at,
    )?;
    let decoded = decode_cover_image(Path::new(&input.image_path))?;
    assert_fingerprint(
        "selected cover image",
        &decoded.fingerprint,
        input.expected_image_size,
        input.expected_image_modified_at,
    )?;

    let (package, plan) = read_package_and_plan(&epub_path, decoded.format)?;
    let processed = process_cover_image(&decoded, input.framing, plan.output_format)?;
    let updated_package_xml = update_package_cover_xml(&package.xml, &plan, plan.output_format)?;
    let temporary_path = rewrite_epub_cover(
        &epub_path,
        &package.path,
        &updated_package_xml,
        &plan,
        &processed.bytes,
    )
    .map_err(|error| {
        format!("EPUB cover write failed before replacing the active file. {error}")
    })?;
    let source_metadata = match validate_rewritten_cover(&temporary_path) {
        Ok(metadata) => metadata,
        Err(error) => {
            let _ = fs::remove_file(&temporary_path);
            return Err(format!(
                "EPUB cover validation failed before replacing the active file. The original EPUB was not modified. {error}"
            ));
        }
    };
    let current_epub_fingerprint =
        file_fingerprint(&epub_path, "The selected EPUB file is unavailable.")?;
    if let Err(error) = assert_fingerprint(
        "EPUB file",
        &current_epub_fingerprint,
        input.expected_epub_size,
        input.expected_epub_modified_at,
    ) {
        let _ = fs::remove_file(&temporary_path);
        return Err(error);
    }

    let writeback = epub_writeback::commit_epub_rewrite_at(
        root,
        &normalized_relative_path,
        &epub_path,
        &temporary_path,
        source_metadata,
        input.keep_successful_backup,
        "cover",
    )?;

    let cover_cache_warning = (|| -> Result<(), String> {
        archive_root::invalidate_cover_cache_entries_at(root, std::slice::from_ref(&input.book_id))?;
        epub::load_epub_cover_at(root, &normalized_relative_path, &input.book_id)?;
        Ok(())
    })()
    .err()
    .map(|error| {
        format!(
            "The cover was written, but its generated preview cache could not be refreshed. Reopen or regenerate the cover. {error}"
        )
    });

    Ok(EpubCoverWritebackResult {
        writeback,
        cover_cache_warning,
    })
}

#[tauri::command]
pub async fn prepare_epub_cover_writeback(
    app: tauri::AppHandle,
    root_path: Option<String>,
    input: EpubCoverPreparationInput,
) -> Result<EpubCoverPreparation, String> {
    let root = archive_root::resolve_archive_root(&app, root_path)?;
    tauri::async_runtime::spawn_blocking(move || prepare_cover_writeback_at(&root, &input))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn write_epub_cover(
    app: tauri::AppHandle,
    root_path: Option<String>,
    input: EpubCoverWritebackInput,
) -> Result<EpubCoverWritebackResult, String> {
    let root = archive_root::resolve_archive_root(&app, root_path)?;
    tauri::async_runtime::spawn_blocking(move || write_cover_at(&root, input))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests;
