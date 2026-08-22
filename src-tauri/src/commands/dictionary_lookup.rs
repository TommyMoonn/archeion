use std::{
    collections::HashMap,
    fmt,
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
};

use flate2::{Decompress, FlushDecompress, Status};
use serde::Serialize;

use super::{
    dictionary_index::{normalize_dictionary_term, DictionaryLookupEntry},
    dictionary_morphology::english_lemma_candidates,
    dictionary_store::{open_current_store, DictionaryStoreError},
    stardict_validation,
};

const MAX_LOOKUP_TERM_CHARS: usize = 256;
const MAX_LOOKUP_CANDIDATES: usize = 64;
const MAX_LOOKUP_RESULTS: usize = 32;
const MAX_DEFINITION_BYTES_PER_ENTRY: usize = 256 * 1024;
const MAX_TOTAL_RESULT_BYTES: usize = 1024 * 1024;
const MAX_TEXT_BLOCKS_PER_ENTRY: usize = 16;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DictionaryLookupResponse {
    pub normalized_query: String,
    pub entries: Vec<DictionaryDefinitionEntry>,
    pub truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DictionaryDefinitionEntry {
    pub dictionary_id: String,
    pub dictionary_name: String,
    pub display_headword: String,
    pub definition_text_blocks: Vec<String>,
    pub source_attribution: String,
}

#[derive(Clone, Default)]
pub(crate) struct DictionaryLookupService;

impl DictionaryLookupService {
    pub(crate) fn lookup(
        &self,
        app_data_root: &Path,
        term: &str,
    ) -> Result<DictionaryLookupResponse, DictionaryLookupError> {
        if term.chars().take(MAX_LOOKUP_TERM_CHARS + 1).count() > MAX_LOOKUP_TERM_CHARS {
            return Err(DictionaryLookupError::InvalidTerm);
        }
        let normalized_query = normalize_dictionary_term(term);
        if normalized_query.is_empty() || normalized_query.chars().count() > MAX_LOOKUP_TERM_CHARS {
            return Err(DictionaryLookupError::InvalidTerm);
        }

        let store = open_current_store(app_data_root)?;
        let mut candidates = store.lookup_exact(&normalized_query, MAX_LOOKUP_CANDIDATES)?;
        if candidates.is_empty() {
            let lemmas = english_lemma_candidates(&normalized_query);
            candidates = store.lookup_english_lemmas(&lemmas, MAX_LOOKUP_CANDIDATES)?;
        }
        let mut sources = HashMap::new();
        let mut entries = Vec::new();
        let mut response_bytes = 64 + json_size(&normalized_query);
        let mut truncated = false;

        for (candidate_index, candidate) in candidates.iter().enumerate() {
            if entries.len() == MAX_LOOKUP_RESULTS {
                truncated = true;
                break;
            }
            if !sources.contains_key(&candidate.dictionary_id) {
                let source = DictionaryDefinitionSource::open(
                    &store.installed_path(&candidate.dictionary_id)?,
                )?;
                sources.insert(candidate.dictionary_id.clone(), source);
            }
            let source = sources
                .get(&candidate.dictionary_id)
                .expect("definition source was inserted");
            let definition = source.read(candidate)?;
            let blocks = decode_definition(&definition, source.same_type_sequence.as_deref())?;
            if blocks.is_empty() {
                continue;
            }
            let entry = DictionaryDefinitionEntry {
                dictionary_id: candidate.dictionary_id.clone(),
                dictionary_name: candidate.dictionary_name.clone(),
                display_headword: candidate.display_headword.clone(),
                definition_text_blocks: blocks,
                source_attribution: candidate.source_attribution.clone(),
            };
            let entry_bytes = serialized_text_bytes(&entry);
            if response_bytes.saturating_add(entry_bytes) > MAX_TOTAL_RESULT_BYTES {
                truncated = true;
                break;
            }
            response_bytes += entry_bytes;
            entries.push(entry);
            if candidate_index + 1 == MAX_LOOKUP_CANDIDATES {
                truncated = true;
            }
        }

        Ok(DictionaryLookupResponse {
            normalized_query,
            entries,
            truncated,
        })
    }
}

struct DictionaryDefinitionSource {
    path: PathBuf,
    compression: DefinitionCompression,
    same_type_sequence: Option<String>,
}

impl DictionaryDefinitionSource {
    fn open(installed_path: &Path) -> Result<Self, DictionaryLookupError> {
        let metadata = stardict_validation::read_metadata(&installed_path.join("dictionary.ifo"))?;
        let plain = installed_path.join("dictionary.dict");
        let compressed = installed_path.join("dictionary.dict.dz");
        let has_plain = is_regular_file(&plain)?;
        let has_compressed = is_regular_file(&compressed)?;
        let (path, compression) = match (has_plain, has_compressed) {
            (true, false) => (plain, DefinitionCompression::None),
            (false, true) => (compressed, DefinitionCompression::Dictzip),
            _ => return Err(DictionaryLookupError::InvalidDefinitionPayload),
        };
        Ok(Self {
            path,
            compression,
            same_type_sequence: metadata.same_type_sequence,
        })
    }

    fn read(&self, candidate: &DictionaryLookupEntry) -> Result<Vec<u8>, DictionaryLookupError> {
        let length = usize::try_from(candidate.definition_length)
            .map_err(|_| DictionaryLookupError::DefinitionTooLarge)?;
        if length > MAX_DEFINITION_BYTES_PER_ENTRY {
            return Err(DictionaryLookupError::DefinitionTooLarge);
        }
        match self.compression {
            DefinitionCompression::None => read_plain_range(
                &self.path,
                candidate.definition_offset,
                candidate.definition_length,
            ),
            DefinitionCompression::Dictzip => read_dictzip_range(
                &self.path,
                candidate.definition_offset,
                candidate.definition_length,
            ),
        }
    }
}

#[derive(Clone, Copy)]
enum DefinitionCompression {
    None,
    Dictzip,
}

fn is_regular_file(path: &Path) -> Result<bool, DictionaryLookupError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(metadata.file_type().is_file()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(DictionaryLookupError::Filesystem(error)),
    }
}

fn read_plain_range(
    path: &Path,
    offset: u64,
    length: u32,
) -> Result<Vec<u8>, DictionaryLookupError> {
    let metadata = fs::symlink_metadata(path)?;
    let end = offset
        .checked_add(u64::from(length))
        .filter(|end| *end <= metadata.len())
        .ok_or(DictionaryLookupError::InvalidDefinitionBounds)?;
    debug_assert!(end <= metadata.len());
    let mut file = File::open(path)?;
    file.seek(SeekFrom::Start(offset))?;
    let mut bytes = vec![0_u8; length as usize];
    file.read_exact(&mut bytes)
        .map_err(|_| DictionaryLookupError::InvalidDefinitionBounds)?;
    Ok(bytes)
}

struct DictzipIndex {
    data_offset: u64,
    chunk_length: usize,
    compressed_sizes: Vec<u16>,
    expanded_size: u64,
}

fn read_dictzip_range(
    path: &Path,
    offset: u64,
    length: u32,
) -> Result<Vec<u8>, DictionaryLookupError> {
    let mut file = File::open(path)?;
    let index = read_dictzip_index(&mut file)?;
    let end = offset
        .checked_add(u64::from(length))
        .filter(|end| *end <= index.expanded_size)
        .ok_or(DictionaryLookupError::InvalidDefinitionBounds)?;
    if length == 0 {
        return Ok(Vec::new());
    }
    let chunk_length = index.chunk_length as u64;
    let first_chunk = usize::try_from(offset / chunk_length)
        .map_err(|_| DictionaryLookupError::InvalidDefinitionBounds)?;
    let last_chunk = usize::try_from((end - 1) / chunk_length)
        .map_err(|_| DictionaryLookupError::InvalidDefinitionBounds)?;
    if last_chunk >= index.compressed_sizes.len() {
        return Err(DictionaryLookupError::InvalidDefinitionBounds);
    }
    let preceding_bytes = index.compressed_sizes[..first_chunk]
        .iter()
        .try_fold(0_u64, |total, size| total.checked_add(u64::from(*size)))
        .ok_or(DictionaryLookupError::InvalidDefinitionPayload)?;
    file.seek(SeekFrom::Start(
        index
            .data_offset
            .checked_add(preceding_bytes)
            .ok_or(DictionaryLookupError::InvalidDefinitionPayload)?,
    ))?;

    let mut expanded = Vec::with_capacity((last_chunk - first_chunk + 1) * index.chunk_length);
    for chunk_index in first_chunk..=last_chunk {
        let compressed_size = usize::from(index.compressed_sizes[chunk_index]);
        let mut compressed = vec![0_u8; compressed_size];
        file.read_exact(&mut compressed)
            .map_err(|_| DictionaryLookupError::InvalidDefinitionPayload)?;
        let expected_expanded_length = expected_dictzip_chunk_length(&index, chunk_index)?;
        let mut chunk = Vec::with_capacity(expected_expanded_length + 1);
        let mut decoder = Decompress::new(false);
        let status = decoder
            .decompress_vec(&compressed, &mut chunk, FlushDecompress::Sync)
            .map_err(|_| DictionaryLookupError::InvalidDefinitionPayload)?;
        let is_final_chunk = chunk_index + 1 == index.compressed_sizes.len();
        if decoder.total_in() != compressed_size as u64
            || chunk.len() != expected_expanded_length
            || (is_final_chunk && status != Status::StreamEnd)
            || (!is_final_chunk && status == Status::StreamEnd)
        {
            return Err(DictionaryLookupError::InvalidDefinitionPayload);
        }
        expanded.extend_from_slice(&chunk);
    }

    let first_chunk_offset = (first_chunk as u64)
        .checked_mul(chunk_length)
        .ok_or(DictionaryLookupError::InvalidDefinitionBounds)?;
    let local_start = usize::try_from(offset - first_chunk_offset)
        .map_err(|_| DictionaryLookupError::InvalidDefinitionBounds)?;
    let local_end = local_start
        .checked_add(length as usize)
        .filter(|end| *end <= expanded.len())
        .ok_or(DictionaryLookupError::InvalidDefinitionBounds)?;
    Ok(expanded[local_start..local_end].to_vec())
}

fn expected_dictzip_chunk_length(
    index: &DictzipIndex,
    chunk_index: usize,
) -> Result<usize, DictionaryLookupError> {
    let chunk_start = (chunk_index as u64)
        .checked_mul(index.chunk_length as u64)
        .ok_or(DictionaryLookupError::InvalidDefinitionPayload)?;
    let remaining = index
        .expanded_size
        .checked_sub(chunk_start)
        .filter(|remaining| *remaining > 0)
        .ok_or(DictionaryLookupError::InvalidDefinitionPayload)?;
    usize::try_from(remaining.min(index.chunk_length as u64))
        .map_err(|_| DictionaryLookupError::InvalidDefinitionPayload)
}

fn read_dictzip_index(file: &mut File) -> Result<DictzipIndex, DictionaryLookupError> {
    const FEXTRA: u8 = 0x04;
    const FNAME: u8 = 0x08;
    const FCOMMENT: u8 = 0x10;
    const FHCRC: u8 = 0x02;
    let file_size = file.metadata()?.len();
    let mut fixed = [0_u8; 10];
    file.read_exact(&mut fixed)
        .map_err(|_| DictionaryLookupError::InvalidDefinitionPayload)?;
    if fixed[0..3] != [0x1f, 0x8b, 0x08] || fixed[3] & FEXTRA == 0 {
        return Err(DictionaryLookupError::InvalidDefinitionPayload);
    }
    let mut xlen = [0_u8; 2];
    file.read_exact(&mut xlen)
        .map_err(|_| DictionaryLookupError::InvalidDefinitionPayload)?;
    let mut extra = vec![0_u8; usize::from(u16::from_le_bytes(xlen))];
    file.read_exact(&mut extra)
        .map_err(|_| DictionaryLookupError::InvalidDefinitionPayload)?;
    let (chunk_length, compressed_sizes) = parse_random_access_field(&extra)?;
    if fixed[3] & FNAME != 0 {
        read_zero_terminated_header(file)?;
    }
    if fixed[3] & FCOMMENT != 0 {
        read_zero_terminated_header(file)?;
    }
    if fixed[3] & FHCRC != 0 {
        let mut crc = [0_u8; 2];
        file.read_exact(&mut crc)
            .map_err(|_| DictionaryLookupError::InvalidDefinitionPayload)?;
    }
    let data_offset = file.stream_position()?;
    if file_size < data_offset.saturating_add(8) {
        return Err(DictionaryLookupError::InvalidDefinitionPayload);
    }
    let compressed_bytes = compressed_sizes
        .iter()
        .try_fold(0_u64, |total, size| total.checked_add(u64::from(*size)))
        .ok_or(DictionaryLookupError::InvalidDefinitionPayload)?;
    if data_offset
        .checked_add(compressed_bytes)
        .and_then(|end| end.checked_add(8))
        != Some(file_size)
    {
        return Err(DictionaryLookupError::InvalidDefinitionPayload);
    }
    file.seek(SeekFrom::End(-4))?;
    let mut expanded_size = [0_u8; 4];
    file.read_exact(&mut expanded_size)?;
    let expanded_size = u64::from(u32::from_le_bytes(expanded_size));
    let expected_chunks = expanded_size.div_ceil(chunk_length as u64);
    if expected_chunks != compressed_sizes.len() as u64 {
        return Err(DictionaryLookupError::InvalidDefinitionPayload);
    }
    Ok(DictzipIndex {
        data_offset,
        chunk_length,
        compressed_sizes,
        expanded_size,
    })
}

fn parse_random_access_field(extra: &[u8]) -> Result<(usize, Vec<u16>), DictionaryLookupError> {
    let mut cursor = 0_usize;
    while cursor < extra.len() {
        let header_end = cursor
            .checked_add(4)
            .filter(|end| *end <= extra.len())
            .ok_or(DictionaryLookupError::InvalidDefinitionPayload)?;
        let field_length = usize::from(u16::from_le_bytes([extra[cursor + 2], extra[cursor + 3]]));
        let field_end = header_end
            .checked_add(field_length)
            .filter(|end| *end <= extra.len())
            .ok_or(DictionaryLookupError::InvalidDefinitionPayload)?;
        if extra[cursor..cursor + 2] == *b"RA" {
            let payload = &extra[header_end..field_end];
            if payload.len() < 6 || u16::from_le_bytes([payload[0], payload[1]]) != 1 {
                return Err(DictionaryLookupError::InvalidDefinitionPayload);
            }
            let chunk_length = usize::from(u16::from_le_bytes([payload[2], payload[3]]));
            let chunk_count = usize::from(u16::from_le_bytes([payload[4], payload[5]]));
            if chunk_length == 0 || payload.len() != 6 + chunk_count.saturating_mul(2) {
                return Err(DictionaryLookupError::InvalidDefinitionPayload);
            }
            let compressed_sizes = payload[6..]
                .chunks_exact(2)
                .map(|size| u16::from_le_bytes([size[0], size[1]]))
                .collect::<Vec<_>>();
            if compressed_sizes.contains(&0) {
                return Err(DictionaryLookupError::InvalidDefinitionPayload);
            }
            return Ok((chunk_length, compressed_sizes));
        }
        cursor = field_end;
    }
    Err(DictionaryLookupError::InvalidDefinitionPayload)
}

fn read_zero_terminated_header(file: &mut File) -> Result<(), DictionaryLookupError> {
    for _ in 0..=u16::MAX {
        let mut byte = [0_u8; 1];
        file.read_exact(&mut byte)
            .map_err(|_| DictionaryLookupError::InvalidDefinitionPayload)?;
        if byte[0] == 0 {
            return Ok(());
        }
    }
    Err(DictionaryLookupError::InvalidDefinitionPayload)
}

fn decode_definition(
    definition: &[u8],
    same_type_sequence: Option<&str>,
) -> Result<Vec<String>, DictionaryLookupError> {
    let mut blocks = Vec::new();
    let mut cursor = 0_usize;
    if let Some(sequence) = same_type_sequence {
        for (index, kind) in sequence.bytes().enumerate() {
            let is_last = index + 1 == sequence.len();
            let field = read_definition_field(definition, &mut cursor, kind, is_last)?;
            append_text_block(&mut blocks, kind, field)?;
        }
        if cursor != definition.len() {
            return Err(DictionaryLookupError::InvalidDefinitionPayload);
        }
    } else {
        while cursor < definition.len() {
            let kind = definition[cursor];
            cursor += 1;
            if !kind.is_ascii_alphabetic() {
                return Err(DictionaryLookupError::InvalidDefinitionPayload);
            }
            let field = read_definition_field(definition, &mut cursor, kind, false)?;
            append_text_block(&mut blocks, kind, field)?;
        }
    }
    Ok(blocks)
}

fn read_definition_field<'a>(
    definition: &'a [u8],
    cursor: &mut usize,
    kind: u8,
    consume_remainder: bool,
) -> Result<&'a [u8], DictionaryLookupError> {
    if kind.is_ascii_lowercase() {
        if consume_remainder {
            let field = &definition[*cursor..];
            *cursor = definition.len();
            return Ok(field);
        }
        let relative_end = definition[*cursor..]
            .iter()
            .position(|byte| *byte == 0)
            .ok_or(DictionaryLookupError::InvalidDefinitionPayload)?;
        let end = *cursor + relative_end;
        let field = &definition[*cursor..end];
        *cursor = end + 1;
        Ok(field)
    } else {
        let length_end = (*cursor)
            .checked_add(4)
            .filter(|end| *end <= definition.len())
            .ok_or(DictionaryLookupError::InvalidDefinitionPayload)?;
        let length = u32::from_be_bytes(
            definition[*cursor..length_end]
                .try_into()
                .expect("validated definition field length"),
        ) as usize;
        let field_end = length_end
            .checked_add(length)
            .filter(|end| *end <= definition.len())
            .ok_or(DictionaryLookupError::InvalidDefinitionPayload)?;
        let field = &definition[length_end..field_end];
        *cursor = field_end;
        Ok(field)
    }
}

fn append_text_block(
    blocks: &mut Vec<String>,
    kind: u8,
    field: &[u8],
) -> Result<(), DictionaryLookupError> {
    if !matches!(kind, b'm' | b'g' | b't' | b'x' | b'y' | b'k' | b'w' | b'h') {
        return Ok(());
    }
    if blocks.len() == MAX_TEXT_BLOCKS_PER_ENTRY {
        return Err(DictionaryLookupError::DefinitionTooLarge);
    }
    let text =
        std::str::from_utf8(field).map_err(|_| DictionaryLookupError::InvalidDefinitionPayload)?;
    if !text.is_empty() {
        blocks.push(
            text.chars()
                .map(|character| {
                    if character.is_control() && !matches!(character, '\n' | '\r' | '\t') {
                        '\u{fffd}'
                    } else {
                        character
                    }
                })
                .collect(),
        );
    }
    Ok(())
}

fn serialized_text_bytes(entry: &DictionaryDefinitionEntry) -> usize {
    json_size(entry)
}

fn json_size<T: Serialize>(value: &T) -> usize {
    serde_json::to_vec(value)
        .map(|bytes| bytes.len())
        .unwrap_or(usize::MAX)
}

#[derive(Debug)]
pub(crate) enum DictionaryLookupError {
    DefinitionTooLarge,
    Filesystem(std::io::Error),
    InvalidDefinitionBounds,
    InvalidDefinitionPayload,
    InvalidTerm,
    Store(DictionaryStoreError),
    Validation(stardict_validation::StarDictValidationError),
}

impl fmt::Display for DictionaryLookupError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::DefinitionTooLarge => formatter.write_str(
                "A matching dictionary definition exceeds the supported lookup response size.",
            ),
            Self::Filesystem(error) => write!(
                formatter,
                "Installed dictionary definition data is unavailable: {error}"
            ),
            Self::InvalidDefinitionBounds => formatter.write_str(
                "A matching dictionary entry points outside its installed definition data.",
            ),
            Self::InvalidDefinitionPayload => formatter.write_str(
                "A matching dictionary definition has an unsupported or malformed payload.",
            ),
            Self::InvalidTerm => formatter.write_str("The dictionary lookup term is invalid."),
            Self::Store(error) => write!(formatter, "{error}"),
            Self::Validation(error) => write!(formatter, "{error}"),
        }
    }
}

impl From<std::io::Error> for DictionaryLookupError {
    fn from(value: std::io::Error) -> Self {
        Self::Filesystem(value)
    }
}

impl From<DictionaryStoreError> for DictionaryLookupError {
    fn from(value: DictionaryStoreError) -> Self {
        Self::Store(value)
    }
}

impl From<stardict_validation::StarDictValidationError> for DictionaryLookupError {
    fn from(value: stardict_validation::StarDictValidationError) -> Self {
        Self::Validation(value)
    }
}

#[cfg(test)]
#[path = "dictionary_lookup_tests.rs"]
mod tests;
