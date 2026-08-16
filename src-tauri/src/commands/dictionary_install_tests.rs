use std::{
    cell::Cell,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

use sha2::{Digest, Sha256};
use zip::{write::SimpleFileOptions, ZipWriter};

use super::{
    install_staging_root, prepare_owned_package, publish_install_with, DictionaryInstallError,
    DictionaryInstallService, InstallStaging,
};
use crate::commands::{
    dictionary_archive::{self, DictionaryArchiveError},
    dictionary_catalog::{
        validate_catalog_entry, DictionaryCatalogEntry, DictionaryCatalogPackageFormat,
    },
    dictionary_download::{resolve_verified_download, write_verified_download_fixture},
    dictionary_index::normalize_dictionary_term,
    dictionary_store::{
        open_current_store, DictionaryIndexState, DictionarySourceKind, DictionaryStoragePaths,
        DictionaryStore,
    },
    stardict_validation,
};

static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

struct TestDirectory(PathBuf);

impl TestDirectory {
    fn new(label: &str) -> Self {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "archeion-dictionary-install-{label}-{}-{timestamp}-{sequence}",
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

fn create_package(directory: &Path, stem: &str) -> PathBuf {
    fs::create_dir_all(directory).unwrap();
    let definitions = b"firstsecond";
    let mut index = Vec::new();
    index.extend_from_slice(b"alpha\0");
    index.extend_from_slice(&0_u32.to_be_bytes());
    index.extend_from_slice(&5_u32.to_be_bytes());
    index.extend_from_slice(b"beta\0");
    index.extend_from_slice(&5_u32.to_be_bytes());
    index.extend_from_slice(&6_u32.to_be_bytes());
    let ifo = format!(
        "StarDict's dict ifo file\nversion=2.4.2\nbookname=Fixture Dictionary\nwordcount=2\nidxfilesize={}\nsametypesequence=m\n",
        index.len()
    );
    let ifo_path = directory.join(format!("{stem}.ifo"));
    fs::write(&ifo_path, ifo).unwrap();
    fs::write(directory.join(format!("{stem}.idx")), index).unwrap();
    fs::write(directory.join(format!("{stem}.dict")), definitions).unwrap();
    ifo_path
}

fn add_synonym(directory: &Path, stem: &str) {
    let ifo_path = directory.join(format!("{stem}.ifo"));
    let mut ifo = fs::read_to_string(&ifo_path).unwrap();
    ifo.push_str("synwordcount=1\n");
    fs::write(ifo_path, ifo).unwrap();
    let mut synonym = b"first-alias\0".to_vec();
    synonym.extend_from_slice(&0_u32.to_be_bytes());
    fs::write(directory.join(format!("{stem}.syn")), synonym).unwrap();
}

fn create_catalog_archive(source: &Path, archive_path: &Path) -> Vec<u8> {
    fs::create_dir_all(archive_path.parent().unwrap()).unwrap();
    let file = fs::File::create(archive_path).unwrap();
    let mut writer = ZipWriter::new(file);
    let options = SimpleFileOptions::default();
    for extension in ["ifo", "idx", "dict"] {
        let path = source.join(format!("fixture.{extension}"));
        writer
            .start_file(format!("package/fixture.{extension}"), options)
            .unwrap();
        writer.write_all(&fs::read(path).unwrap()).unwrap();
    }
    writer.finish().unwrap();
    fs::read(archive_path).unwrap()
}

fn catalog_entry_with_format(
    bytes: &[u8],
    package_format: DictionaryCatalogPackageFormat,
) -> DictionaryCatalogEntry {
    DictionaryCatalogEntry {
        id: "english-core".to_string(),
        name: "English Core".to_string(),
        source_language: "fr".to_string(),
        target_language: "en".to_string(),
        description: "Fixture".to_string(),
        source_attribution: "Fixture Lexicographers".to_string(),
        source_url: Some("https://example.com/source".to_string()),
        license_name: "CC BY 4.0".to_string(),
        license_url: "https://example.com/license".to_string(),
        package_version: "2026.1".to_string(),
        compressed_size_bytes: bytes.len() as u64,
        installed_size_estimate_bytes: None,
        download_url: match package_format {
            DictionaryCatalogPackageFormat::StardictZip => "https://example.com/english.zip",
            DictionaryCatalogPackageFormat::StardictTarXz => {
                "https://example.com/english.stardict.tar.xz"
            }
        }
        .to_string(),
        package_format,
        sha256: format!("{:x}", Sha256::digest(bytes)),
    }
}

fn catalog_entry(bytes: &[u8]) -> DictionaryCatalogEntry {
    catalog_entry_with_format(bytes, DictionaryCatalogPackageFormat::StardictZip)
}

fn write_verified_archive(root: &Path, token: &str, source: &Path) -> DictionaryCatalogEntry {
    let temporary_archive = root.join("catalog-fixture.stardict.zip");
    let bytes = create_catalog_archive(source, &temporary_archive);
    let entry = catalog_entry(&bytes);
    write_verified_download_fixture(root, token, entry.clone(), &bytes);
    fs::remove_file(temporary_archive).unwrap();
    entry
}

fn assert_install_staging_empty(root: &Path) {
    let staging = install_staging_root(root);
    assert!(
        !staging.exists() || fs::read_dir(staging).unwrap().next().is_none(),
        "recognized installation staging should be empty"
    );
}

#[test]
fn verified_catalog_provenance_cannot_be_substituted_with_an_identical_package_entry() {
    let directory = TestDirectory::new("catalog");
    let source = directory.path().join("source");
    create_package(&source, "fixture");
    let token = "verified-1-2-3.dictionary-package";
    let entry = write_verified_archive(directory.path(), token, &source);
    let mut other_entry = entry.clone();
    other_entry.id = "other-english".to_string();
    other_entry.name = "Other English".to_string();
    other_entry.source_attribution = "Other Publisher".to_string();
    other_entry.license_name = "Other License".to_string();
    other_entry.license_url = "https://example.com/other-license".to_string();
    validate_catalog_entry(entry.clone()).unwrap();
    validate_catalog_entry(other_entry.clone()).unwrap();
    assert_ne!(entry.id, other_entry.id);
    assert_ne!(entry.source_attribution, other_entry.source_attribution);
    assert_eq!(
        entry.compressed_size_bytes,
        other_entry.compressed_size_bytes
    );
    assert_eq!(entry.sha256, other_entry.sha256);
    let archive = DictionaryStoragePaths::from_app_data_root(directory.path())
        .root()
        .join("staging/downloads")
        .join(token);
    let unrelated_staging = archive.parent().unwrap().join("unrelated.staged");
    fs::write(&unrelated_staging, b"preserve").unwrap();

    let installed = DictionaryInstallService::default()
        .install_catalog(directory.path(), token)
        .unwrap();

    assert_eq!(installed.display_name, entry.name);
    assert_eq!(installed.source_language, "fr");
    assert_eq!(installed.target_language, "en");
    assert_eq!(installed.source_kind, DictionarySourceKind::Catalog);
    assert_eq!(installed.catalog_id.as_deref(), Some("english-core"));
    assert_eq!(installed.source_attribution, "Fixture Lexicographers");
    assert_eq!(installed.license_name, "CC BY 4.0");
    assert_eq!(
        installed.license_url.as_deref(),
        Some("https://example.com/license")
    );
    assert_eq!(installed.package_version, "2026.1");
    assert_eq!(installed.index_state, DictionaryIndexState::Ready);
    assert_eq!(installed.entry_count, 2);
    let registry = DictionaryStore::snapshot(directory.path()).unwrap();
    assert_eq!(registry.dictionaries.len(), 1);
    assert_eq!(registry.dictionaries[0].source_language, "fr");
    assert_eq!(registry.dictionaries[0].target_language, "en");
    assert_eq!(
        registry.dictionaries[0].index_state,
        DictionaryIndexState::Ready
    );
    assert_ne!(
        installed.catalog_id.as_deref(),
        Some(other_entry.id.as_str())
    );
    assert_ne!(installed.source_attribution, other_entry.source_attribution);
    let store = open_current_store(directory.path()).unwrap();
    let matches = store
        .lookup_exact(&normalize_dictionary_term("Alpha"), 32)
        .unwrap();
    assert_eq!(matches.len(), 1);
    assert_eq!(matches[0].dictionary_id, installed.id);
    let installed_path = store.installed_path(&installed.id).unwrap();
    assert_eq!(
        fs::read_dir(&installed_path)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<std::collections::BTreeSet<_>>(),
        ["dictionary.dict", "dictionary.idx", "dictionary.ifo"]
            .into_iter()
            .map(std::ffi::OsString::from)
            .collect()
    );
    assert!(!archive.exists());
    assert_eq!(fs::read(unrelated_staging).unwrap(), b"preserve");
    assert_install_staging_empty(directory.path());
}

#[test]
fn verified_tar_xz_catalog_installs_through_existing_activation_and_index_owner() {
    let directory = TestDirectory::new("tar-xz-catalog");
    let token = "verified-30-31-32.dictionary-package";
    let bytes = dictionary_archive::tests::freedict_style_tar_xz_fixture();
    let entry = catalog_entry_with_format(bytes, DictionaryCatalogPackageFormat::StardictTarXz);
    write_verified_download_fixture(directory.path(), token, entry.clone(), bytes);

    let installed = DictionaryInstallService::default()
        .install_catalog(directory.path(), token)
        .unwrap();

    assert_eq!(installed.catalog_id.as_deref(), Some(entry.id.as_str()));
    assert_eq!(installed.source_language, "fr");
    assert_eq!(installed.target_language, "en");
    assert_eq!(installed.index_state, DictionaryIndexState::Ready);
    assert_eq!(installed.entry_count, 2);
    let store = open_current_store(directory.path()).unwrap();
    assert_eq!(
        store
            .lookup_exact(&normalize_dictionary_term("alpha"), 8)
            .unwrap()
            .len(),
        1
    );
    let installed_path = store.installed_path(&installed.id).unwrap();
    assert_eq!(
        fs::read_dir(&installed_path)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<std::collections::BTreeSet<_>>(),
        ["dictionary.dict", "dictionary.idx", "dictionary.ifo"]
            .into_iter()
            .map(std::ffi::OsString::from)
            .collect()
    );
    assert!(resolve_verified_download(directory.path(), token).is_err());
    assert_install_staging_empty(directory.path());
}

#[test]
fn post_publication_cleanup_failure_keeps_success_and_permanently_retires_token() {
    let directory = TestDirectory::new("retired-cleanup-failure");
    let source = directory.path().join("source");
    create_package(&source, "fixture");
    let token = "verified-10-11-12.dictionary-package";
    write_verified_archive(directory.path(), token, &source);
    let verified_path = DictionaryStoragePaths::from_app_data_root(directory.path())
        .root()
        .join("staging/downloads")
        .join(token);
    let cleanup_attempted = Cell::new(false);

    let installed = DictionaryInstallService::default()
        .install_catalog_with_cleanup(directory.path(), token, |retired_path| {
            cleanup_attempted.set(true);
            assert!(!verified_path.exists());
            assert!(retired_path.is_dir());
            assert!(retired_path
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with("retired-install-"));
            let snapshot = DictionaryStore::snapshot(directory.path()).unwrap();
            assert_eq!(snapshot.dictionaries.len(), 1);
            assert_eq!(
                snapshot.dictionaries[0].index_state,
                DictionaryIndexState::Ready
            );
            Err(std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "deterministic retired-artifact cleanup failure",
            ))
        })
        .unwrap();

    assert!(cleanup_attempted.get());
    assert_eq!(installed.index_state, DictionaryIndexState::Ready);
    let snapshot = DictionaryStore::snapshot(directory.path()).unwrap();
    assert_eq!(snapshot.dictionaries.len(), 1);
    assert_eq!(snapshot.dictionaries[0].id, installed.id);
    assert!(resolve_verified_download(directory.path(), token).is_err());
    assert!(DictionaryInstallService::default()
        .install_catalog(directory.path(), token)
        .is_err());
    assert_eq!(
        DictionaryStore::snapshot(directory.path())
            .unwrap()
            .dictionaries
            .len(),
        1
    );
    let staging_entries = fs::read_dir(verified_path.parent().unwrap())
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect::<Vec<_>>();
    assert_eq!(staging_entries.len(), 1);
    assert!(staging_entries[0].starts_with("retired-install-"));
}

#[test]
fn manual_import_uses_the_same_owned_layout_without_modifying_source_files() {
    let directory = TestDirectory::new("manual");
    let source = directory.path().join("manual-source");
    let ifo = create_package(&source, "user-name");
    let before = ["ifo", "idx", "dict"]
        .into_iter()
        .map(|extension| {
            let path = source.join(format!("user-name.{extension}"));
            (path.clone(), fs::read(path).unwrap())
        })
        .collect::<Vec<_>>();

    let installed = DictionaryInstallService::default()
        .install_manual(directory.path(), &ifo)
        .unwrap();

    assert_eq!(installed.display_name, "Fixture Dictionary");
    assert_eq!(installed.source_language, "und");
    assert_eq!(installed.target_language, "und");
    assert_eq!(installed.source_kind, DictionarySourceKind::ManualImport);
    assert_eq!(installed.catalog_id, None);
    assert_eq!(installed.index_state, DictionaryIndexState::Ready);
    for (path, bytes) in before {
        assert_eq!(fs::read(path).unwrap(), bytes);
    }
    let store = open_current_store(directory.path()).unwrap();
    let installed_path = store.installed_path(&installed.id).unwrap();
    assert!(installed_path.join("dictionary.ifo").is_file());
    assert!(installed_path.join("dictionary.idx").is_file());
    assert!(installed_path.join("dictionary.dict").is_file());
    assert_install_staging_empty(directory.path());
}

#[test]
fn catalog_reinstall_restores_unavailable_dictionary_without_changing_its_identity() {
    let directory = TestDirectory::new("catalog-reinstall");
    let source = directory.path().join("source");
    create_package(&source, "fixture");
    let first_token = "verified-20-21-22.dictionary-package";
    write_verified_archive(directory.path(), first_token, &source);
    let installed = DictionaryInstallService::default()
        .install_catalog(directory.path(), first_token)
        .unwrap();
    {
        let mut store = open_current_store(directory.path()).unwrap();
        store.set_enabled(&installed.id, false).unwrap();
        let installed_path = store.installed_path(&installed.id).unwrap();
        fs::remove_file(installed_path.join("dictionary.dict")).unwrap();
    }
    let unavailable = DictionaryStore::snapshot(directory.path()).unwrap();
    assert_eq!(
        unavailable.dictionaries[0].index_state,
        DictionaryIndexState::Unavailable
    );

    let retry_token = "verified-23-24-25.dictionary-package";
    write_verified_archive(directory.path(), retry_token, &source);
    let restored = DictionaryInstallService::default()
        .install_catalog(directory.path(), retry_token)
        .unwrap();

    assert_eq!(restored.id, installed.id);
    assert_eq!(restored.order, installed.order);
    assert!(!restored.enabled);
    assert_eq!(restored.index_state, DictionaryIndexState::Ready);
    assert_eq!(restored.catalog_id, installed.catalog_id);
    let store = open_current_store(directory.path()).unwrap();
    assert_eq!(store.list().unwrap().len(), 1);
    assert!(store.lookup_exact("alpha", 8).unwrap().is_empty());
    let mut store = open_current_store(directory.path()).unwrap();
    store.set_enabled(&restored.id, true).unwrap();
    assert_eq!(store.lookup_exact("alpha", 8).unwrap().len(), 1);
    assert_install_staging_empty(directory.path());
}

#[test]
fn invalid_catalog_package_cleans_install_staging_and_preserves_verified_and_unrelated_data() {
    let directory = TestDirectory::new("invalid-catalog");
    let token = "verified-4-5-6.dictionary-package";
    let temporary_archive = directory.path().join("invalid.stardict.zip");
    let file = fs::File::create(&temporary_archive).unwrap();
    let mut writer = ZipWriter::new(file);
    writer
        .start_file("package/incomplete.ifo", SimpleFileOptions::default())
        .unwrap();
    writer
        .write_all(b"StarDict's dict ifo file\nversion=2.4.2\n")
        .unwrap();
    writer.finish().unwrap();
    let bytes = fs::read(&temporary_archive).unwrap();
    let entry = catalog_entry(&bytes);
    let archive = write_verified_download_fixture(directory.path(), token, entry, &bytes);
    fs::remove_file(temporary_archive).unwrap();
    let unrelated = DictionaryStoragePaths::from_app_data_root(directory.path())
        .root()
        .join("installed/unrelated/preserve.data");
    fs::create_dir_all(unrelated.parent().unwrap()).unwrap();
    fs::write(&unrelated, b"preserve").unwrap();

    let result = DictionaryInstallService::default().install_catalog(directory.path(), token);

    assert!(matches!(result, Err(DictionaryInstallError::Validation(_))));
    assert!(archive.is_dir());
    let preserved = resolve_verified_download(directory.path(), token).unwrap();
    assert_eq!(preserved.catalog_entry.id, "english-core");
    assert_eq!(fs::read(preserved.package_path).unwrap(), bytes);
    assert_eq!(fs::read(unrelated).unwrap(), b"preserve");
    assert!(DictionaryStore::snapshot(directory.path())
        .unwrap()
        .dictionaries
        .is_empty());
    assert_install_staging_empty(directory.path());
}

#[test]
fn catalog_archive_traversal_is_rejected_without_writing_outside_staging() {
    let directory = TestDirectory::new("unsafe-archive");
    let token = "verified-7-8-9.dictionary-package";
    let temporary_archive = directory.path().join("unsafe.stardict.zip");
    let file = fs::File::create(&temporary_archive).unwrap();
    let mut writer = ZipWriter::new(file);
    writer
        .start_file("../outside.ifo", SimpleFileOptions::default())
        .unwrap();
    writer.write_all(b"unsafe").unwrap();
    writer.finish().unwrap();
    let bytes = fs::read(&temporary_archive).unwrap();
    let entry = catalog_entry(&bytes);
    let archive = write_verified_download_fixture(directory.path(), token, entry, &bytes);
    fs::remove_file(temporary_archive).unwrap();

    let result = DictionaryInstallService::default().install_catalog(directory.path(), token);

    assert!(matches!(
        result,
        Err(DictionaryInstallError::Archive(
            DictionaryArchiveError::InvalidArchive(_)
        ))
    ));
    assert!(!directory.path().join("outside.ifo").exists());
    assert!(archive.is_dir());
    assert_install_staging_empty(directory.path());
}

#[test]
fn activation_failure_rolls_back_registry_and_index_publication() {
    let directory = TestDirectory::new("activation-failure");
    let source = directory.path().join("source");
    let ifo = create_package(&source, "fixture");
    let source_package = stardict_validation::validate_package(&ifo).unwrap();
    let staging = InstallStaging::create(directory.path()).unwrap();
    let prepared = prepare_owned_package(&source_package, &staging.path.join("prepared")).unwrap();
    let registration = super::manual_registration(&prepared);

    let result = publish_install_with(
        directory.path(),
        &staging,
        registration,
        &prepared,
        |_prepared, _installed| Err("activation blocked".to_string()),
        |_installed| Ok(()),
    );

    assert!(matches!(result, Err(DictionaryInstallError::Store(_))));
    assert!(DictionaryStore::snapshot(directory.path())
        .unwrap()
        .dictionaries
        .is_empty());
    assert_install_staging_empty_after_drop(directory.path(), staging);
}

#[test]
fn index_publication_failure_never_marks_dictionary_ready_or_activates_files() {
    let directory = TestDirectory::new("database-failure");
    let source = directory.path().join("source");
    let ifo = create_package(&source, "fixture");
    add_synonym(&source, "fixture");
    let source_before = ["ifo", "idx", "dict", "syn"]
        .into_iter()
        .map(|extension| {
            let path = source.join(format!("fixture.{extension}"));
            (path.clone(), fs::read(&path).unwrap())
        })
        .collect::<Vec<_>>();
    let source_package = stardict_validation::validate_package(&ifo).unwrap();
    let unrelated_id;
    {
        let mut store = open_current_store(directory.path()).unwrap();
        unrelated_id = store
            .register(super::manual_registration(&source_package))
            .unwrap()
            .id;
        store
            .connection()
            .execute_batch(
                "CREATE TRIGGER fail_install_index
                 BEFORE INSERT ON dictionary_entries
                 BEGIN
                     SELECT RAISE(ABORT, 'focused installation index failure');
                 END;",
            )
            .unwrap();
    }

    let result = DictionaryInstallService::default().install_manual(directory.path(), &ifo);

    assert!(matches!(result, Err(DictionaryInstallError::Store(_))));
    let dictionaries = DictionaryStore::snapshot(directory.path())
        .unwrap()
        .dictionaries;
    assert_eq!(dictionaries.len(), 1);
    assert_eq!(dictionaries[0].id, unrelated_id);
    let installed = DictionaryStoragePaths::from_app_data_root(directory.path())
        .root()
        .join("installed");
    assert!(!installed.exists() || fs::read_dir(installed).unwrap().next().is_none());
    for (path, bytes) in source_before {
        assert_eq!(fs::read(path).unwrap(), bytes);
    }
    assert_install_staging_empty(directory.path());
}

fn assert_install_staging_empty_after_drop(root: &Path, staging: InstallStaging) {
    drop(staging);
    assert_install_staging_empty(root);
}
