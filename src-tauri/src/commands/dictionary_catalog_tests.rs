use std::{
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

use serde_json::{json, Value};
use tokio::sync::oneshot;

use super::{
    catalog_cache_path, validate_catalog_bytes, DictionaryCatalogError, DictionaryCatalogService,
    DictionaryCatalogSource, MAX_CATALOG_BYTES,
};
use crate::commands::dictionary_store::{
    open_current_store, DictionaryIndexState, DictionaryRegistration, DictionarySourceKind,
};

static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn test_root(label: &str) -> PathBuf {
    let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "archeion-dictionary-catalog-{label}-{}-{sequence}",
        std::process::id()
    ))
}

fn entry(id: &str, name: &str, language: &str) -> Value {
    json!({
        "id": id,
        "name": name,
        "language": language,
        "description": "A focused dictionary.",
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

    for bytes in [invalid_schema, duplicate_ids, insecure_url, invalid_digest] {
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
                language: "en".to_string(),
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
