use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use super::normalize_headword;
use crate::commands::{
    dictionary_store::{
        DictionaryIndexState, DictionaryRegistration, DictionarySourceKind, DictionaryStore,
        DictionaryStoreError, DictionaryStoreOpen,
    },
    stardict_validation::{
        StarDictDefinitionCompression, StarDictDefinitionData, StarDictIndexEntry,
        StarDictMetadata, StarDictSynonym, ValidatedStarDictPackage,
    },
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
            "archeion-dictionary-index-{label}-{}-{timestamp}-{sequence}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("test directory should be created");
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

fn open_store(root: &Path) -> DictionaryStore {
    match DictionaryStore::open(root).expect("store should open") {
        DictionaryStoreOpen::Current(store) => store,
        DictionaryStoreOpen::RecoveryRequired(state) => {
            panic!("store unexpectedly requires recovery: {}", state.message)
        }
    }
}

fn registration(name: &str) -> DictionaryRegistration {
    DictionaryRegistration {
        display_name: name.to_string(),
        language: "en".to_string(),
        enabled: true,
        entry_count: 0,
        installed_size_bytes: 0,
        source_kind: DictionarySourceKind::ManualImport,
        catalog_id: None,
        source_attribution: "Fixture".to_string(),
        license_name: "Test".to_string(),
        license_url: None,
        package_version: "1".to_string(),
        index_state: DictionaryIndexState::Pending,
    }
}

fn package(
    entries: &[(&str, u64, u32)],
    synonyms: &[(&str, u32)],
    bytes: u64,
) -> ValidatedStarDictPackage {
    ValidatedStarDictPackage {
        package_name: "fixture".to_string(),
        metadata: StarDictMetadata {
            version: "2.4.2".to_string(),
            book_name: "Fixture".to_string(),
            word_count: entries.len() as u32,
            synonym_word_count: synonyms.len() as u32,
            index_file_size: 0,
            index_offset_bits: 32,
            same_type_sequence: Some("m".to_string()),
            description: None,
            date: None,
            website: None,
            email: None,
        },
        entries: entries
            .iter()
            .map(|(word, offset, size)| StarDictIndexEntry {
                word: (*word).to_string(),
                definition_offset: *offset,
                definition_size: *size,
            })
            .collect(),
        synonyms: synonyms
            .iter()
            .map(|(word, target)| StarDictSynonym {
                word: (*word).to_string(),
                target_index: *target,
            })
            .collect(),
        definition_data: StarDictDefinitionData {
            compression: StarDictDefinitionCompression::None,
            stored_bytes: bytes,
            expanded_bytes: bytes,
        },
        source_files: Vec::new(),
    }
}

#[test]
fn representative_entries_build_normalized_rows_and_exact_lookup_is_deterministic() {
    let directory = TestDirectory::new("build");
    let mut store = open_store(directory.path());
    let first = store.register(registration("First")).unwrap();
    let second = store.register(registration("Second")).unwrap();
    store
        .replace_index(
            &first.id,
            &package(&[("Apple", 0, 5), ("APPLE", 5, 4)], &[], 9),
            9,
        )
        .unwrap();
    store
        .replace_index(&second.id, &package(&[("apple", 0, 3)], &[], 3), 3)
        .unwrap();

    let matches = store.lookup_exact("  ApPlE ").unwrap();

    assert_eq!(normalize_headword("  ApPlE "), "apple");
    assert_eq!(matches.len(), 3);
    assert_eq!(matches[0].dictionary_id, first.id);
    assert_eq!(matches[0].source_ordinal, 0);
    assert_eq!(matches[1].source_ordinal, 1);
    assert_eq!(matches[2].dictionary_id, second.id);
    assert_eq!(matches[0].display_headword, "Apple");
    assert_eq!(matches[0].definition_offset, 0);
    assert_eq!(matches[0].definition_length, 5);
    let indexes = store
        .connection()
        .prepare(
            "SELECT name FROM sqlite_schema
             WHERE type = 'index' AND name IN (
                'dictionary_entries_headword_idx', 'dictionary_aliases_lookup_idx'
             ) ORDER BY name",
        )
        .unwrap()
        .query_map([], |row| row.get::<_, String>(0))
        .unwrap()
        .collect::<Result<Vec<_>, _>>()
        .unwrap();
    assert_eq!(
        indexes,
        vec![
            "dictionary_aliases_lookup_idx",
            "dictionary_entries_headword_idx"
        ]
    );
}

#[test]
fn synonym_rows_resolve_to_the_owning_source_entry() {
    let directory = TestDirectory::new("aliases");
    let mut store = open_store(directory.path());
    let dictionary = store.register(registration("Aliases")).unwrap();
    store
        .replace_index(
            &dictionary.id,
            &package(&[("color", 0, 6), ("tone", 6, 4)], &[("Colour", 0)], 10),
            10,
        )
        .unwrap();

    let matches = store.lookup_exact("COLOUR").unwrap();

    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].dictionary_id, dictionary.id);
    assert_eq!(matches[0].source_ordinal, 0);
    assert_eq!(matches[0].display_headword, "color");
}

#[test]
fn normalized_alias_mappings_are_deduplicated_without_merging_distinct_targets() {
    let directory = TestDirectory::new("normalized-aliases");
    let mut store = open_store(directory.path());
    let dictionary = store.register(registration("Aliases")).unwrap();
    store
        .replace_index(
            &dictionary.id,
            &package(
                &[("first", 0, 2), ("second", 2, 2)],
                &[("Apple", 0), ("apple", 0), ("APPLE", 1)],
                4,
            ),
            4,
        )
        .unwrap();

    let matches = store.lookup_exact("apple").unwrap();

    assert_eq!(matches.len(), 2);
    assert_eq!(matches[0].source_ordinal, 0);
    assert_eq!(matches[1].source_ordinal, 1);
    let alias_count: i64 = store
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM dictionary_aliases
             WHERE dictionary_id = ?1 AND normalized_alias = 'apple'",
            [&dictionary.id],
            |row| row.get(0),
        )
        .unwrap();
    let first_target_count: i64 = store
        .connection()
        .query_row(
            "SELECT COUNT(*) FROM dictionary_aliases
             WHERE dictionary_id = ?1
               AND normalized_alias = 'apple'
               AND source_ordinal = 0",
            [&dictionary.id],
            |row| row.get(0),
        )
        .unwrap();
    assert_eq!(alias_count, 2);
    assert_eq!(first_target_count, 1);
}

#[test]
fn replacing_one_dictionary_is_transactional_and_preserves_unrelated_indexes() {
    let directory = TestDirectory::new("transaction");
    let mut store = open_store(directory.path());
    let first = store.register(registration("First")).unwrap();
    let second = store.register(registration("Second")).unwrap();
    store
        .replace_index(&first.id, &package(&[("stable", 0, 2)], &[], 2), 2)
        .unwrap();
    store
        .replace_index(&second.id, &package(&[("other", 0, 3)], &[], 3), 3)
        .unwrap();
    let first_before = store.get(&first.id).unwrap().unwrap();
    let second_before = store.get(&second.id).unwrap().unwrap();
    store
        .connection()
        .execute_batch(
            "CREATE TEMP TRIGGER fail_dictionary_alias_insert
             BEFORE INSERT ON dictionary_aliases
             WHEN NEW.normalized_alias = 'force-failure'
             BEGIN
                 SELECT RAISE(ABORT, 'focused transactional replacement failure');
             END;",
        )
        .unwrap();

    let invalid = package(
        &[("replacement", 0, 2), ("inserted-before-failure", 2, 2)],
        &[("force-failure", 0)],
        4,
    );
    assert!(store.replace_index(&first.id, &invalid, 4).is_err());

    assert_eq!(store.lookup_exact("stable").unwrap().len(), 1);
    assert!(store.lookup_exact("replacement").unwrap().is_empty());
    assert!(store
        .lookup_exact("inserted-before-failure")
        .unwrap()
        .is_empty());
    assert_eq!(store.lookup_exact("other").unwrap().len(), 1);
    assert_eq!(store.get(&first.id).unwrap().unwrap(), first_before);
    assert_eq!(store.get(&second.id).unwrap().unwrap(), second_before);
}

#[test]
fn invalid_definition_metadata_cannot_replace_current_rows() {
    let directory = TestDirectory::new("bounds");
    let mut store = open_store(directory.path());
    let dictionary = store.register(registration("Bounds")).unwrap();
    store
        .replace_index(&dictionary.id, &package(&[("valid", 0, 4)], &[], 4), 4)
        .unwrap();

    let error = store
        .replace_index(&dictionary.id, &package(&[("invalid", 3, 4)], &[], 4), 4)
        .unwrap_err();

    assert!(matches!(error, DictionaryStoreError::InvalidIndex(_)));
    assert_eq!(store.lookup_exact("valid").unwrap().len(), 1);
    assert!(store.lookup_exact("invalid").unwrap().is_empty());
}

#[test]
fn rebuild_restores_queryable_rows_from_installed_stardict_sources() {
    let directory = TestDirectory::new("rebuild");
    let mut store = open_store(directory.path());
    let dictionary = store.register(registration("Rebuild")).unwrap();
    let installed = store.installed_path(&dictionary.id).unwrap();
    fs::create_dir_all(&installed).unwrap();
    let mut index = Vec::new();
    index.extend_from_slice(b"alpha\0");
    index.extend_from_slice(&0_u32.to_be_bytes());
    index.extend_from_slice(&5_u32.to_be_bytes());
    fs::write(installed.join("fixture.idx"), &index).unwrap();
    fs::write(installed.join("fixture.dict"), b"first").unwrap();
    fs::write(
        installed.join("fixture.ifo"),
        format!(
            "StarDict's dict ifo file\nversion=2.4.2\nbookname=Rebuild\nwordcount=1\nidxfilesize={}\nsametypesequence=m\n",
            index.len()
        ),
    )
    .unwrap();

    store.rebuild_index(&dictionary.id).unwrap();

    let matches = store.lookup_exact("alpha").unwrap();
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].definition_length, 5);
    let installed = store.get(&dictionary.id).unwrap().unwrap();
    assert_eq!(installed.index_state, DictionaryIndexState::Ready);
    assert_eq!(installed.entry_count, 1);
}
