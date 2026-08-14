use std::{
    fmt,
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use reqwest::{redirect, Url};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tokio::{
    fs::{self, OpenOptions},
    io::AsyncWriteExt,
};

use super::{
    dictionary_catalog::{
        validate_catalog_entry, DictionaryCatalogEntry, DictionaryCatalogPackageFormat,
    },
    dictionary_request::{
        DictionaryRequestError, DictionaryRequestOwner, DictionaryRequestTicket as RequestTicket,
    },
    dictionary_store::DictionaryStoragePaths,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const MAX_REDIRECTS: usize = 3;
const PROGRESS_STEP_BYTES: u64 = 1024 * 1024;
const DOWNLOAD_STAGING_DIRECTORY: &str = "staging/downloads";
const VERIFIED_PREFIX: &str = "verified-";
const VERIFIED_SUFFIX: &str = ".stardict.zip";
const RETIRED_INSTALL_PREFIX: &str = "retired-install-";
const VERIFIED_PACKAGE_FILE_NAME: &str = "package.stardict.zip";
const VERIFIED_PROVENANCE_FILE_NAME: &str = "provenance-v1.json";
const VERIFIED_PROVENANCE_SCHEMA_VERSION: u32 = 1;
const MAX_VERIFIED_PROVENANCE_BYTES: u64 = 32 * 1024;
static STAGING_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DictionaryDownloadProgress {
    pub received_bytes: u64,
    pub total_bytes: u64,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct VerifiedDictionaryDownload {
    pub staging_token: String,
    pub catalog_id: String,
    pub package_format: DictionaryCatalogPackageFormat,
    pub size_bytes: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VerifiedDownloadProvenance {
    schema_version: u32,
    staging_token: String,
    catalog_entry: DictionaryCatalogEntry,
    package_format: DictionaryCatalogPackageFormat,
    verified_size_bytes: u64,
    verified_sha256: String,
}

#[derive(Clone, Debug)]
pub(crate) struct VerifiedDownloadArtifact {
    artifact_path: PathBuf,
    pub package_path: PathBuf,
    pub catalog_entry: DictionaryCatalogEntry,
    pub verified_size_bytes: u64,
    pub verified_sha256: String,
}

pub(crate) struct ClaimedVerifiedDownload {
    original_path: PathBuf,
    retired_path: PathBuf,
    artifact: VerifiedDownloadArtifact,
}

impl ClaimedVerifiedDownload {
    pub(crate) fn artifact(&self) -> &VerifiedDownloadArtifact {
        &self.artifact
    }

    pub(crate) fn restore(self) -> Result<(), DictionaryDownloadError> {
        match std::fs::symlink_metadata(&self.original_path) {
            Ok(_) => {
                return Err(filesystem_error(std::io::Error::new(
                    std::io::ErrorKind::AlreadyExists,
                    "the original verified staging token path is occupied",
                )))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(filesystem_error(error)),
        }
        std::fs::rename(&self.retired_path, &self.original_path).map_err(filesystem_error)
    }

    pub(crate) fn retire_with<Cleanup>(self, cleanup: Cleanup)
    where
        Cleanup: FnOnce(&Path) -> Result<(), std::io::Error>,
    {
        let _ = cleanup(&self.retired_path);
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub(crate) enum DictionaryDownloadOutcome {
    Succeeded { package: VerifiedDictionaryDownload },
    Cancelled,
    Failed { message: String },
}

type NextChunkFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Option<Vec<u8>>, DictionaryDownloadError>> + Send + 'a>>;

trait PackageSource: Send {
    fn content_length(&self) -> Option<u64>;

    fn next_chunk<'a>(&'a mut self, ticket: &'a RequestTicket) -> NextChunkFuture<'a>;
}

struct HttpPackageSource {
    response: reqwest::Response,
}

impl PackageSource for HttpPackageSource {
    fn content_length(&self) -> Option<u64> {
        self.response.content_length()
    }

    fn next_chunk<'a>(&'a mut self, ticket: &'a RequestTicket) -> NextChunkFuture<'a> {
        Box::pin(async move {
            tokio::select! {
                chunk = self.response.chunk() => chunk
                    .map(|chunk| chunk.map(|bytes| bytes.to_vec()))
                    .map_err(network_error),
                error = ticket.wait_for_retirement() => Err(download_request_error(error)),
            }
        })
    }
}

#[derive(Clone, Default)]
pub(crate) struct DictionaryDownloadService {
    requests: DictionaryRequestOwner,
}

impl DictionaryDownloadService {
    pub(crate) async fn download<P>(
        &self,
        app_data_root: &Path,
        entry: DictionaryCatalogEntry,
        progress: P,
    ) -> Result<VerifiedDictionaryDownload, DictionaryDownloadError>
    where
        P: FnMut(DictionaryDownloadProgress) -> Result<(), DictionaryDownloadError>,
    {
        self.download_with(app_data_root, entry, progress, open_http_source)
            .await
    }

    async fn download_with<F, Fut, S, P>(
        &self,
        app_data_root: &Path,
        entry: DictionaryCatalogEntry,
        progress: P,
        open_source: F,
    ) -> Result<VerifiedDictionaryDownload, DictionaryDownloadError>
    where
        F: FnOnce(DictionaryCatalogEntry, RequestTicket) -> Fut,
        Fut: Future<Output = Result<S, DictionaryDownloadError>>,
        S: PackageSource,
        P: FnMut(DictionaryDownloadProgress) -> Result<(), DictionaryDownloadError>,
    {
        let ticket = self.requests.begin().map_err(download_request_error)?;
        let source = open_source(entry.clone(), ticket.clone()).await;
        let result = match source {
            Ok(source) => stage_source(app_data_root, &entry, &ticket, source, progress).await,
            Err(error) => Err(error),
        };

        match result {
            Ok((package, mut guard)) => {
                self.requests
                    .settle_current(&ticket, || ())
                    .map_err(download_request_error)?;
                guard.preserve = true;
                Ok(package)
            }
            Err(error) => Err(self
                .requests
                .finish_failed(&ticket)
                .map(download_request_error)
                .unwrap_or(error)),
        }
    }

    pub(crate) fn cancel_current(&self) {
        self.requests.cancel_current();
    }

    pub(crate) fn cleanup_stale(
        &self,
        app_data_root: &Path,
    ) -> Result<usize, DictionaryDownloadError> {
        if self.requests.is_active() {
            return Ok(0);
        }
        cleanup_stale_download_staging(app_data_root)
    }
}

async fn open_http_source(
    entry: DictionaryCatalogEntry,
    ticket: RequestTicket,
) -> Result<HttpPackageSource, DictionaryDownloadError> {
    let download_url = Url::parse(&entry.download_url)
        .map_err(|_| DictionaryDownloadError::InvalidDownloadTarget)?;
    if download_url.scheme() != "https" {
        return Err(DictionaryDownloadError::InvalidDownloadTarget);
    }
    let redirects = redirect::Policy::custom(|attempt| {
        if attempt.previous().len() >= MAX_REDIRECTS {
            attempt.error("dictionary download exceeded the redirect limit")
        } else if attempt.url().scheme() != "https" {
            attempt.error("dictionary download redirected to a non-HTTPS URL")
        } else {
            attempt.follow()
        }
    });
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .redirect(redirects)
        .user_agent("Archeion dictionary download")
        .build()
        .map_err(network_error)?;
    let response = tokio::select! {
        response = client.get(download_url).send() => response.map_err(network_error)?,
        error = ticket.wait_for_retirement() => return Err(download_request_error(error)),
    };
    if !response.status().is_success() {
        return Err(DictionaryDownloadError::Network(format!(
            "The dictionary package server returned HTTP {}.",
            response.status().as_u16()
        )));
    }
    Ok(HttpPackageSource { response })
}

async fn stage_source<S, P>(
    app_data_root: &Path,
    entry: &DictionaryCatalogEntry,
    ticket: &RequestTicket,
    mut source: S,
    mut progress: P,
) -> Result<(VerifiedDictionaryDownload, StagingArtifactGuard), DictionaryDownloadError>
where
    S: PackageSource,
    P: FnMut(DictionaryDownloadProgress) -> Result<(), DictionaryDownloadError>,
{
    if source
        .content_length()
        .is_some_and(|length| length > entry.compressed_size_bytes)
    {
        return Err(DictionaryDownloadError::SizeLimitExceeded);
    }

    let staging = download_staging_root(app_data_root);
    fs::create_dir_all(&staging)
        .await
        .map_err(filesystem_error)?;
    let stem = generated_staging_stem();
    let partial_path = staging.join(format!("partial-{stem}.download"));
    let verified_token = format!("{VERIFIED_PREFIX}{stem}{VERIFIED_SUFFIX}");
    let verified_path = staging.join(&verified_token);
    fs::create_dir(&partial_path)
        .await
        .map_err(filesystem_error)?;
    let mut guard = StagingArtifactGuard::new(partial_path.clone());
    let partial_package_path = partial_path.join(VERIFIED_PACKAGE_FILE_NAME);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial_package_path)
        .await
        .map_err(filesystem_error)?;
    let mut hasher = Sha256::new();
    let mut received = 0_u64;
    let mut next_progress = 0_u64;
    publish_progress(&mut progress, received, entry.compressed_size_bytes)?;

    while let Some(chunk) = source.next_chunk(ticket).await? {
        ticket
            .current_error()
            .map(download_request_error)
            .map_or(Ok(()), Err)?;
        received = received
            .checked_add(chunk.len() as u64)
            .ok_or(DictionaryDownloadError::SizeLimitExceeded)?;
        if received > entry.compressed_size_bytes {
            return Err(DictionaryDownloadError::SizeLimitExceeded);
        }
        file.write_all(&chunk).await.map_err(filesystem_error)?;
        hasher.update(&chunk);
        if received >= next_progress {
            publish_progress(&mut progress, received, entry.compressed_size_bytes)?;
            next_progress = received.saturating_add(PROGRESS_STEP_BYTES);
        }
    }

    if received != entry.compressed_size_bytes {
        return Err(DictionaryDownloadError::SizeMismatch {
            expected: entry.compressed_size_bytes,
            actual: received,
        });
    }
    let sha256 = format!("{:x}", hasher.finalize());
    if sha256 != entry.sha256 {
        return Err(DictionaryDownloadError::ChecksumMismatch);
    }
    file.flush().await.map_err(filesystem_error)?;
    file.sync_all().await.map_err(filesystem_error)?;
    drop(file);
    ticket
        .current_error()
        .map(download_request_error)
        .map_or(Ok(()), Err)?;
    let provenance = verified_provenance(
        entry.clone(),
        verified_token.clone(),
        received,
        sha256.clone(),
    );
    write_provenance(&partial_path, &provenance).await?;
    fs::rename(&partial_path, &verified_path)
        .await
        .map_err(filesystem_error)?;
    guard.path = verified_path;
    publish_progress(&mut progress, received, entry.compressed_size_bytes)?;
    ticket
        .current_error()
        .map(download_request_error)
        .map_or(Ok(()), Err)?;
    Ok((
        VerifiedDictionaryDownload {
            staging_token: verified_token,
            catalog_id: entry.id.clone(),
            package_format: entry.package_format,
            size_bytes: received,
            sha256,
        },
        guard,
    ))
}

fn publish_progress<P>(
    progress: &mut P,
    received_bytes: u64,
    total_bytes: u64,
) -> Result<(), DictionaryDownloadError>
where
    P: FnMut(DictionaryDownloadProgress) -> Result<(), DictionaryDownloadError>,
{
    progress(DictionaryDownloadProgress {
        received_bytes,
        total_bytes,
    })
}

pub(crate) fn cleanup_verified_download(
    app_data_root: &Path,
    staging_token: &str,
) -> Result<bool, DictionaryDownloadError> {
    if !valid_verified_token(staging_token) {
        return Err(DictionaryDownloadError::InvalidStagingToken);
    }
    let path = download_staging_root(app_data_root).join(staging_token);
    let metadata = match std::fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(filesystem_error(error)),
    };
    if !metadata.file_type().is_dir() {
        return Err(DictionaryDownloadError::InvalidStagingToken);
    }
    let artifact = resolve_verified_download(app_data_root, staging_token)?;
    std::fs::remove_dir_all(artifact.artifact_path).map_err(filesystem_error)?;
    Ok(true)
}

pub(crate) fn resolve_verified_download(
    app_data_root: &Path,
    staging_token: &str,
) -> Result<VerifiedDownloadArtifact, DictionaryDownloadError> {
    if !valid_verified_token(staging_token) {
        return Err(DictionaryDownloadError::InvalidStagingToken);
    }
    let artifact_path = download_staging_root(app_data_root).join(staging_token);
    let metadata = std::fs::symlink_metadata(&artifact_path).map_err(filesystem_error)?;
    if !metadata.file_type().is_dir() {
        return Err(DictionaryDownloadError::InvalidStagingToken);
    }
    let package_path = artifact_path.join(VERIFIED_PACKAGE_FILE_NAME);
    require_regular_file(&package_path)?;
    let provenance_path = artifact_path.join(VERIFIED_PROVENANCE_FILE_NAME);
    let provenance_metadata = require_regular_file(&provenance_path)?;
    if provenance_metadata.len() > MAX_VERIFIED_PROVENANCE_BYTES {
        return Err(DictionaryDownloadError::InvalidStagingToken);
    }
    let bytes = std::fs::read(&provenance_path).map_err(filesystem_error)?;
    let provenance: VerifiedDownloadProvenance =
        serde_json::from_slice(&bytes).map_err(|_| DictionaryDownloadError::InvalidStagingToken)?;
    let validated_entry = validate_catalog_entry(provenance.catalog_entry.clone())
        .map_err(|_| DictionaryDownloadError::InvalidStagingToken)?;
    if provenance.schema_version != VERIFIED_PROVENANCE_SCHEMA_VERSION
        || provenance.staging_token != staging_token
        || validated_entry != provenance.catalog_entry
        || provenance.package_format != provenance.catalog_entry.package_format
        || provenance.verified_size_bytes != provenance.catalog_entry.compressed_size_bytes
        || provenance.verified_sha256 != provenance.catalog_entry.sha256
    {
        return Err(DictionaryDownloadError::InvalidStagingToken);
    }
    Ok(VerifiedDownloadArtifact {
        artifact_path,
        package_path,
        catalog_entry: provenance.catalog_entry,
        verified_size_bytes: provenance.verified_size_bytes,
        verified_sha256: provenance.verified_sha256,
    })
}

pub(crate) fn claim_verified_download(
    app_data_root: &Path,
    staging_token: &str,
) -> Result<ClaimedVerifiedDownload, DictionaryDownloadError> {
    let mut artifact = resolve_verified_download(app_data_root, staging_token)?;
    let original_path = artifact.artifact_path.clone();
    let stem = staging_token
        .strip_prefix(VERIFIED_PREFIX)
        .and_then(|value| value.strip_suffix(VERIFIED_SUFFIX))
        .ok_or(DictionaryDownloadError::InvalidStagingToken)?;
    let retired_path = download_staging_root(app_data_root)
        .join(format!("{RETIRED_INSTALL_PREFIX}{stem}{VERIFIED_SUFFIX}"));
    match std::fs::symlink_metadata(&retired_path) {
        Ok(_) => return Err(DictionaryDownloadError::InvalidStagingToken),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(filesystem_error(error)),
    }
    std::fs::rename(&original_path, &retired_path).map_err(filesystem_error)?;
    artifact.artifact_path = retired_path.clone();
    artifact.package_path = retired_path.join(VERIFIED_PACKAGE_FILE_NAME);
    Ok(ClaimedVerifiedDownload {
        original_path,
        retired_path,
        artifact,
    })
}

async fn write_provenance(
    artifact_path: &Path,
    provenance: &VerifiedDownloadProvenance,
) -> Result<(), DictionaryDownloadError> {
    let mut bytes = serde_json::to_vec_pretty(provenance)
        .map_err(|_| DictionaryDownloadError::InvalidStagingToken)?;
    bytes.push(b'\n');
    if bytes.len() as u64 > MAX_VERIFIED_PROVENANCE_BYTES {
        return Err(DictionaryDownloadError::InvalidStagingToken);
    }
    let path = artifact_path.join(VERIFIED_PROVENANCE_FILE_NAME);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .await
        .map_err(filesystem_error)?;
    file.write_all(&bytes).await.map_err(filesystem_error)?;
    file.flush().await.map_err(filesystem_error)?;
    file.sync_all().await.map_err(filesystem_error)
}

fn verified_provenance(
    catalog_entry: DictionaryCatalogEntry,
    staging_token: String,
    verified_size_bytes: u64,
    verified_sha256: String,
) -> VerifiedDownloadProvenance {
    VerifiedDownloadProvenance {
        schema_version: VERIFIED_PROVENANCE_SCHEMA_VERSION,
        staging_token,
        package_format: catalog_entry.package_format,
        catalog_entry,
        verified_size_bytes,
        verified_sha256,
    }
}

#[cfg(test)]
pub(crate) fn write_verified_download_fixture(
    app_data_root: &Path,
    staging_token: &str,
    catalog_entry: DictionaryCatalogEntry,
    package_bytes: &[u8],
) -> PathBuf {
    assert!(valid_verified_token(staging_token));
    let artifact_path = download_staging_root(app_data_root).join(staging_token);
    std::fs::create_dir_all(&artifact_path).unwrap();
    std::fs::write(
        artifact_path.join(VERIFIED_PACKAGE_FILE_NAME),
        package_bytes,
    )
    .unwrap();
    let provenance = verified_provenance(
        catalog_entry,
        staging_token.to_string(),
        package_bytes.len() as u64,
        format!("{:x}", Sha256::digest(package_bytes)),
    );
    let mut bytes = serde_json::to_vec_pretty(&provenance).unwrap();
    bytes.push(b'\n');
    std::fs::write(artifact_path.join(VERIFIED_PROVENANCE_FILE_NAME), bytes).unwrap();
    artifact_path
}

fn require_regular_file(path: &Path) -> Result<std::fs::Metadata, DictionaryDownloadError> {
    let metadata = std::fs::symlink_metadata(path).map_err(filesystem_error)?;
    if !metadata.file_type().is_file() {
        return Err(DictionaryDownloadError::InvalidStagingToken);
    }
    Ok(metadata)
}

fn valid_verified_token(value: &str) -> bool {
    value
        .strip_prefix(VERIFIED_PREFIX)
        .and_then(|value| value.strip_suffix(VERIFIED_SUFFIX))
        .is_some_and(|stem| {
            !stem.is_empty()
                && stem
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || byte == b'-')
        })
}

fn download_staging_root(app_data_root: &Path) -> PathBuf {
    DictionaryStoragePaths::from_app_data_root(app_data_root)
        .root()
        .join(DOWNLOAD_STAGING_DIRECTORY)
}

fn cleanup_stale_download_staging(app_data_root: &Path) -> Result<usize, DictionaryDownloadError> {
    let staging = download_staging_root(app_data_root);
    let entries = match std::fs::read_dir(&staging) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(filesystem_error(error)),
    };
    let mut removed = 0;
    for entry in entries {
        let entry = entry.map_err(filesystem_error)?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !recognized_stale_download_name(name) {
            continue;
        }
        let metadata = std::fs::symlink_metadata(entry.path()).map_err(filesystem_error)?;
        if !metadata.file_type().is_dir() {
            continue;
        }
        std::fs::remove_dir_all(entry.path()).map_err(filesystem_error)?;
        removed += 1;
    }
    Ok(removed)
}

fn recognized_stale_download_name(name: &str) -> bool {
    name.strip_prefix("partial-")
        .and_then(|value| value.strip_suffix(".download"))
        .or_else(|| {
            name.strip_prefix(RETIRED_INSTALL_PREFIX)
                .and_then(|value| value.strip_suffix(VERIFIED_SUFFIX))
        })
        .is_some_and(valid_generated_stem)
}

fn valid_generated_stem(stem: &str) -> bool {
    let segments = stem.split('-').collect::<Vec<_>>();
    segments.len() == 3
        && segments
            .iter()
            .all(|segment| !segment.is_empty() && segment.bytes().all(|byte| byte.is_ascii_digit()))
}

fn generated_staging_stem() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = STAGING_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{}-{timestamp}-{sequence}", std::process::id())
}

struct StagingArtifactGuard {
    path: PathBuf,
    preserve: bool,
}

impl StagingArtifactGuard {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            preserve: false,
        }
    }
}

impl Drop for StagingArtifactGuard {
    fn drop(&mut self) {
        if !self.preserve {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

fn network_error(error: reqwest::Error) -> DictionaryDownloadError {
    if error.is_timeout() {
        DictionaryDownloadError::Timeout
    } else {
        DictionaryDownloadError::Network(format!(
            "The dictionary package could not be downloaded: {error}"
        ))
    }
}

fn filesystem_error(error: std::io::Error) -> DictionaryDownloadError {
    DictionaryDownloadError::Filesystem(format!(
        "Dictionary download staging is unavailable: {error}"
    ))
}

fn download_request_error(error: DictionaryRequestError) -> DictionaryDownloadError {
    match error {
        DictionaryRequestError::Cancelled => DictionaryDownloadError::Cancelled,
        DictionaryRequestError::RevisionExhausted => {
            DictionaryDownloadError::RequestRevisionExhausted
        }
        DictionaryRequestError::Superseded => DictionaryDownloadError::Superseded,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum DictionaryDownloadError {
    Cancelled,
    ChecksumMismatch,
    Filesystem(String),
    InvalidDownloadTarget,
    InvalidStagingToken,
    Network(String),
    ProgressUnavailable,
    RequestRevisionExhausted,
    SizeLimitExceeded,
    SizeMismatch { expected: u64, actual: u64 },
    Superseded,
    Timeout,
}

impl fmt::Display for DictionaryDownloadError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cancelled => formatter.write_str("The dictionary download was cancelled."),
            Self::ChecksumMismatch => formatter.write_str(
                "The downloaded dictionary package did not match its expected checksum.",
            ),
            Self::Filesystem(message) | Self::Network(message) => formatter.write_str(message),
            Self::InvalidDownloadTarget => {
                formatter.write_str("The dictionary package download URL is invalid.")
            }
            Self::InvalidStagingToken => {
                formatter.write_str("The verified dictionary staging token is invalid.")
            }
            Self::ProgressUnavailable => {
                formatter.write_str("The dictionary download progress channel is unavailable.")
            }
            Self::RequestRevisionExhausted => {
                formatter.write_str("Dictionary download request revisions are exhausted.")
            }
            Self::SizeLimitExceeded => {
                formatter.write_str("The dictionary package exceeds its expected size.")
            }
            Self::SizeMismatch { expected, actual } => write!(
                formatter,
                "The dictionary package size was {actual} bytes, but {expected} bytes were expected."
            ),
            Self::Superseded => formatter.write_str("The dictionary download was superseded."),
            Self::Timeout => formatter.write_str("The dictionary download timed out."),
        }
    }
}

#[cfg(test)]
#[path = "dictionary_download_tests.rs"]
mod tests;
