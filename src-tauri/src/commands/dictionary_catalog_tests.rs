use std::{
    collections::HashSet,
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::sync::oneshot;

use super::{
    catalog_cache_path, validate_catalog_bytes, DictionaryCatalogError,
    DictionaryCatalogPackageFormat, DictionaryCatalogService, DictionaryCatalogSource,
    MAX_CATALOG_BYTES,
};
use crate::commands::{
    dictionary_download::write_verified_download_fixture,
    dictionary_install::DictionaryInstallService,
    dictionary_lookup::DictionaryLookupService,
    dictionary_store::{
        open_current_store, DictionaryIndexState, DictionaryRegistration, DictionarySourceKind,
    },
};

static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);
const PRODUCTION_CATALOG_BYTES: &[u8] =
    include_bytes!("../../../docs/dictionaries/catalog-v1.json");

fn test_root(label: &str) -> PathBuf {
    let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "archeion-dictionary-catalog-{label}-{}-{sequence}",
        std::process::id()
    ))
}

fn entry(id: &str, name: &str, language: &str) -> Value {
    directional_entry(id, name, language, language)
}

fn directional_entry(id: &str, name: &str, source_language: &str, target_language: &str) -> Value {
    json!({
        "id": id,
        "name": name,
        "sourceLanguage": source_language,
        "targetLanguage": target_language,
        "sourceAttribution": "Example Lexicographers",
        "sourceUrl": "https://example.com/source",
        "licenseName": "CC BY 4.0",
        "licenseUrl": "https://example.com/license",
        "packageVersion": "2026.1",
        "compressedSizeBytes": 4096,
        "installedSizeEstimateBytes": 8192,
        "downloadUrl": format!("https://example.com/{id}.zip"),
        "packageFormat": "stardict-zip",
        "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789ABCDEF"
    })
}

fn manifest(entries: Vec<Value>) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "schemaVersion": 1,
        "dictionaries": entries
    }))
    .unwrap()
}

#[test]
fn committed_production_catalog_is_valid_and_non_empty() {
    let raw: Value = serde_json::from_slice(PRODUCTION_CATALOG_BYTES).unwrap();
    assert!(raw["dictionaries"]
        .as_array()
        .unwrap()
        .iter()
        .all(|entry| entry.get("description").is_none()));

    let catalog = validate_catalog_bytes(PRODUCTION_CATALOG_BYTES)
        .expect("the committed production dictionary catalog should validate");

    let freedict = catalog
        .dictionaries
        .iter()
        .filter(|entry| entry.id.starts_with("freedict-"))
        .collect::<Vec<_>>();
    let first = catalog
        .dictionaries
        .first()
        .expect("the production catalog should contain an English dictionary");
    assert_eq!(
        (
            first.source_language.as_str(),
            first.target_language.as_str()
        ),
        ("en", "en")
    );
    assert!(
        freedict.len() > 100,
        "the production catalog should provide broad FreeDict coverage"
    );
    let mut directions = HashSet::with_capacity(freedict.len());
    for entry in &freedict {
        assert!(
            directions.insert((&entry.source_language, &entry.target_language)),
            "FreeDict should publish at most one current dictionary per language direction"
        );
        assert!(!entry.package_version.trim().is_empty());
        assert_eq!(
            entry.package_format,
            DictionaryCatalogPackageFormat::StardictTarXz
        );
        assert!(!entry
            .source_attribution
            .to_ascii_lowercase()
            .contains("packaged for archeion"));
        assert!(!entry
            .source_attribution
            .ends_with(", distributed by FreeDict"));
    }
    for (id, source, target, version) in [
        ("freedict-afr-eng", "af", "en", "0.2.2"),
        ("freedict-eng-fra", "en", "fr", "0.1.6"),
        ("freedict-ckb-kmr", "ckb", "kmr", "0.2"),
    ] {
        let entry = freedict
            .iter()
            .find(|entry| entry.id == id)
            .unwrap_or_else(|| panic!("the production catalog should contain {id}"));
        assert_eq!(entry.source_language, source);
        assert_eq!(entry.target_language, target);
        assert_eq!(entry.package_version, version);
        assert_eq!(
            entry.package_format,
            DictionaryCatalogPackageFormat::StardictTarXz
        );
        assert!(entry
            .download_url
            .starts_with("https://download.freedict.org/"));
    }
}

#[test]
#[ignore = "requires generated Phase 1.3.0.17 production candidate packages"]
fn generated_freedict_candidates_pass_current_package_validator() {
    let candidate_dir = PathBuf::from(
        std::env::var_os("ARCHEION_FREEDICT_CANDIDATE_DIR")
            .expect("candidate package directory must be supplied"),
    );
    let candidate_catalog = PathBuf::from(
        std::env::var_os("ARCHEION_FREEDICT_CANDIDATE_CATALOG")
            .expect("candidate catalog path must be supplied"),
    );
    let validation_receipt = PathBuf::from(
        std::env::var_os("ARCHEION_FREEDICT_VALIDATION_RECEIPT")
            .expect("validation receipt path must be supplied"),
    );
    let catalog_bytes = fs::read(&candidate_catalog).expect("candidate catalog should be readable");
    let catalog = validate_catalog_bytes(&catalog_bytes)
        .expect("candidate catalog should pass the production catalog validator");
    let freedict = catalog
        .dictionaries
        .iter()
        .filter(|entry| entry.id.starts_with("freedict-"))
        .collect::<Vec<_>>();
    assert!(
        freedict.len() > 100,
        "the FreeDict candidate should provide broad multilingual coverage"
    );

    let validation_root = test_root("freedict-candidates");
    fs::create_dir_all(&validation_root).expect("validation root should be created");
    let mut receipt_packages = Vec::with_capacity(freedict.len());
    let mut failures = Vec::new();
    for entry in freedict {
        let file_name = entry
            .download_url
            .rsplit('/')
            .next()
            .filter(|name| !name.is_empty())
            .expect("FreeDict URL should end in a package filename");
        let package_path = candidate_dir.join(file_name);
        let package_bytes = fs::read(&package_path)
            .unwrap_or_else(|error| panic!("{} should be readable: {error}", entry.id));
        let package_sha256 = format!("{:x}", Sha256::digest(&package_bytes));
        assert_eq!(package_bytes.len() as u64, entry.compressed_size_bytes);
        assert_eq!(package_sha256, entry.sha256);

        let extraction = validation_root.join(&entry.id);
        let validation = crate::commands::dictionary_archive::extract_catalog_package(
            DictionaryCatalogPackageFormat::StardictTarXz,
            &package_path,
            &extraction,
        );
        if let Err(error) = validation {
            failures.push(json!({ "id": entry.id, "reason": error.to_string() }));
            if extraction.exists() {
                fs::remove_dir_all(&extraction).expect("failed extraction should be removable");
            }
            continue;
        }
        fs::remove_dir_all(&extraction).expect("validated extraction should be removable");
        receipt_packages.push(json!({
            "id": entry.id,
            "fileName": file_name,
            "compressedSizeBytes": package_bytes.len(),
            "sha256": package_sha256,
        }));
    }

    let mut receipt_bytes = serde_json::to_vec_pretty(&json!({
        "schemaVersion": 1,
        "catalogSha256": format!("{:x}", Sha256::digest(&catalog_bytes)),
        "packages": receipt_packages,
        "failures": &failures,
    }))
    .expect("validation receipt should serialize");
    receipt_bytes.push(b'\n');
    fs::write(validation_receipt, receipt_bytes).expect("validation receipt should be written");
    fs::remove_dir_all(validation_root).expect("validation root should be removed");
    assert!(
        failures.is_empty(),
        "FreeDict candidate validation failures: {failures:?}"
    );
}

#[test]
#[ignore = "requires generated Phase 1.3.0.16 production candidate packages"]
fn generated_english_candidates_install_index_activate_and_lookup() {
    let candidate_dir = PathBuf::from(
        std::env::var_os("ARCHEION_ENGLISH_CANDIDATE_DIR")
            .expect("candidate package directory must be supplied"),
    );
    let candidate_catalog = PathBuf::from(
        std::env::var_os("ARCHEION_ENGLISH_CANDIDATE_CATALOG")
            .expect("candidate catalog path must be supplied"),
    );
    let validation_receipt = PathBuf::from(
        std::env::var_os("ARCHEION_ENGLISH_VALIDATION_RECEIPT")
            .expect("validation receipt path must be supplied"),
    );

    let catalog_bytes = fs::read(&candidate_catalog).expect("candidate catalog should be readable");
    let catalog = validate_catalog_bytes(&catalog_bytes)
        .expect("candidate catalog should pass the production catalog validator");
    let required = [
        ("princeton-wordnet-3-0", "entity"),
        ("open-english-wordnet-2025-plus", "pub"),
        ("gcide-0-54", "Aard-wolf"),
    ];
    assert_eq!(
        catalog.dictionaries.len(),
        required.len(),
        "the English candidate set should contain exactly the configured Phase 16 sources"
    );

    let app_data_root = test_root("generated-english-candidates");
    fs::create_dir_all(&app_data_root).expect("candidate validation root should be created");
    let mut receipt_packages = Vec::with_capacity(required.len());

    for (index, (id, lookup_term)) in required.into_iter().enumerate() {
        let entry = catalog
            .dictionaries
            .iter()
            .find(|entry| entry.id == id)
            .unwrap_or_else(|| panic!("candidate catalog should contain {id}"))
            .clone();
        assert_eq!(entry.source_language, "en");
        assert_eq!(entry.target_language, "en");
        assert_eq!(
            entry.package_format,
            DictionaryCatalogPackageFormat::StardictTarXz
        );

        let file_name = entry
            .download_url
            .rsplit('/')
            .next()
            .filter(|name| !name.is_empty())
            .expect("candidate download URL should end in a package filename");
        let package_path = candidate_dir.join(file_name);
        let package_bytes = fs::read(&package_path).unwrap_or_else(|error| {
            panic!("candidate package {file_name} should be readable: {error}")
        });
        let package_sha256 = format!("{:x}", Sha256::digest(&package_bytes));
        assert_eq!(package_bytes.len() as u64, entry.compressed_size_bytes);
        assert_eq!(package_sha256, entry.sha256);

        let token = format!("verified-16-{index}-0.dictionary-package");
        write_verified_download_fixture(&app_data_root, &token, entry.clone(), &package_bytes);
        let installed = DictionaryInstallService::default()
            .install_catalog(&app_data_root, &token)
            .unwrap_or_else(|error| {
                panic!("{id} should install through the catalog owner: {error}")
            });
        assert_eq!(installed.catalog_id.as_deref(), Some(id));
        assert_eq!(installed.index_state, DictionaryIndexState::Ready);
        assert!(
            installed.entry_count > 0,
            "{id} should publish indexed entries"
        );

        let response = DictionaryLookupService
            .lookup(&app_data_root, lookup_term)
            .unwrap_or_else(|error| panic!("{id} representative lookup should succeed: {error}"));
        let matched = response
            .entries
            .iter()
            .find(|result| result.dictionary_id == installed.id)
            .unwrap_or_else(|| panic!("{id} should return a result for {lookup_term}"));
        assert!(
            matched
                .definition_text_blocks
                .iter()
                .any(|block| !block.trim().is_empty()),
            "{id} should return a textual definition for {lookup_term}"
        );

        receipt_packages.push(json!({
            "id": id,
            "fileName": file_name,
            "compressedSizeBytes": package_bytes.len(),
            "sha256": package_sha256,
        }));
    }

    let mut receipt_bytes = serde_json::to_vec_pretty(&json!({
        "schemaVersion": 1,
        "catalogSha256": format!("{:x}", Sha256::digest(&catalog_bytes)),
        "packages": receipt_packages,
    }))
    .expect("validation receipt should serialize");
    receipt_bytes.push(b'\n');
    fs::create_dir_all(
        validation_receipt
            .parent()
            .expect("validation receipt should have a parent directory"),
    )
    .expect("validation receipt parent should be created");
    fs::write(&validation_receipt, receipt_bytes).expect("validation receipt should be written");
    fs::remove_dir_all(app_data_root).expect("candidate validation root should be removed");
}

#[tokio::test(flavor = "current_thread")]
async fn valid_catalog_publishes_normalized_entries_in_deterministic_order() {
    let root = test_root("valid");
    let service = DictionaryCatalogService::default();
    let bytes = manifest(vec![
        entry("zulu", "Zulu", "en-US"),
        entry("alpha-fr", "Alpha", "fr"),
        entry("alpha-en", " Alpha ", "en-US"),
    ]);

    let snapshot = service
        .refresh_with(&root, move |_| async move { Ok(bytes) })
        .await
        .unwrap();

    assert_eq!(snapshot.source, DictionaryCatalogSource::Network);
    assert_eq!(snapshot.cache_warning, None);
    assert_eq!(
        snapshot
            .entries
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>(),
        vec!["alpha-en", "zulu", "alpha-fr"]
    );
    assert_eq!(snapshot.entries[0].name, "Alpha");
    assert_eq!(
        service.current_entry("alpha-en").unwrap(),
        snapshot.entries[0]
    );
    assert_eq!(
        snapshot.entries[0].sha256,
        "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    );
    let cached = service.load_cached(&root).unwrap().unwrap();
    assert_eq!(cached.source, DictionaryCatalogSource::Cache);
    assert_eq!(cached.entries, snapshot.entries);
    assert_eq!(service.current_entry("zulu").unwrap().id, "zulu");
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn catalog_orders_english_monolingual_entries_before_language_pairs() {
    let catalog = validate_catalog_bytes(&manifest(vec![
        directional_entry("afrikaans-english", "Afrikaans to English", "af", "en"),
        entry("english-b", "English B", "en"),
        directional_entry("english-french", "English to French", "en", "fr"),
        entry("english-a", "English A", "en"),
    ]))
    .unwrap();

    assert_eq!(
        catalog
            .dictionaries
            .iter()
            .map(|entry| entry.id.as_str())
            .collect::<Vec<_>>(),
        vec![
            "english-a",
            "english-b",
            "afrikaans-english",
            "english-french"
        ]
    );
}

#[test]
fn catalog_accepts_versioned_stardict_zip_and_tar_xz_package_formats() {
    let zip_entry = entry("zip", "ZIP", "en");
    let mut tar_entry = entry("tar", "TAR XZ", "fr");
    tar_entry["downloadUrl"] = json!("https://example.com/freedict-fra-eng-2026.1.stardict.tar.xz");
    tar_entry["packageFormat"] = json!("stardict-tar-xz");

    let catalog = validate_catalog_bytes(&manifest(vec![zip_entry, tar_entry])).unwrap();

    let zip = catalog
        .dictionaries
        .iter()
        .find(|entry| entry.id == "zip")
        .unwrap();
    let tar = catalog
        .dictionaries
        .iter()
        .find(|entry| entry.id == "tar")
        .unwrap();
    assert_eq!(
        zip.package_format,
        DictionaryCatalogPackageFormat::StardictZip
    );
    assert_eq!(
        tar.package_format,
        DictionaryCatalogPackageFormat::StardictTarXz
    );
}

#[test]
fn catalog_preserves_canonical_monolingual_and_directional_language_pairs() {
    let catalog = validate_catalog_bytes(&manifest(vec![
        entry("english-us", "English US", "EN-us"),
        directional_entry("french-english", "French to English", "FR", "en"),
        directional_entry("english-french", "English to French", "en", "fr"),
    ]))
    .unwrap();

    let english = catalog
        .dictionaries
        .iter()
        .find(|entry| entry.id == "english-us")
        .unwrap();
    assert_eq!(english.source_language, "en-US");
    assert_eq!(english.target_language, "en-US");

    let french_english = catalog
        .dictionaries
        .iter()
        .find(|entry| entry.id == "french-english")
        .unwrap();
    assert_eq!(french_english.source_language, "fr");
    assert_eq!(french_english.target_language, "en");

    let english_french = catalog
        .dictionaries
        .iter()
        .find(|entry| entry.id == "english-french")
        .unwrap();
    assert_eq!(english_french.source_language, "en");
    assert_eq!(english_french.target_language, "fr");
    assert_ne!(
        (
            french_english.source_language.as_str(),
            french_english.target_language.as_str()
        ),
        (
            english_french.source_language.as_str(),
            english_french.target_language.as_str()
        )
    );
}

#[test]
fn invalid_manifests_never_validate_for_publication() {
    let mut invalid_schema: Value =
        serde_json::from_slice(&manifest(vec![entry("english", "English", "en")])).unwrap();
    invalid_schema["schemaVersion"] = json!(2);
    let invalid_schema = serde_json::to_vec(&invalid_schema).unwrap();

    let duplicate_ids = manifest(vec![
        entry("english", "English", "en"),
        entry("english", "English Two", "en"),
    ]);

    let mut insecure_url: Value =
        serde_json::from_slice(&manifest(vec![entry("english", "English", "en")])).unwrap();
    insecure_url["dictionaries"][0]["downloadUrl"] = json!("http://example.com/english.zip");
    let insecure_url = serde_json::to_vec(&insecure_url).unwrap();

    let mut invalid_digest: Value =
        serde_json::from_slice(&manifest(vec![entry("english", "English", "en")])).unwrap();
    invalid_digest["dictionaries"][0]["sha256"] = json!("not-a-digest");
    let invalid_digest = serde_json::to_vec(&invalid_digest).unwrap();

    let mut invalid_language: Value =
        serde_json::from_slice(&manifest(vec![entry("english", "English", "en")])).unwrap();
    invalid_language["dictionaries"][0]["targetLanguage"] = json!("en_US");
    let invalid_language = serde_json::to_vec(&invalid_language).unwrap();

    let mut unknown_entry_field: Value =
        serde_json::from_slice(&manifest(vec![entry("english", "English", "en")])).unwrap();
    unknown_entry_field["dictionaries"][0]["unexpectedField"] = json!("unexpected");
    let unknown_entry_field = serde_json::to_vec(&unknown_entry_field).unwrap();

    let legacy_single_language = serde_json::to_vec(&json!({
        "schemaVersion": 1,
        "dictionaries": [{
            "id": "legacy",
            "name": "Legacy",
            "language": "en",
            "description": "Legacy prerelease shape",
            "sourceAttribution": "Example",
            "sourceUrl": null,
            "licenseName": "Example",
            "licenseUrl": "https://example.com/license",
            "packageVersion": "1",
            "compressedSizeBytes": 4096,
            "installedSizeEstimateBytes": 8192,
            "downloadUrl": "https://example.com/legacy.zip",
            "packageFormat": "stardict-zip",
            "sha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
        }]
    }))
    .unwrap();

    for bytes in [
        invalid_schema,
        duplicate_ids,
        insecure_url,
        invalid_digest,
        invalid_language,
        unknown_entry_field,
        legacy_single_language,
    ] {
        assert!(matches!(
            validate_catalog_bytes(&bytes),
            Err(DictionaryCatalogError::Invalid(_))
        ));
    }
    assert_eq!(
        validate_catalog_bytes(&vec![b' '; MAX_CATALOG_BYTES + 1]).unwrap_err(),
        DictionaryCatalogError::ResponseTooLarge
    );
}

#[test]
fn retired_descriptions_are_accepted_but_not_republished() {
    let mut legacy_manifest: Value =
        serde_json::from_slice(&manifest(vec![entry("english", "English", "en")])).unwrap();
    legacy_manifest["dictionaries"][0]["description"] =
        json!("Description from a previously published catalog.");

    let catalog = validate_catalog_bytes(&serde_json::to_vec(&legacy_manifest).unwrap()).unwrap();
    let republished = serde_json::to_value(catalog).unwrap();

    assert!(republished["dictionaries"][0].get("description").is_none());
}

#[tokio::test(flavor = "current_thread")]
async fn cancellation_and_newer_requests_retire_stale_publication() {
    let cancelled_root = test_root("cancelled");
    let cancelled_service = DictionaryCatalogService::default();
    let (started_tx, started_rx) = oneshot::channel();
    let pending_service = cancelled_service.clone();
    let pending_root = cancelled_root.clone();
    let pending = tokio::spawn(async move {
        pending_service
            .refresh_with(&pending_root, move |ticket| async move {
                started_tx.send(()).unwrap();
                Err(super::catalog_request_error(
                    ticket.wait_for_retirement().await,
                ))
            })
            .await
    });
    started_rx.await.unwrap();
    cancelled_service.cancel_current();
    assert_eq!(
        pending.await.unwrap().unwrap_err(),
        DictionaryCatalogError::Cancelled
    );
    assert!(!catalog_cache_path(&cancelled_root).exists());

    let stale_root = test_root("stale");
    let stale_service = DictionaryCatalogService::default();
    let (old_started_tx, old_started_rx) = oneshot::channel();
    let (old_release_tx, old_release_rx) = oneshot::channel();
    let old_service = stale_service.clone();
    let old_root = stale_root.clone();
    let old = tokio::spawn(async move {
        old_service
            .refresh_with(&old_root, move |_| async move {
                old_started_tx.send(()).unwrap();
                old_release_rx.await.unwrap();
                Ok(manifest(vec![entry("old", "Old", "en")]))
            })
            .await
    });
    old_started_rx.await.unwrap();
    let current = stale_service
        .refresh_with(&stale_root, |_| async {
            Ok(manifest(vec![entry("current", "Current", "en")]))
        })
        .await
        .unwrap();
    old_release_tx.send(()).unwrap();

    assert_eq!(current.entries[0].id, "current");
    assert_eq!(
        old.await.unwrap().unwrap_err(),
        DictionaryCatalogError::Superseded
    );
    let cached = stale_service.load_cached(&stale_root).unwrap().unwrap();
    assert_eq!(cached.entries[0].id, "current");
    assert!(!cancelled_root.exists());
    fs::remove_dir_all(stale_root).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn failed_refresh_preserves_valid_cache_and_installed_dictionary_state() {
    let root = test_root("offline");
    let service = DictionaryCatalogService::default();
    service
        .refresh_with(&root, |_| async {
            Ok(manifest(vec![entry("cached", "Cached", "en")]))
        })
        .await
        .unwrap();
    let installed = {
        let mut store = open_current_store(&root).unwrap();
        store
            .register(DictionaryRegistration {
                display_name: "Installed".to_string(),
                source_language: "en".to_string(),
                target_language: "en".to_string(),
                enabled: true,
                entry_count: 1,
                installed_size_bytes: 4,
                source_kind: DictionarySourceKind::Catalog,
                catalog_id: Some("cached".to_string()),
                source_attribution: "Example".to_string(),
                license_name: "CC BY 4.0".to_string(),
                license_url: Some("https://example.com/license".to_string()),
                package_version: "1".to_string(),
                index_state: DictionaryIndexState::Ready,
            })
            .unwrap()
    };

    let error = service
        .refresh_with(&root, |_| async {
            Err(DictionaryCatalogError::Network(
                "catalog unavailable".to_string(),
            ))
        })
        .await
        .unwrap_err();

    assert!(matches!(error, DictionaryCatalogError::Network(_)));
    let cached = service.load_cached(&root).unwrap().unwrap();
    assert_eq!(cached.entries[0].id, "cached");
    assert_eq!(
        open_current_store(&root).unwrap().list().unwrap(),
        vec![installed]
    );
    fs::remove_dir_all(root).unwrap();
}
