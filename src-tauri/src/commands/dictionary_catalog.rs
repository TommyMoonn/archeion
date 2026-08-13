use std::{
    collections::HashSet,
    fmt, fs,
    future::Future,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, MutexGuard},
    time::Duration,
};

use reqwest::{redirect, Url};
use serde::{Deserialize, Serialize};
use tokio::sync::watch;

use crate::atomic_file::{
    transaction_path, BackupCleanup, PreparedAtomicFile, RealAtomicFileSystem,
};

use super::dictionary_store::DictionaryStoragePaths;

const CATALOG_ENDPOINT: &str = "https://tommymoonn.github.io/archeion/dictionaries/catalog-v1.json";
const CATALOG_SCHEMA_VERSION: u32 = 1;
const CATALOG_CACHE_FILE_NAME: &str = "catalog-cache-v1.json";
const MAX_CATALOG_BYTES: usize = 1024 * 1024;
const MAX_CATALOG_ENTRIES: usize = 512;
const MAX_COMPRESSED_PACKAGE_BYTES: u64 = 512 * 1024 * 1024;
const MAX_INSTALLED_SIZE_ESTIMATE_BYTES: u64 = 2 * 1024 * 1024 * 1024;
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct DictionaryCatalogEntry {
    pub id: String,
    pub name: String,
    pub language: String,
    pub description: String,
    pub source_attribution: String,
    pub source_url: Option<String>,
    pub license_name: String,
    pub license_url: String,
    pub package_version: String,
    pub compressed_size_bytes: u64,
    pub installed_size_estimate_bytes: Option<u64>,
    pub download_url: String,
    pub package_format: DictionaryCatalogPackageFormat,
    pub sha256: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum DictionaryCatalogPackageFormat {
    StardictZip,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum DictionaryCatalogSource {
    Cache,
    Network,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DictionaryCatalogSnapshot {
    pub schema_version: u32,
    pub entries: Vec<DictionaryCatalogEntry>,
    pub source: DictionaryCatalogSource,
    pub cache_warning: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CatalogManifest {
    schema_version: u32,
    dictionaries: Vec<DictionaryCatalogEntry>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RequestRetirement {
    Active,
    Cancelled,
    Superseded,
}

struct ActiveRequest {
    revision: u64,
    retirement: watch::Sender<RequestRetirement>,
}

#[derive(Default)]
struct RequestOwner {
    revision: u64,
    active: Option<ActiveRequest>,
}

#[derive(Clone)]
struct RequestTicket {
    revision: u64,
    retirement: watch::Receiver<RequestRetirement>,
}

impl RequestTicket {
    fn current_error(&self) -> Option<DictionaryCatalogError> {
        match *self.retirement.borrow() {
            RequestRetirement::Active => None,
            RequestRetirement::Cancelled => Some(DictionaryCatalogError::Cancelled),
            RequestRetirement::Superseded => Some(DictionaryCatalogError::Superseded),
        }
    }

    async fn wait_for_retirement(&self) -> DictionaryCatalogError {
        let mut retirement = self.retirement.clone();
        loop {
            if let Some(error) = self.current_error() {
                return error;
            }
            if retirement.changed().await.is_err() {
                return DictionaryCatalogError::Superseded;
            }
        }
    }
}

#[derive(Clone, Default)]
pub(crate) struct DictionaryCatalogService {
    requests: Arc<Mutex<RequestOwner>>,
}

impl DictionaryCatalogService {
    pub(crate) async fn refresh(
        &self,
        app_data_root: &Path,
    ) -> Result<DictionaryCatalogSnapshot, DictionaryCatalogError> {
        self.refresh_with(app_data_root, fetch_catalog).await
    }

    async fn refresh_with<F, Fut>(
        &self,
        app_data_root: &Path,
        fetch: F,
    ) -> Result<DictionaryCatalogSnapshot, DictionaryCatalogError>
    where
        F: FnOnce(RequestTicket) -> Fut,
        Fut: Future<Output = Result<Vec<u8>, DictionaryCatalogError>>,
    {
        let ticket = self.begin_request()?;
        let result = fetch(ticket.clone())
            .await
            .and_then(|bytes| validate_catalog_bytes(&bytes));
        match result {
            Ok(manifest) => self.publish(app_data_root, &ticket, manifest),
            Err(error) => Err(self.finish_failed_request(&ticket).unwrap_or(error)),
        }
    }

    pub(crate) fn cancel_current(&self) {
        let mut requests = recover_lock(&self.requests);
        if let Some(active) = requests.active.take() {
            active.retirement.send_replace(RequestRetirement::Cancelled);
        }
    }

    pub(crate) fn load_cached(
        app_data_root: &Path,
    ) -> Result<Option<DictionaryCatalogSnapshot>, DictionaryCatalogError> {
        let path = catalog_cache_path(app_data_root);
        let bytes = match read_bounded_file(&path)? {
            Some(bytes) => bytes,
            None => return Ok(None),
        };
        let manifest = validate_catalog_bytes(&bytes)?;
        Ok(Some(snapshot(
            manifest,
            DictionaryCatalogSource::Cache,
            None,
        )))
    }

    fn begin_request(&self) -> Result<RequestTicket, DictionaryCatalogError> {
        let mut requests = recover_lock(&self.requests);
        if let Some(active) = requests.active.take() {
            active
                .retirement
                .send_replace(RequestRetirement::Superseded);
        }
        requests.revision = requests
            .revision
            .checked_add(1)
            .ok_or(DictionaryCatalogError::RequestRevisionExhausted)?;
        let revision = requests.revision;
        let (retirement, receiver) = watch::channel(RequestRetirement::Active);
        requests.active = Some(ActiveRequest {
            revision,
            retirement,
        });
        Ok(RequestTicket {
            revision,
            retirement: receiver,
        })
    }

    fn publish(
        &self,
        app_data_root: &Path,
        ticket: &RequestTicket,
        manifest: CatalogManifest,
    ) -> Result<DictionaryCatalogSnapshot, DictionaryCatalogError> {
        let mut requests = recover_lock(&self.requests);
        ensure_current_request(&requests, ticket)?;
        let cache_warning = write_catalog_cache(app_data_root, &manifest)
            .err()
            .map(|error| error.to_string());
        requests.active = None;
        Ok(snapshot(
            manifest,
            DictionaryCatalogSource::Network,
            cache_warning,
        ))
    }

    fn finish_failed_request(&self, ticket: &RequestTicket) -> Option<DictionaryCatalogError> {
        if let Some(error) = ticket.current_error() {
            return Some(error);
        }
        let mut requests = recover_lock(&self.requests);
        if requests
            .active
            .as_ref()
            .is_some_and(|active| active.revision == ticket.revision)
        {
            requests.active = None;
            None
        } else {
            Some(DictionaryCatalogError::Superseded)
        }
    }
}

fn ensure_current_request(
    requests: &RequestOwner,
    ticket: &RequestTicket,
) -> Result<(), DictionaryCatalogError> {
    if let Some(error) = ticket.current_error() {
        return Err(error);
    }
    if requests
        .active
        .as_ref()
        .is_some_and(|active| active.revision == ticket.revision)
    {
        Ok(())
    } else {
        Err(DictionaryCatalogError::Superseded)
    }
}

async fn fetch_catalog(ticket: RequestTicket) -> Result<Vec<u8>, DictionaryCatalogError> {
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .redirect(redirect::Policy::none())
        .user_agent("Archeion dictionary catalog")
        .build()
        .map_err(network_error)?;
    let response = tokio::select! {
        response = client.get(CATALOG_ENDPOINT).send() => response.map_err(network_error)?,
        error = ticket.wait_for_retirement() => return Err(error),
    };
    if !response.status().is_success() {
        return Err(DictionaryCatalogError::Network(format!(
            "The dictionary catalog server returned HTTP {}.",
            response.status().as_u16()
        )));
    }
    if response
        .content_length()
        .is_some_and(|length| length > MAX_CATALOG_BYTES as u64)
    {
        return Err(DictionaryCatalogError::ResponseTooLarge);
    }

    let mut response = response;
    let mut bytes = Vec::new();
    loop {
        let chunk = tokio::select! {
            chunk = response.chunk() => chunk.map_err(network_error)?,
            error = ticket.wait_for_retirement() => return Err(error),
        };
        let Some(chunk) = chunk else {
            break;
        };
        if bytes.len().saturating_add(chunk.len()) > MAX_CATALOG_BYTES {
            return Err(DictionaryCatalogError::ResponseTooLarge);
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn validate_catalog_bytes(bytes: &[u8]) -> Result<CatalogManifest, DictionaryCatalogError> {
    if bytes.len() > MAX_CATALOG_BYTES {
        return Err(DictionaryCatalogError::ResponseTooLarge);
    }
    let mut manifest: CatalogManifest = serde_json::from_slice(bytes)
        .map_err(|error| DictionaryCatalogError::Invalid(format!("Invalid JSON: {error}")))?;
    if manifest.schema_version != CATALOG_SCHEMA_VERSION {
        return Err(DictionaryCatalogError::Invalid(format!(
            "Unsupported catalog schema version {}.",
            manifest.schema_version
        )));
    }
    if manifest.dictionaries.len() > MAX_CATALOG_ENTRIES {
        return Err(DictionaryCatalogError::Invalid(
            "The dictionary catalog contains too many entries.".to_string(),
        ));
    }

    let mut ids = HashSet::with_capacity(manifest.dictionaries.len());
    for entry in &mut manifest.dictionaries {
        validate_entry(entry)?;
        if !ids.insert(entry.id.clone()) {
            return Err(DictionaryCatalogError::Invalid(format!(
                "The dictionary catalog contains duplicate id '{}'.",
                entry.id
            )));
        }
    }
    manifest.dictionaries.sort_by_cached_key(|entry| {
        (
            entry.language.to_lowercase(),
            entry.name.to_lowercase(),
            entry.id.clone(),
        )
    });
    Ok(manifest)
}

fn validate_entry(entry: &mut DictionaryCatalogEntry) -> Result<(), DictionaryCatalogError> {
    if entry.id.is_empty()
        || entry.id.len() > 64
        || !entry.id.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_lowercase()
                || byte.is_ascii_digit()
                || (byte == b'-' && index > 0 && index + 1 < entry.id.len())
        })
        || entry.id.contains("--")
    {
        return invalid_entry(&entry.id, "id");
    }
    normalize_required(&mut entry.name, 160, &entry.id, "name")?;
    normalize_locale(&mut entry.language, &entry.id)?;
    normalize_required(&mut entry.description, 600, &entry.id, "description")?;
    normalize_required(
        &mut entry.source_attribution,
        240,
        &entry.id,
        "source attribution",
    )?;
    if let Some(source_url) = &mut entry.source_url {
        normalize_https_url(source_url, &entry.id, "source URL")?;
    }
    normalize_required(&mut entry.license_name, 160, &entry.id, "license name")?;
    normalize_https_url(&mut entry.license_url, &entry.id, "license URL")?;
    normalize_required(&mut entry.package_version, 80, &entry.id, "package version")?;
    normalize_https_url(&mut entry.download_url, &entry.id, "download URL")?;
    if entry.compressed_size_bytes == 0
        || entry.compressed_size_bytes > MAX_COMPRESSED_PACKAGE_BYTES
    {
        return invalid_entry(&entry.id, "compressed byte size");
    }
    if entry
        .installed_size_estimate_bytes
        .is_some_and(|bytes| bytes == 0 || bytes > MAX_INSTALLED_SIZE_ESTIMATE_BYTES)
    {
        return invalid_entry(&entry.id, "installed-size estimate");
    }
    if entry.sha256.len() != 64 || !entry.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return invalid_entry(&entry.id, "SHA-256 digest");
    }
    entry.sha256.make_ascii_lowercase();
    Ok(())
}

fn normalize_required(
    value: &mut String,
    maximum_chars: usize,
    entry_id: &str,
    field: &'static str,
) -> Result<(), DictionaryCatalogError> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.chars().count() > maximum_chars || trimmed.contains('\0') {
        return invalid_entry(entry_id, field);
    }
    *value = trimmed.to_string();
    Ok(())
}

fn normalize_locale(value: &mut String, entry_id: &str) -> Result<(), DictionaryCatalogError> {
    normalize_required(value, 64, entry_id, "language")?;
    if value.split('-').any(|part| {
        part.is_empty() || part.len() > 8 || !part.bytes().all(|byte| byte.is_ascii_alphanumeric())
    }) {
        return invalid_entry(entry_id, "language");
    }
    Ok(())
}

fn normalize_https_url(
    value: &mut String,
    entry_id: &str,
    field: &'static str,
) -> Result<(), DictionaryCatalogError> {
    normalize_required(value, 2048, entry_id, field)?;
    let parsed = Url::parse(value).map_err(|_| invalid_entry_error(entry_id, field))?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.fragment().is_some()
    {
        return invalid_entry(entry_id, field);
    }
    *value = parsed.to_string();
    Ok(())
}

fn invalid_entry<T>(entry_id: &str, field: &'static str) -> Result<T, DictionaryCatalogError> {
    Err(invalid_entry_error(entry_id, field))
}

fn invalid_entry_error(entry_id: &str, field: &'static str) -> DictionaryCatalogError {
    let identifier = if entry_id.is_empty() {
        "<unknown>"
    } else {
        entry_id
    };
    DictionaryCatalogError::Invalid(format!(
        "Dictionary catalog entry '{identifier}' has an invalid {field}."
    ))
}

fn snapshot(
    manifest: CatalogManifest,
    source: DictionaryCatalogSource,
    cache_warning: Option<String>,
) -> DictionaryCatalogSnapshot {
    DictionaryCatalogSnapshot {
        schema_version: manifest.schema_version,
        entries: manifest.dictionaries,
        source,
        cache_warning,
    }
}

fn catalog_cache_path(app_data_root: &Path) -> PathBuf {
    DictionaryStoragePaths::from_app_data_root(app_data_root)
        .root()
        .join(CATALOG_CACHE_FILE_NAME)
}

fn write_catalog_cache(
    app_data_root: &Path,
    manifest: &CatalogManifest,
) -> Result<(), DictionaryCatalogError> {
    let destination = catalog_cache_path(app_data_root);
    let parent = destination.parent().ok_or_else(|| {
        DictionaryCatalogError::Cache("The catalog cache path is invalid.".to_string())
    })?;
    fs::create_dir_all(parent).map_err(cache_error)?;
    let mut contents = serde_json::to_vec_pretty(manifest).map_err(|error| {
        DictionaryCatalogError::Cache(format!("Catalog cache serialization failed: {error}"))
    })?;
    contents.push(b'\n');
    let temporary = transaction_path(&destination, "tmp-write");
    let backup = transaction_path(&destination, "write-backup");
    let prepared = PreparedAtomicFile::write(temporary, &contents).map_err(|error| {
        DictionaryCatalogError::Cache(format!(
            "Catalog cache write failed: {}",
            error.into_source()
        ))
    })?;
    prepared
        .replace(
            &destination,
            &backup,
            BackupCleanup::BestEffort,
            &RealAtomicFileSystem,
        )
        .map_err(|error| {
            DictionaryCatalogError::Cache(format!("Catalog cache replacement failed: {error:?}"))
        })
}

fn read_bounded_file(path: &Path) -> Result<Option<Vec<u8>>, DictionaryCatalogError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(cache_error(error)),
    };
    if !metadata.file_type().is_file() {
        return Err(DictionaryCatalogError::Cache(
            "The dictionary catalog cache is not a regular file.".to_string(),
        ));
    }
    if metadata.len() > MAX_CATALOG_BYTES as u64 {
        return Err(DictionaryCatalogError::ResponseTooLarge);
    }
    fs::read(path).map(Some).map_err(cache_error)
}

fn network_error(error: reqwest::Error) -> DictionaryCatalogError {
    if error.is_timeout() {
        DictionaryCatalogError::Network("The dictionary catalog request timed out.".to_string())
    } else {
        DictionaryCatalogError::Network(format!(
            "The dictionary catalog could not be refreshed: {error}"
        ))
    }
}

fn cache_error(error: std::io::Error) -> DictionaryCatalogError {
    DictionaryCatalogError::Cache(format!(
        "The dictionary catalog cache is unavailable: {error}"
    ))
}

fn recover_lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum DictionaryCatalogError {
    Cache(String),
    Cancelled,
    Invalid(String),
    Network(String),
    RequestRevisionExhausted,
    ResponseTooLarge,
    Superseded,
}

impl fmt::Display for DictionaryCatalogError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cache(message) | Self::Invalid(message) | Self::Network(message) => {
                formatter.write_str(message)
            }
            Self::Cancelled => formatter.write_str("The dictionary catalog refresh was cancelled."),
            Self::RequestRevisionExhausted => {
                formatter.write_str("Dictionary catalog request revisions are exhausted.")
            }
            Self::ResponseTooLarge => {
                formatter.write_str("The dictionary catalog response exceeds the size limit.")
            }
            Self::Superseded => {
                formatter.write_str("The dictionary catalog refresh was superseded.")
            }
        }
    }
}

#[cfg(test)]
#[path = "dictionary_catalog_tests.rs"]
mod tests;
