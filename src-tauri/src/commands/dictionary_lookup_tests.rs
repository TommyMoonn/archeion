use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use flate2::{Compress, Compression, FlushCompress, Status};

use super::{
    decode_definition, read_dictzip_range, DictionaryLookupError, DictionaryLookupService,
    MAX_DEFINITION_BYTES_PER_ENTRY, MAX_LOOKUP_CANDIDATES, MAX_LOOKUP_TERM_CHARS,
    MAX_TOTAL_RESULT_BYTES,
};
use crate::commands::{
    dictionary_store::{
        open_current_store, DictionaryIndexState, DictionaryRegistration, DictionarySourceKind,
        InstalledDictionary,
    },
    stardict_validation::{
        StarDictDefinitionCompression, StarDictDefinitionData, StarDictIndexEntry,
        StarDictMetadata, StarDictSynonym, ValidatedStarDictPackage,
    },
};

static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new(label: &str) -> Self {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "archeion-dictionary-lookup-{label}-{}-{timestamp}-{sequence}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
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

fn install_dictionary(
    root: &Path,
    name: &str,
    entries: Vec<(&str, Vec<u8>)>,
    synonyms: Vec<(&str, u32)>,
    enabled: bool,
    compressed: bool,
) -> InstalledDictionary {
    install_dictionary_with_sequence(
        root,
        name,
        entries,
        synonyms,
        enabled,
        compressed,
        Some("m"),
    )
}

fn install_dictionary_with_sequence(
    root: &Path,
    name: &str,
    entries: Vec<(&str, Vec<u8>)>,
    synonyms: Vec<(&str, u32)>,
    enabled: bool,
    compressed: bool,
    same_type_sequence: Option<&str>,
) -> InstalledDictionary {
    let mut definition_bytes = Vec::new();
    let mut index_entries = Vec::new();
    for (word, definition) in entries {
        let offset = definition_bytes.len() as u64;
        let size = definition.len() as u32;
        definition_bytes.extend_from_slice(&definition);
        index_entries.push(StarDictIndexEntry {
            word: word.to_string(),
            definition_offset: offset,
            definition_size: size,
        });
    }
    let package = ValidatedStarDictPackage {
        package_name: name.to_lowercase().replace(' ', "-"),
        metadata: StarDictMetadata {
            version: "2.4.2".to_string(),
            book_name: name.to_string(),
            word_count: index_entries.len() as u32,
            synonym_word_count: synonyms.len() as u32,
            index_file_size: 0,
            index_offset_bits: 32,
            same_type_sequence: same_type_sequence.map(str::to_string),
            description: None,
            date: None,
            website: None,
            email: None,
        },
        entries: index_entries,
        synonyms: synonyms
            .into_iter()
            .map(|(word, target_index)| StarDictSynonym {
                word: word.to_string(),
                target_index,
            })
            .collect(),
        definition_data: StarDictDefinitionData {
            compression: if compressed {
                StarDictDefinitionCompression::Dictzip
            } else {
                StarDictDefinitionCompression::None
            },
            stored_bytes: definition_bytes.len() as u64,
            expanded_bytes: definition_bytes.len() as u64,
        },
        source_files: Vec::new(),
    };
    let mut store = open_current_store(root).unwrap();
    let dictionary = store
        .register(DictionaryRegistration {
            display_name: name.to_string(),
            source_language: "en".to_string(),
            target_language: "en".to_string(),
            enabled,
            entry_count: 0,
            installed_size_bytes: definition_bytes.len() as u64,
            source_kind: DictionarySourceKind::ManualImport,
            catalog_id: None,
            source_attribution: format!("{name} source"),
            license_name: "Test license".to_string(),
            license_url: None,
            package_version: "1".to_string(),
            index_state: DictionaryIndexState::Pending,
        })
        .unwrap();
    let installed_path = store.installed_path(&dictionary.id).unwrap();
    fs::create_dir_all(&installed_path).unwrap();
    fs::write(
        installed_path.join("dictionary.ifo"),
        format!(
            "StarDict's dict ifo file\nversion=2.4.2\nbookname={name}\nwordcount={}\nidxfilesize=0\n{}",
            package.entries.len(),
            same_type_sequence
                .map(|sequence| format!("sametypesequence={sequence}\n"))
                .unwrap_or_default()
        ),
    )
    .unwrap();
    if compressed {
        fs::write(
            installed_path.join("dictionary.dict.dz"),
            dictzip_fixture(&definition_bytes),
        )
        .unwrap();
    } else {
        fs::write(installed_path.join("dictionary.dict"), &definition_bytes).unwrap();
    }
    store
        .replace_index(&dictionary.id, &package, definition_bytes.len() as u64)
        .unwrap();
    store.get(&dictionary.id).unwrap().unwrap()
}

fn lookup(root: &Path, term: &str) -> super::DictionaryLookupResponse {
    DictionaryLookupService.lookup(root, term).unwrap()
}

#[test]
fn exact_normalized_phrase_and_synonym_lookup_return_safe_text() {
    let directory = TestDirectory::new("representative");
    let dictionary = install_dictionary(
        directory.path(),
        "Core",
        vec![
            ("Apple", b"A <script>alert('text')</script>".to_vec()),
            ("ice cream", b"A frozen dessert".to_vec()),
            ("rock'n'roll", b"Music".to_vec()),
        ],
        vec![("fruit", 0)],
        true,
        false,
    );

    let exact = lookup(directory.path(), "  ((APPLE!))  ");
    assert_eq!(exact.normalized_query, "apple");
    assert_eq!(exact.entries.len(), 1);
    assert_eq!(exact.entries[0].dictionary_id, dictionary.id);
    assert_eq!(exact.entries[0].dictionary_name, "Core");
    assert_eq!(exact.entries[0].display_headword, "Apple");
    assert_eq!(
        exact.entries[0].definition_text_blocks,
        ["A <script>alert('text')</script>"]
    );
    assert_eq!(exact.entries[0].source_attribution, "Core source");

    assert_eq!(
        lookup(directory.path(), "ice     cream").entries[0].display_headword,
        "ice cream"
    );
    assert_eq!(
        lookup(directory.path(), "rock'n'roll").entries[0].display_headword,
        "rock'n'roll"
    );
    assert_eq!(
        lookup(directory.path(), "FRUIT").entries[0].display_headword,
        "Apple"
    );
}

#[test]
fn regular_morphology_resolves_lemma_only_english_entries() {
    let directory = TestDirectory::new("english-regular-morphology");
    install_dictionary(
        directory.path(),
        "Lemmas",
        vec![
            ("walk", b"walk lemma".to_vec()),
            ("make", b"make lemma".to_vec()),
            ("study", b"study lemma".to_vec()),
            ("run", b"run lemma".to_vec()),
            ("class", b"class lemma".to_vec()),
            ("happy", b"happy lemma".to_vec()),
            ("big", b"big lemma".to_vec()),
            ("large", b"large lemma".to_vec()),
            ("box", b"box lemma".to_vec()),
            ("watch", b"watch lemma".to_vec()),
        ],
        Vec::new(),
        true,
        false,
    );

    for (inflection, lemma) in [
        ("((WALKED!))", "walk"),
        ("making", "make"),
        ("studied", "study"),
        ("running", "run"),
        ("classes", "class"),
        ("happier", "happy"),
        ("happiest", "happy"),
        ("bigger", "big"),
        ("largest", "large"),
        ("boxes", "box"),
        ("watches", "watch"),
    ] {
        let response = lookup(directory.path(), inflection);
        assert_eq!(response.entries.len(), 1, "lookup for {inflection}");
        assert_eq!(response.entries[0].display_headword, lemma);
    }

    assert!(lookup(directory.path(), "ice creams").entries.is_empty());
    assert!(lookup(directory.path(), "quartz").entries.is_empty());
    assert!(lookup(directory.path(), "press").entries.is_empty());

    install_dictionary(
        directory.path(),
        "Exact surface",
        vec![("walked", b"exact surface".to_vec())],
        Vec::new(),
        true,
        false,
    );
    let exact = lookup(directory.path(), "walked");
    assert_eq!(exact.entries.len(), 1);
    assert_eq!(exact.entries[0].display_headword, "walked");
}

#[test]
fn morphology_lookup_keeps_query_and_result_budgets() {
    let directory = TestDirectory::new("morphology-limits");
    let entry_count = MAX_LOOKUP_CANDIDATES + 8;
    install_dictionary(
        directory.path(),
        "Many lemmas",
        (0..entry_count)
            .map(|index| ("walk", format!("definition {index}").into_bytes()))
            .collect(),
        Vec::new(),
        true,
        false,
    );

    let response = lookup(directory.path(), "walked");
    assert_eq!(response.entries.len(), super::MAX_LOOKUP_RESULTS);
    assert!(response.truncated);
}

#[test]
fn morphology_rejects_invalid_collisions_and_preserves_real_ambiguity() {
    let directory = TestDirectory::new("morphology-collisions");
    install_dictionary(
        directory.path(),
        "Collision lemmas",
        vec![
            ("hop", b"mechanical hop".to_vec()),
            ("us", b"mechanical us".to_vec()),
            ("cut", b"mechanical cut".to_vec()),
            ("classe", b"mechanical classe".to_vec()),
            ("runn", b"mechanical runn".to_vec()),
            ("bigg", b"mechanical bigg".to_vec()),
            ("pas", b"mechanical pas".to_vec()),
            ("gass", b"mechanical gass".to_vec()),
            ("buse", b"mechanical buse".to_vec()),
            ("the", b"mechanical the".to_vec()),
            ("bee", b"mechanical bee".to_vec()),
            ("be", b"mechanical be".to_vec()),
            ("he", b"mechanical he".to_vec()),
            ("pry", b"mechanical pry".to_vec()),
            ("fore", b"mechanical fore".to_vec()),
            ("flow", b"mechanical flow".to_vec()),
            ("new", b"mechanical new".to_vec()),
            ("movy", b"mechanical movy".to_vec()),
            ("unty", b"mechanical unty".to_vec()),
            ("bet", b"mechanical bet".to_vec()),
            ("use", b"mechanical use".to_vec()),
        ],
        Vec::new(),
        true,
        false,
    );

    for surface in [
        "hoped", "used", "cuter", "classes", "running", "bigger", "passed", "gassed", "buses",
        "leaves", "thing", "being", "best", "her", "priest", "forest", "flower", "news", "movies",
        "untied", "better", "user",
    ] {
        assert!(
            lookup(directory.path(), surface).entries.is_empty(),
            "lookup for {surface} must wait for package-owned lexical data"
        );
    }
}

#[test]
fn package_alias_resolves_a_lexical_inflection_before_runtime_morphology() {
    let directory = TestDirectory::new("morphology-package-alias");
    install_dictionary(
        directory.path(),
        "Package aliases",
        vec![
            ("gas", b"intended gas".to_vec()),
            ("gass", b"unrelated gass".to_vec()),
            ("leaf", b"leaf lemma".to_vec()),
            ("leave", b"leave lemma".to_vec()),
            ("walk", b"runtime walk candidate".to_vec()),
            ("stride", b"authoritative alias target".to_vec()),
        ],
        vec![("gassed", 0), ("leaves", 2), ("leaves", 3), ("walked", 5)],
        true,
        false,
    );

    let response = lookup(directory.path(), "gassed");
    assert_eq!(response.entries.len(), 1);
    assert_eq!(response.entries[0].display_headword, "gas");

    let response = lookup(directory.path(), "walked");
    assert_eq!(response.entries.len(), 1);
    assert_eq!(response.entries[0].display_headword, "stride");

    assert_eq!(
        lookup(directory.path(), "leaves")
            .entries
            .iter()
            .map(|entry| entry.display_headword.as_str())
            .collect::<Vec<_>>(),
        ["leaf", "leave"]
    );
}

#[test]
fn morphology_preserves_dictionary_order_and_does_not_cross_language_scope() {
    let directory = TestDirectory::new("morphology-scope-order");
    let first = install_dictionary(
        directory.path(),
        "First",
        vec![("class", b"second candidate".to_vec())],
        Vec::new(),
        true,
        false,
    );
    let second = install_dictionary(
        directory.path(),
        "Second",
        vec![
            ("classe", b"first candidate".to_vec()),
            ("class", b"second candidate".to_vec()),
        ],
        Vec::new(),
        true,
        false,
    );
    let non_english = install_dictionary(
        directory.path(),
        "French",
        vec![("walk", b"non-English entry".to_vec())],
        Vec::new(),
        true,
        false,
    );
    let store = open_current_store(directory.path()).unwrap();
    store
        .connection()
        .execute(
            "UPDATE installed_dictionaries
             SET source_language = 'fr', target_language = 'en'
             WHERE dictionary_id = ?1",
            [&non_english.id],
        )
        .unwrap();
    drop(store);

    let response = lookup(directory.path(), "classes");
    assert_eq!(
        response
            .entries
            .iter()
            .map(|entry| (
                entry.dictionary_id.as_str(),
                entry.display_headword.as_str()
            ))
            .collect::<Vec<_>>(),
        [(first.id.as_str(), "class"), (second.id.as_str(), "class"),]
    );

    assert!(lookup(directory.path(), "walked").entries.is_empty());
}

#[test]
fn enabled_dictionaries_follow_configured_order_and_disabled_entries_are_excluded() {
    let directory = TestDirectory::new("order");
    let first = install_dictionary(
        directory.path(),
        "First",
        vec![("shared", b"first".to_vec())],
        Vec::new(),
        true,
        false,
    );
    let second = install_dictionary(
        directory.path(),
        "Second",
        vec![("shared", b"second".to_vec())],
        Vec::new(),
        true,
        false,
    );
    let disabled = install_dictionary(
        directory.path(),
        "Disabled",
        vec![("shared", b"disabled".to_vec())],
        Vec::new(),
        false,
        false,
    );
    let mut store = open_current_store(directory.path()).unwrap();
    store
        .set_order(&[second.id.clone(), disabled.id, first.id.clone()])
        .unwrap();

    let response = lookup(directory.path(), "shared");

    assert_eq!(
        response
            .entries
            .iter()
            .map(|entry| entry.dictionary_id.as_str())
            .collect::<Vec<_>>(),
        [second.id.as_str(), first.id.as_str()]
    );
}

#[test]
fn corrupt_definition_bounds_return_a_contained_lookup_error() {
    let directory = TestDirectory::new("bounds");
    let dictionary = install_dictionary(
        directory.path(),
        "Bounds",
        vec![("broken", b"small".to_vec())],
        Vec::new(),
        true,
        false,
    );
    let store = open_current_store(directory.path()).unwrap();
    store
        .connection()
        .execute(
            "UPDATE dictionary_entries SET definition_offset = 100 WHERE dictionary_id = ?1",
            [&dictionary.id],
        )
        .unwrap();
    drop(store);

    let error = DictionaryLookupService
        .lookup(directory.path(), "broken")
        .unwrap_err();

    assert!(matches!(
        error,
        DictionaryLookupError::InvalidDefinitionBounds
    ));
}

#[test]
fn lookup_term_definition_and_total_result_limits_are_enforced() {
    let directory = TestDirectory::new("limits");
    assert!(matches!(
        DictionaryLookupService.lookup(directory.path(), &"a".repeat(MAX_LOOKUP_TERM_CHARS + 1)),
        Err(DictionaryLookupError::InvalidTerm)
    ));

    install_dictionary(
        directory.path(),
        "Oversized",
        vec![("oversized", vec![b'x'; MAX_DEFINITION_BYTES_PER_ENTRY + 1])],
        Vec::new(),
        true,
        false,
    );
    assert!(matches!(
        DictionaryLookupService.lookup(directory.path(), "oversized"),
        Err(DictionaryLookupError::DefinitionTooLarge)
    ));

    let repeated = (0..5)
        .map(|_| ("many", vec![b'm'; MAX_DEFINITION_BYTES_PER_ENTRY - 1024]))
        .collect();
    install_dictionary(directory.path(), "Many", repeated, Vec::new(), true, false);
    let response = lookup(directory.path(), "many");
    let returned_text_bytes = response
        .entries
        .iter()
        .flat_map(|entry| &entry.definition_text_blocks)
        .map(String::len)
        .sum::<usize>();
    assert!(response.truncated);
    assert!(returned_text_bytes <= MAX_TOTAL_RESULT_BYTES);
    assert!(response.entries.len() < 5);
}

#[test]
fn dictzip_ranges_are_read_locally_and_binary_fields_are_omitted() {
    let directory = TestDirectory::new("dictzip");
    install_dictionary(
        directory.path(),
        "Compressed",
        vec![("compressed", b"local definition".to_vec())],
        Vec::new(),
        true,
        true,
    );

    assert_eq!(
        lookup(directory.path(), "compressed").entries[0].definition_text_blocks,
        ["local definition"]
    );

    let mut mixed = 3_u32.to_be_bytes().to_vec();
    mixed.extend_from_slice(&[0, 1, 2]);
    mixed.extend_from_slice(b"<b>shown as text</b>");
    assert_eq!(
        decode_definition(&mixed, Some("Pm")).unwrap(),
        ["<b>shown as text</b>"]
    );
}

#[test]
fn locale_encoded_definition_fields_are_omitted_without_blocking_later_utf8_text() {
    let directory = TestDirectory::new("locale-field");
    let mut definition = vec![0xff, 0xfe, 0];
    definition.extend_from_slice(b"UTF-8 definition");
    install_dictionary_with_sequence(
        directory.path(),
        "Locale field",
        vec![("localized", definition)],
        Vec::new(),
        true,
        false,
        Some("lm"),
    );

    assert_eq!(
        lookup(directory.path(), "localized").entries[0].definition_text_blocks,
        ["UTF-8 definition"]
    );

    let explicit = [
        b'l', 0xff, 0xfe, 0, b'm', b'E', b'x', b'p', b'l', b'i', b'c', b'i', b't', 0,
    ];
    assert_eq!(decode_definition(&explicit, None).unwrap(), ["Explicit"]);
}

#[test]
fn dictzip_rejects_chunks_that_contradict_the_declared_expanded_layout() {
    let directory = TestDirectory::new("dictzip-chunk-layout");
    let bytes = b"sixteen byte txt";
    assert_eq!(bytes.len(), 16);
    let fixture = dictzip_fixture_from_chunks(&[&bytes[..7], &bytes[7..]], 8);
    let path = directory.path().join("malformed.dict.dz");
    fs::write(&path, fixture).unwrap();

    assert!(matches!(
        read_dictzip_range(&path, 0, 8),
        Err(DictionaryLookupError::InvalidDefinitionPayload)
    ));
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
    let chunk_length = 8_u16;
    let chunks = bytes.chunks(chunk_length as usize).collect::<Vec<_>>();
    dictzip_fixture_from_chunks(&chunks, chunk_length)
}

fn dictzip_fixture_from_chunks(chunks: &[&[u8]], chunk_length: u16) -> Vec<u8> {
    let mut compressor = Compress::new(Compression::default(), false);
    let mut compressed = Vec::new();
    let mut compressed_sizes = Vec::with_capacity(chunks.len());
    for (index, chunk) in chunks.iter().enumerate() {
        let output_start = compressed.len();
        compressed.reserve(chunk.len() + 128);
        let flush = if index + 1 == chunks.len() {
            FlushCompress::Finish
        } else {
            FlushCompress::Full
        };
        let input_start = compressor.total_in();
        let status = compressor
            .compress_vec(chunk, &mut compressed, flush)
            .unwrap();
        assert_eq!(compressor.total_in() - input_start, chunk.len() as u64);
        if index + 1 == chunks.len() {
            assert_eq!(status, Status::StreamEnd);
        } else {
            assert_ne!(status, Status::StreamEnd);
        }
        compressed_sizes.push(u16::try_from(compressed.len() - output_start).unwrap());
    }
    let bytes = chunks.concat();
    let field_length = 6 + compressed_sizes.len() * 2;
    let extra_length = 4 + field_length;
    let mut result = vec![0x1f, 0x8b, 0x08, 0x04, 0, 0, 0, 0, 0, 0xff];
    result.extend_from_slice(&(extra_length as u16).to_le_bytes());
    result.extend_from_slice(b"RA");
    result.extend_from_slice(&(field_length as u16).to_le_bytes());
    result.extend_from_slice(&1_u16.to_le_bytes());
    result.extend_from_slice(&chunk_length.to_le_bytes());
    result.extend_from_slice(&(compressed_sizes.len() as u16).to_le_bytes());
    for size in compressed_sizes {
        result.extend_from_slice(&size.to_le_bytes());
    }
    result.extend_from_slice(&compressed);
    result.extend_from_slice(&crc32(&bytes).to_le_bytes());
    result.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    result
}
