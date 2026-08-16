use std::{
    collections::HashSet,
    fmt,
    fs::{self, File, OpenOptions},
    io::{BufReader, Read, Write},
    path::{Path, PathBuf},
};

use flate2::read::MultiGzDecoder;
use liblzma::{
    read::XzDecoder,
    stream::{Error as XzError, Stream},
};
use zip::ZipArchive;

use super::{
    dictionary_catalog::DictionaryCatalogPackageFormat,
    stardict_validation::{self, ValidatedStarDictPackage},
};

const MAX_ARCHIVE_ENTRIES: usize = 16;
const MAX_ANCILLARY_ENTRY_BYTES: u64 = 1024 * 1024;
const MAX_TAR_TRAILING_ZERO_BYTES: u64 = 64 * 1024;
const MAX_XZ_DECODER_MEMORY_BYTES: u64 = 64 * 1024 * 1024;
const TAR_BLOCK_BYTES: u64 = 512;

#[derive(Clone, Copy)]
struct ArchiveLimits {
    max_entries: usize,
    max_expanded_bytes: u64,
    max_tar_stream_bytes: u64,
    max_xz_decoder_memory_bytes: u64,
}

impl ArchiveLimits {
    const fn production() -> Self {
        let max_expanded_bytes = stardict_validation::maximum_package_source_bytes()
            + (MAX_ARCHIVE_ENTRIES as u64 * MAX_ANCILLARY_ENTRY_BYTES);
        Self {
            max_entries: MAX_ARCHIVE_ENTRIES,
            max_expanded_bytes,
            max_tar_stream_bytes: max_expanded_bytes
                + (MAX_ARCHIVE_ENTRIES as u64 * TAR_BLOCK_BYTES * 2)
                + MAX_TAR_TRAILING_ZERO_BYTES,
            max_xz_decoder_memory_bytes: MAX_XZ_DECODER_MEMORY_BYTES,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum ArchivePolicy {
    ExactStarDict,
    UpstreamTar,
}

pub(crate) fn extract_catalog_package(
    package_format: DictionaryCatalogPackageFormat,
    archive_path: &Path,
    destination: &Path,
) -> Result<ValidatedStarDictPackage, DictionaryArchiveError> {
    let limits = ArchiveLimits::production();
    match package_format {
        DictionaryCatalogPackageFormat::StardictZip => {
            extract_zip_archive(archive_path, destination, limits)
        }
        DictionaryCatalogPackageFormat::StardictTarXz => {
            extract_tar_xz_archive(archive_path, destination, limits)
        }
    }
}

fn extract_zip_archive(
    archive_path: &Path,
    destination: &Path,
    limits: ArchiveLimits,
) -> Result<ValidatedStarDictPackage, DictionaryArchiveError> {
    fs::create_dir_all(destination).map_err(DictionaryArchiveError::Filesystem)?;
    let file = File::open(archive_path).map_err(DictionaryArchiveError::Filesystem)?;
    let mut archive = ZipArchive::new(file).map_err(zip_error)?;
    if archive.len() > limits.max_entries {
        return Err(invalid_archive(
            "The dictionary package contains too many archive entries.",
        ));
    }

    let mut extraction = ExtractionState::new(destination, limits, ArchivePolicy::ExactStarDict);
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(zip_error)?;
        if zip_entry_is_special(entry.unix_mode(), entry.is_dir()) {
            return Err(invalid_archive(
                "The dictionary package contains an unsafe resource.",
            ));
        }
        if entry.is_dir() {
            extraction.register_directory(entry.name())?;
            continue;
        }
        let entry_name = entry.name().to_owned();
        let entry_size = entry.size();
        extraction.extract_file(&entry_name, entry_size, &mut entry, |error| {
            invalid_archive(format!(
                "The dictionary package archive is invalid: {error}"
            ))
        })?;
    }
    extraction.finish()
}

fn extract_tar_xz_archive(
    archive_path: &Path,
    destination: &Path,
    limits: ArchiveLimits,
) -> Result<ValidatedStarDictPackage, DictionaryArchiveError> {
    fs::create_dir_all(destination).map_err(DictionaryArchiveError::Filesystem)?;
    let tar_path = destination.join("archive.tar");
    {
        let input = File::open(archive_path).map_err(DictionaryArchiveError::Filesystem)?;
        let input = BufReader::new(input);
        let stream = Stream::new_stream_decoder(limits.max_xz_decoder_memory_bytes, 0)
            .map_err(map_xz_stream_error)?;
        let mut decoder = XzDecoder::new_stream(input, stream);
        let output = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tar_path)
            .map_err(DictionaryArchiveError::Filesystem)?;
        let mut output = BoundedWriter::new(output, limits.max_tar_stream_bytes);
        std::io::copy(&mut decoder, &mut output).map_err(map_xz_io_error)?;
        output.flush().map_err(DictionaryArchiveError::Filesystem)?;
        output
            .get_ref()
            .sync_all()
            .map_err(DictionaryArchiveError::Filesystem)?;
    }

    let result = extract_tar_archive(&tar_path, destination, limits);
    let cleanup = fs::remove_file(&tar_path);
    match (result, cleanup) {
        (Ok(package), Ok(())) => Ok(package),
        (Ok(_), Err(error)) => Err(DictionaryArchiveError::Filesystem(error)),
        (Err(error), _) => Err(error),
    }
}

fn extract_tar_archive(
    tar_path: &Path,
    destination: &Path,
    limits: ArchiveLimits,
) -> Result<ValidatedStarDictPackage, DictionaryArchiveError> {
    let file = File::open(tar_path).map_err(DictionaryArchiveError::Filesystem)?;
    let mut reader = BufReader::new(file);
    let mut extraction = ExtractionState::new(destination, limits, ArchivePolicy::UpstreamTar);
    let mut header = [0_u8; TAR_BLOCK_BYTES as usize];

    loop {
        read_tar_block(&mut reader, &mut header)?;
        if header.iter().all(|byte| *byte == 0) {
            let mut second = [0_u8; TAR_BLOCK_BYTES as usize];
            read_tar_block(&mut reader, &mut second)?;
            if second.iter().any(|byte| *byte != 0) {
                return Err(invalid_archive(
                    "The dictionary TAR archive has an invalid end marker.",
                ));
            }
            ensure_zero_tar_trailer(&mut reader)?;
            break;
        }

        validate_tar_header(&header)?;
        let raw_path = tar_path_from_header(&header)?;
        let size = parse_tar_number(&header[124..136])?;
        match header[156] {
            0 | b'0' => {
                extraction.extract_file(&raw_path, size, &mut reader, |error| {
                    invalid_archive(format!("The dictionary TAR archive is truncated: {error}"))
                })?;
                skip_tar_padding(&mut reader, size)?;
            }
            b'5' => {
                if size != 0 {
                    return Err(invalid_archive(
                        "The dictionary TAR archive contains an invalid directory entry.",
                    ));
                }
                extraction.register_directory(&raw_path)?;
            }
            _ => {
                return Err(invalid_archive(
                    "The dictionary package contains a link or unsupported special TAR entry.",
                ));
            }
        }
    }

    extraction.finish()
}

struct ExtractionState<'a> {
    destination: &'a Path,
    limits: ArchiveLimits,
    policy: ArchivePolicy,
    entry_count: usize,
    expanded_bytes: u64,
    extracted_paths: HashSet<String>,
    extracted_files: Vec<PathBuf>,
    compressed_indexes: Vec<(PathBuf, u64)>,
    ancillary_parents: Vec<PathBuf>,
    directory_paths: Vec<PathBuf>,
    ifo_paths: Vec<PathBuf>,
}

impl<'a> ExtractionState<'a> {
    fn new(destination: &'a Path, limits: ArchiveLimits, policy: ArchivePolicy) -> Self {
        Self {
            destination,
            limits,
            policy,
            entry_count: 0,
            expanded_bytes: 0,
            extracted_paths: HashSet::new(),
            extracted_files: Vec::new(),
            compressed_indexes: Vec::new(),
            ancillary_parents: Vec::new(),
            directory_paths: Vec::new(),
            ifo_paths: Vec::new(),
        }
    }

    fn register_directory(&mut self, raw_path: &str) -> Result<(), DictionaryArchiveError> {
        self.bump_entry_count()?;
        let relative = safe_archive_relative_path(raw_path)?;
        if self.policy == ArchivePolicy::UpstreamTar {
            self.directory_paths.push(relative);
        }
        Ok(())
    }

    fn extract_file<R, MapReadError>(
        &mut self,
        raw_path: &str,
        size: u64,
        reader: &mut R,
        map_read_error: MapReadError,
    ) -> Result<(), DictionaryArchiveError>
    where
        R: Read,
        MapReadError: Fn(std::io::Error) -> DictionaryArchiveError,
    {
        self.bump_entry_count()?;
        let relative = safe_archive_relative_path(raw_path)?;
        let classification = classify_archive_file(&relative, self.policy)?;
        let entry_limit = match &classification {
            ArchiveFile::StarDict { limit, .. } => *limit,
            ArchiveFile::Ancillary => MAX_ANCILLARY_ENTRY_BYTES,
        };
        if size > entry_limit {
            return Err(invalid_archive(
                "A dictionary package resource exceeds its size limit.",
            ));
        }
        self.expanded_bytes = self
            .expanded_bytes
            .checked_add(size)
            .filter(|bytes| *bytes <= self.limits.max_expanded_bytes)
            .ok_or_else(|| {
                invalid_archive("The expanded dictionary package exceeds its size limit.")
            })?;

        match classification {
            ArchiveFile::Ancillary => {
                self.ancillary_parents
                    .push(relative.parent().unwrap_or(Path::new("")).to_path_buf());
                discard_exact(reader, size, map_read_error)?;
                Ok(())
            }
            ArchiveFile::StarDict {
                output_relative,
                compressed_index,
                ..
            } => {
                let collision_key = output_relative.to_string_lossy().to_lowercase();
                if !self.extracted_paths.insert(collision_key) {
                    return Err(invalid_archive(
                        "The dictionary package contains duplicate resource paths.",
                    ));
                }

                let output = self.destination.join(&relative);
                let parent = output.parent().ok_or_else(|| {
                    invalid_archive("The dictionary package resource path is invalid.")
                })?;
                fs::create_dir_all(parent).map_err(DictionaryArchiveError::Filesystem)?;
                let mut output_file = OpenOptions::new()
                    .write(true)
                    .create_new(true)
                    .open(&output)
                    .map_err(DictionaryArchiveError::Filesystem)?;
                copy_exact(reader, &mut output_file, size, map_read_error)?;
                output_file
                    .flush()
                    .map_err(DictionaryArchiveError::Filesystem)?;
                output_file
                    .sync_all()
                    .map_err(DictionaryArchiveError::Filesystem)?;

                if compressed_index {
                    self.compressed_indexes.push((output.clone(), size));
                } else {
                    if output.extension().and_then(|extension| extension.to_str()) == Some("ifo") {
                        self.ifo_paths.push(output.clone());
                    }
                    self.extracted_files.push(output);
                }
                Ok(())
            }
        }
    }

    fn bump_entry_count(&mut self) -> Result<(), DictionaryArchiveError> {
        self.entry_count = self.entry_count.saturating_add(1);
        if self.entry_count > self.limits.max_entries {
            return Err(invalid_archive(
                "The dictionary package contains too many archive entries.",
            ));
        }
        Ok(())
    }

    fn finish(mut self) -> Result<ValidatedStarDictPackage, DictionaryArchiveError> {
        if self.ifo_paths.len() != 1 {
            return Err(invalid_archive(
                "The dictionary package must contain exactly one StarDict .ifo file.",
            ));
        }

        let ifo_parent = self.ifo_paths[0]
            .parent()
            .ok_or_else(|| invalid_archive("The dictionary package resource path is invalid."))?;
        let relative_parent = ifo_parent
            .strip_prefix(self.destination)
            .map_err(|_| invalid_archive("The dictionary package resource path is invalid."))?;
        if self
            .ancillary_parents
            .iter()
            .any(|parent| parent != relative_parent)
            || self
                .directory_paths
                .iter()
                .any(|directory| directory != relative_parent)
        {
            return Err(invalid_archive(
                "The dictionary package contains an unsupported nested package layout.",
            ));
        }

        for (compressed_index, compressed_size) in std::mem::take(&mut self.compressed_indexes) {
            let normalized = normalize_gzip_index(&compressed_index)?;
            let normalized_size = fs::metadata(&normalized)
                .map_err(DictionaryArchiveError::Filesystem)?
                .len();
            self.expanded_bytes = self
                .expanded_bytes
                .checked_sub(compressed_size)
                .and_then(|bytes| bytes.checked_add(normalized_size))
                .filter(|bytes| *bytes <= self.limits.max_expanded_bytes)
                .ok_or_else(|| {
                    invalid_archive("The expanded dictionary package exceeds its size limit.")
                })?;
            self.extracted_files.push(normalized);
        }

        let validated = stardict_validation::validate_package(&self.ifo_paths[0])
            .map_err(DictionaryArchiveError::Validation)?;
        if validated.source_files.len() != self.extracted_files.len() {
            return Err(invalid_archive(
                "The dictionary package must contain one complete StarDict package.",
            ));
        }
        Ok(validated)
    }
}

enum ArchiveFile {
    StarDict {
        output_relative: PathBuf,
        compressed_index: bool,
        limit: u64,
    },
    Ancillary,
}

fn classify_archive_file(
    relative: &Path,
    policy: ArchivePolicy,
) -> Result<ArchiveFile, DictionaryArchiveError> {
    if let Some(limit) = stardict_validation::supported_source_file_limit(relative) {
        return Ok(ArchiveFile::StarDict {
            output_relative: relative.to_path_buf(),
            compressed_index: false,
            limit,
        });
    }

    if policy == ArchivePolicy::UpstreamTar && is_gzip_index(relative) {
        let normalized = relative.with_extension("");
        let limit =
            stardict_validation::supported_source_file_limit(&normalized).ok_or_else(|| {
                invalid_archive("The dictionary package contains an unsupported resource.")
            })?;
        return Ok(ArchiveFile::StarDict {
            output_relative: normalized,
            compressed_index: true,
            limit,
        });
    }

    if policy == ArchivePolicy::UpstreamTar && is_allowed_ancillary_file(relative) {
        return Ok(ArchiveFile::Ancillary);
    }

    Err(invalid_archive(
        "The dictionary package contains an unsupported resource.",
    ))
}

fn is_gzip_index(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.ends_with(".idx.gz"))
}

fn is_allowed_ancillary_file(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return false;
    };
    let upper = name.to_ascii_uppercase();
    ["README", "COPYING", "LICENSE", "INSTALL"]
        .iter()
        .any(|base| {
            upper == *base
                || ["TXT", "MD", "RST"]
                    .iter()
                    .any(|extension| upper == format!("{base}.{extension}"))
        })
}

fn normalize_gzip_index(compressed_path: &Path) -> Result<PathBuf, DictionaryArchiveError> {
    let normalized = compressed_path.with_extension("");
    let limit = stardict_validation::supported_source_file_limit(&normalized)
        .ok_or_else(|| invalid_archive("The dictionary package index path is invalid."))?;
    let input = File::open(compressed_path).map_err(DictionaryArchiveError::Filesystem)?;
    let mut decoder = MultiGzDecoder::new(input);
    let output = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&normalized)
        .map_err(DictionaryArchiveError::Filesystem)?;
    let mut output = BoundedWriter::new(output, limit);
    std::io::copy(&mut decoder, &mut output).map_err(|error| {
        invalid_archive(format!(
            "The dictionary package gzip-compressed index is invalid: {error}"
        ))
    })?;
    output.flush().map_err(DictionaryArchiveError::Filesystem)?;
    output
        .get_ref()
        .sync_all()
        .map_err(DictionaryArchiveError::Filesystem)?;
    fs::remove_file(compressed_path).map_err(DictionaryArchiveError::Filesystem)?;
    Ok(normalized)
}

fn safe_archive_relative_path(raw_path: &str) -> Result<PathBuf, DictionaryArchiveError> {
    let raw_path = raw_path.strip_suffix('/').unwrap_or(raw_path);
    if raw_path.is_empty() || raw_path.starts_with('/') || raw_path.starts_with('\\') {
        return Err(invalid_archive(
            "The dictionary package contains an unsafe path.",
        ));
    }
    let segments = raw_path.split('/').collect::<Vec<_>>();
    if segments.is_empty()
        || segments.len() > 2
        || segments.iter().any(|segment| {
            segment.is_empty()
                || *segment == "."
                || *segment == ".."
                || segment.contains('\\')
                || segment.contains(':')
        })
    {
        return Err(invalid_archive(
            "The dictionary package contains an unsafe or unsupported path layout.",
        ));
    }
    let mut relative = PathBuf::new();
    for segment in segments {
        relative.push(segment);
    }
    Ok(relative)
}

fn zip_entry_is_special(mode: Option<u32>, is_dir: bool) -> bool {
    let Some(mode) = mode else {
        return false;
    };
    match mode & 0o170000 {
        0 => false,
        0o040000 => !is_dir,
        0o100000 => is_dir,
        _ => true,
    }
}

fn copy_exact<R, W, MapReadError>(
    reader: &mut R,
    writer: &mut W,
    byte_count: u64,
    map_read_error: MapReadError,
) -> Result<(), DictionaryArchiveError>
where
    R: Read,
    W: Write,
    MapReadError: Fn(std::io::Error) -> DictionaryArchiveError,
{
    let mut remaining = byte_count;
    let mut buffer = [0_u8; 64 * 1024];
    while remaining > 0 {
        let capacity = usize::try_from(remaining.min(buffer.len() as u64)).unwrap();
        let read = reader
            .read(&mut buffer[..capacity])
            .map_err(&map_read_error)?;
        if read == 0 {
            return Err(map_read_error(std::io::Error::new(
                std::io::ErrorKind::UnexpectedEof,
                "archive entry ended before its declared size",
            )));
        }
        writer
            .write_all(&buffer[..read])
            .map_err(DictionaryArchiveError::Filesystem)?;
        remaining -= read as u64;
    }
    Ok(())
}

fn discard_exact<R, MapReadError>(
    reader: &mut R,
    byte_count: u64,
    map_read_error: MapReadError,
) -> Result<(), DictionaryArchiveError>
where
    R: Read,
    MapReadError: Fn(std::io::Error) -> DictionaryArchiveError,
{
    copy_exact(reader, &mut std::io::sink(), byte_count, map_read_error)
}

fn read_tar_block<R: Read>(
    reader: &mut R,
    block: &mut [u8; TAR_BLOCK_BYTES as usize],
) -> Result<(), DictionaryArchiveError> {
    reader.read_exact(block).map_err(|error| {
        invalid_archive(format!("The dictionary TAR archive is truncated: {error}"))
    })
}

fn validate_tar_header(
    header: &[u8; TAR_BLOCK_BYTES as usize],
) -> Result<(), DictionaryArchiveError> {
    if &header[257..262] != b"ustar" {
        return Err(invalid_archive(
            "The dictionary TAR archive uses an unsupported header format.",
        ));
    }
    let expected = parse_tar_number(&header[148..156])?;
    let actual = header
        .iter()
        .enumerate()
        .map(|(index, byte)| {
            if (148..156).contains(&index) {
                b' ' as u64
            } else {
                *byte as u64
            }
        })
        .sum::<u64>();
    if expected != actual {
        return Err(invalid_archive(
            "The dictionary TAR archive has an invalid header checksum.",
        ));
    }
    Ok(())
}

fn tar_path_from_header(
    header: &[u8; TAR_BLOCK_BYTES as usize],
) -> Result<String, DictionaryArchiveError> {
    let name = tar_text(&header[0..100])?;
    let prefix = tar_text(&header[345..500])?;
    if name.is_empty() {
        return Err(invalid_archive(
            "The dictionary TAR archive contains an empty path.",
        ));
    }
    Ok(if prefix.is_empty() {
        name
    } else {
        format!("{prefix}/{name}")
    })
}

fn tar_text(bytes: &[u8]) -> Result<String, DictionaryArchiveError> {
    let end = bytes
        .iter()
        .position(|byte| *byte == 0)
        .unwrap_or(bytes.len());
    std::str::from_utf8(&bytes[..end])
        .map(str::to_owned)
        .map_err(|_| invalid_archive("The dictionary TAR archive contains a non-UTF-8 path."))
}

fn parse_tar_number(bytes: &[u8]) -> Result<u64, DictionaryArchiveError> {
    if bytes.first().is_some_and(|byte| byte & 0x80 != 0) {
        return Err(invalid_archive(
            "The dictionary TAR archive uses an unsupported numeric encoding.",
        ));
    }
    let start = bytes
        .iter()
        .position(|byte| *byte != 0 && *byte != b' ')
        .unwrap_or(bytes.len());
    let end = bytes
        .iter()
        .rposition(|byte| *byte != 0 && *byte != b' ')
        .map(|index| index + 1)
        .unwrap_or(start);
    if start == end {
        return Ok(0);
    }
    let text = std::str::from_utf8(&bytes[start..end])
        .map_err(|_| invalid_archive("The dictionary TAR archive has invalid numeric metadata."))?;
    if !text.bytes().all(|byte| matches!(byte, b'0'..=b'7')) {
        return Err(invalid_archive(
            "The dictionary TAR archive has invalid numeric metadata.",
        ));
    }
    u64::from_str_radix(text, 8)
        .map_err(|_| invalid_archive("The dictionary TAR archive has invalid numeric metadata."))
}

fn skip_tar_padding<R: Read>(
    reader: &mut R,
    entry_size: u64,
) -> Result<(), DictionaryArchiveError> {
    let padding = (TAR_BLOCK_BYTES - (entry_size % TAR_BLOCK_BYTES)) % TAR_BLOCK_BYTES;
    if padding == 0 {
        return Ok(());
    }
    let mut buffer = [0_u8; TAR_BLOCK_BYTES as usize];
    reader
        .read_exact(&mut buffer[..padding as usize])
        .map_err(|error| {
            invalid_archive(format!("The dictionary TAR archive is truncated: {error}"))
        })?;
    if buffer[..padding as usize].iter().any(|byte| *byte != 0) {
        return Err(invalid_archive(
            "The dictionary TAR archive has invalid entry padding.",
        ));
    }
    Ok(())
}

fn ensure_zero_tar_trailer<R: Read>(reader: &mut R) -> Result<(), DictionaryArchiveError> {
    let mut buffer = [0_u8; 8 * 1024];
    loop {
        let read = reader.read(&mut buffer).map_err(|error| {
            invalid_archive(format!("The dictionary TAR archive is invalid: {error}"))
        })?;
        if read == 0 {
            return Ok(());
        }
        if buffer[..read].iter().any(|byte| *byte != 0) {
            return Err(invalid_archive(
                "The dictionary TAR archive contains trailing non-zero data.",
            ));
        }
    }
}

struct BoundedWriter<W> {
    inner: W,
    written: u64,
    limit: u64,
}

impl<W> BoundedWriter<W> {
    fn new(inner: W, limit: u64) -> Self {
        Self {
            inner,
            written: 0,
            limit,
        }
    }

    fn get_ref(&self) -> &W {
        &self.inner
    }
}

impl<W: Write> Write for BoundedWriter<W> {
    fn write(&mut self, buffer: &[u8]) -> std::io::Result<usize> {
        let remaining = self.limit.saturating_sub(self.written);
        if buffer.len() as u64 > remaining {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "expanded archive stream exceeds its size limit",
            ));
        }
        let written = self.inner.write(buffer)?;
        self.written += written as u64;
        Ok(written)
    }

    fn flush(&mut self) -> std::io::Result<()> {
        self.inner.flush()
    }
}

fn map_xz_stream_error(error: XzError) -> DictionaryArchiveError {
    match error {
        XzError::MemLimit => invalid_archive(
            "The dictionary package XZ stream requires more decoder memory than allowed.",
        ),
        _ => invalid_archive(format!(
            "The dictionary package XZ stream is invalid: {error}"
        )),
    }
}

fn map_xz_io_error(error: std::io::Error) -> DictionaryArchiveError {
    if error
        .get_ref()
        .and_then(|source| source.downcast_ref::<XzError>())
        .is_some_and(|error| *error == XzError::MemLimit)
    {
        return invalid_archive(
            "The dictionary package XZ stream requires more decoder memory than allowed.",
        );
    }
    invalid_archive(format!(
        "The dictionary package XZ stream is invalid: {error}"
    ))
}

fn zip_error(error: zip::result::ZipError) -> DictionaryArchiveError {
    invalid_archive(format!(
        "The dictionary package archive is invalid: {error}"
    ))
}

fn invalid_archive(message: impl Into<String>) -> DictionaryArchiveError {
    DictionaryArchiveError::InvalidArchive(message.into())
}

#[derive(Debug)]
pub(crate) enum DictionaryArchiveError {
    Filesystem(std::io::Error),
    InvalidArchive(String),
    Validation(stardict_validation::StarDictValidationError),
}

impl fmt::Display for DictionaryArchiveError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Filesystem(error) => {
                write!(formatter, "Dictionary package extraction failed: {error}")
            }
            Self::InvalidArchive(message) => formatter.write_str(message),
            Self::Validation(error) => write!(formatter, "{error}"),
        }
    }
}

#[cfg(test)]
#[path = "dictionary_archive_tests.rs"]
pub(crate) mod tests;
