use std::{
    collections::VecDeque,
    fs,
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

use sha2::{Digest, Sha256};
use tokio::sync::oneshot;

use super::{
    cleanup_verified_download, download_staging_root, open_http_source, resolve_verified_download,
    DictionaryDownloadError, DictionaryDownloadService, NextChunkFuture, PackageSource,
    RequestTicket,
};
use crate::commands::dictionary_catalog::{DictionaryCatalogEntry, DictionaryCatalogPackageFormat};
use crate::commands::{
    dictionary_archive, dictionary_install::DictionaryInstallService,
    dictionary_lookup::DictionaryLookupService,
};

static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

fn test_root(label: &str) -> PathBuf {
    let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    std::env::temp_dir().join(format!(
        "archeion-dictionary-download-{label}-{}-{sequence}",
        std::process::id()
    ))
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn entry_with_format(
    bytes: &[u8],
    package_format: DictionaryCatalogPackageFormat,
) -> DictionaryCatalogEntry {
    DictionaryCatalogEntry {
        id: "english".to_string(),
        name: "English".to_string(),
        source_language: "en".to_string(),
        target_language: "en".to_string(),
        description: "A test dictionary.".to_string(),
        source_attribution: "Example".to_string(),
        source_url: None,
        license_name: "CC BY 4.0".to_string(),
        license_url: "https://example.com/license".to_string(),
        package_version: "1".to_string(),
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
        sha256: sha256(bytes),
    }
}

fn entry(bytes: &[u8]) -> DictionaryCatalogEntry {
    entry_with_format(bytes, DictionaryCatalogPackageFormat::StardictZip)
}

struct ChunkSource {
    content_length: Option<u64>,
    chunks: VecDeque<Result<Vec<u8>, DictionaryDownloadError>>,
}

impl ChunkSource {
    fn new(content_length: Option<u64>, chunks: Vec<Vec<u8>>) -> Self {
        Self {
            content_length,
            chunks: chunks.into_iter().map(Ok).collect(),
        }
    }
}

impl PackageSource for ChunkSource {
    fn content_length(&self) -> Option<u64> {
        self.content_length
    }

    fn next_chunk<'a>(&'a mut self, _ticket: &'a RequestTicket) -> NextChunkFuture<'a> {
        Box::pin(async move { self.chunks.pop_front().transpose() })
    }
}

struct RetiringSource;

impl PackageSource for RetiringSource {
    fn content_length(&self) -> Option<u64> {
        None
    }

    fn next_chunk<'a>(&'a mut self, ticket: &'a RequestTicket) -> NextChunkFuture<'a> {
        Box::pin(async move {
            Err(super::download_request_error(
                ticket.wait_for_retirement().await,
            ))
        })
    }
}

#[tokio::test(flavor = "current_thread")]
async fn download_owner_rejects_a_non_https_target_before_network_access() {
    let service = DictionaryDownloadService::default();
    let ticket = service.requests.begin().unwrap();
    let mut package_entry = entry(b"package");
    package_entry.download_url = "http://example.com/package.zip".to_string();

    assert!(matches!(
        open_http_source(package_entry, ticket).await,
        Err(DictionaryDownloadError::InvalidDownloadTarget)
    ));
}

#[tokio::test(flavor = "current_thread")]
async fn streamed_download_reports_bounded_progress_and_publishes_only_verified_bytes() {
    let root = test_root("success");
    let bytes = vec![b'a'; 2 * 1024 * 1024 + 123];
    let package_entry = entry(&bytes);
    let service = DictionaryDownloadService::default();
    let mut progress = Vec::new();
    let byte_count = bytes.len() as u64;
    let chunks = bytes
        .chunks(8 * 1024)
        .map(<[u8]>::to_vec)
        .collect::<Vec<_>>();

    let package = service
        .download_with(
            &root,
            package_entry.clone(),
            |update| {
                progress.push(update);
                Ok(())
            },
            |_, _| async move { Ok(ChunkSource::new(Some(byte_count), chunks)) },
        )
        .await
        .unwrap();

    assert_eq!(package.catalog_id, package_entry.id);
    assert_eq!(package.size_bytes, bytes.len() as u64);
    assert_eq!(package.sha256, sha256(&bytes));
    let staged = download_staging_root(&root).join(&package.staging_token);
    let artifact = resolve_verified_download(&root, &package.staging_token).unwrap();
    assert_eq!(artifact.catalog_entry, package_entry);
    assert_eq!(artifact.verified_size_bytes, bytes.len() as u64);
    assert_eq!(artifact.verified_sha256, sha256(&bytes));
    assert_eq!(fs::read(&artifact.package_path).unwrap(), bytes);
    assert_eq!(fs::read_dir(&staged).unwrap().count(), 2);
    assert_eq!(progress.first().unwrap().received_bytes, 0);
    assert_eq!(progress.last().unwrap().received_bytes, bytes.len() as u64);
    assert!(progress.len() <= 5);
    let unrelated = download_staging_root(&root).join("unrelated.staged");
    fs::write(&unrelated, b"preserve").unwrap();
    assert!(cleanup_verified_download(&root, &package.staging_token).unwrap());
    assert!(!staged.exists());
    assert_eq!(fs::read(unrelated).unwrap(), b"preserve");
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn tar_xz_download_preserves_verified_archive_bytes_and_format() {
    let root = test_root("tar-xz-success");
    let bytes = b"representative-compressed-tar-xz";
    let package_entry = entry_with_format(bytes, DictionaryCatalogPackageFormat::StardictTarXz);
    let service = DictionaryDownloadService::default();

    let package = service
        .download_with(
            &root,
            package_entry.clone(),
            |_| Ok(()),
            |_, _| async move {
                Ok(ChunkSource::new(
                    Some(bytes.len() as u64),
                    vec![bytes.to_vec()],
                ))
            },
        )
        .await
        .unwrap();

    assert_eq!(
        package.package_format,
        DictionaryCatalogPackageFormat::StardictTarXz
    );
    let artifact = resolve_verified_download(&root, &package.staging_token).unwrap();
    assert_eq!(
        artifact.catalog_entry.package_format,
        DictionaryCatalogPackageFormat::StardictTarXz
    );
    assert_eq!(artifact.verified_size_bytes, bytes.len() as u64);
    assert_eq!(artifact.verified_sha256, sha256(bytes));
    assert_eq!(fs::read(artifact.package_path).unwrap(), bytes);
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn representative_freedict_package_downloads_installs_indexes_and_looks_up() {
    let root = test_root("freedict-full-path");
    let bytes = dictionary_archive::tests::freedict_style_tar_xz_fixture();
    let mut package_entry = entry_with_format(bytes, DictionaryCatalogPackageFormat::StardictTarXz);
    package_entry.id = "freedict-fra-eng".to_string();
    package_entry.source_language = "fr".to_string();
    package_entry.target_language = "en".to_string();
    let service = DictionaryDownloadService::default();

    let verified = service
        .download_with(
            &root,
            package_entry,
            |_| Ok(()),
            |_, _| async move {
                Ok(ChunkSource::new(
                    Some(bytes.len() as u64),
                    vec![bytes.to_vec()],
                ))
            },
        )
        .await
        .expect("representative FreeDict bytes should pass download verification");
    let installed = DictionaryInstallService::default()
        .install_catalog(&root, &verified.staging_token)
        .expect("verified FreeDict bytes should install and index");
    let lookup = DictionaryLookupService
        .lookup(&root, "alpha")
        .expect("installed FreeDict fixture should be queryable");

    assert_eq!(installed.catalog_id.as_deref(), Some("freedict-fra-eng"));
    assert_eq!(installed.source_language, "fr");
    assert_eq!(installed.target_language, "en");
    assert!(lookup
        .entries
        .iter()
        .any(|entry| entry.dictionary_id == installed.id));
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn checksum_and_size_failures_remove_only_the_owned_partial_file() {
    let root = test_root("contained-failures");
    let staging = download_staging_root(&root);
    let installed = root.join("dictionaries/installed/stable/source.dict");
    fs::create_dir_all(&staging).unwrap();
    fs::create_dir_all(installed.parent().unwrap()).unwrap();
    let unrelated = staging.join("unrelated.staged");
    fs::write(&unrelated, b"keep").unwrap();
    fs::write(&installed, b"installed").unwrap();
    let service = DictionaryDownloadService::default();
    let bytes = b"package";

    let mut wrong_digest = entry_with_format(bytes, DictionaryCatalogPackageFormat::StardictTarXz);
    wrong_digest.sha256 = "0".repeat(64);
    let checksum_error = service
        .download_with(
            &root,
            wrong_digest,
            |_| Ok(()),
            |_, _| async move {
                Ok(ChunkSource::new(
                    Some(bytes.len() as u64),
                    vec![bytes.to_vec()],
                ))
            },
        )
        .await
        .unwrap_err();
    assert_eq!(checksum_error, DictionaryDownloadError::ChecksumMismatch);

    let size_error = service
        .download_with(
            &root,
            entry_with_format(bytes, DictionaryCatalogPackageFormat::StardictTarXz),
            |_| Ok(()),
            |_, _| async move { Ok(ChunkSource::new(None, vec![b"package!".to_vec()])) },
        )
        .await
        .unwrap_err();
    assert_eq!(size_error, DictionaryDownloadError::SizeLimitExceeded);
    assert_eq!(fs::read(&unrelated).unwrap(), b"keep");
    assert_eq!(fs::read(&installed).unwrap(), b"installed");
    assert_eq!(
        fs::read_dir(&staging)
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<Vec<_>>(),
        vec![unrelated.file_name().unwrap()]
    );
    fs::remove_dir_all(root).unwrap();
}

#[tokio::test(flavor = "current_thread")]
async fn network_timeout_and_cancel_settle_without_verified_staging() {
    let root = test_root("outcomes");
    let bytes = b"package";
    let service = DictionaryDownloadService::default();

    for expected in [
        DictionaryDownloadError::Network("offline".to_string()),
        DictionaryDownloadError::Timeout,
    ] {
        let returned = expected.clone();
        let error = service
            .download_with(
                &root,
                entry(bytes),
                |_| Ok(()),
                move |_, _| async move { Err::<ChunkSource, _>(returned) },
            )
            .await
            .unwrap_err();
        assert_eq!(error, expected);
    }

    let pending_service = service.clone();
    let pending_root = root.clone();
    let recognized_stale = download_staging_root(&root).join("partial-1-2-3.download");
    fs::create_dir_all(&recognized_stale).unwrap();
    let (started_tx, started_rx) = oneshot::channel();
    let pending = tokio::spawn(async move {
        pending_service
            .download_with(
                &pending_root,
                entry(bytes),
                |_| Ok(()),
                move |_, _| async move {
                    started_tx.send(()).unwrap();
                    Ok(RetiringSource)
                },
            )
            .await
    });
    started_rx.await.unwrap();
    assert_eq!(service.cleanup_stale(&root).unwrap(), 0);
    assert!(recognized_stale.is_dir());
    service.cancel_current();
    assert_eq!(
        pending.await.unwrap().unwrap_err(),
        DictionaryDownloadError::Cancelled
    );
    assert_eq!(service.cleanup_stale(&root).unwrap(), 1);
    assert!(
        !download_staging_root(&root).exists()
            || fs::read_dir(download_staging_root(&root))
                .unwrap()
                .next()
                .is_none()
    );
    if root.exists() {
        fs::remove_dir_all(root).unwrap();
    }
}

#[tokio::test(flavor = "current_thread")]
async fn newer_download_retires_the_older_request_before_it_can_publish() {
    let root = test_root("superseded");
    let bytes = b"package";
    let service = DictionaryDownloadService::default();
    let old_service = service.clone();
    let old_root = root.clone();
    let (started_tx, started_rx) = oneshot::channel();
    let old = tokio::spawn(async move {
        old_service
            .download_with(
                &old_root,
                entry(bytes),
                |_| Ok(()),
                move |_, _| async move {
                    started_tx.send(()).unwrap();
                    Ok(RetiringSource)
                },
            )
            .await
    });
    started_rx.await.unwrap();

    let current = service
        .download_with(
            &root,
            entry(bytes),
            |_| Ok(()),
            |_, _| async move {
                Ok(ChunkSource::new(
                    Some(bytes.len() as u64),
                    vec![bytes.to_vec()],
                ))
            },
        )
        .await
        .unwrap();
    assert_eq!(
        old.await.unwrap().unwrap_err(),
        DictionaryDownloadError::Superseded
    );
    assert_eq!(
        fs::read_dir(download_staging_root(&root))
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<Vec<_>>(),
        vec![std::ffi::OsString::from(current.staging_token)]
    );
    fs::remove_dir_all(root).unwrap();
}
