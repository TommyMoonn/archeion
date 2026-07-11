use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{Cursor, Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use image::{
    imageops::{crop_imm, overlay, resize, FilterType},
    DynamicImage, GenericImageView, ImageFormat, ImageReader, Limits, Rgba, RgbaImage,
};
use quick_xml::{
    events::{BytesStart, Event},
    Reader, Writer,
};
use serde::{Deserialize, Serialize};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

use super::{archive_root, epub, epub_metadata, epub_writeback, filesystem};

const MAX_SOURCE_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_SOURCE_DIMENSION: u32 = 12_000;
const MAX_SOURCE_PIXELS: u64 = 80_000_000;
const MIN_SOURCE_DIMENSION: u32 = 64;
const MAX_OUTPUT_WIDTH: u32 = 1_200;
const MAX_OUTPUT_HEIGHT: u32 = 1_800;
const PREVIEW_WIDTH: u32 = 360;
const PREVIEW_HEIGHT: u32 = 540;
const MAX_COVER_PAGE_BYTES: u64 = 2 * 1024 * 1024;
const MAX_NAVIGATION_DOCUMENT_BYTES: u64 = 2 * 1024 * 1024;
const MAX_COVER_STYLESHEET_BYTES: u64 = 512 * 1024;
const EPUB_OPS_NAMESPACE: &str = "http://www.idpf.org/2007/ops";
const PACKAGE_COVER_ID_BASE: &str = "archeion-cover-image";
const PACKAGE_COVER_FILE_BASE: &str = "archeion-cover";

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EpubCoverFraming {
    Crop,
    Fit,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubCoverPreparationInput {
    relative_path: String,
    image_path: String,
    framing: EpubCoverFraming,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubCoverPreparation {
    file_name: String,
    source_format: String,
    output_format: String,
    source_width: u32,
    source_height: u32,
    output_width: u32,
    output_height: u32,
    image_size: u64,
    image_modified_at: u64,
    epub_size: u64,
    epub_modified_at: u64,
    replacing_existing_cover: bool,
    preview_mime_type: String,
    preview_bytes: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubCoverWritebackInput {
    relative_path: String,
    book_id: String,
    image_path: String,
    framing: EpubCoverFraming,
    expected_image_size: u64,
    expected_image_modified_at: u64,
    expected_epub_size: u64,
    expected_epub_modified_at: u64,
    #[serde(default)]
    keep_successful_backup: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubCoverWritebackResult {
    #[serde(flatten)]
    writeback: epub_writeback::EpubMetadataWritebackResult,
    cover_cache_warning: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CoverImageFormat {
    Jpeg,
    Png,
    WebP,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct EpubPackageVersion {
    major: u8,
    minor: u8,
}

impl EpubPackageVersion {
    fn parse(value: &str) -> Result<Self, String> {
        let mut parts = value.trim().split('.');
        let major = parts
            .next()
            .filter(|part| !part.is_empty())
            .and_then(|part| part.parse::<u8>().ok());
        let minor = parts
            .next()
            .filter(|part| !part.is_empty())
            .and_then(|part| part.parse::<u8>().ok());

        let (Some(major), Some(minor)) = (major, minor) else {
            return Err(
                "The EPUB package version is malformed. The file was not modified.".to_string(),
            );
        };
        if parts.next().is_some() {
            return Err(
                "The EPUB package version is malformed. The file was not modified.".to_string(),
            );
        }

        match (major, minor) {
            (2, 0) | (3, _) => Ok(Self { major, minor }),
            _ => Err(format!(
                "EPUB package version {}.{} is not supported for cover writeback. The file was not modified.",
                major, minor
            )),
        }
    }

    fn is_epub_two(self) -> bool {
        self.major == 2
    }

    fn is_epub_three(self) -> bool {
        self.major == 3
    }

    fn supports_webp(self) -> bool {
        self.major == 3 && self.minor >= 3
    }
}

impl CoverImageFormat {
    fn from_image_format(format: ImageFormat) -> Option<Self> {
        match format {
            ImageFormat::Jpeg => Some(Self::Jpeg),
            ImageFormat::Png => Some(Self::Png),
            ImageFormat::WebP => Some(Self::WebP),
            _ => None,
        }
    }

    fn from_media_type(media_type: &str) -> Option<Self> {
        match media_type.trim().to_ascii_lowercase().as_str() {
            "image/jpeg" | "image/jpg" => Some(Self::Jpeg),
            "image/png" => Some(Self::Png),
            "image/webp" => Some(Self::WebP),
            _ => None,
        }
    }

    fn media_type(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::WebP => "image/webp",
        }
    }

    fn extension(self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::Png => "png",
            Self::WebP => "webp",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::Jpeg => "JPEG",
            Self::Png => "PNG",
            Self::WebP => "WebP",
        }
    }
}

#[derive(Clone, Debug)]
struct FileFingerprint {
    size: u64,
    modified_at: u64,
}

#[derive(Clone, Debug)]
struct DecodedCoverImage {
    image: DynamicImage,
    format: CoverImageFormat,
    fingerprint: FileFingerprint,
    file_name: String,
}

#[derive(Clone, Debug)]
struct ProcessedCoverImage {
    image: DynamicImage,
    format: CoverImageFormat,
    bytes: Vec<u8>,
}

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

fn modified_at_millis(path: &Path) -> Result<u64, String> {
    let modified = fs::metadata(path)
        .map_err(|error| error.to_string())?
        .modified()
        .map_err(|error| error.to_string())?;
    modified
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .map_err(|error| error.to_string())
}

fn file_fingerprint(path: &Path, unavailable_message: &str) -> Result<FileFingerprint, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err(unavailable_message.to_string());
    }
    Ok(FileFingerprint {
        size: metadata.len(),
        modified_at: modified_at_millis(path)?,
    })
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

fn decode_cover_image(path: &Path) -> Result<DecodedCoverImage, String> {
    let fingerprint = file_fingerprint(path, "The selected cover image is unavailable.")?;
    if fingerprint.size == 0 {
        return Err("The selected cover image is empty.".to_string());
    }
    if fingerprint.size > MAX_SOURCE_FILE_BYTES {
        return Err("The selected cover image exceeds the 32 MB limit.".to_string());
    }

    let bytes = fs::read(path).map_err(|error| error.to_string())?;
    let fingerprint_after_read =
        file_fingerprint(path, "The selected cover image is unavailable.")?;
    if fingerprint_after_read.size != fingerprint.size
        || fingerprint_after_read.modified_at != fingerprint.modified_at
    {
        return Err(
            "The selected cover image changed while it was being read. Choose it again."
                .to_string(),
        );
    }
    let mut reader = ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|error| format!("The selected cover image could not be identified. {error}"))?;
    let image_format = reader
        .format()
        .and_then(CoverImageFormat::from_image_format)
        .ok_or_else(|| "Choose a JPEG, PNG, or WebP image.".to_string())?;
    let mut limits = Limits::default();
    limits.max_alloc = Some(256 * 1024 * 1024);
    reader.limits(limits);
    let image = reader
        .decode()
        .map_err(|error| format!("The selected cover image could not be decoded. {error}"))?;
    let (width, height) = image.dimensions();
    if width < MIN_SOURCE_DIMENSION || height < MIN_SOURCE_DIMENSION {
        return Err("The selected cover image must be at least 64 × 64 pixels.".to_string());
    }
    if width > MAX_SOURCE_DIMENSION
        || height > MAX_SOURCE_DIMENSION
        || u64::from(width) * u64::from(height) > MAX_SOURCE_PIXELS
    {
        return Err("The selected cover image dimensions are too large.".to_string());
    }

    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| "Cover image".to_string());

    Ok(DecodedCoverImage {
        image,
        format: image_format,
        fingerprint,
        file_name,
    })
}

fn cover_ratio_unit(width: u32, height: u32) -> u32 {
    (width / 2).min(height / 3).max(1)
}

fn crop_cover(image: &DynamicImage) -> DynamicImage {
    let rgba = image.to_rgba8();
    let source_unit = cover_ratio_unit(rgba.width(), rgba.height());
    let width = source_unit * 2;
    let height = source_unit * 3;
    let x = (rgba.width() - width) / 2;
    let y = (rgba.height() - height) / 2;
    let cropped = crop_imm(&rgba, x, y, width, height).to_image();
    let output_unit = source_unit
        .min(MAX_OUTPUT_WIDTH / 2)
        .min(MAX_OUTPUT_HEIGHT / 3);
    let output_width = output_unit * 2;
    let output_height = output_unit * 3;
    if output_unit == source_unit {
        DynamicImage::ImageRgba8(cropped)
    } else {
        DynamicImage::ImageRgba8(resize(
            &cropped,
            output_width,
            output_height,
            FilterType::Lanczos3,
        ))
    }
}

fn fit_cover(image: &DynamicImage, output_format: CoverImageFormat) -> DynamicImage {
    let source = image.to_rgba8();
    let (source_width, source_height) = source.dimensions();
    let source_unit = source_width.div_ceil(2).max(source_height.div_ceil(3));
    let output_unit = source_unit
        .min(MAX_OUTPUT_WIDTH / 2)
        .min(MAX_OUTPUT_HEIGHT / 3);
    let output_width = output_unit * 2;
    let output_height = output_unit * 3;
    let scale = (output_width as f64 / source_width as f64)
        .min(output_height as f64 / source_height as f64)
        .min(1.0);
    let image_width = ((source_width as f64 * scale).round() as u32).max(1);
    let image_height = ((source_height as f64 * scale).round() as u32).max(1);
    let fitted = if image_width == source_width && image_height == source_height {
        source
    } else {
        resize(&source, image_width, image_height, FilterType::Lanczos3)
    };
    let background = if output_format == CoverImageFormat::Jpeg {
        Rgba([255, 255, 255, 255])
    } else {
        Rgba([255, 255, 255, 0])
    };
    let mut canvas = RgbaImage::from_pixel(output_width, output_height, background);
    overlay(
        &mut canvas,
        &fitted,
        i64::from((output_width - image_width) / 2),
        i64::from((output_height - image_height) / 2),
    );
    DynamicImage::ImageRgba8(canvas)
}

fn flatten_alpha_on_white(image: &DynamicImage) -> DynamicImage {
    let source = image.to_rgba8();
    let mut canvas =
        RgbaImage::from_pixel(source.width(), source.height(), Rgba([255, 255, 255, 255]));
    overlay(&mut canvas, &source, 0, 0);
    DynamicImage::ImageRgba8(canvas)
}

fn encode_image(image: &DynamicImage, format: CoverImageFormat) -> Result<Vec<u8>, String> {
    let mut output = Cursor::new(Vec::new());
    match format {
        CoverImageFormat::Jpeg => DynamicImage::ImageRgb8(image.to_rgb8())
            .write_to(&mut output, ImageFormat::Jpeg)
            .map_err(|error| error.to_string())?,
        CoverImageFormat::Png => image
            .write_to(&mut output, ImageFormat::Png)
            .map_err(|error| error.to_string())?,
        CoverImageFormat::WebP => image
            .write_to(&mut output, ImageFormat::WebP)
            .map_err(|error| error.to_string())?,
    }
    Ok(output.into_inner())
}

fn process_cover_image(
    decoded: &DecodedCoverImage,
    framing: EpubCoverFraming,
    output_format: CoverImageFormat,
) -> Result<ProcessedCoverImage, String> {
    let image = match framing {
        EpubCoverFraming::Crop => crop_cover(&decoded.image),
        EpubCoverFraming::Fit => fit_cover(&decoded.image, output_format),
    };
    let image = if output_format == CoverImageFormat::Jpeg {
        flatten_alpha_on_white(&image)
    } else {
        image
    };
    let bytes = encode_image(&image, output_format)?;
    Ok(ProcessedCoverImage {
        image,
        format: output_format,
        bytes,
    })
}

fn preview_bytes(image: &DynamicImage) -> Result<Vec<u8>, String> {
    let preview = image.thumbnail(PREVIEW_WIDTH, PREVIEW_HEIGHT);
    let mut output = Cursor::new(Vec::new());
    preview
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok(output.into_inner())
}

fn attributes_map(reader: &Reader<&[u8]>, event: &BytesStart<'_>) -> HashMap<String, String> {
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

fn href_extension_matches_format(href: &str, format: CoverImageFormat) -> bool {
    let decoded_href = epub_metadata::decode_archive_href(href);
    let extension = decoded_href
        .split(['#', '?'])
        .next()
        .and_then(|path| Path::new(path).extension())
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase);

    matches!(
        (format, extension.as_deref()),
        (CoverImageFormat::Jpeg, Some("jpg" | "jpeg"))
            | (CoverImageFormat::Png, Some("png"))
            | (CoverImageFormat::WebP, Some("webp"))
    )
}

fn output_format_for_package(
    version: EpubPackageVersion,
    source_format: CoverImageFormat,
    existing_format: Option<CoverImageFormat>,
) -> Result<CoverImageFormat, String> {
    if let Some(existing_format) = existing_format {
        if existing_format == CoverImageFormat::WebP && !version.supports_webp() {
            return Err(format!(
                "The existing EPUB cover uses WebP, which is not supported by EPUB {}.{}. The file was not modified.",
                version.major, version.minor
            ));
        }
        return Ok(existing_format);
    }

    if source_format == CoverImageFormat::WebP && !version.supports_webp() {
        Ok(CoverImageFormat::Png)
    } else {
        Ok(source_format)
    }
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
            "The EPUB cover page is marked as using remote resources and cannot be resolved safely. The file was not modified."
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
    let attributes = attributes_map(reader, event);
    let item_id = local_attribute(&attributes, "id")
        .map(String::as_str)
        .unwrap_or_default();
    let event_name = String::from_utf8_lossy(event.name().as_ref()).into_owned();
    let mut rewritten = BytesStart::new(event_name);
    let selected = item_id == plan.cover_item_id;
    let mut properties_written = false;
    let mark_cover = plan.package_version.is_epub_three() || plan.had_cover_property;

    for (key, value) in attributes {
        let local = key.rsplit(':').next().unwrap_or(key.as_str());
        if selected && local == "media-type" {
            rewritten.push_attribute((key.as_str(), output_format.media_type()));
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
                rewritten.push_attribute((key.as_str(), properties.join(" ").as_str()));
            }
            properties_written = true;
            continue;
        }
        rewritten.push_attribute((key.as_str(), value.as_str()));
    }

    if selected
        && !attributes_map(reader, event)
            .keys()
            .any(|key| key.rsplit(':').next() == Some("media-type"))
    {
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

fn assert_fingerprint(
    label: &str,
    actual: &FileFingerprint,
    expected_size: u64,
    expected_modified_at: u64,
) -> Result<(), String> {
    if actual.size != expected_size || actual.modified_at != expected_modified_at {
        return Err(format!(
            "The {label} changed after the preview was created. Review it again before writing."
        ));
    }
    Ok(())
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
mod tests {
    use std::{
        collections::HashMap,
        fs,
        io::{Read, Write},
        path::Path,
        sync::atomic::{AtomicBool, Ordering},
    };

    use image::{DynamicImage, Rgb, RgbImage, Rgba, RgbaImage};

    use super::{
        decode_cover_image, plan_cover_package, prepare_cover_writeback_at, process_cover_image,
        read_package_and_plan, update_package_cover_xml, validate_rewritten_cover, write_cover_at,
        CoverImageFormat, EpubCoverFraming, EpubCoverPreparationInput, EpubCoverWritebackInput,
    };

    static SCANNER_CACHE_PUBLISHED: AtomicBool = AtomicBool::new(false);

    fn test_root() -> std::path::PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-cover-writeback-{nonce}"))
    }

    fn write_image(path: &std::path::Path, width: u32, height: u32) {
        let image =
            DynamicImage::ImageRgb8(RgbImage::from_pixel(width, height, Rgb([40, 80, 120])));
        image
            .save_with_format(path, image::ImageFormat::Png)
            .expect("image should be written");
    }

    fn write_image_with_format(
        path: &std::path::Path,
        width: u32,
        height: u32,
        format: image::ImageFormat,
    ) {
        let image = DynamicImage::ImageRgba8(RgbaImage::from_pixel(
            width,
            height,
            Rgba([40, 80, 120, 96]),
        ));
        image
            .save_with_format(path, format)
            .expect("image should be written");
    }

    fn write_epub(path: &std::path::Path, package_xml: &str, entries: &[(&str, &[u8])]) {
        let file = fs::File::create(path).expect("EPUB should be created");
        let mut archive = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        archive
            .start_file("META-INF/container.xml", options)
            .expect("container should start");
        archive
            .write_all(
                br#"<?xml version="1.0"?><container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#,
            )
            .expect("container should be written");
        archive
            .start_file("OEBPS/content.opf", options)
            .expect("package should start");
        archive
            .write_all(package_xml.as_bytes())
            .expect("package should be written");
        for (name, bytes) in entries {
            archive
                .start_file(*name, options)
                .expect("entry should start");
            archive.write_all(bytes).expect("entry should be written");
        }
        archive.finish().expect("EPUB should finish");
    }

    fn fingerprint(path: &std::path::Path) -> (u64, u64) {
        let metadata = fs::metadata(path).expect("file should exist");
        let modified_at = metadata
            .modified()
            .expect("modified time should exist")
            .duration_since(std::time::UNIX_EPOCH)
            .expect("clock should be valid")
            .as_millis() as u64;
        (metadata.len(), modified_at)
    }

    fn plan_package(
        package_xml: &str,
        source_format: CoverImageFormat,
        entries: &[(&str, &[u8])],
    ) -> Result<super::CoverPackagePlan, String> {
        let names = entries
            .iter()
            .map(|(name, _)| (*name).to_string())
            .collect::<Vec<_>>();
        let resources = entries.iter().copied().collect::<HashMap<_, _>>();
        plan_cover_package(
            "OEBPS/content.opf",
            package_xml,
            &names,
            source_format,
            |path, max_bytes| {
                let bytes = resources
                    .get(path)
                    .ok_or_else(|| format!("missing test resource {path}"))?;
                if bytes.len() as u64 > max_bytes {
                    return Err(format!("test resource {path} is too large"));
                }
                Ok(bytes.to_vec())
            },
        )
    }

    fn metadata_fixture() -> super::epub_metadata::EpubPackageMetadata {
        super::epub_metadata::EpubPackageMetadata {
            title: Some("Title".to_string()),
            creator: None,
            identifier: None,
            language: None,
            publisher: None,
            date: None,
            description: None,
            subjects: Vec::new(),
            series: None,
            volume: None,
        }
    }

    fn failing_replace(_temporary_path: &Path, _epub_path: &Path) -> Result<(), String> {
        Err("simulated final replacement failure".to_string())
    }

    fn restore_backup(backup_path: &Path, epub_path: &Path) -> Result<(), String> {
        if epub_path.exists() {
            fs::remove_file(epub_path).map_err(|error| error.to_string())?;
        }
        fs::rename(backup_path, epub_path).map_err(|error| error.to_string())
    }

    fn failing_restore(_backup_path: &Path, _epub_path: &Path) -> Result<(), String> {
        Err("simulated restore failure".to_string())
    }

    fn record_scanner_cache_publish(
        _root: &Path,
        _relative_path: &str,
        _file_stat: &super::epub_writeback::EpubMetadataWritebackFileStat,
        _metadata: &super::epub_metadata::EpubPackageMetadata,
    ) -> Result<(), String> {
        SCANNER_CACHE_PUBLISHED.store(true, Ordering::SeqCst);
        Ok(())
    }

    #[test]
    fn crop_and_fit_produce_exact_two_by_three_frames() {
        let root = test_root();
        fs::create_dir_all(&root).expect("root should be created");
        let image_path = root.join("wide.png");
        write_image(&image_path, 900, 500);
        let decoded = decode_cover_image(&image_path).expect("image should decode");

        for framing in [EpubCoverFraming::Crop, EpubCoverFraming::Fit] {
            let processed = process_cover_image(&decoded, framing, CoverImageFormat::Png)
                .expect("image should process");
            assert_eq!(
                u64::from(processed.image.width()) * 3,
                u64::from(processed.image.height()) * 2
            );
        }
        fs::remove_dir_all(root).expect("root should be removed");
    }

    #[test]
    fn jpeg_output_flattens_transparency_to_white_in_the_preview_and_resource() {
        let root = test_root();
        fs::create_dir_all(&root).expect("root should be created");
        let image_path = root.join("transparent.png");
        DynamicImage::ImageRgba8(RgbaImage::from_pixel(300, 450, Rgba([0, 0, 0, 0])))
            .save_with_format(&image_path, image::ImageFormat::Png)
            .expect("image should be written");
        let decoded = decode_cover_image(&image_path).expect("image should decode");

        let processed =
            process_cover_image(&decoded, EpubCoverFraming::Crop, CoverImageFormat::Jpeg)
                .expect("image should process");
        let rgba = processed.image.to_rgba8();
        let pixel = rgba.get_pixel(0, 0).0;

        assert_eq!(pixel, [255, 255, 255, 255]);
        fs::remove_dir_all(root).expect("root should be removed");
    }

    #[test]
    fn webp_source_converts_to_png_for_epub_two() {
        let package = r#"<package version="2.0"><metadata/><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine/></package>"#;
        let plan = plan_package(
            package,
            CoverImageFormat::WebP,
            &[("OEBPS/chapter.xhtml", b"chapter")],
        )
        .expect("EPUB 2 plan should parse");

        assert_eq!(plan.output_format, CoverImageFormat::Png);
        assert!(plan.cover_href.ends_with(".png"));
    }

    #[test]
    fn webp_source_converts_to_png_for_epub_three_zero() {
        let package = r#"<package version="3.0"><metadata/><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine/></package>"#;
        let plan = plan_package(
            package,
            CoverImageFormat::WebP,
            &[("OEBPS/chapter.xhtml", b"chapter")],
        )
        .expect("EPUB 3.0 plan should parse");

        assert_eq!(plan.output_format, CoverImageFormat::Png);
        assert!(plan.cover_href.ends_with(".png"));
    }

    #[test]
    fn webp_source_converts_to_png_for_epub_three_two() {
        let package = r#"<package version="3.2"><metadata/><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine/></package>"#;
        let plan = plan_package(
            package,
            CoverImageFormat::WebP,
            &[("OEBPS/chapter.xhtml", b"chapter")],
        )
        .expect("EPUB 3.2 plan should parse");

        assert_eq!(plan.output_format, CoverImageFormat::Png);
        assert!(plan.cover_href.ends_with(".png"));
    }

    #[test]
    fn webp_source_remains_webp_for_epub_three_three() {
        let package = r#"<package version=" 3.3 "><metadata/><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine/></package>"#;
        let plan = plan_package(
            package,
            CoverImageFormat::WebP,
            &[("OEBPS/chapter.xhtml", b"chapter")],
        )
        .expect("EPUB 3.3 plan should parse");

        assert_eq!(plan.output_format, CoverImageFormat::WebP);
        assert!(plan.cover_href.ends_with(".webp"));
    }

    #[test]
    fn jpeg_and_png_sources_remain_compatible_across_supported_versions() {
        for version in ["2.0", "3.0", "3.1", "3.2", "3.3"] {
            for format in [CoverImageFormat::Jpeg, CoverImageFormat::Png] {
                let package = format!(
                    r#"<package version="{version}"><metadata/><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine/></package>"#
                );
                let plan = plan_package(&package, format, &[("OEBPS/chapter.xhtml", b"chapter")])
                    .expect("compatible plan should parse");
                assert_eq!(plan.output_format, format, "version {version}");
            }
        }
    }

    #[test]
    fn existing_jpeg_and_png_cover_formats_are_preserved() {
        for (media_type, href, expected) in [
            ("image/jpeg", "images/cover.jpeg", CoverImageFormat::Jpeg),
            ("image/png", "images/cover.png", CoverImageFormat::Png),
        ] {
            let package = format!(
                r#"<package version="2.0"><metadata><meta name="cover" content="cover"/></metadata><manifest><item id="cover" href="{href}" media-type="{media_type}"/></manifest><spine/></package>"#
            );
            let zip_path = format!("OEBPS/{href}");
            let plan = plan_package(
                &package,
                CoverImageFormat::WebP,
                &[(zip_path.as_str(), b"existing")],
            )
            .expect("existing compatible format should be preserved");
            assert_eq!(plan.output_format, expected);
            assert_eq!(plan.cover_href, href);
        }
    }

    #[test]
    fn existing_webp_cover_is_rejected_before_epub_three_three() {
        for version in ["2.0", "3.2"] {
            let package = format!(
                r#"<package version="{version}"><metadata><meta name="cover" content="cover"/></metadata><manifest><item id="cover" href="images/cover.webp" media-type="image/webp"/></manifest><spine/></package>"#
            );
            let error = plan_package(
                &package,
                CoverImageFormat::Png,
                &[("OEBPS/images/cover.webp", b"existing")],
            )
            .expect_err("incompatible existing WebP should fail");
            assert!(error.contains("not supported by EPUB"), "{error}");
        }
    }

    #[test]
    fn existing_webp_cover_is_preserved_for_epub_three_three() {
        let package = r#"<package version="3.3"><metadata/><manifest><item id="cover" href="images/cover.webp" media-type="image/webp" properties="cover-image"/></manifest><spine/></package>"#;
        let plan = plan_package(
            package,
            CoverImageFormat::Png,
            &[("OEBPS/images/cover.webp", b"existing")],
        )
        .expect("EPUB 3.3 WebP cover should remain supported");
        assert_eq!(plan.output_format, CoverImageFormat::WebP);
    }

    #[test]
    fn generated_href_media_type_and_encoded_bytes_use_the_same_format() {
        let root = test_root();
        fs::create_dir_all(&root).expect("root should be created");
        let image_path = root.join("replacement.webp");
        write_image_with_format(&image_path, 600, 900, image::ImageFormat::WebP);
        let decoded = decode_cover_image(&image_path).expect("WebP should decode");
        let package = r#"<package version="3.2"><metadata></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine/></package>"#;
        let plan = plan_package(
            package,
            decoded.format,
            &[("OEBPS/chapter.xhtml", b"chapter")],
        )
        .expect("plan should parse");
        let processed = process_cover_image(&decoded, EpubCoverFraming::Crop, plan.output_format)
            .expect("cover should process");
        let updated = update_package_cover_xml(package, &plan, plan.output_format)
            .expect("package should update");

        assert!(plan.cover_href.ends_with(".png"));
        assert!(updated.contains("media-type=\"image/png\""));
        assert_eq!(
            image::guess_format(&processed.bytes).expect("encoded format should be detectable"),
            image::ImageFormat::Png,
        );
        fs::remove_dir_all(root).expect("root should be removed");
    }

    #[test]
    fn preview_reports_actual_png_output_for_webp_source_in_epub_three_two() {
        let root = test_root();
        fs::create_dir_all(&root).expect("root should be created");
        let epub_path = root.join("book.epub");
        let image_path = root.join("replacement.webp");
        write_image_with_format(&image_path, 600, 900, image::ImageFormat::WebP);
        write_epub(
            &epub_path,
            r#"<package version="3.2"><metadata/><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine/></package>"#,
            &[("OEBPS/chapter.xhtml", b"chapter")],
        );

        let preparation = prepare_cover_writeback_at(
            &root,
            &EpubCoverPreparationInput {
                relative_path: "book.epub".to_string(),
                image_path: image_path.to_string_lossy().into_owned(),
                framing: EpubCoverFraming::Crop,
            },
        )
        .expect("preview should prepare");

        assert_eq!(preparation.source_format, "WebP");
        assert_eq!(preparation.output_format, "PNG");
        assert_eq!(preparation.preview_mime_type, "image/png");
        fs::remove_dir_all(root).expect("root should be removed");
    }

    #[test]
    fn malformed_or_unknown_package_versions_do_not_enable_webp() {
        for version in ["", "3", "3.x", "3.3.0", "2.1", "4.0"] {
            let package = format!(
                r#"<package version="{version}"><metadata/><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine/></package>"#
            );
            let error = plan_package(
                &package,
                CoverImageFormat::WebP,
                &[("OEBPS/chapter.xhtml", b"chapter")],
            )
            .expect_err("unknown package version should fail conservatively");
            assert!(
                error.contains("version") || error.contains("supported"),
                "{error}"
            );
        }
    }

    #[test]
    fn plans_epub_two_cover_from_meta_reference() {
        let package = r#"<package version="2.0"><metadata><meta name="cover" content="cover-id"/></metadata><manifest><item id="cover-id" href="images/cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;
        let plan = plan_package(
            package,
            CoverImageFormat::Png,
            &[("OEBPS/images/cover.jpg", b"old-cover")],
        )
        .expect("plan should parse");

        assert!(plan.existing_cover);
        assert_eq!(plan.cover_item_id, "cover-id");
        assert_eq!(plan.cover_zip_path, "OEBPS/images/cover.jpg");
        assert_eq!(plan.package_version.major, 2);
        assert_eq!(plan.package_version.minor, 0);
    }

    #[test]
    fn rejects_multiple_active_cover_resources() {
        let package = r#"<package version="3.0"><metadata/><manifest><item id="one" href="one.jpg" media-type="image/jpeg" properties="cover-image"/><item id="two" href="two.jpg" media-type="image/jpeg" properties="cover-image"/></manifest><spine/></package>"#;
        let error = plan_package(
            package,
            CoverImageFormat::Png,
            &[("OEBPS/one.jpg", b"one"), ("OEBPS/two.jpg", b"two")],
        )
        .expect_err("ambiguous covers should fail");

        assert!(error.contains("multiple active cover resources"));
    }

    #[test]
    fn rejects_cover_metadata_that_targets_an_xhtml_cover_page() {
        let package = r#"<package version="2.0"><metadata><meta name="cover" content="cover-page"/></metadata><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover-page"/></spine></package>"#;
        let error = plan_package(
            package,
            CoverImageFormat::Png,
            &[("OEBPS/cover.xhtml", b"<html/>")],
        )
        .expect_err("cover pages must not be overwritten as image resources");

        assert!(error.contains("unsupported media type"));
    }

    #[test]
    fn adds_epub_three_cover_item_without_touching_spine() {
        let package = r#"<package version="3.0"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Title</dc:title></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="chapter"/></spine></package>"#;
        let plan = plan_package(
            package,
            CoverImageFormat::Png,
            &[("OEBPS/chapter.xhtml", b"chapter")],
        )
        .expect("plan should parse");
        let updated = update_package_cover_xml(package, &plan, plan.output_format)
            .expect("package should update");

        assert!(updated.contains("properties=\"cover-image\""));
        assert!(updated.contains(
            r#"<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>"#,
        ));
        assert!(updated.contains("idref=\"chapter\""));
        assert_eq!(updated.matches("<itemref").count(), 1);
        assert!(!updated.contains("name=\"cover\""));
    }

    #[test]
    fn preserves_package_namespace_prefix_for_new_cover_elements() {
        let package = r#"<opf:package xmlns:opf="http://www.idpf.org/2007/opf" version="2.0"><opf:metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Title</dc:title></opf:metadata><opf:manifest><opf:item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></opf:manifest><opf:spine><opf:itemref idref="chapter"/></opf:spine></opf:package>"#;
        let plan = plan_package(
            package,
            CoverImageFormat::Png,
            &[("OEBPS/chapter.xhtml", b"chapter")],
        )
        .expect("plan should parse");
        let updated = update_package_cover_xml(package, &plan, plan.output_format)
            .expect("package should update");

        assert!(updated.contains("<opf:meta name=\"cover\""));
        assert!(updated.contains("<opf:item id=\"archeion-cover-image\""));
        assert!(!updated.contains("<meta name=\"cover\""));
        assert!(!updated.contains("<item id=\"archeion-cover-image\""));
        assert_eq!(updated.matches("<opf:itemref").count(), 1);
    }

    #[test]
    fn resolves_epub_two_guide_only_cover_page_and_preserves_reading_order() {
        let package = r#"<package version="2.0"><metadata></metadata><manifest><item id="cover-page" href="Text/cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-image" href="Images/cover.jpg" media-type="image/jpeg"/><item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover-page"/><itemref idref="chapter"/></spine><guide><reference type="cover" title="Cover" href="Text/cover.xhtml"/></guide></package>"#;
        let plan = plan_package(
            package,
            CoverImageFormat::Png,
            &[
                (
                    "OEBPS/Text/cover.xhtml",
                    br#"<html xmlns="http://www.w3.org/1999/xhtml"><body><img src="../Images/cover.jpg"/></body></html>"#,
                ),
                ("OEBPS/Images/cover.jpg", b"old-cover"),
                ("OEBPS/Text/chapter.xhtml", b"chapter"),
            ],
        )
        .expect("guide-only cover should resolve");
        let updated = update_package_cover_xml(package, &plan, plan.output_format)
            .expect("package should update");

        assert!(plan.existing_cover);
        assert_eq!(plan.cover_item_id, "cover-image");
        assert_eq!(plan.cover_zip_path, "OEBPS/Images/cover.jpg");
        assert!(updated.contains("<meta name=\"cover\" content=\"cover-image\"/>"));
        assert!(updated.contains("href=\"Text/cover.xhtml\""));
        assert!(updated.contains("<itemref idref=\"cover-page\"/>"));
        assert!(updated.contains("<itemref idref=\"chapter\"/>"));
        assert_eq!(updated.matches("<itemref").count(), 2);
    }

    #[test]
    fn declared_cover_and_guide_page_may_reference_the_same_image() {
        let package = r#"<package version="2.0"><metadata><meta name="cover" content="cover-image"/></metadata><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-image" href="images/cover.png" media-type="image/png"/></manifest><spine><itemref idref="cover-page"/></spine><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#;
        let plan = plan_package(
            package,
            CoverImageFormat::Jpeg,
            &[
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><body><img src="images/cover.png"/></body></html>"#,
                ),
                ("OEBPS/images/cover.png", b"old-cover"),
            ],
        )
        .expect("coherent cover declarations should work");

        assert_eq!(plan.cover_item_id, "cover-image");
        assert_eq!(plan.output_format, CoverImageFormat::Png);
    }

    #[test]
    fn cover_page_with_two_candidate_images_fails_safely() {
        let package = r#"<package version="2.0"><metadata/><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="one" href="one.jpg" media-type="image/jpeg"/><item id="two" href="two.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#;
        let error = plan_package(
            package,
            CoverImageFormat::Png,
            &[
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><body><img src="one.jpg"/><img src="two.jpg"/></body></html>"#,
                ),
                ("OEBPS/one.jpg", b"one"),
                ("OEBPS/two.jpg", b"two"),
            ],
        )
        .expect_err("ambiguous cover page should fail");
        assert!(error.contains("multiple candidate images"), "{error}");
    }

    #[test]
    fn css_background_cover_page_fails_safely() {
        let package = r#"<package version="2.0"><metadata/><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-image" href="cover.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#;
        let error = plan_package(
            package,
            CoverImageFormat::Png,
            &[
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><head><style>body { background-image: url('cover.jpg'); }</style></head><body/></html>"#,
                ),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect_err("CSS cover should fail");
        assert!(error.contains("image resource dependency"), "{error}");
    }

    #[test]
    fn missing_cover_page_image_fails_safely() {
        let package = r#"<package version="2.0"><metadata/><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-image" href="missing.jpg" media-type="image/jpeg"/></manifest><spine/><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#;
        let error = plan_package(
            package,
            CoverImageFormat::Png,
            &[(
                "OEBPS/cover.xhtml",
                br#"<html><body><img src="missing.jpg"/></body></html>"#,
            )],
        )
        .expect_err("missing cover image should fail");
        assert!(error.contains("is missing"), "{error}");
    }

    #[test]
    fn cover_page_image_outside_manifest_fails_safely() {
        let package = r#"<package version="2.0"><metadata/><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/></manifest><spine/><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#;
        let error = plan_package(
            package,
            CoverImageFormat::Png,
            &[
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><body><img src="images/cover.jpg"/></body></html>"#,
                ),
                ("OEBPS/images/cover.jpg", b"cover"),
            ],
        )
        .expect_err("unmanifested cover image should fail");
        assert!(error.contains("not tied to a manifest item"), "{error}");
    }

    #[test]
    fn external_cover_page_image_fails_safely() {
        let package = r#"<package version="2.0"><metadata/><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/></manifest><spine/><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#;
        let error = plan_package(
            package,
            CoverImageFormat::Png,
            &[(
                "OEBPS/cover.xhtml",
                br#"<html><body><img src="https://example.com/cover.jpg"/></body></html>"#,
            )],
        )
        .expect_err("external cover image should fail");
        assert!(error.contains("external, embedded, or unsafe"), "{error}");
    }

    #[test]
    fn malformed_cover_page_xml_fails_safely() {
        let package = r#"<package version="2.0"><metadata/><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-image" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#;
        let error = plan_package(
            package,
            CoverImageFormat::Png,
            &[
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><body><img src="cover.jpg"></body></broken>"#,
                ),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect_err("malformed XHTML should fail");
        assert!(error.contains("malformed"), "{error}");
    }

    #[test]
    fn conflicting_package_and_guide_cover_declarations_fail_safely() {
        let package = r#"<package version="2.0"><metadata><meta name="cover" content="declared"/></metadata><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="declared" href="declared.jpg" media-type="image/jpeg"/><item id="visible" href="visible.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#;
        let error = plan_package(
            package,
            CoverImageFormat::Png,
            &[
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><body><img src="visible.jpg"/></body></html>"#,
                ),
                ("OEBPS/declared.jpg", b"declared"),
                ("OEBPS/visible.jpg", b"visible"),
            ],
        )
        .expect_err("conflicting covers should fail");
        assert!(
            error.contains("point to different image resources"),
            "{error}"
        );
    }

    #[test]
    fn epub_three_guide_cover_keeps_spine_order_and_adds_cover_property() {
        let package = r#"<package version="3.2"><metadata></metadata><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-image" href="cover.png" media-type="image/png"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover-page"/><itemref idref="chapter"/></spine><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#;
        let plan = plan_package(
            package,
            CoverImageFormat::Jpeg,
            &[
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><body><img src="cover.png"/></body></html>"#,
                ),
                ("OEBPS/cover.png", b"cover"),
                ("OEBPS/chapter.xhtml", b"chapter"),
            ],
        )
        .expect("explicit EPUB 3 guide cover should resolve");
        let updated = update_package_cover_xml(package, &plan, plan.output_format)
            .expect("package should update");

        assert!(updated.contains(
            "id=\"cover-image\" href=\"cover.png\" media-type=\"image/png\" properties=\"cover-image\""
        ));
        let cover_position = updated
            .find("idref=\"cover-page\"")
            .expect("cover itemref should remain");
        let chapter_position = updated
            .find("idref=\"chapter\"")
            .expect("chapter itemref should remain");
        assert!(cover_position < chapter_position);
        assert_eq!(updated.matches("<itemref").count(), 2);
    }

    #[test]
    fn resolves_landmark_only_covers_across_supported_epub_three_versions() {
        for version in ["3.0", "3.2", "3.3"] {
            let package = format!(
                r#"<package version="{version}"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-resource" href="images/cover.jpg" media-type="image/jpeg"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover-page"/><itemref idref="chapter"/></spine></package>"#
            );
            let navigation = br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><ol><li><a epub:type="cover" href="cover.xhtml#cover">Cover</a></li></ol></nav></body></html>"#;
            let plan = plan_package(
                &package,
                CoverImageFormat::Png,
                &[
                    ("OEBPS/nav.xhtml", navigation),
                    (
                        "OEBPS/cover.xhtml",
                        br#"<html><body><img id="cover" src="images/cover.jpg"/></body></html>"#,
                    ),
                    ("OEBPS/images/cover.jpg", b"old-cover"),
                    ("OEBPS/chapter.xhtml", b"chapter"),
                ],
            )
            .expect("landmark-only cover should resolve");
            let updated = update_package_cover_xml(&package, &plan, plan.output_format)
                .expect("package should update");

            assert!(plan.existing_cover, "version {version}");
            assert_eq!(plan.cover_item_id, "cover-resource", "version {version}");
            assert_eq!(
                plan.cover_zip_path, "OEBPS/images/cover.jpg",
                "version {version}"
            );
            assert!(updated.contains(
                "id=\"cover-resource\" href=\"images/cover.jpg\" media-type=\"image/jpeg\" properties=\"cover-image\""
            ));
            assert_eq!(updated.matches("<item ").count(), 4);
            assert_eq!(updated.matches("<itemref").count(), 2);
            let cover_position = updated
                .find("idref=\"cover-page\"")
                .expect("cover itemref should remain");
            let chapter_position = updated
                .find("idref=\"chapter\"")
                .expect("chapter itemref should remain");
            assert!(cover_position < chapter_position);
        }
    }

    #[test]
    fn coherent_package_guide_and_landmarks_declarations_resolve_to_one_cover() {
        let package = r#"<package version="3.2"><metadata><meta name="cover" content="cover-resource"/></metadata><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-resource" href="cover.png" media-type="image/png" properties="cover-image"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover-page"/><itemref idref="chapter"/></spine><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#;
        let plan = plan_package(
            package,
            CoverImageFormat::Jpeg,
            &[
                (
                    "OEBPS/nav.xhtml",
                    br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><ol><li><a epub:type="cover" href="cover.xhtml">Cover</a></li></ol></nav></body></html>"#,
                ),
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><body><img src="cover.png"/></body></html>"#,
                ),
                ("OEBPS/cover.png", b"old-cover"),
                ("OEBPS/chapter.xhtml", b"chapter"),
            ],
        )
        .expect("coherent declarations should resolve");
        let updated = update_package_cover_xml(package, &plan, plan.output_format)
            .expect("package should update");

        assert_eq!(plan.cover_item_id, "cover-resource");
        assert_eq!(updated.matches("properties=\"cover-image\"").count(), 1);
        assert_eq!(updated.matches("name=\"cover\"").count(), 1);
        assert_eq!(updated.matches("<itemref").count(), 2);
    }

    #[test]
    fn package_cover_and_landmarks_conflict_fails_safely() {
        let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="declared" href="declared.jpg" media-type="image/jpeg" properties="cover-image"/><item id="visible" href="visible.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine></package>"#;
        let error = plan_package(
            package,
            CoverImageFormat::Png,
            &[
                (
                    "OEBPS/nav.xhtml",
                    br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#,
                ),
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><body><img src="visible.jpg"/></body></html>"#,
                ),
                ("OEBPS/declared.jpg", b"declared"),
                ("OEBPS/visible.jpg", b"visible"),
            ],
        )
        .expect_err("conflicting package and landmark covers should fail");

        assert!(
            error.contains("visible cover page point to different image resources"),
            "{error}"
        );
    }

    #[test]
    fn guide_and_landmarks_must_identify_the_same_cover_page() {
        let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="guide-page" href="guide.xhtml" media-type="application/xhtml+xml"/><item id="landmark-page" href="landmark.xhtml" media-type="application/xhtml+xml"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="guide-page"/><itemref idref="landmark-page"/></spine><guide><reference type="cover" href="guide.xhtml"/></guide></package>"#;
        let error = plan_package(
            package,
            CoverImageFormat::Png,
            &[
                (
                    "OEBPS/nav.xhtml",
                    br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="landmark.xhtml">Cover</a></nav></body></html>"#,
                ),
                (
                    "OEBPS/guide.xhtml",
                    br#"<html><body><img src="cover.jpg"/></body></html>"#,
                ),
                (
                    "OEBPS/landmark.xhtml",
                    br#"<html><body><img src="cover.jpg"/></body></html>"#,
                ),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect_err("different visible cover pages should fail");

        assert!(error.contains("different cover pages"), "{error}");
    }

    #[test]
    fn ambiguous_or_invalid_landmarks_navigation_fails_safely() {
        let base_manifest = |navigation_items: &str, cover_item: &str| {
            format!(
                r#"<package version="3.2"><metadata/><manifest>{navigation_items}{cover_item}<item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine></package>"#
            )
        };
        let cover_item =
            r#"<item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>"#;
        let cover_page = br#"<html><body><img src="cover.jpg"/></body></html>"#;

        let cases = [
            (
                "multiple cover landmarks",
                base_manifest(
                    r#"<item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>"#,
                    cover_item,
                ),
                br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">One</a><a epub:type="cover" href="cover.xhtml">Two</a></nav></body></html>"#
                    .as_slice(),
                "multiple cover landmarks",
            ),
            (
                "multiple landmarks navigations",
                base_manifest(
                    r#"<item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>"#,
                    cover_item,
                ),
                br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"/><nav epub:type="landmarks"/></body></html>"#
                    .as_slice(),
                "multiple landmarks navigation elements",
            ),
            (
                "external landmark target",
                base_manifest(
                    r#"<item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>"#,
                    cover_item,
                ),
                br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="https://example.com/cover.xhtml">Cover</a></nav></body></html>"#
                    .as_slice(),
                "external, embedded, or unsafe",
            ),
            (
                "malformed navigation",
                base_manifest(
                    r#"<item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>"#,
                    cover_item,
                ),
                br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml"></broken>"#
                    .as_slice(),
                "navigation document is malformed",
            ),
        ];

        for (label, package, navigation, expected) in cases {
            let error = plan_package(
                &package,
                CoverImageFormat::Png,
                &[
                    ("OEBPS/nav.xhtml", navigation),
                    ("OEBPS/cover.xhtml", cover_page),
                    ("OEBPS/cover.jpg", b"cover"),
                ],
            )
            .expect_err(label);
            assert!(error.contains(expected), "{label}: {error}");
        }

        let ambiguous_nav_package = base_manifest(
            r#"<item id="navigation-one" href="nav-one.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="navigation-two" href="nav-two.xhtml" media-type="application/xhtml+xml" properties="nav"/>"#,
            cover_item,
        );
        let error = plan_package(
            &ambiguous_nav_package,
            CoverImageFormat::Png,
            &[
                ("OEBPS/nav-one.xhtml", b"<html/>"),
                ("OEBPS/nav-two.xhtml", b"<html/>"),
                ("OEBPS/cover.xhtml", cover_page),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect_err("ambiguous navigation items should fail");
        assert!(error.contains("multiple navigation documents"), "{error}");
    }

    #[test]
    fn missing_or_unmanifested_landmark_resources_fail_safely() {
        let navigation = br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#;

        let missing_nav_package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;
        let error = plan_package(
            missing_nav_package,
            CoverImageFormat::Png,
            &[
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><body><img src="cover.jpg"/></body></html>"#,
                ),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect_err("missing navigation document should fail");
        assert!(error.contains("navigation document resource"), "{error}");
        assert!(error.contains("is missing"), "{error}");

        let missing_target_package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;
        let error = plan_package(
            missing_target_package,
            CoverImageFormat::Png,
            &[
                ("OEBPS/nav.xhtml", navigation),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect_err("missing landmark target should fail");
        assert!(error.contains("cover page resource"), "{error}");
        assert!(error.contains("is missing"), "{error}");

        let unmanifested_target_package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;
        let error = plan_package(
            unmanifested_target_package,
            CoverImageFormat::Png,
            &[
                ("OEBPS/nav.xhtml", navigation),
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><body><img src="cover.jpg"/></body></html>"#,
                ),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect_err("unmanifested landmark target should fail");
        assert!(error.contains("not tied to a manifest item"), "{error}");
    }

    #[test]
    fn landmark_target_must_be_manifest_backed_xhtml() {
        let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.html" media-type="text/html"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;
        let error = plan_package(
            package,
            CoverImageFormat::Png,
            &[
                (
                    "OEBPS/nav.xhtml",
                    br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.html">Cover</a></nav></body></html>"#,
                ),
                (
                    "OEBPS/cover.html",
                    br#"<html><body><img src="cover.jpg"/></body></html>"#,
                ),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect_err("non-XHTML landmark target should fail");

        assert!(
            error.contains("does not reference a supported XHTML document"),
            "{error}"
        );
    }

    #[test]
    fn navigation_without_a_cover_landmark_preserves_package_cover_behavior() {
        let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg" properties="cover-image"/></manifest><spine/></package>"#;
        let plan = plan_package(
            package,
            CoverImageFormat::Png,
            &[
                (
                    "OEBPS/nav.xhtml",
                    br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="toc" href="toc.xhtml">Contents</a></nav></body></html>"#,
                ),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect("package cover should remain usable without a cover landmark");

        assert_eq!(plan.cover_item_id, "cover-resource");
        assert!(plan.existing_cover);
    }

    #[test]
    fn conflicting_landmark_and_package_cover_leave_original_epub_unchanged() {
        let root = test_root();
        fs::create_dir_all(&root).expect("root should be created");
        let epub_path = root.join("book.epub");
        let image_path = root.join("replacement.png");
        write_image(&image_path, 600, 900);
        write_epub(
            &epub_path,
            r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="declared" href="declared.jpg" media-type="image/jpeg" properties="cover-image"/><item id="visible" href="visible.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine></package>"#,
            &[
                (
                    "OEBPS/nav.xhtml",
                    br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#,
                ),
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><body><img src="visible.jpg"/></body></html>"#,
                ),
                ("OEBPS/declared.jpg", b"declared"),
                ("OEBPS/visible.jpg", b"visible"),
            ],
        );
        let original = fs::read(&epub_path).expect("original EPUB should read");
        let (image_size, image_modified_at) = fingerprint(&image_path);
        let (epub_size, epub_modified_at) = fingerprint(&epub_path);

        let error = write_cover_at(
            &root,
            EpubCoverWritebackInput {
                relative_path: "book.epub".to_string(),
                book_id: "book-landmark-conflict".to_string(),
                image_path: image_path.to_string_lossy().into_owned(),
                framing: EpubCoverFraming::Crop,
                expected_image_size: image_size,
                expected_image_modified_at: image_modified_at,
                expected_epub_size: epub_size,
                expected_epub_modified_at: epub_modified_at,
                keep_successful_backup: false,
            },
        )
        .expect_err("conflicting package and landmark covers should fail");

        assert!(
            error.contains("visible cover page point to different image resources"),
            "{error}"
        );
        assert_eq!(fs::read(&epub_path).expect("EPUB should remain"), original);
        fs::remove_dir_all(root).expect("root should be removed");
    }

    #[test]
    fn harmless_local_cover_stylesheet_is_allowed() {
        let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-style" href="cover.css" media-type="text/css"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine></package>"#;
        let plan = plan_package(
            package,
            CoverImageFormat::Png,
            &[
                (
                    "OEBPS/nav.xhtml",
                    br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#,
                ),
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><head><link rel="stylesheet" href="cover.css"/></head><body><img src="cover.jpg"/></body></html>"#,
                ),
                ("OEBPS/cover.css", b"html, body { margin: 0; } img { display: block; }"),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect("harmless stylesheet should be accepted");

        assert_eq!(plan.cover_item_id, "cover-resource");
    }

    #[test]
    fn cover_stylesheets_with_image_or_import_dependencies_fail_safely() {
        let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-style" href="cover.css" media-type="text/css"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;
        let navigation = br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#;
        let cover_page = br#"<html><head><link rel="stylesheet" href="cover.css"/></head><body><img src="cover.jpg"/></body></html>"#;

        for (label, css, expected) in [
            (
                "background-image",
                b"body { background-image: url('other.jpg'); }".as_slice(),
                "image resource dependency",
            ),
            (
                "background shorthand",
                b"body { background: center / cover url('other.jpg'); }".as_slice(),
                "image resource dependency",
            ),
            (
                "stylesheet import",
                b"@import url('nested.css'); body { margin: 0; }".as_slice(),
                "imports another stylesheet",
            ),
            (
                "remote URL",
                b"@font-face { src: url('https://example.com/font.woff2'); }".as_slice(),
                "image resource dependency",
            ),
            (
                "data URL",
                b"@font-face { src: url(data:font/woff2;base64,AAAA); }".as_slice(),
                "image resource dependency",
            ),
            (
                "malformed stylesheet",
                b"body { margin: 0;".as_slice(),
                "stylesheet is malformed",
            ),
        ] {
            let error = plan_package(
                package,
                CoverImageFormat::Png,
                &[
                    ("OEBPS/nav.xhtml", navigation),
                    ("OEBPS/cover.xhtml", cover_page),
                    ("OEBPS/cover.css", css),
                    ("OEBPS/cover.jpg", b"cover"),
                ],
            )
            .expect_err(label);
            assert!(error.contains(expected), "{label}: {error}");
        }
    }

    #[test]
    fn external_missing_and_unmanifested_cover_stylesheets_fail_safely() {
        let navigation = br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#;
        let package_with_css = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-style" href="cover.css" media-type="text/css"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;

        let external_error = plan_package(
            package_with_css,
            CoverImageFormat::Png,
            &[
                ("OEBPS/nav.xhtml", navigation),
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><head><link rel="stylesheet" href="https://example.com/cover.css"/></head><body><img src="cover.jpg"/></body></html>"#,
                ),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect_err("external stylesheet should fail");
        assert!(
            external_error.contains("external, embedded, or unsafe reference"),
            "{external_error}"
        );

        let missing_error = plan_package(
            package_with_css,
            CoverImageFormat::Png,
            &[
                ("OEBPS/nav.xhtml", navigation),
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><head><link rel="stylesheet" href="cover.css"/></head><body><img src="cover.jpg"/></body></html>"#,
                ),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect_err("missing stylesheet should fail");
        assert!(missing_error.contains("is missing"), "{missing_error}");

        let package_without_css = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;
        let unmanifested_error = plan_package(
            package_without_css,
            CoverImageFormat::Png,
            &[
                ("OEBPS/nav.xhtml", navigation),
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><head><link rel="stylesheet" href="cover.css"/></head><body><img src="cover.jpg"/></body></html>"#,
                ),
                ("OEBPS/cover.css", b"body { margin: 0; }"),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect_err("unmanifested stylesheet should fail");
        assert!(
            unmanifested_error.contains("not tied to a manifest item"),
            "{unmanifested_error}"
        );
    }

    #[test]
    fn ambiguous_cover_page_rendering_mechanisms_fail_safely() {
        let navigation = br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#;
        let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;

        for (label, page, expected) in [
            (
                "picture",
                br#"<html><body><picture><img src="cover.jpg"/></picture></body></html>"#
                    .as_slice(),
                "alternative image sources",
            ),
            (
                "source",
                br#"<html><body><source src="cover.jpg"/></body></html>"#.as_slice(),
                "alternative image sources",
            ),
            (
                "srcset",
                br#"<html><body><img src="cover.jpg" srcset="cover@2x.jpg 2x"/></body></html>"#
                    .as_slice(),
                "uses srcset",
            ),
            (
                "script",
                br#"<html><body><script>document.write('cover')</script><img src="cover.jpg"/></body></html>"#
                    .as_slice(),
                "uses scripting",
            ),
            (
                "iframe",
                br#"<html><body><iframe src="cover.html"/><img src="cover.jpg"/></body></html>"#
                    .as_slice(),
                "embedded content",
            ),
            (
                "object",
                br#"<html><body><object data="cover.svg"/><img src="cover.jpg"/></body></html>"#
                    .as_slice(),
                "embedded content",
            ),
            (
                "embed",
                br#"<html><body><embed src="cover.svg"/><img src="cover.jpg"/></body></html>"#
                    .as_slice(),
                "embedded content",
            ),
        ] {
            let error = plan_package(
                package,
                CoverImageFormat::Png,
                &[
                    ("OEBPS/nav.xhtml", navigation),
                    ("OEBPS/cover.xhtml", page),
                    ("OEBPS/cover.jpg", b"cover"),
                ],
            )
            .expect_err(label);
            assert!(error.contains(expected), "{label}: {error}");
        }

        for property in ["scripted", "remote-resources"] {
            let package = format!(
                r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml" properties="{property}"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#
            );
            let error = plan_package(
                &package,
                CoverImageFormat::Png,
                &[
                    ("OEBPS/nav.xhtml", navigation),
                    (
                        "OEBPS/cover.xhtml",
                        br#"<html><body><img src="cover.jpg"/></body></html>"#,
                    ),
                    ("OEBPS/cover.jpg", b"cover"),
                ],
            )
            .expect_err("unsafe manifest property should fail");
            assert!(error.contains(property), "{property}: {error}");
        }
    }

    #[test]
    fn writes_landmark_only_cover_without_changing_navigation_page_or_spine() {
        let root = test_root();
        fs::create_dir_all(&root).expect("root should be created");
        let epub_path = root.join("book.epub");
        let image_path = root.join("replacement.png");
        write_image(&image_path, 900, 1200);
        let navigation = br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><ol><li><a epub:type="cover" href="cover.xhtml#cover">Cover</a></li></ol></nav></body></html>"#;
        let cover_page = br#"<html><body><img id="cover" src="images/cover.jpg"/></body></html>"#;
        write_epub(
            &epub_path,
            r#"<package version="3.2"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Title</dc:title></metadata><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-resource" href="images/cover.jpg" media-type="image/jpeg"/><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover-page"/><itemref idref="chapter"/></spine></package>"#,
            &[
                ("OEBPS/nav.xhtml", navigation),
                ("OEBPS/cover.xhtml", cover_page),
                ("OEBPS/images/cover.jpg", b"old-cover"),
                ("OEBPS/chapter.xhtml", b"chapter"),
            ],
        );
        let (image_size, image_modified_at) = fingerprint(&image_path);
        let (epub_size, epub_modified_at) = fingerprint(&epub_path);

        write_cover_at(
            &root,
            EpubCoverWritebackInput {
                relative_path: "book.epub".to_string(),
                book_id: "book-landmark".to_string(),
                image_path: image_path.to_string_lossy().into_owned(),
                framing: EpubCoverFraming::Crop,
                expected_image_size: image_size,
                expected_image_modified_at: image_modified_at,
                expected_epub_size: epub_size,
                expected_epub_modified_at: epub_modified_at,
                keep_successful_backup: false,
            },
        )
        .expect("landmark-only cover should write");

        let file = fs::File::open(&epub_path).expect("EPUB should open");
        let mut archive = zip::ZipArchive::new(file).expect("EPUB should parse");
        let names = (0..archive.len())
            .map(|index| {
                archive
                    .by_index(index)
                    .expect("entry should read")
                    .name()
                    .to_string()
            })
            .collect::<Vec<_>>();
        assert_eq!(
            names
                .iter()
                .filter(|name| name.as_str() == "OEBPS/images/cover.jpg")
                .count(),
            1
        );
        assert!(!names.iter().any(|name| name.contains("archeion-cover")));

        let package = super::epub_metadata::read_package_document(&mut archive)
            .expect("package should be readable");
        assert!(package.xml.contains(
            "id=\"cover-resource\" href=\"images/cover.jpg\" media-type=\"image/jpeg\" properties=\"cover-image\""
        ));
        assert_eq!(package.xml.matches("<item ").count(), 4);
        assert_eq!(package.xml.matches("<itemref").count(), 2);
        let cover_position = package
            .xml
            .find("idref=\"cover-page\"")
            .expect("cover itemref should remain");
        let chapter_position = package
            .xml
            .find("idref=\"chapter\"")
            .expect("chapter itemref should remain");
        assert!(cover_position < chapter_position);

        let mut navigation_after = Vec::new();
        archive
            .by_name("OEBPS/nav.xhtml")
            .expect("navigation should remain")
            .read_to_end(&mut navigation_after)
            .expect("navigation should read");
        assert_eq!(navigation_after, navigation);

        let mut cover_page_after = Vec::new();
        archive
            .by_name("OEBPS/cover.xhtml")
            .expect("cover page should remain")
            .read_to_end(&mut cover_page_after)
            .expect("cover page should read");
        assert_eq!(cover_page_after, cover_page);
        fs::remove_dir_all(root).expect("root should be removed");
    }

    #[test]
    fn landmark_dependency_analysis_failure_leaves_epub_byte_for_byte_unchanged() {
        let root = test_root();
        fs::create_dir_all(&root).expect("root should be created");
        let epub_path = root.join("book.epub");
        let image_path = root.join("replacement.png");
        write_image(&image_path, 600, 900);
        write_epub(
            &epub_path,
            r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-style" href="cover.css" media-type="text/css"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine></package>"#,
            &[
                (
                    "OEBPS/nav.xhtml",
                    br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#,
                ),
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><head><link rel="stylesheet" href="cover.css"/></head><body><img src="cover.jpg"/></body></html>"#,
                ),
                (
                    "OEBPS/cover.css",
                    b"body { background-image: url('cover.jpg'); }",
                ),
                ("OEBPS/cover.jpg", b"old-cover"),
            ],
        );
        let original = fs::read(&epub_path).expect("original EPUB should read");
        let (image_size, image_modified_at) = fingerprint(&image_path);
        let (epub_size, epub_modified_at) = fingerprint(&epub_path);

        let error = write_cover_at(
            &root,
            EpubCoverWritebackInput {
                relative_path: "book.epub".to_string(),
                book_id: "book-landmark-unsafe".to_string(),
                image_path: image_path.to_string_lossy().into_owned(),
                framing: EpubCoverFraming::Crop,
                expected_image_size: image_size,
                expected_image_modified_at: image_modified_at,
                expected_epub_size: epub_size,
                expected_epub_modified_at: epub_modified_at,
                keep_successful_backup: false,
            },
        )
        .expect_err("unsafe stylesheet should fail before mutation");

        assert!(error.contains("image resource dependency"), "{error}");
        assert_eq!(fs::read(&epub_path).expect("EPUB should remain"), original);
        fs::remove_dir_all(root).expect("root should be removed");
    }

    #[test]
    fn writes_cover_into_existing_epub_two_resource_and_preserves_cover_page() {
        let root = test_root();
        fs::create_dir_all(&root).expect("root should be created");
        let epub_path = root.join("book.epub");
        let image_path = root.join("replacement.png");
        write_image(&image_path, 900, 1200);
        write_epub(
            &epub_path,
            r#"<package version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Title</dc:title><meta name="cover" content="cover-image"/></metadata><manifest><item id="cover-image" href="images/cover.jpg" media-type="image/jpeg"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover-page"/></spine><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#,
            &[
                ("OEBPS/images/cover.jpg", b"old-cover"),
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><body><img src="images/cover.jpg"/></body></html>"#,
                ),
            ],
        );
        let (image_size, image_modified_at) = fingerprint(&image_path);
        let (epub_size, epub_modified_at) = fingerprint(&epub_path);
        let result = write_cover_at(
            &root,
            EpubCoverWritebackInput {
                relative_path: "book.epub".to_string(),
                book_id: "book-1".to_string(),
                image_path: image_path.to_string_lossy().into_owned(),
                framing: EpubCoverFraming::Crop,
                expected_image_size: image_size,
                expected_image_modified_at: image_modified_at,
                expected_epub_size: epub_size,
                expected_epub_modified_at: epub_modified_at,
                keep_successful_backup: false,
            },
        )
        .expect("cover should write");

        assert!(result.cover_cache_warning.is_none());
        validate_rewritten_cover(&epub_path).expect("rewritten EPUB should validate");
        let file = fs::File::open(&epub_path).expect("EPUB should open");
        let mut archive = zip::ZipArchive::new(file).expect("EPUB should parse");
        let package = super::epub_metadata::read_package_document(&mut archive)
            .expect("package should be readable");
        assert!(package.xml.contains("href=\"images/cover.jpg\""));
        assert!(package.xml.contains("media-type=\"image/jpeg\""));
        let mut cover_page = String::new();
        archive
            .by_name("OEBPS/cover.xhtml")
            .expect("cover page should remain")
            .read_to_string(&mut cover_page)
            .expect("cover page should read");
        assert!(cover_page.contains("images/cover.jpg"));
        let mut cover_bytes = Vec::new();
        archive
            .by_name("OEBPS/images/cover.jpg")
            .expect("cover resource should remain")
            .read_to_end(&mut cover_bytes)
            .expect("cover resource should read");
        assert_eq!(
            image::guess_format(&cover_bytes).expect("cover format should be detectable"),
            image::ImageFormat::Jpeg,
        );
        fs::remove_dir_all(root).expect("root should be removed");
    }

    #[test]
    fn writes_guide_only_cover_into_existing_resource_without_duplicate_cover_entries() {
        let root = test_root();
        fs::create_dir_all(&root).expect("root should be created");
        let epub_path = root.join("book.epub");
        let image_path = root.join("replacement.png");
        write_image(&image_path, 900, 1200);
        write_epub(
            &epub_path,
            r#"<package version="2.0"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Title</dc:title></metadata><manifest><item id="cover-page" href="Text/cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-image" href="Images/cover.jpg" media-type="image/jpeg"/><item id="chapter" href="Text/chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="cover-page"/><itemref idref="chapter"/></spine><guide><reference type="cover" href="Text/cover.xhtml"/></guide></package>"#,
            &[
                (
                    "OEBPS/Text/cover.xhtml",
                    br#"<html><body><img src="../Images/cover.jpg"/></body></html>"#,
                ),
                ("OEBPS/Images/cover.jpg", b"old-cover"),
                ("OEBPS/Text/chapter.xhtml", b"chapter"),
            ],
        );
        let (image_size, image_modified_at) = fingerprint(&image_path);
        let (epub_size, epub_modified_at) = fingerprint(&epub_path);

        write_cover_at(
            &root,
            EpubCoverWritebackInput {
                relative_path: "book.epub".to_string(),
                book_id: "book-guide-only".to_string(),
                image_path: image_path.to_string_lossy().into_owned(),
                framing: EpubCoverFraming::Crop,
                expected_image_size: image_size,
                expected_image_modified_at: image_modified_at,
                expected_epub_size: epub_size,
                expected_epub_modified_at: epub_modified_at,
                keep_successful_backup: false,
            },
        )
        .expect("guide-only cover should write");

        let file = fs::File::open(&epub_path).expect("EPUB should open");
        let mut archive = zip::ZipArchive::new(file).expect("EPUB should parse");
        let names = (0..archive.len())
            .map(|index| {
                archive
                    .by_index(index)
                    .expect("entry should read")
                    .name()
                    .to_string()
            })
            .collect::<Vec<_>>();
        assert_eq!(
            names
                .iter()
                .filter(|name| name.as_str() == "OEBPS/Images/cover.jpg")
                .count(),
            1
        );
        assert!(!names.iter().any(|name| name.contains("archeion-cover")));

        let package = super::epub_metadata::read_package_document(&mut archive)
            .expect("package should be readable");
        assert!(package
            .xml
            .contains("<meta name=\"cover\" content=\"cover-image\"/>"));
        assert!(package.xml.contains("href=\"Text/cover.xhtml\""));
        assert_eq!(package.xml.matches("<itemref").count(), 2);
        assert_eq!(package.xml.matches("name=\"cover\"").count(), 1);

        let mut cover_page = String::new();
        archive
            .by_name("OEBPS/Text/cover.xhtml")
            .expect("cover page should remain")
            .read_to_string(&mut cover_page)
            .expect("cover page should read");
        assert!(cover_page.contains("../Images/cover.jpg"));

        let mut cover_bytes = Vec::new();
        archive
            .by_name("OEBPS/Images/cover.jpg")
            .expect("cover image should remain")
            .read_to_end(&mut cover_bytes)
            .expect("cover image should read");
        assert_eq!(
            image::guess_format(&cover_bytes).expect("cover format should be detectable"),
            image::ImageFormat::Jpeg,
        );
        fs::remove_dir_all(root).expect("root should be removed");
    }

    #[test]
    fn conflicting_cover_declarations_do_not_mutate_original_epub() {
        let root = test_root();
        fs::create_dir_all(&root).expect("root should be created");
        let epub_path = root.join("book.epub");
        let image_path = root.join("replacement.png");
        write_image(&image_path, 600, 900);
        write_epub(
            &epub_path,
            r#"<package version="2.0"><metadata><meta name="cover" content="declared"/></metadata><manifest><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="declared" href="declared.jpg" media-type="image/jpeg"/><item id="visible" href="visible.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine><guide><reference type="cover" href="cover.xhtml"/></guide></package>"#,
            &[
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><body><img src="visible.jpg"/></body></html>"#,
                ),
                ("OEBPS/declared.jpg", b"declared"),
                ("OEBPS/visible.jpg", b"visible"),
            ],
        );
        let original = fs::read(&epub_path).expect("original EPUB should read");
        let (image_size, image_modified_at) = fingerprint(&image_path);
        let (epub_size, epub_modified_at) = fingerprint(&epub_path);

        let error = write_cover_at(
            &root,
            EpubCoverWritebackInput {
                relative_path: "book.epub".to_string(),
                book_id: "book-conflict".to_string(),
                image_path: image_path.to_string_lossy().into_owned(),
                framing: EpubCoverFraming::Crop,
                expected_image_size: image_size,
                expected_image_modified_at: image_modified_at,
                expected_epub_size: epub_size,
                expected_epub_modified_at: epub_modified_at,
                keep_successful_backup: false,
            },
        )
        .expect_err("conflicting declarations should fail");

        assert!(
            error.contains("point to different image resources"),
            "{error}"
        );
        assert_eq!(fs::read(&epub_path).expect("EPUB should remain"), original);
        fs::remove_dir_all(root).expect("root should be removed");
    }

    #[test]
    fn rejects_when_selected_image_changes_after_preview() {
        let root = test_root();
        fs::create_dir_all(&root).expect("root should be created");
        let epub_path = root.join("book.epub");
        let image_path = root.join("replacement.png");
        write_image(&image_path, 600, 900);
        write_epub(
            &epub_path,
            r#"<package version="3.0"><metadata><dc:title xmlns:dc="http://purl.org/dc/elements/1.1/">Title</dc:title></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine/></package>"#,
            &[("OEBPS/chapter.xhtml", b"chapter")],
        );
        let (image_size, image_modified_at) = fingerprint(&image_path);
        let (epub_size, epub_modified_at) = fingerprint(&epub_path);
        write_image(&image_path, 700, 1050);

        let error = write_cover_at(
            &root,
            EpubCoverWritebackInput {
                relative_path: "book.epub".to_string(),
                book_id: "book-1".to_string(),
                image_path: image_path.to_string_lossy().into_owned(),
                framing: EpubCoverFraming::Crop,
                expected_image_size: image_size,
                expected_image_modified_at: image_modified_at,
                expected_epub_size: epub_size,
                expected_epub_modified_at: epub_modified_at,
                keep_successful_backup: false,
            },
        )
        .expect_err("stale image preview should fail");

        assert!(error.contains("selected cover image changed after the preview"));
        fs::remove_dir_all(root).expect("root should be removed");
    }

    #[test]
    fn rejects_when_epub_changes_after_preview() {
        let root = test_root();
        fs::create_dir_all(&root).expect("root should be created");
        let epub_path = root.join("book.epub");
        let image_path = root.join("replacement.png");
        write_image(&image_path, 600, 900);
        write_epub(
            &epub_path,
            r#"<package version="3.0"><metadata/><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine/></package>"#,
            &[("OEBPS/chapter.xhtml", b"chapter")],
        );
        let (image_size, image_modified_at) = fingerprint(&image_path);
        let (epub_size, epub_modified_at) = fingerprint(&epub_path);
        fs::OpenOptions::new()
            .append(true)
            .open(&epub_path)
            .expect("EPUB should open")
            .write_all(b"changed")
            .expect("EPUB should change");

        let error = write_cover_at(
            &root,
            EpubCoverWritebackInput {
                relative_path: "book.epub".to_string(),
                book_id: "book-1".to_string(),
                image_path: image_path.to_string_lossy().into_owned(),
                framing: EpubCoverFraming::Fit,
                expected_image_size: image_size,
                expected_image_modified_at: image_modified_at,
                expected_epub_size: epub_size,
                expected_epub_modified_at: epub_modified_at,
                keep_successful_backup: false,
            },
        )
        .expect_err("stale preview should fail");

        assert!(error.contains("EPUB file changed after the preview"));
        fs::remove_dir_all(root).expect("root should be removed");
    }

    #[test]
    fn cover_final_replacement_failure_restores_original_without_publishing_cache_state() {
        SCANNER_CACHE_PUBLISHED.store(false, Ordering::SeqCst);
        let root = test_root();
        fs::create_dir_all(root.join(".archeion/covers")).expect("cache folder should be created");
        let epub_path = root.join("book.epub");
        let temporary_path = root.join("book.epub.cover-writeback.tmp");
        let cache_path = root.join(".archeion/covers/book-1.jpg");
        fs::write(&epub_path, b"original-epub").expect("original EPUB should be written");
        fs::write(&temporary_path, b"replacement-epub")
            .expect("replacement EPUB should be written");
        fs::write(&cache_path, b"existing-cache").expect("cache sentinel should be written");

        let error = super::epub_writeback::commit_epub_rewrite_at_with_test_ops(
            &root,
            "book.epub",
            &epub_path,
            &temporary_path,
            metadata_fixture(),
            "cover",
            failing_replace,
            restore_backup,
            record_scanner_cache_publish,
        )
        .expect_err("final replacement should fail");

        assert!(error.contains("EPUB cover write failed"), "{error}");
        assert!(error.contains("backup was restored"), "{error}");
        assert_eq!(
            fs::read(&epub_path).expect("original EPUB should be restored"),
            b"original-epub"
        );
        assert!(!temporary_path.exists());
        assert_eq!(
            fs::read(&cache_path).expect("cache sentinel should remain"),
            b"existing-cache"
        );
        assert!(!SCANNER_CACHE_PUBLISHED.load(Ordering::SeqCst));
        fs::remove_dir_all(root).expect("root should be removed");
    }

    #[test]
    fn cover_restore_failure_keeps_recovery_backup_and_reports_its_location() {
        SCANNER_CACHE_PUBLISHED.store(false, Ordering::SeqCst);
        let root = test_root();
        fs::create_dir_all(root.join(".archeion/covers")).expect("cache folder should be created");
        let epub_path = root.join("book.epub");
        let temporary_path = root.join("book.epub.cover-writeback.tmp");
        let cache_path = root.join(".archeion/covers/book-1.jpg");
        fs::write(&epub_path, b"original-epub").expect("original EPUB should be written");
        fs::write(&temporary_path, b"replacement-epub")
            .expect("replacement EPUB should be written");
        fs::write(&cache_path, b"existing-cache").expect("cache sentinel should be written");

        let error = super::epub_writeback::commit_epub_rewrite_at_with_test_ops(
            &root,
            "book.epub",
            &epub_path,
            &temporary_path,
            metadata_fixture(),
            "cover",
            failing_replace,
            failing_restore,
            record_scanner_cache_publish,
        )
        .expect_err("restore should fail");

        assert!(error.contains("EPUB cover write failed"), "{error}");
        assert!(error.contains("automatic restore failed"), "{error}");
        assert!(error.contains("Backup is available at"), "{error}");
        let backup_dir = root.join(".archeion/backups");
        let backups = fs::read_dir(&backup_dir)
            .expect("backup directory should remain")
            .map(|entry| entry.expect("backup entry should read").path())
            .collect::<Vec<_>>();
        assert_eq!(backups.len(), 1);
        assert_eq!(
            fs::read(&backups[0]).expect("recovery backup should remain"),
            b"original-epub"
        );
        assert!(!epub_path.exists());
        assert!(!temporary_path.exists());
        assert_eq!(
            fs::read(&cache_path).expect("cache sentinel should remain"),
            b"existing-cache"
        );
        assert!(!SCANNER_CACHE_PUBLISHED.load(Ordering::SeqCst));
        fs::remove_dir_all(root).expect("root should be removed");
    }

    #[test]
    fn navigation_and_cover_documents_reject_base_url_overrides() {
        let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="Text/cover.xhtml" media-type="application/xhtml+xml"/><item id="text-cover" href="Text/cover.jpg" media-type="image/jpeg"/><item id="images-cover" href="Images/cover.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine></package>"#;
        let safe_navigation = br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="Text/cover.xhtml">Cover</a></nav></body></html>"#;
        let safe_cover = br#"<html><body><img src="cover.jpg"/></body></html>"#;

        for (label, navigation, cover_page) in [
            (
                "navigation base element",
                br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><head><base href="Text/"/></head><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#.as_slice(),
                safe_cover.as_slice(),
            ),
            (
                "navigation empty base element",
                br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><head><base/></head><body><nav epub:type="landmarks"><a epub:type="cover" href="Text/cover.xhtml">Cover</a></nav></body></html>"#.as_slice(),
                safe_cover.as_slice(),
            ),
            (
                "navigation root xml base",
                br#"<html xmlns:epub="http://www.idpf.org/2007/ops" xml:base="Text/"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#.as_slice(),
                safe_cover.as_slice(),
            ),
            (
                "landmarks xml base",
                br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks" xml:base="Text/"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#.as_slice(),
                safe_cover.as_slice(),
            ),
            (
                "cover base element",
                safe_navigation.as_slice(),
                br#"<html><head><base href="../Images/"/></head><body><img src="cover.jpg"/></body></html>"#.as_slice(),
            ),
            (
                "cover root xml base",
                safe_navigation.as_slice(),
                br#"<html xml:base="../Images/"><body><img src="cover.jpg"/></body></html>"#.as_slice(),
            ),
            (
                "cover image xml base",
                safe_navigation.as_slice(),
                br#"<html><body><img xml:base="../Images/" src="cover.jpg"/></body></html>"#.as_slice(),
            ),
        ] {
            let error = plan_package(
                package,
                CoverImageFormat::Png,
                &[
                    ("OEBPS/nav.xhtml", navigation),
                    ("OEBPS/Text/cover.xhtml", cover_page),
                    ("OEBPS/Text/cover.jpg", b"text-cover"),
                    ("OEBPS/Images/cover.jpg", b"images-cover"),
                ],
            )
            .expect_err(label);
            assert!(
                error.contains("document-relative resources cannot be resolved safely"),
                "{label}: {error}"
            );
        }
    }

    #[test]
    fn cover_css_rejects_all_resource_indirection_but_allows_harmless_rules() {
        let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-style" href="cover.css" media-type="text/css"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;
        let navigation = br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#;
        let linked_page = br#"<html><head><link rel="stylesheet" href="cover.css"/></head><body><img src="cover.jpg"/></body></html>"#;

        for (label, css) in [
            (
                "content URL",
                b"img { content: url('actual-cover.jpg'); }".as_slice(),
            ),
            (
                "custom property URL",
                b".cover { --cover-image: url('actual-cover.jpg'); }".as_slice(),
            ),
            (
                "mask image URL",
                b".cover { mask-image: url('mask.png'); }".as_slice(),
            ),
            (
                "border image URL",
                b".cover { border-image-source: url('frame.png'); }".as_slice(),
            ),
            (
                "image set",
                b".cover { background-image: image-set('cover.png' 1x); }".as_slice(),
            ),
            (
                "cross fade",
                b".cover { background-image: cross-fade(cover.png, other.png, 50%); }".as_slice(),
            ),
            (
                "element function",
                b".cover { content: element(#cover); }".as_slice(),
            ),
            (
                "image function",
                b".cover { background: image('cover.png'); }".as_slice(),
            ),
        ] {
            let error = plan_package(
                package,
                CoverImageFormat::Png,
                &[
                    ("OEBPS/nav.xhtml", navigation),
                    ("OEBPS/cover.xhtml", linked_page),
                    ("OEBPS/cover.css", css),
                    ("OEBPS/cover.jpg", b"cover"),
                ],
            )
            .expect_err(label);
            assert!(
                error.contains("image resource dependency"),
                "{label}: {error}"
            );
        }

        plan_package(
            package,
            CoverImageFormat::Png,
            &[
                ("OEBPS/nav.xhtml", navigation),
                ("OEBPS/cover.xhtml", linked_page),
                (
                    "OEBPS/cover.css",
                    b"html, body { margin: 0; } img { display: block; width: 100%; }",
                ),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect("harmless stylesheet should remain supported");
    }

    #[test]
    fn inline_cover_css_resource_indirection_fails_safely() {
        let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;
        let navigation = br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#;

        for (label, page) in [
            (
                "style element URL",
                br#"<html><head><style>img { content: url('actual-cover.jpg'); }</style></head><body><img src="cover.jpg"/></body></html>"#.as_slice(),
            ),
            (
                "style attribute URL",
                br#"<html><body><img src="cover.jpg" style="mask-image: url('mask.png')"/></body></html>"#.as_slice(),
            ),
            (
                "style attribute image set",
                br#"<html><body><img src="cover.jpg" style="content: image-set('cover.png' 1x)"/></body></html>"#.as_slice(),
            ),
        ] {
            let error = plan_package(
                package,
                CoverImageFormat::Png,
                &[
                    ("OEBPS/nav.xhtml", navigation),
                    ("OEBPS/cover.xhtml", page),
                    ("OEBPS/cover.jpg", b"cover"),
                ],
            )
            .expect_err(label);
            assert!(error.contains("image resource dependency"), "{label}: {error}");
        }
    }

    #[test]
    fn cover_page_event_handler_attributes_fail_case_insensitively() {
        let package = r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/><item id="cover-resource" href="cover.jpg" media-type="image/jpeg"/></manifest><spine/></package>"#;
        let navigation = br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="cover.xhtml">Cover</a></nav></body></html>"#;

        for (label, page) in [
            (
                "image onload",
                br#"<html><body><img src="cover.jpg" onload="this.src='actual.jpg'"/></body></html>"#.as_slice(),
            ),
            (
                "image onerror",
                br#"<html><body><img src="cover.jpg" onerror="this.src='actual.jpg'"/></body></html>"#.as_slice(),
            ),
            (
                "parent onload",
                br#"<html><body onload="replaceCover()"><img src="cover.jpg"/></body></html>"#.as_slice(),
            ),
            (
                "mixed case handler",
                br#"<html><body><img src="cover.jpg" OnMouseOver="replaceCover()"/></body></html>"#.as_slice(),
            ),
        ] {
            let error = plan_package(
                package,
                CoverImageFormat::Png,
                &[
                    ("OEBPS/nav.xhtml", navigation),
                    ("OEBPS/cover.xhtml", page),
                    ("OEBPS/cover.jpg", b"cover"),
                ],
            )
            .expect_err(label);
            assert!(error.contains("event-handler attribute"), "{label}: {error}");
        }

        plan_package(
            package,
            CoverImageFormat::Png,
            &[
                ("OEBPS/nav.xhtml", navigation),
                (
                    "OEBPS/cover.xhtml",
                    br#"<html><body><img src="cover.jpg" alt="Cover"/></body></html>"#,
                ),
                ("OEBPS/cover.jpg", b"cover"),
            ],
        )
        .expect("normal attributes should remain supported");
    }

    #[test]
    fn deterministic_resolution_failure_leaves_original_epub_unchanged() {
        let root = test_root();
        fs::create_dir_all(&root).expect("root should be created");
        let epub_path = root.join("book.epub");
        let image_path = root.join("replacement.png");
        write_image(&image_path, 600, 900);
        write_epub(
            &epub_path,
            r#"<package version="3.2"><metadata/><manifest><item id="navigation" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="cover-page" href="Text/cover.xhtml" media-type="application/xhtml+xml"/><item id="text-cover" href="Text/cover.jpg" media-type="image/jpeg"/><item id="images-cover" href="Images/cover.jpg" media-type="image/jpeg"/></manifest><spine><itemref idref="cover-page"/></spine></package>"#,
            &[
                (
                    "OEBPS/nav.xhtml",
                    br#"<html xmlns:epub="http://www.idpf.org/2007/ops"><body><nav epub:type="landmarks"><a epub:type="cover" href="Text/cover.xhtml">Cover</a></nav></body></html>"#,
                ),
                (
                    "OEBPS/Text/cover.xhtml",
                    br#"<html><head><base href="../Images/"/></head><body><img src="cover.jpg"/></body></html>"#,
                ),
                ("OEBPS/Text/cover.jpg", b"text-cover"),
                ("OEBPS/Images/cover.jpg", b"images-cover"),
            ],
        );
        let original = fs::read(&epub_path).expect("original EPUB should read");
        let (image_size, image_modified_at) = fingerprint(&image_path);
        let (epub_size, epub_modified_at) = fingerprint(&epub_path);

        let error = write_cover_at(
            &root,
            EpubCoverWritebackInput {
                relative_path: "book.epub".to_string(),
                book_id: "book-base-unsafe".to_string(),
                image_path: image_path.to_string_lossy().into_owned(),
                framing: EpubCoverFraming::Crop,
                expected_image_size: image_size,
                expected_image_modified_at: image_modified_at,
                expected_epub_size: epub_size,
                expected_epub_modified_at: epub_modified_at,
                keep_successful_backup: false,
            },
        )
        .expect_err("base override should fail before mutation");

        assert!(
            error.contains("document-relative resources cannot be resolved safely"),
            "{error}"
        );
        assert_eq!(fs::read(&epub_path).expect("EPUB should remain"), original);
        fs::remove_dir_all(root).expect("root should be removed");
    }

    #[test]
    fn reads_package_and_plan_for_existing_epub_three_cover() {
        let root = test_root();
        fs::create_dir_all(&root).expect("root should be created");
        let epub_path = root.join("book.epub");
        write_epub(
            &epub_path,
            r#"<package version="3.2"><metadata/><manifest><item id="cover" href="cover.png" media-type="image/png" properties="cover-image"/></manifest><spine/></package>"#,
            &[("OEBPS/cover.png", b"image")],
        );

        let (_, plan) =
            read_package_and_plan(&epub_path, CoverImageFormat::Jpeg).expect("plan should load");
        assert_eq!(plan.cover_item_id, "cover");
        assert_eq!(plan.existing_media_type.as_deref(), Some("image/png"));
        fs::remove_dir_all(root).expect("root should be removed");
    }
}
