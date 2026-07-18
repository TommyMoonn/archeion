use std::io::{Cursor, Read};

use image::{error::LimitErrorKind, ImageError, ImageFormat, ImageReader, Limits};

pub(super) const MAX_COVER_RESOURCE_BYTES: u64 = 20 * 1024 * 1024;
const MAX_COVER_DIMENSION: u32 = 12_000;
const MAX_COVER_PIXELS: u64 = 80_000_000;
const MAX_COVER_DECODE_ALLOC: u64 = 128 * 1024 * 1024;
const COVER_READ_BUFFER_BYTES: usize = 16 * 1024;

pub(super) struct CoverResource {
    bytes: Vec<u8>,
}

#[derive(Debug, Eq, PartialEq)]
pub(super) enum CoverByteReadError {
    TooLarge,
    Allocation,
    Read,
}

impl CoverByteReadError {
    fn message(&self) -> String {
        match self {
            Self::TooLarge => resource_too_large_error(),
            Self::Allocation => "The EPUB cover could not be buffered safely.".to_string(),
            Self::Read => "The EPUB cover could not be read.".to_string(),
        }
    }
}

impl CoverResource {
    pub(super) fn is_empty(&self) -> bool {
        self.bytes.is_empty()
    }

    pub(super) fn into_ipc_bytes(self) -> Result<Vec<u8>, String> {
        let Self { bytes } = self;
        match thumbnail_cover(&bytes)? {
            Some(thumbnail) => {
                drop(bytes);
                validate_resource_size(thumbnail.len() as u64).map_err(|error| error.message())?;
                Ok(thumbnail)
            }
            None => Ok(bytes),
        }
    }
}

fn resource_too_large_error() -> String {
    "The EPUB cover exceeds the 20 MiB resource limit.".to_string()
}

fn image_too_large_error() -> String {
    "The EPUB cover width or height exceeds the supported 12,000 pixel limit.".to_string()
}

fn image_pixel_limit_error() -> String {
    "The EPUB cover exceeds the supported 80,000,000 pixel limit.".to_string()
}

fn validate_resource_size(size: u64) -> Result<(), CoverByteReadError> {
    if size > MAX_COVER_RESOURCE_BYTES {
        return Err(CoverByteReadError::TooLarge);
    }
    Ok(())
}

fn reserve_for_read(bytes: &mut Vec<u8>, additional: usize) -> Result<(), CoverByteReadError> {
    let required = bytes
        .len()
        .checked_add(additional)
        .ok_or(CoverByteReadError::TooLarge)?;
    validate_resource_size(required as u64)?;
    if required <= bytes.capacity() {
        return Ok(());
    }

    let maximum = MAX_COVER_RESOURCE_BYTES as usize;
    let next_capacity = bytes
        .capacity()
        .max(COVER_READ_BUFFER_BYTES)
        .saturating_mul(2)
        .max(required)
        .min(maximum);
    bytes
        .try_reserve_exact(next_capacity - bytes.len())
        .map_err(|_| CoverByteReadError::Allocation)
}

pub(super) fn read_bounded_cover_bytes<R: Read>(
    reader: &mut R,
    declared_size: u64,
) -> Result<Vec<u8>, CoverByteReadError> {
    validate_resource_size(declared_size)?;

    let capacity = usize::try_from(declared_size).map_err(|_| CoverByteReadError::TooLarge)?;
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(capacity)
        .map_err(|_| CoverByteReadError::Allocation)?;

    let mut buffer = [0_u8; COVER_READ_BUFFER_BYTES];
    loop {
        let remaining = MAX_COVER_RESOURCE_BYTES - bytes.len() as u64;
        if remaining == 0 {
            let mut extra = [0_u8; 1];
            if reader
                .read(&mut extra)
                .map_err(|_| CoverByteReadError::Read)?
                != 0
            {
                return Err(CoverByteReadError::TooLarge);
            }
            break;
        }

        let read_length = remaining.min(buffer.len() as u64) as usize;
        let read = reader
            .read(&mut buffer[..read_length])
            .map_err(|_| CoverByteReadError::Read)?;
        if read == 0 {
            break;
        }
        reserve_for_read(&mut bytes, read)?;
        bytes.extend_from_slice(&buffer[..read]);
    }

    Ok(bytes)
}

pub(super) fn read_cover_resource<R: Read>(
    reader: &mut R,
    declared_size: u64,
) -> Result<CoverResource, String> {
    let bytes = read_bounded_cover_bytes(reader, declared_size).map_err(|error| error.message())?;
    Ok(CoverResource { bytes })
}

fn image_limits() -> Limits {
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_COVER_DIMENSION);
    limits.max_image_height = Some(MAX_COVER_DIMENSION);
    limits.max_alloc = Some(MAX_COVER_DECODE_ALLOC);
    limits
}

fn image_resource_limit_error(error: &ImageError) -> Option<String> {
    let ImageError::Limits(error) = error else {
        return None;
    };
    Some(match error.kind() {
        LimitErrorKind::DimensionError => image_too_large_error(),
        LimitErrorKind::InsufficientMemory => {
            "The decoded EPUB cover exceeds the configured 128 MiB output allocation allowance."
                .to_string()
        }
        LimitErrorKind::Unsupported { .. } => {
            "The EPUB cover format cannot be decoded while enforcing the required image safety limits."
                .to_string()
        }
        _ => "The EPUB cover exceeds the configured image resource limits.".to_string(),
    })
}

fn thumbnail_cover(bytes: &[u8]) -> Result<Option<Vec<u8>>, String> {
    let format_reader = match ImageReader::new(Cursor::new(bytes)).with_guessed_format() {
        Ok(reader) => reader,
        Err(_) => return Ok(None),
    };
    let Some(format) = format_reader.format() else {
        return Ok(None);
    };

    let mut dimension_reader = ImageReader::with_format(Cursor::new(bytes), format);
    dimension_reader.limits(image_limits());
    let (width, height) = match dimension_reader.into_dimensions() {
        Ok(dimensions) => dimensions,
        Err(error) => match image_resource_limit_error(&error) {
            Some(message) => return Err(message),
            None => return Ok(None),
        },
    };
    if u64::from(width).saturating_mul(u64::from(height)) > MAX_COVER_PIXELS {
        return Err(image_pixel_limit_error());
    }

    let mut decode_reader = ImageReader::with_format(Cursor::new(bytes), format);
    decode_reader.limits(image_limits());
    let image = match decode_reader.decode() {
        Ok(image) => image,
        Err(error) => match image_resource_limit_error(&error) {
            Some(message) => return Err(message),
            None => return Ok(None),
        },
    };
    let thumbnail = image.thumbnail(320, 480);
    drop(image);
    let mut output = Cursor::new(Vec::new());
    if thumbnail.write_to(&mut output, ImageFormat::Png).is_err() {
        return Ok(None);
    }
    Ok(Some(output.into_inner()))
}

#[cfg(test)]
mod tests {
    use std::{
        io::{Cursor, Read},
        sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        },
    };

    use super::{
        image_limits, image_resource_limit_error, read_bounded_cover_bytes, read_cover_resource,
        validate_resource_size, CoverByteReadError, CoverResource, MAX_COVER_DIMENSION,
        MAX_COVER_PIXELS, MAX_COVER_RESOURCE_BYTES,
    };

    struct CountingReader {
        reads: Arc<AtomicUsize>,
    }

    impl Read for CountingReader {
        fn read(&mut self, _buffer: &mut [u8]) -> std::io::Result<usize> {
            self.reads.fetch_add(1, Ordering::SeqCst);
            Ok(0)
        }
    }

    fn gif_with_dimensions(width: u16, height: u16) -> Vec<u8> {
        let source = image::DynamicImage::new_rgb8(1, 1);
        let mut encoded = Cursor::new(Vec::new());
        source
            .write_to(&mut encoded, image::ImageFormat::Gif)
            .expect("GIF fixture should encode");
        let mut bytes = encoded.into_inner();
        bytes[6..8].copy_from_slice(&width.to_le_bytes());
        bytes[8..10].copy_from_slice(&height.to_le_bytes());
        bytes
    }

    fn resource(bytes: Vec<u8>) -> CoverResource {
        CoverResource { bytes }
    }

    #[test]
    fn rejects_an_oversized_declaration_before_reading_or_allocating() {
        let reads = Arc::new(AtomicUsize::new(0));
        let mut reader = CountingReader {
            reads: Arc::clone(&reads),
        };

        let error = read_cover_resource(&mut reader, MAX_COVER_RESOURCE_BYTES + 1)
            .err()
            .expect("oversized cover should fail");

        assert!(error.contains("20 MiB"));
        assert_eq!(reads.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn rejects_streamed_bytes_that_exceed_an_inaccurate_declaration() {
        let mut reader = std::io::repeat(7).take(MAX_COVER_RESOURCE_BYTES + 1);

        let error = read_cover_resource(&mut reader, 1)
            .err()
            .expect("oversized stream should fail");

        assert!(error.contains("20 MiB"));
    }

    #[test]
    fn rejects_excessive_dimensions_before_full_decode() {
        let bytes = gif_with_dimensions((MAX_COVER_DIMENSION + 1) as u16, 1);

        let error = resource(bytes)
            .into_ipc_bytes()
            .expect_err("oversized dimensions should fail");

        assert!(error.contains("width or height"));
    }

    #[test]
    fn rejects_excessive_height_before_full_decode() {
        let bytes = gif_with_dimensions(1, (MAX_COVER_DIMENSION + 1) as u16);

        let error = resource(bytes)
            .into_ipc_bytes()
            .expect_err("oversized height should fail");

        assert!(error.contains("width or height"));
    }

    #[test]
    fn rejects_excessive_total_pixels_before_full_decode() {
        let width = 10_000_u16;
        let height = (MAX_COVER_PIXELS / u64::from(width) + 1) as u16;
        let bytes = gif_with_dimensions(width, height);

        let error = resource(bytes)
            .into_ipc_bytes()
            .expect_err("oversized pixel count should fail");

        assert!(error.contains("80,000,000 pixel"));
    }

    #[test]
    fn rejects_decoded_output_above_the_allocation_allowance_before_allocating_it() {
        let bytes = gif_with_dimensions(10_000, 4_000);

        let error = resource(bytes)
            .into_ipc_bytes()
            .expect_err("decoded output above 128 MiB should fail");

        assert!(error.contains("128 MiB output allocation"));
    }

    #[test]
    fn reports_when_a_decoder_cannot_enforce_required_strict_limits() {
        let error = image::ImageError::Limits(image::error::LimitError::from_kind(
            image::error::LimitErrorKind::Unsupported {
                limits: image_limits(),
                supported: image::LimitSupport::default(),
            },
        ));

        let message =
            image_resource_limit_error(&error).expect("strict-limit failure should remain fatal");

        assert!(message.contains("cannot be decoded"));
        assert!(message.contains("safety limits"));
    }

    #[test]
    fn creates_a_bounded_thumbnail_for_a_supported_cover() {
        let source = image::DynamicImage::new_rgb8(1_200, 1_800);
        let mut source_bytes = Cursor::new(Vec::new());
        source
            .write_to(&mut source_bytes, image::ImageFormat::Png)
            .expect("source image should encode");

        let thumbnail = resource(source_bytes.into_inner())
            .into_ipc_bytes()
            .expect("thumbnail should be generated");
        let decoded =
            image::load_from_memory(&thumbnail).expect("thumbnail should be a readable image");

        assert!(decoded.width() <= 320);
        assert!(decoded.height() <= 480);
    }

    #[test]
    fn safe_decode_fallback_reuses_the_original_allocation() {
        let original = vec![1, 2, 3, 4];
        let original_pointer = original.as_ptr();

        let fallback = resource(original)
            .into_ipc_bytes()
            .expect("small undecodable cover should fall back");

        assert_eq!(fallback, [1, 2, 3, 4]);
        assert_eq!(fallback.as_ptr(), original_pointer);
    }

    #[test]
    fn oversized_bytes_cannot_be_proven_safe_for_decode_fallback() {
        let error = validate_resource_size(MAX_COVER_RESOURCE_BYTES + 1)
            .expect_err("oversized fallback should be rejected");

        assert_eq!(error, CoverByteReadError::TooLarge);
    }

    #[test]
    fn shared_bounded_reader_rejects_a_stream_larger_than_its_declared_size() {
        let mut reader = std::io::repeat(3).take(MAX_COVER_RESOURCE_BYTES + 1);

        let error = read_bounded_cover_bytes(&mut reader, 0)
            .expect_err("changing stream should remain bounded");

        assert_eq!(error, CoverByteReadError::TooLarge);
    }
}
