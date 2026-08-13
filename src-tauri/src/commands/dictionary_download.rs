use std::{
    fmt,
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use reqwest::{redirect, Url};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tokio::{
    fs::{self, OpenOptions},
    io::AsyncWriteExt,
};

use super::{
    dictionary_catalog::{DictionaryCatalogEntry, DictionaryCatalogPackageFormat},
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
) -> Result<(VerifiedDictionaryDownload, StagingFileGuard), DictionaryDownloadError>
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
    let mut guard = StagingFileGuard::new(partial_path.clone());
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&partial_path)
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
    if !metadata.file_type().is_file() {
        return Err(DictionaryDownloadError::InvalidStagingToken);
    }
    std::fs::remove_file(path).map_err(filesystem_error)?;
    Ok(true)
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

fn generated_staging_stem() -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = STAGING_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!("{}-{timestamp}-{sequence}", std::process::id())
}

struct StagingFileGuard {
    path: PathBuf,
    preserve: bool,
}

impl StagingFileGuard {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            preserve: false,
        }
    }
}

impl Drop for StagingFileGuard {
    fn drop(&mut self) {
        if !self.preserve {
            let _ = std::fs::remove_file(&self.path);
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
