use std::{
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use flate2::{write::DeflateEncoder, Compression};

use crate::commands::dictionary_store::DictionaryStore;

use super::{
    validate_package, StarDictDefinitionCompression, StarDictValidationErrorCode,
    MAX_COMPRESSED_DICTIONARY_BYTES, MAX_IDX_BYTES, MAX_IFO_BYTES,
};

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new(label: &str) -> Self {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should follow the epoch")
            .as_nanos();
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "archeion-stardict-{label}-{}-{timestamp}-{sequence}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("test package directory should be created");
        Self(path)
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TestDirectory {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn index_entry(word: &str, offset: u32, size: u32) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(word.as_bytes());
    bytes.push(0);
    bytes.extend_from_slice(&offset.to_be_bytes());
    bytes.extend_from_slice(&size.to_be_bytes());
    bytes
}

fn index_entry_64(word: &str, offset: u64, size: u32) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(word.as_bytes());
    bytes.push(0);
    bytes.extend_from_slice(&offset.to_be_bytes());
    bytes.extend_from_slice(&size.to_be_bytes());
    bytes
}

fn synonym_entry(word: &str, target: u32) -> Vec<u8> {
    let mut bytes = Vec::new();
    bytes.extend_from_slice(word.as_bytes());
    bytes.push(0);
    bytes.extend_from_slice(&target.to_be_bytes());
    bytes
}

fn metadata(index_size: usize, word_count: u32, extra: &str) -> String {
    format!(
        "StarDict's dict ifo file\nversion=2.4.2\nbookname=Fixture Dictionary\nwordcount={word_count}\nidxfilesize={index_size}\nsametypesequence=m\n{extra}"
    )
}

fn write_plain_package(root: &Path, extra_metadata: &str) -> PathBuf {
    let definitions = b"firstsecond";
    let mut index = index_entry("alpha", 0, 5);
    index.extend(index_entry("beta", 5, 6));
    let ifo = root.join("fixture.ifo");
    fs::write(&ifo, metadata(index.len(), 2, extra_metadata)).unwrap();
    fs::write(root.join("fixture.idx"), index).unwrap();
    fs::write(root.join("fixture.dict"), definitions).unwrap();
    ifo
}

fn write_package_with_index(
    root: &Path,
    index: &[u8],
    word_count: u32,
    definitions: &[u8],
) -> PathBuf {
    let ifo = root.join("fixture.ifo");
    fs::write(&ifo, metadata(index.len(), word_count, "")).unwrap();
    fs::write(root.join("fixture.idx"), index).unwrap();
    fs::write(root.join("fixture.dict"), definitions).unwrap();
    ifo
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = u32::MAX;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = (crc >> 1) ^ (0xedb8_8320 & 0_u32.wrapping_sub(crc & 1));
        }
    }
    !crc
}

fn dictzip_fixture(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = DeflateEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(bytes).unwrap();
    let compressed = encoder.finish().unwrap();
    let compressed_size = u16::try_from(compressed.len()).expect("fixture chunk should fit");
    let chunk_length = u16::try_from(bytes.len().max(1)).expect("fixture should fit");

    let mut result = vec![0x1f, 0x8b, 0x08, 0x04, 0, 0, 0, 0, 0, 0xff];
    result.extend_from_slice(&12_u16.to_le_bytes());
    result.extend_from_slice(b"RA");
    result.extend_from_slice(&8_u16.to_le_bytes());
    result.extend_from_slice(&1_u16.to_le_bytes());
    result.extend_from_slice(&chunk_length.to_le_bytes());
    result.extend_from_slice(&1_u16.to_le_bytes());
    result.extend_from_slice(&compressed_size.to_le_bytes());
    result.extend_from_slice(&compressed);
    result.extend_from_slice(&crc32(bytes).to_le_bytes());
    result.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    result
}

#[test]
fn valid_plain_package_returns_metadata_entries_and_source_facts() {
    let directory = TestDirectory::new("plain");
    let ifo = write_plain_package(directory.path(), "description=Useful fixture\n");

    let package = validate_package(&ifo).expect("valid package should pass");

    assert_eq!(package.package_name, "fixture");
    assert_eq!(package.metadata.book_name, "Fixture Dictionary");
    assert_eq!(package.metadata.word_count, 2);
    assert_eq!(
        package.metadata.description.as_deref(),
        Some("Useful fixture")
    );
    assert_eq!(package.entries[0].word, "alpha");
    assert_eq!(package.entries[1].definition_offset, 5);
    assert_eq!(
        package.definition_data.compression,
        StarDictDefinitionCompression::None
    );
    assert_eq!(package.definition_data.expanded_bytes, 11);
    assert_eq!(package.source_files.len(), 3);
    assert!(package
        .source_files
        .iter()
        .all(|source| source.path.is_absolute()));
}

#[test]
fn valid_dict_dz_uses_the_bounded_compressed_definition_path() {
    let directory = TestDirectory::new("dict-dz");
    let mut index = index_entry_64("alpha", 0, 5);
    index.extend(index_entry_64("beta", 5, 6));
    let ifo = directory.path().join("fixture.ifo");
    let metadata = metadata(index.len(), 2, "idxoffsetbits=64\n").replace("2.4.2", "3.0.0");
    fs::write(&ifo, metadata).unwrap();
    fs::write(directory.path().join("fixture.idx"), index).unwrap();
    fs::write(
        directory.path().join("fixture.dict.dz"),
        dictzip_fixture(b"firstsecond"),
    )
    .unwrap();

    let package = validate_package(&ifo).expect("valid compressed package should pass");

    assert_eq!(
        package.definition_data.compression,
        StarDictDefinitionCompression::Dictzip
    );
    assert_eq!(package.metadata.index_offset_bits, 64);
    assert_eq!(package.definition_data.expanded_bytes, 11);
    assert_eq!(package.entries.len(), 2);
}

#[test]
fn metadata_accepts_supported_whitespace_and_line_endings() {
    for (label, separator) in [("lf", "\n"), ("crlf", "\r\n"), ("cr", "\r")] {
        let directory = TestDirectory::new(label);
        let mut index = index_entry("alpha", 0, 5);
        index.extend(index_entry("beta", 5, 6));
        let fields = [
            "StarDict's dict ifo file",
            "  version = 2.4.2  ",
            " bookname = Fixture Dictionary ",
            "wordcount = 2",
            &format!(" idxfilesize = {} ", index.len()),
            " sametypesequence = m ",
            " source_url-1 = https://example.invalid/dictionary ",
            " description = ",
        ];
        let ifo = directory.path().join("fixture.ifo");
        fs::write(&ifo, fields.join(separator)).unwrap();
        fs::write(directory.path().join("fixture.idx"), &index).unwrap();
        fs::write(directory.path().join("fixture.dict"), b"firstsecond").unwrap();

        let package = validate_package(&ifo).expect("supported metadata form should pass");
        assert_eq!(package.metadata.book_name, "Fixture Dictionary");
    }
}

#[test]
fn metadata_rejects_version_order_and_invalid_key_syntax() {
    let ordering = TestDirectory::new("metadata-order");
    let ifo = write_plain_package(ordering.path(), "");
    let contents = fs::read_to_string(&ifo).unwrap();
    let malformed = contents.replacen(
        "version=2.4.2\nbookname=Fixture Dictionary",
        "bookname=Fixture Dictionary\nversion=2.4.2",
        1,
    );
    fs::write(&ifo, malformed).unwrap();
    let error = validate_package(&ifo).unwrap_err();
    assert_eq!(error.code, StarDictValidationErrorCode::MalformedMetadata);

    let key = TestDirectory::new("metadata-key");
    let ifo = write_plain_package(key.path(), "bad key=value\n");
    let error = validate_package(&ifo).unwrap_err();
    assert_eq!(error.code, StarDictValidationErrorCode::MalformedMetadata);
}

#[test]
fn index_and_synonym_words_enforce_stardict_length_and_order() {
    let ordered = TestDirectory::new("ordered-words");
    let mut index = index_entry("Alpha", 0, 1);
    index.extend(index_entry("alpha", 1, 1));
    index.extend(index_entry("beta", 2, 1));
    let ifo = write_package_with_index(ordered.path(), &index, 3, b"abc");
    let package = validate_package(&ifo).expect("StarDict-ordered entries should pass");
    assert_eq!(package.entries.len(), 3);

    let duplicate = TestDirectory::new("duplicate-headwords");
    let mut index = index_entry("alpha", 0, 1);
    index.extend(index_entry("alpha", 1, 1));
    let ifo = write_package_with_index(duplicate.path(), &index, 2, b"ab");
    let package = validate_package(&ifo).expect("duplicate headwords should remain compatible");
    assert_eq!(package.entries[0].word, package.entries[1].word);

    let unordered = TestDirectory::new("unordered-index");
    let mut index = index_entry("beta", 0, 1);
    index.extend(index_entry("alpha", 1, 1));
    let ifo = write_package_with_index(unordered.path(), &index, 2, b"ab");
    let error = validate_package(&ifo).unwrap_err();
    assert_eq!(error.code, StarDictValidationErrorCode::MalformedIndex);

    let overlong = TestDirectory::new("overlong-index");
    let index = index_entry(&"a".repeat(256), 0, 1);
    let ifo = write_package_with_index(overlong.path(), &index, 1, b"a");
    let error = validate_package(&ifo).unwrap_err();
    assert_eq!(error.code, StarDictValidationErrorCode::MalformedIndex);

    let synonym = TestDirectory::new("synonym-structure");
    let ifo = write_plain_package(synonym.path(), "synwordcount=2\n");
    let mut synonyms = synonym_entry("zeta", 0);
    synonyms.extend(synonym_entry("alpha", 1));
    fs::write(synonym.path().join("fixture.syn"), synonyms).unwrap();
    let error = validate_package(&ifo).unwrap_err();
    assert_eq!(error.code, StarDictValidationErrorCode::MalformedSynonyms);

    let overlong_synonym = TestDirectory::new("overlong-synonym");
    let ifo = write_plain_package(overlong_synonym.path(), "synwordcount=1\n");
    fs::write(
        overlong_synonym.path().join("fixture.syn"),
        synonym_entry(&"s".repeat(256), 0),
    )
    .unwrap();
    let error = validate_package(&ifo).unwrap_err();
    assert_eq!(error.code, StarDictValidationErrorCode::MalformedSynonyms);
}

#[test]
fn optional_synonyms_are_validated_against_index_entries() {
    let directory = TestDirectory::new("synonyms");
    let ifo = write_plain_package(directory.path(), "synwordcount=2\n");
    let mut synonyms = synonym_entry("first", 0);
    synonyms.extend(synonym_entry("second", 1));
    fs::write(directory.path().join("fixture.syn"), synonyms).unwrap();

    let package = validate_package(&ifo).expect("valid synonyms should pass");

    assert_eq!(package.synonyms.len(), 2);
    assert_eq!(package.synonyms[1].target_index, 1);
    assert_eq!(package.source_files.len(), 4);
}

#[test]
fn invalid_package_shapes_return_contained_typed_errors() {
    let missing = TestDirectory::new("missing");
    let missing_ifo = missing.path().join("fixture.ifo");
    fs::write(&missing_ifo, metadata(0, 0, "")).unwrap();
    let error = validate_package(&missing_ifo).unwrap_err();
    assert_eq!(error.code, StarDictValidationErrorCode::MissingRequiredFile);

    let unsupported = TestDirectory::new("unsupported");
    let unsupported_ifo = write_plain_package(unsupported.path(), "");
    let text = fs::read_to_string(&unsupported_ifo)
        .unwrap()
        .replace("2.4.2", "1.0.0");
    fs::write(&unsupported_ifo, text).unwrap();
    let error = validate_package(&unsupported_ifo).unwrap_err();
    assert_eq!(error.code, StarDictValidationErrorCode::UnsupportedVersion);

    let unsupported_format = TestDirectory::new("unsupported-format");
    let unsupported_format_ifo =
        write_plain_package(unsupported_format.path(), "idxoffsetbits=64\n");
    let error = validate_package(&unsupported_format_ifo).unwrap_err();
    assert_eq!(error.code, StarDictValidationErrorCode::UnsupportedFormat);

    let malformed = TestDirectory::new("malformed-index");
    let malformed_ifo = malformed.path().join("fixture.ifo");
    fs::write(&malformed_ifo, metadata(5, 1, "")).unwrap();
    fs::write(malformed.path().join("fixture.idx"), b"word\0").unwrap();
    fs::write(malformed.path().join("fixture.dict"), b"definition").unwrap();
    let error = validate_package(&malformed_ifo).unwrap_err();
    assert_eq!(error.code, StarDictValidationErrorCode::MalformedIndex);

    let bounds = TestDirectory::new("bounds");
    let bounds_ifo = bounds.path().join("fixture.ifo");
    let bounds_index = index_entry("word", 4, 8);
    fs::write(&bounds_ifo, metadata(bounds_index.len(), 1, "")).unwrap();
    fs::write(bounds.path().join("fixture.idx"), bounds_index).unwrap();
    fs::write(bounds.path().join("fixture.dict"), b"small").unwrap();
    let error = validate_package(&bounds_ifo).unwrap_err();
    assert_eq!(
        error.code,
        StarDictValidationErrorCode::InvalidDefinitionBounds
    );

    let synonym = TestDirectory::new("invalid-synonym");
    let synonym_ifo = write_plain_package(synonym.path(), "synwordcount=1\n");
    fs::write(
        synonym.path().join("fixture.syn"),
        synonym_entry("missing", 2),
    )
    .unwrap();
    let error = validate_package(&synonym_ifo).unwrap_err();
    assert_eq!(
        error.code,
        StarDictValidationErrorCode::InvalidSynonymTarget
    );
}

#[test]
fn metadata_index_and_definition_inputs_are_bounded() {
    let metadata_directory = TestDirectory::new("metadata-limit");
    let metadata_ifo = metadata_directory.path().join("fixture.ifo");
    let oversized_metadata = File::create(&metadata_ifo).unwrap();
    oversized_metadata.set_len(MAX_IFO_BYTES + 1).unwrap();
    let error = validate_package(&metadata_ifo).unwrap_err();
    assert_eq!(error.code, StarDictValidationErrorCode::MissingRequiredFile);
    fs::write(metadata_directory.path().join("fixture.idx"), []).unwrap();
    fs::write(metadata_directory.path().join("fixture.dict"), []).unwrap();
    let error = validate_package(&metadata_ifo).unwrap_err();
    assert_eq!(
        error.code,
        StarDictValidationErrorCode::ResourceLimitExceeded
    );

    let index_directory = TestDirectory::new("index-limit");
    let index_ifo = index_directory.path().join("fixture.ifo");
    fs::write(&index_ifo, metadata((MAX_IDX_BYTES + 1) as usize, 1, "")).unwrap();
    File::create(index_directory.path().join("fixture.idx"))
        .unwrap()
        .set_len(MAX_IDX_BYTES + 1)
        .unwrap();
    fs::write(index_directory.path().join("fixture.dict"), []).unwrap();
    let error = validate_package(&index_ifo).unwrap_err();
    assert_eq!(
        error.code,
        StarDictValidationErrorCode::ResourceLimitExceeded
    );

    let definition_directory = TestDirectory::new("definition-limit");
    let definition_ifo = definition_directory.path().join("fixture.ifo");
    let index = index_entry("word", 0, 0);
    fs::write(&definition_ifo, metadata(index.len(), 1, "")).unwrap();
    fs::write(definition_directory.path().join("fixture.idx"), index).unwrap();
    File::create(definition_directory.path().join("fixture.dict"))
        .unwrap()
        .set_len(MAX_COMPRESSED_DICTIONARY_BYTES + 1)
        .unwrap();
    let error = validate_package(&definition_ifo).unwrap_err();
    assert_eq!(
        error.code,
        StarDictValidationErrorCode::ResourceLimitExceeded
    );
}

#[test]
fn validation_does_not_modify_source_files_or_dictionary_registry_state() {
    let directory = TestDirectory::new("non-mutating");
    let package_root = directory.path().join("source");
    fs::create_dir(&package_root).unwrap();
    let ifo = write_plain_package(&package_root, "");
    let source_paths = [
        ifo.clone(),
        package_root.join("fixture.idx"),
        package_root.join("fixture.dict"),
    ];
    let before = source_paths
        .iter()
        .map(|path| fs::read(path).unwrap())
        .collect::<Vec<_>>();
    let app_data = directory.path().join("app-data");
    let registry_before = DictionaryStore::snapshot(&app_data).unwrap();

    validate_package(&ifo).expect("valid package should pass");

    let after = source_paths
        .iter()
        .map(|path| fs::read(path).unwrap())
        .collect::<Vec<_>>();
    let registry_after = DictionaryStore::snapshot(&app_data).unwrap();
    assert_eq!(after, before);
    assert_eq!(registry_after, registry_before);
}
