use std::{fs, io::Cursor, path::Path};

use ::image::{
    imageops::{crop_imm, overlay, resize, FilterType},
    DynamicImage, GenericImageView, ImageFormat, ImageReader, Limits, Rgba, RgbaImage,
};

use super::{
    fingerprint::{file_fingerprint, FileFingerprint},
    types::{CoverImageFormat, EpubCoverFraming},
};

pub(super) const MAX_SOURCE_FILE_BYTES: u64 = 32 * 1024 * 1024;
const MAX_SOURCE_DIMENSION: u32 = 12_000;
const MAX_SOURCE_PIXELS: u64 = 80_000_000;
const MIN_SOURCE_DIMENSION: u32 = 64;
const MAX_OUTPUT_WIDTH: u32 = 1_200;
const MAX_OUTPUT_HEIGHT: u32 = 1_800;
const PREVIEW_WIDTH: u32 = 360;
const PREVIEW_HEIGHT: u32 = 540;

#[derive(Clone, Debug)]
pub(super) struct DecodedCoverImage {
    pub(super) image: DynamicImage,
    pub(super) format: CoverImageFormat,
    pub(super) fingerprint: FileFingerprint,
    pub(super) file_name: String,
}

#[derive(Clone, Debug)]
pub(super) struct ProcessedCoverImage {
    pub(super) image: DynamicImage,
    pub(super) format: CoverImageFormat,
    pub(super) bytes: Vec<u8>,
}

pub(super) fn decode_cover_image(path: &Path) -> Result<DecodedCoverImage, String> {
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

pub(super) fn process_cover_image(
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

pub(super) fn preview_bytes(image: &DynamicImage) -> Result<Vec<u8>, String> {
    let preview = image.thumbnail(PREVIEW_WIDTH, PREVIEW_HEIGHT);
    let mut output = Cursor::new(Vec::new());
    preview
        .write_to(&mut output, ImageFormat::Png)
        .map_err(|error| error.to_string())?;
    Ok(output.into_inner())
}
