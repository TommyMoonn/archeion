use std::path::Path;

use ::image::ImageFormat;
use serde::{Deserialize, Serialize};

use crate::commands::{epub_metadata, epub_writeback};

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum EpubCoverFraming {
    Crop,
    Fit,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubCoverPreparationInput {
    pub(super) relative_path: String,
    pub(super) image_path: String,
    pub(super) framing: EpubCoverFraming,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubCoverPreparation {
    pub(super) file_name: String,
    pub(super) source_format: String,
    pub(super) output_format: String,
    pub(super) source_width: u32,
    pub(super) source_height: u32,
    pub(super) output_width: u32,
    pub(super) output_height: u32,
    pub(super) image_size: u64,
    pub(super) image_modified_at: u64,
    pub(super) epub_size: u64,
    pub(super) epub_modified_at: u64,
    pub(super) replacing_existing_cover: bool,
    pub(super) preview_mime_type: String,
    pub(super) preview_bytes: Vec<u8>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubCoverWritebackInput {
    pub(super) relative_path: String,
    pub(super) book_id: String,
    pub(super) image_path: String,
    pub(super) framing: EpubCoverFraming,
    pub(super) expected_image_size: u64,
    pub(super) expected_image_modified_at: u64,
    pub(super) expected_epub_size: u64,
    pub(super) expected_epub_modified_at: u64,
    #[serde(default)]
    pub(super) keep_successful_backup: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EpubCoverWritebackResult {
    #[serde(flatten)]
    pub(super) writeback: epub_writeback::EpubMetadataWritebackResult,
    pub(super) cover_cache_warning: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum CoverImageFormat {
    Jpeg,
    Png,
    WebP,
}

impl CoverImageFormat {
    pub(super) fn from_image_format(format: ImageFormat) -> Option<Self> {
        match format {
            ImageFormat::Jpeg => Some(Self::Jpeg),
            ImageFormat::Png => Some(Self::Png),
            ImageFormat::WebP => Some(Self::WebP),
            _ => None,
        }
    }

    pub(super) fn from_media_type(media_type: &str) -> Option<Self> {
        match media_type.trim().to_ascii_lowercase().as_str() {
            "image/jpeg" | "image/jpg" => Some(Self::Jpeg),
            "image/png" => Some(Self::Png),
            "image/webp" => Some(Self::WebP),
            _ => None,
        }
    }

    pub(super) fn media_type(self) -> &'static str {
        match self {
            Self::Jpeg => "image/jpeg",
            Self::Png => "image/png",
            Self::WebP => "image/webp",
        }
    }

    pub(super) fn extension(self) -> &'static str {
        match self {
            Self::Jpeg => "jpg",
            Self::Png => "png",
            Self::WebP => "webp",
        }
    }

    pub(super) fn label(self) -> &'static str {
        match self {
            Self::Jpeg => "JPEG",
            Self::Png => "PNG",
            Self::WebP => "WebP",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) struct EpubPackageVersion {
    pub(super) major: u8,
    pub(super) minor: u8,
}

impl EpubPackageVersion {
    pub(super) fn parse(value: &str) -> Result<Self, String> {
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

    pub(super) fn is_epub_two(self) -> bool {
        self.major == 2
    }

    pub(super) fn is_epub_three(self) -> bool {
        self.major == 3
    }

    pub(super) fn supports_webp(self) -> bool {
        self.major == 3 && self.minor >= 3
    }
}

pub(super) fn href_extension_matches_format(href: &str, format: CoverImageFormat) -> bool {
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

pub(super) fn output_format_for_package(
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
