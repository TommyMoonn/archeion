use std::{
    cmp::Ordering,
    collections::BTreeMap,
    ffi::OsStr,
    fs::{self, File},
    io::{BufReader, Read},
    path::{Path, PathBuf},
};

use flate2::read::GzDecoder;
use serde::Serialize;

const IFO_HEADER: &str = "StarDict's dict ifo file";
const MAX_IFO_BYTES: u64 = 256 * 1024;
const MAX_IDX_BYTES: u64 = 64 * 1024 * 1024;
const MAX_SYN_BYTES: u64 = 32 * 1024 * 1024;
const MAX_COMPRESSED_DICTIONARY_BYTES: u64 = 512 * 1024 * 1024;
const MAX_EXPANDED_DICTIONARY_BYTES: u64 = 1024 * 1024 * 1024;
const MAX_ENTRY_COUNT: u32 = 5_000_000;
const MAX_HEADWORD_BYTES: usize = 255;

pub(crate) fn supported_source_file_limit(path: &Path) -> Option<u64> {
    let name = path.file_name()?.to_str()?;
    if name.ends_with(".dict.dz") {
        Some(MAX_COMPRESSED_DICTIONARY_BYTES)
    } else {
        match path.extension()?.to_str()? {
            "ifo" => Some(MAX_IFO_BYTES),
            "idx" => Some(MAX_IDX_BYTES),
            "dict" => Some(MAX_EXPANDED_DICTIONARY_BYTES),
            "syn" => Some(MAX_SYN_BYTES),
            _ => None,
        }
    }
}

pub(crate) const fn maximum_package_source_bytes() -> u64 {
    MAX_IFO_BYTES + MAX_IDX_BYTES + MAX_SYN_BYTES + MAX_EXPANDED_DICTIONARY_BYTES
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedStarDictPackage {
    pub package_name: String,
    pub metadata: StarDictMetadata,
    pub entries: Vec<StarDictIndexEntry>,
    pub synonyms: Vec<StarDictSynonym>,
    pub definition_data: StarDictDefinitionData,
    pub source_files: Vec<StarDictSourceFile>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StarDictMetadata {
    pub version: String,
    pub book_name: String,
    pub word_count: u32,
    pub synonym_word_count: u32,
    pub index_file_size: u64,
    pub index_offset_bits: u8,
    pub same_type_sequence: Option<String>,
    pub description: Option<String>,
    pub date: Option<String>,
    pub website: Option<String>,
    pub email: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StarDictIndexEntry {
    pub word: String,
    pub definition_offset: u64,
    pub definition_size: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StarDictSynonym {
    pub word: String,
    pub target_index: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StarDictDefinitionData {
    pub compression: StarDictDefinitionCompression,
    pub stored_bytes: u64,
    pub expanded_bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum StarDictDefinitionCompression {
    None,
    Dictzip,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StarDictSourceFile {
    pub kind: StarDictSourceFileKind,
    pub file_name: String,
    pub path: PathBuf,
    pub byte_length: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum StarDictSourceFileKind {
    Metadata,
    Index,
    Definitions,
    Synonyms,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StarDictValidationError {
    pub code: StarDictValidationErrorCode,
    pub message: String,
    pub resource_path: Option<PathBuf>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum StarDictValidationErrorCode {
    InvalidPackageRoot,
    MissingRequiredFile,
    AmbiguousDefinitionData,
    UnsupportedVersion,
    UnsupportedFormat,
    MalformedMetadata,
    MalformedIndex,
    InvalidDefinitionBounds,
    MalformedSynonyms,
    InvalidSynonymTarget,
    ResourceLimitExceeded,
    Unavailable,
}

impl std::fmt::Display for StarDictValidationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&self.message)
    }
}

impl std::error::Error for StarDictValidationError {}

impl StarDictValidationError {
    fn new(
        code: StarDictValidationErrorCode,
        message: impl Into<String>,
        resource_path: Option<&Path>,
    ) -> Self {
        Self {
            code,
            message: message.into(),
            resource_path: resource_path.map(Path::to_path_buf),
        }
    }
}

#[derive(Debug)]
struct PackagePaths {
    package_name: String,
    ifo: PathBuf,
    idx: PathBuf,
    definitions: PathBuf,
    definitions_compressed: bool,
    syn: Option<PathBuf>,
}

pub fn validate_package(
    ifo_path: &Path,
) -> Result<ValidatedStarDictPackage, StarDictValidationError> {
    let paths = discover_package(ifo_path)?;
    let ifo_bytes = read_regular_file(&paths.ifo, MAX_IFO_BYTES, "metadata")?;
    let metadata = parse_ifo(&ifo_bytes, &paths.ifo)?;

    let idx_bytes = read_regular_file(&paths.idx, MAX_IDX_BYTES, "index")?;
    if idx_bytes.len() as u64 != metadata.index_file_size {
        return Err(StarDictValidationError::new(
            StarDictValidationErrorCode::MalformedMetadata,
            "The declared StarDict index size does not match the .idx file.",
            Some(&paths.idx),
        ));
    }

    let definition_data = inspect_definitions(&paths.definitions, paths.definitions_compressed)?;
    let entries = parse_index(
        &idx_bytes,
        metadata.index_offset_bits,
        metadata.word_count,
        definition_data.expanded_bytes,
        &paths.idx,
    )?;
    let synonyms = parse_synonyms(paths.syn.as_deref(), &metadata, entries.len())?;

    let mut source_files = vec![
        source_fact(StarDictSourceFileKind::Metadata, &paths.ifo)?,
        source_fact(StarDictSourceFileKind::Index, &paths.idx)?,
        source_fact(StarDictSourceFileKind::Definitions, &paths.definitions)?,
    ];
    if let Some(syn) = &paths.syn {
        source_files.push(source_fact(StarDictSourceFileKind::Synonyms, syn)?);
    }

    Ok(ValidatedStarDictPackage {
        package_name: paths.package_name,
        metadata,
        entries,
        synonyms,
        definition_data,
        source_files,
    })
}

pub(crate) fn read_metadata(ifo_path: &Path) -> Result<StarDictMetadata, StarDictValidationError> {
    let ifo = resolve_regular_file(ifo_path, false, "StarDict metadata")?;
    let bytes = read_regular_file(&ifo, MAX_IFO_BYTES, "metadata")?;
    parse_ifo(&bytes, &ifo)
}

fn discover_package(ifo_path: &Path) -> Result<PackagePaths, StarDictValidationError> {
    if ifo_path.extension().and_then(OsStr::to_str) != Some("ifo") {
        return Err(StarDictValidationError::new(
            StarDictValidationErrorCode::InvalidPackageRoot,
            "Select a StarDict .ifo package file.",
            Some(ifo_path),
        ));
    }
    let ifo = resolve_regular_file(ifo_path, false, "StarDict metadata")?;
    let parent = ifo.parent().ok_or_else(|| {
        StarDictValidationError::new(
            StarDictValidationErrorCode::InvalidPackageRoot,
            "The StarDict package has no containing folder.",
            Some(&ifo),
        )
    })?;
    let stem = ifo.file_stem().ok_or_else(|| {
        StarDictValidationError::new(
            StarDictValidationErrorCode::InvalidPackageRoot,
            "The StarDict package name is invalid.",
            Some(&ifo),
        )
    })?;
    let package_name = stem.to_string_lossy().into_owned();
    if package_name.is_empty() {
        return Err(StarDictValidationError::new(
            StarDictValidationErrorCode::InvalidPackageRoot,
            "The StarDict package name is empty.",
            Some(&ifo),
        ));
    }

    let sibling = |extension: &str| parent.join(stem).with_extension(extension);
    let idx = resolve_regular_file(&sibling("idx"), true, "StarDict index")?;
    let dict_candidate = sibling("dict");
    let dict_dz_candidate = sibling("dict.dz");
    let has_dict = path_is_regular_file(&dict_candidate)?;
    let has_dict_dz = path_is_regular_file(&dict_dz_candidate)?;
    let (definitions, definitions_compressed) = match (has_dict, has_dict_dz) {
        (true, false) => (
            resolve_regular_file(&dict_candidate, true, "StarDict definitions")?,
            false,
        ),
        (false, true) => (
            resolve_regular_file(&dict_dz_candidate, true, "StarDict definitions")?,
            true,
        ),
        (false, false) => {
            return Err(StarDictValidationError::new(
                StarDictValidationErrorCode::MissingRequiredFile,
                "The StarDict package is missing its .dict or .dict.dz definitions file.",
                Some(&dict_candidate),
            ))
        }
        (true, true) => {
            return Err(StarDictValidationError::new(
                StarDictValidationErrorCode::AmbiguousDefinitionData,
                "The StarDict package contains both .dict and .dict.dz definitions.",
                Some(parent),
            ))
        }
    };
    let syn_candidate = sibling("syn");
    let syn = path_is_regular_file(&syn_candidate)?
        .then(|| resolve_regular_file(&syn_candidate, true, "StarDict synonyms"))
        .transpose()?;

    Ok(PackagePaths {
        package_name,
        ifo,
        idx,
        definitions,
        definitions_compressed,
        syn,
    })
}

fn path_is_regular_file(path: &Path) -> Result<bool, StarDictValidationError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err(StarDictValidationError::new(
                StarDictValidationErrorCode::InvalidPackageRoot,
                "StarDict package resources must be regular files.",
                Some(path),
            ))
        }
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(StarDictValidationError::new(
            StarDictValidationErrorCode::Unavailable,
            format!("Unable to inspect the StarDict package: {error}"),
            Some(path),
        )),
    }
}

fn resolve_regular_file(
    path: &Path,
    required: bool,
    label: &str,
) -> Result<PathBuf, StarDictValidationError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if required && error.kind() == std::io::ErrorKind::NotFound => {
            return Err(StarDictValidationError::new(
                StarDictValidationErrorCode::MissingRequiredFile,
                format!("The package is missing its {label} file."),
                Some(path),
            ))
        }
        Err(error) => {
            return Err(StarDictValidationError::new(
                StarDictValidationErrorCode::InvalidPackageRoot,
                format!("The selected {label} file is unavailable: {error}"),
                Some(path),
            ))
        }
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(StarDictValidationError::new(
            StarDictValidationErrorCode::InvalidPackageRoot,
            format!("The {label} must be a regular file."),
            Some(path),
        ));
    }
    fs::canonicalize(path).map_err(|error| {
        StarDictValidationError::new(
            StarDictValidationErrorCode::Unavailable,
            format!("Unable to resolve the {label} file: {error}"),
            Some(path),
        )
    })
}

fn read_regular_file(
    path: &Path,
    maximum: u64,
    label: &str,
) -> Result<Vec<u8>, StarDictValidationError> {
    let metadata = fs::metadata(path).map_err(|error| {
        StarDictValidationError::new(
            StarDictValidationErrorCode::Unavailable,
            format!("Unable to inspect the StarDict {label}: {error}"),
            Some(path),
        )
    })?;
    if metadata.len() > maximum {
        return Err(limit_error(path, label));
    }
    let file = File::open(path).map_err(|error| {
        StarDictValidationError::new(
            StarDictValidationErrorCode::Unavailable,
            format!("Unable to open the StarDict {label}: {error}"),
            Some(path),
        )
    })?;
    read_bounded(file, maximum, path, label)
}

fn read_bounded(
    mut reader: impl Read,
    maximum: u64,
    path: &Path,
    label: &str,
) -> Result<Vec<u8>, StarDictValidationError> {
    let mut bytes = Vec::new();
    reader
        .by_ref()
        .take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| {
            StarDictValidationError::new(
                StarDictValidationErrorCode::Unavailable,
                format!("Unable to read the StarDict {label}: {error}"),
                Some(path),
            )
        })?;
    if bytes.len() as u64 > maximum {
        return Err(limit_error(path, label));
    }
    Ok(bytes)
}

fn limit_error(path: &Path, label: &str) -> StarDictValidationError {
    StarDictValidationError::new(
        StarDictValidationErrorCode::ResourceLimitExceeded,
        format!("The StarDict {label} exceeds Archeion's validation limit."),
        Some(path),
    )
}

fn parse_ifo(bytes: &[u8], path: &Path) -> Result<StarDictMetadata, StarDictValidationError> {
    let text = std::str::from_utf8(bytes)
        .map_err(|_| metadata_error(path, "The .ifo file is not UTF-8."))?;
    let mut lines = text.split(['\r', '\n']);
    if lines.next() != Some(IFO_HEADER) {
        return Err(metadata_error(path, "The .ifo header is invalid."));
    }
    let mut values = BTreeMap::new();
    let mut first_metadata_key = None;
    for line in lines {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let (raw_key, raw_value) = line
            .split_once('=')
            .ok_or_else(|| metadata_error(path, "The .ifo metadata contains an invalid line."))?;
        let key = raw_key.trim();
        let value = raw_value.trim();
        if !valid_metadata_key(key) {
            return Err(metadata_error(
                path,
                "The .ifo metadata contains an invalid field.",
            ));
        }
        first_metadata_key.get_or_insert(key);
        if values.insert(key, value).is_some() {
            return Err(metadata_error(
                path,
                "The .ifo metadata contains a duplicate field.",
            ));
        }
    }

    if first_metadata_key != Some("version") {
        return Err(metadata_error(
            path,
            "The .ifo version must be the first metadata field.",
        ));
    }

    let version = required_value(&values, "version", path)?;
    if !matches!(version, "2.4.2" | "3.0.0") {
        return Err(StarDictValidationError::new(
            StarDictValidationErrorCode::UnsupportedVersion,
            format!("StarDict version {version} is not supported."),
            Some(path),
        ));
    }
    let word_count = parse_u32(
        required_value(&values, "wordcount", path)?,
        "wordcount",
        path,
    )?;
    if word_count > MAX_ENTRY_COUNT {
        return Err(limit_error(path, "entry count"));
    }
    let synonym_word_count = values
        .get("synwordcount")
        .map(|value| parse_u32(value, "synwordcount", path))
        .transpose()?
        .unwrap_or(0);
    if synonym_word_count > MAX_ENTRY_COUNT {
        return Err(limit_error(path, "synonym count"));
    }
    let index_file_size = parse_u64(
        required_value(&values, "idxfilesize", path)?,
        "idxfilesize",
        path,
    )?;
    if index_file_size > MAX_IDX_BYTES {
        return Err(limit_error(path, "index"));
    }
    let index_offset_bits = match values.get("idxoffsetbits").copied().unwrap_or("32") {
        "32" => 32,
        "64" if version == "3.0.0" => 64,
        _ => {
            return Err(StarDictValidationError::new(
                StarDictValidationErrorCode::UnsupportedFormat,
                "The StarDict index offset format is not supported.",
                Some(path),
            ))
        }
    };

    let same_type_sequence = optional_value(&values, "sametypesequence");
    if let Some(sequence) = &same_type_sequence {
        validate_same_type_sequence(sequence, path)?;
    }

    Ok(StarDictMetadata {
        version: version.to_string(),
        book_name: required_value(&values, "bookname", path)?.to_string(),
        word_count,
        synonym_word_count,
        index_file_size,
        index_offset_bits,
        same_type_sequence,
        description: optional_value(&values, "description"),
        date: optional_value(&values, "date"),
        website: optional_value(&values, "website"),
        email: optional_value(&values, "email"),
    })
}

fn valid_metadata_key(key: &str) -> bool {
    !key.is_empty()
        && key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
}

fn validate_same_type_sequence(sequence: &str, path: &Path) -> Result<(), StarDictValidationError> {
    if sequence.is_empty()
        || !sequence.bytes().all(|byte| byte.is_ascii_alphabetic())
        || sequence.len() > 64
    {
        return Err(StarDictValidationError::new(
            StarDictValidationErrorCode::UnsupportedFormat,
            "The StarDict same-type sequence is not supported.",
            Some(path),
        ));
    }
    Ok(())
}

fn required_value<'a>(
    values: &'a BTreeMap<&str, &str>,
    key: &str,
    path: &Path,
) -> Result<&'a str, StarDictValidationError> {
    values
        .get(key)
        .copied()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| metadata_error(path, format!("The .ifo file is missing {key}.")))
}

fn optional_value(values: &BTreeMap<&str, &str>, key: &str) -> Option<String> {
    values.get(key).map(|value| (*value).to_string())
}

fn parse_u32(value: &str, key: &str, path: &Path) -> Result<u32, StarDictValidationError> {
    value
        .parse()
        .map_err(|_| metadata_error(path, format!("The .ifo {key} value is invalid.")))
}

fn parse_u64(value: &str, key: &str, path: &Path) -> Result<u64, StarDictValidationError> {
    value
        .parse()
        .map_err(|_| metadata_error(path, format!("The .ifo {key} value is invalid.")))
}

fn metadata_error(path: &Path, message: impl Into<String>) -> StarDictValidationError {
    StarDictValidationError::new(
        StarDictValidationErrorCode::MalformedMetadata,
        message,
        Some(path),
    )
}

fn inspect_definitions(
    path: &Path,
    compressed: bool,
) -> Result<StarDictDefinitionData, StarDictValidationError> {
    let metadata = fs::metadata(path).map_err(|error| {
        StarDictValidationError::new(
            StarDictValidationErrorCode::Unavailable,
            format!("Unable to inspect the StarDict definitions: {error}"),
            Some(path),
        )
    })?;
    let stored_bytes = metadata.len();
    if stored_bytes > MAX_COMPRESSED_DICTIONARY_BYTES {
        return Err(limit_error(path, "definition data"));
    }
    if !compressed {
        if stored_bytes > MAX_EXPANDED_DICTIONARY_BYTES {
            return Err(limit_error(path, "definition data"));
        }
        return Ok(StarDictDefinitionData {
            compression: StarDictDefinitionCompression::None,
            stored_bytes,
            expanded_bytes: stored_bytes,
        });
    }

    validate_dictzip_header(path)?;
    let file = File::open(path).map_err(|error| {
        StarDictValidationError::new(
            StarDictValidationErrorCode::Unavailable,
            format!("Unable to open the compressed StarDict definitions: {error}"),
            Some(path),
        )
    })?;
    let mut decoder = GzDecoder::new(BufReader::new(file));
    let mut buffer = [0_u8; 64 * 1024];
    let mut expanded_bytes = 0_u64;
    loop {
        let read = decoder.read(&mut buffer).map_err(|error| {
            StarDictValidationError::new(
                StarDictValidationErrorCode::UnsupportedFormat,
                format!("The .dict.dz data cannot be decompressed: {error}"),
                Some(path),
            )
        })?;
        if read == 0 {
            break;
        }
        expanded_bytes = expanded_bytes.saturating_add(read as u64);
        if expanded_bytes > MAX_EXPANDED_DICTIONARY_BYTES {
            return Err(limit_error(path, "expanded definition data"));
        }
    }
    Ok(StarDictDefinitionData {
        compression: StarDictDefinitionCompression::Dictzip,
        stored_bytes,
        expanded_bytes,
    })
}

fn validate_dictzip_header(path: &Path) -> Result<(), StarDictValidationError> {
    const GZIP_FIXED_HEADER_BYTES: usize = 12;
    const GZIP_EXTRA_FLAG: u8 = 0x04;

    let mut file = File::open(path).map_err(|error| {
        StarDictValidationError::new(
            StarDictValidationErrorCode::Unavailable,
            format!("Unable to open the compressed StarDict definitions: {error}"),
            Some(path),
        )
    })?;
    let mut header = [0_u8; GZIP_FIXED_HEADER_BYTES];
    file.read_exact(&mut header)
        .map_err(|_| dictzip_format_error(path, "The .dict.dz header is truncated."))?;
    if header[0..3] != [0x1f, 0x8b, 0x08] || header[3] & GZIP_EXTRA_FLAG == 0 {
        return Err(dictzip_format_error(
            path,
            "The .dict.dz file does not contain a dictzip random-access header.",
        ));
    }
    let extra_length = usize::from(u16::from_le_bytes([header[10], header[11]]));
    let mut extra = vec![0_u8; extra_length];
    file.read_exact(&mut extra)
        .map_err(|_| dictzip_format_error(path, "The .dict.dz extra header is truncated."))?;

    let mut cursor = 0_usize;
    while cursor < extra.len() {
        let field_header_end = cursor
            .checked_add(4)
            .filter(|end| *end <= extra.len())
            .ok_or_else(|| dictzip_format_error(path, "The .dict.dz extra field is malformed."))?;
        let field_length = usize::from(u16::from_le_bytes([extra[cursor + 2], extra[cursor + 3]]));
        let field_end = field_header_end
            .checked_add(field_length)
            .filter(|end| *end <= extra.len())
            .ok_or_else(|| dictzip_format_error(path, "The .dict.dz extra field is truncated."))?;
        if extra[cursor..cursor + 2] == *b"RA" {
            let payload = &extra[field_header_end..field_end];
            if payload.len() < 6 {
                return Err(dictzip_format_error(
                    path,
                    "The dictzip RA field is truncated.",
                ));
            }
            let version = u16::from_le_bytes([payload[0], payload[1]]);
            let chunk_length = u16::from_le_bytes([payload[2], payload[3]]);
            let chunk_count = usize::from(u16::from_le_bytes([payload[4], payload[5]]));
            let expected_length = 6_usize
                .checked_add(chunk_count.saturating_mul(2))
                .ok_or_else(|| dictzip_format_error(path, "The dictzip RA field is invalid."))?;
            if version != 1
                || chunk_length == 0
                || chunk_count == 0
                || payload.len() != expected_length
                || payload[6..]
                    .chunks_exact(2)
                    .any(|size| u16::from_le_bytes([size[0], size[1]]) == 0)
            {
                return Err(dictzip_format_error(
                    path,
                    "The dictzip RA field is invalid.",
                ));
            }
            return Ok(());
        }
        cursor = field_end;
    }

    Err(dictzip_format_error(
        path,
        "The .dict.dz file is missing its dictzip RA field.",
    ))
}

fn dictzip_format_error(path: &Path, message: impl Into<String>) -> StarDictValidationError {
    StarDictValidationError::new(
        StarDictValidationErrorCode::UnsupportedFormat,
        message,
        Some(path),
    )
}

fn stardict_compare(left: &str, right: &str) -> Ordering {
    let folded = left
        .bytes()
        .map(|byte| byte.to_ascii_lowercase())
        .cmp(right.bytes().map(|byte| byte.to_ascii_lowercase()));
    if folded == Ordering::Equal {
        left.as_bytes().cmp(right.as_bytes())
    } else {
        folded
    }
}

fn validate_word_order(
    previous: Option<&str>,
    current: &str,
    path: &Path,
    label: &str,
    error: fn(&Path, String) -> StarDictValidationError,
) -> Result<(), StarDictValidationError> {
    if previous.is_some_and(|word| stardict_compare(word, current) == Ordering::Greater) {
        return Err(error(
            path,
            format!("The {label} entries are not in StarDict order."),
        ));
    }
    Ok(())
}

fn parse_index(
    bytes: &[u8],
    offset_bits: u8,
    expected_entries: u32,
    definition_bytes: u64,
    path: &Path,
) -> Result<Vec<StarDictIndexEntry>, StarDictValidationError> {
    let offset_bytes = usize::from(offset_bits / 8);
    let mut cursor = 0_usize;
    let mut entries = Vec::new();
    let mut previous_word: Option<String> = None;
    entries
        .try_reserve_exact(expected_entries as usize)
        .map_err(|_| limit_error(path, "entry count"))?;
    while cursor < bytes.len() {
        if entries.len() >= expected_entries as usize {
            return Err(index_error(
                path,
                "The .idx file contains more entries than declared.",
            ));
        }
        let word_end = bytes[cursor..]
            .iter()
            .position(|byte| *byte == 0)
            .map(|relative| cursor + relative)
            .ok_or_else(|| index_error(path, "An index headword is not terminated."))?;
        let word_bytes = &bytes[cursor..word_end];
        if word_bytes.is_empty() || word_bytes.len() > MAX_HEADWORD_BYTES {
            return Err(index_error(
                path,
                "An index headword has an invalid length.",
            ));
        }
        let word = std::str::from_utf8(word_bytes)
            .map_err(|_| index_error(path, "An index headword is not UTF-8."))?
            .to_string();
        validate_word_order(previous_word.as_deref(), &word, path, "index", index_error)?;
        cursor = word_end + 1;
        let numeric_end = cursor
            .checked_add(offset_bytes + 4)
            .filter(|end| *end <= bytes.len())
            .ok_or_else(|| index_error(path, "An index entry is truncated."))?;
        let definition_offset = if offset_bits == 64 {
            u64::from_be_bytes(
                bytes[cursor..cursor + 8]
                    .try_into()
                    .expect("validated width"),
            )
        } else {
            u32::from_be_bytes(
                bytes[cursor..cursor + 4]
                    .try_into()
                    .expect("validated width"),
            ) as u64
        };
        cursor += offset_bytes;
        let definition_size = u32::from_be_bytes(
            bytes[cursor..cursor + 4]
                .try_into()
                .expect("validated width"),
        );
        cursor = numeric_end;
        let definition_end = definition_offset
            .checked_add(u64::from(definition_size))
            .filter(|end| *end <= definition_bytes)
            .ok_or_else(|| {
                StarDictValidationError::new(
                    StarDictValidationErrorCode::InvalidDefinitionBounds,
                    format!("The definition range for {word:?} is outside the definition data."),
                    Some(path),
                )
            })?;
        debug_assert!(definition_end <= definition_bytes);
        entries.push(StarDictIndexEntry {
            word: word.clone(),
            definition_offset,
            definition_size,
        });
        previous_word = Some(word);
    }
    if entries.len() != expected_entries as usize {
        return Err(index_error(
            path,
            "The .idx entry count does not match wordcount.",
        ));
    }
    Ok(entries)
}

fn index_error(path: &Path, message: impl Into<String>) -> StarDictValidationError {
    StarDictValidationError::new(
        StarDictValidationErrorCode::MalformedIndex,
        message,
        Some(path),
    )
}

fn parse_synonyms(
    path: Option<&Path>,
    metadata: &StarDictMetadata,
    entry_count: usize,
) -> Result<Vec<StarDictSynonym>, StarDictValidationError> {
    let Some(path) = path else {
        if metadata.synonym_word_count != 0 {
            return Err(StarDictValidationError::new(
                StarDictValidationErrorCode::MissingRequiredFile,
                "The .ifo file declares synonyms but the .syn file is missing.",
                None,
            ));
        }
        return Ok(Vec::new());
    };
    if metadata.synonym_word_count == 0 {
        return Err(synonym_error(
            path,
            "The .syn file is not declared by synwordcount.",
        ));
    }
    let bytes = read_regular_file(path, MAX_SYN_BYTES, "synonym index")?;
    let mut cursor = 0_usize;
    let mut synonyms = Vec::new();
    let mut previous_word: Option<String> = None;
    synonyms
        .try_reserve_exact(metadata.synonym_word_count as usize)
        .map_err(|_| limit_error(path, "synonym count"))?;
    while cursor < bytes.len() {
        if synonyms.len() >= metadata.synonym_word_count as usize {
            return Err(synonym_error(
                path,
                "The .syn file contains more entries than declared.",
            ));
        }
        let word_end = bytes[cursor..]
            .iter()
            .position(|byte| *byte == 0)
            .map(|relative| cursor + relative)
            .ok_or_else(|| synonym_error(path, "A synonym is not terminated."))?;
        let word_bytes = &bytes[cursor..word_end];
        if word_bytes.is_empty() || word_bytes.len() > MAX_HEADWORD_BYTES {
            return Err(synonym_error(path, "A synonym has an invalid length."));
        }
        let word = std::str::from_utf8(word_bytes)
            .map_err(|_| synonym_error(path, "A synonym is not UTF-8."))?
            .to_string();
        validate_word_order(
            previous_word.as_deref(),
            &word,
            path,
            "synonym",
            synonym_error,
        )?;
        cursor = word_end + 1;
        let target_end = cursor
            .checked_add(4)
            .filter(|end| *end <= bytes.len())
            .ok_or_else(|| synonym_error(path, "A synonym target is truncated."))?;
        let target_index = u32::from_be_bytes(
            bytes[cursor..target_end]
                .try_into()
                .expect("validated width"),
        );
        if target_index as usize >= entry_count {
            return Err(StarDictValidationError::new(
                StarDictValidationErrorCode::InvalidSynonymTarget,
                format!("The synonym {word:?} references a missing index entry."),
                Some(path),
            ));
        }
        cursor = target_end;
        synonyms.push(StarDictSynonym {
            word: word.clone(),
            target_index,
        });
        previous_word = Some(word);
    }
    if synonyms.len() != metadata.synonym_word_count as usize {
        return Err(synonym_error(
            path,
            "The .syn entry count does not match synwordcount.",
        ));
    }
    Ok(synonyms)
}

fn synonym_error(path: &Path, message: impl Into<String>) -> StarDictValidationError {
    StarDictValidationError::new(
        StarDictValidationErrorCode::MalformedSynonyms,
        message,
        Some(path),
    )
}

fn source_fact(
    kind: StarDictSourceFileKind,
    path: &Path,
) -> Result<StarDictSourceFile, StarDictValidationError> {
    let byte_length = fs::metadata(path)
        .map_err(|error| {
            StarDictValidationError::new(
                StarDictValidationErrorCode::Unavailable,
                format!("Unable to inspect a validated StarDict source file: {error}"),
                Some(path),
            )
        })?
        .len();
    let file_name = path
        .file_name()
        .and_then(OsStr::to_str)
        .ok_or_else(|| {
            StarDictValidationError::new(
                StarDictValidationErrorCode::InvalidPackageRoot,
                "A StarDict source filename is not valid UTF-8.",
                Some(path),
            )
        })?
        .to_string();
    Ok(StarDictSourceFile {
        kind,
        file_name,
        path: path.to_path_buf(),
        byte_length,
    })
}

#[cfg(test)]
#[path = "stardict_validation_tests.rs"]
mod tests;
