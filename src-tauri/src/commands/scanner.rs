use std::{
    collections::{hash_map::Entry, BTreeMap, BTreeSet, HashMap},
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, AtomicUsize, Ordering},
        mpsc,
    },
    thread,
    time::{Duration, Instant, UNIX_EPOCH},
};

use serde::Serialize;

use super::{archive_root, epub_metadata, filesystem, metadata, scanner_cache};

// Four workers bound simultaneous ZIP handles and parse memory while still overlapping local-disk latency.
const MAX_METADATA_PARSE_WORKERS: usize = 4;
const SUPERSEDED_SCAN_ERROR: &str = "Archive scan was superseded by a newer scan.";
static ACTIVE_FULL_SCAN_GENERATION: AtomicU64 = AtomicU64::new(0);

#[tauri::command]
pub fn invalidate_scanner_cache_entries(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_paths: Vec<String>,
) -> Result<(), String> {
    let root = archive_root::resolve_archive_root(&app, root_path)?;
    let normalized = relative_paths
        .iter()
        .map(|path| filesystem::normalize_archive_relative_path(path))
        .collect::<Result<Vec<_>, _>>()?;
    let maintenance = scanner_cache::invalidate_paths(&root, &normalized);
    if let Some(warning) = maintenance.warning {
        eprintln!("{}", warning.message);
    }
    Ok(())
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedBook {
    discovery_id: String,
    relative_path: String,
    file_name: String,
    folder_path: String,
    size: u64,
    modified_at: u64,
    source_metadata: Option<epub_metadata::EpubPackageMetadata>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannedFolder {
    id: String,
    name: String,
    relative_path: String,
    parent_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveScan {
    books: Vec<ScannedBook>,
    folders: Vec<ScannedFolder>,
    warnings: Vec<ArchiveScanWarning>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveEpubScan {
    books: Vec<ScannedBook>,
    missing_relative_paths: Vec<String>,
    warnings: Vec<ArchiveScanWarning>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveScanWarning {
    relative_path: String,
    message: String,
}

#[derive(Clone, Copy)]
struct ScanCancellation {
    generation: Option<u64>,
}

impl ScanCancellation {
    fn begin_full_scan() -> Self {
        let generation = ACTIVE_FULL_SCAN_GENERATION.fetch_add(1, Ordering::AcqRel) + 1;
        Self {
            generation: Some(generation),
        }
    }

    fn never() -> Self {
        Self { generation: None }
    }

    fn is_cancelled(self) -> bool {
        self.generation.is_some_and(|generation| {
            ACTIVE_FULL_SCAN_GENERATION.load(Ordering::Acquire) != generation
        })
    }

    fn ensure_current(self) -> Result<(), String> {
        if self.is_cancelled() {
            Err(SUPERSEDED_SCAN_ERROR.to_string())
        } else {
            Ok(())
        }
    }
}

fn discovery_id(relative_path: &str, size: u64, modified_at: u64) -> String {
    let identity = format!("{relative_path}\0{size}\0{modified_at}");
    let hash = identity
        .as_bytes()
        .iter()
        .fold(0xcbf29ce484222325_u64, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100000001b3)
        });
    format!("book-{hash:016x}")
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum CachedMetadataResult {
    SourceMetadata(Option<Box<epub_metadata::EpubPackageMetadata>>),
    MetadataError(String),
}

#[derive(Clone, Debug, Hash, PartialEq, Eq)]
struct ScannerCacheSignature {
    file_name: String,
    size: u64,
    modified_at: u64,
}

enum SignatureCandidate<'a> {
    Unique(&'a epub_metadata::EpubPackageMetadata),
    Ambiguous,
}

type SignatureLookup<'a> = HashMap<ScannerCacheSignature, SignatureCandidate<'a>>;

#[derive(Clone, Copy)]
enum MetadataCacheHitKind {
    Path,
    Signature,
}

#[derive(Default)]
struct MetadataResolutionMetrics {
    uncached_jobs: usize,
    path_hits: usize,
    signature_hits: usize,
    max_active_parse_workers: usize,
}

struct MetadataResolutions {
    metrics: MetadataResolutionMetrics,
    values: Vec<MetadataResolution>,
}

#[cfg_attr(not(test), allow(dead_code))]
#[derive(Default)]
struct ScannerMeasurement {
    cache_load_duration: Duration,
    signature_index_duration: Duration,
    metadata_resolution_duration: Duration,
    cache_publication_duration: Duration,
    uncached_metadata_jobs: usize,
    cache_path_hits: usize,
    signature_hits: usize,
    max_active_parse_workers: usize,
    approximate_parser_owned_open_epubs: usize,
    cancellation_result: &'static str,
}

struct DiscoveredEpub {
    path: PathBuf,
    relative_path: String,
    file_name: String,
    folder_path: String,
    size: u64,
    modified_at: u64,
}

struct TargetedEpubDiscovery {
    discovered: Vec<DiscoveredEpub>,
    missing_relative_paths: Vec<String>,
    normalized_relative_paths: Vec<String>,
}

struct MetadataResolution {
    source_metadata: Option<epub_metadata::EpubPackageMetadata>,
    cache_entry: metadata::ScannerCacheEntry,
    warning: Option<ArchiveScanWarning>,
}

fn file_name_from_relative_path(relative_path: &str) -> Option<&str> {
    relative_path
        .rsplit('/')
        .next()
        .filter(|file_name| !file_name.is_empty())
}

fn cache_signature(
    relative_path: &str,
    size: u64,
    modified_at: u64,
) -> Option<ScannerCacheSignature> {
    Some(ScannerCacheSignature {
        file_name: file_name_from_relative_path(relative_path)?.to_string(),
        size,
        modified_at,
    })
}

fn build_signature_lookup(cache: &metadata::ScannerCache) -> SignatureLookup<'_> {
    let mut lookup = HashMap::new();
    for (relative_path, cache_entry) in &cache.entries {
        let Some(source_metadata) = cache_entry.source_metadata.as_ref() else {
            continue;
        };
        if cache_entry.metadata_error.is_some() || source_metadata.identifier.is_none() {
            continue;
        }
        let Some(signature) =
            cache_signature(relative_path, cache_entry.size, cache_entry.modified_at)
        else {
            continue;
        };

        match lookup.entry(signature) {
            Entry::Vacant(entry) => {
                entry.insert(SignatureCandidate::Unique(source_metadata));
            }
            Entry::Occupied(mut entry) => {
                entry.insert(SignatureCandidate::Ambiguous);
            }
        }
    }
    lookup
}

fn cached_source_metadata_by_path(
    relative_path: &str,
    size: u64,
    modified_at: u64,
    cache: &metadata::ScannerCache,
) -> Option<CachedMetadataResult> {
    let entry = cache.entries.get(relative_path)?;
    if entry.size != size || entry.modified_at != modified_at {
        return None;
    }

    if let Some(error) = &entry.metadata_error {
        return Some(CachedMetadataResult::MetadataError(error.clone()));
    }

    Some(CachedMetadataResult::SourceMetadata(
        entry.source_metadata.clone().map(Box::new),
    ))
}

fn cached_source_metadata_by_signature(
    relative_path: &str,
    size: u64,
    modified_at: u64,
    lookup: &SignatureLookup<'_>,
) -> Option<epub_metadata::EpubPackageMetadata> {
    let signature = cache_signature(relative_path, size, modified_at)?;
    match lookup.get(&signature)? {
        SignatureCandidate::Unique(metadata) => Some((**metadata).clone()),
        SignatureCandidate::Ambiguous => None,
    }
}

fn cached_source_metadata(
    discovered: &DiscoveredEpub,
    cache: &metadata::ScannerCache,
    signature_lookup: &SignatureLookup<'_>,
) -> Option<(CachedMetadataResult, MetadataCacheHitKind)> {
    cached_source_metadata_by_path(
        &discovered.relative_path,
        discovered.size,
        discovered.modified_at,
        cache,
    )
    .map(|cached| (cached, MetadataCacheHitKind::Path))
    .or_else(|| {
        cached_source_metadata_by_signature(
            &discovered.relative_path,
            discovered.size,
            discovered.modified_at,
            signature_lookup,
        )
        .map(|metadata| {
            (
                CachedMetadataResult::SourceMetadata(Some(Box::new(metadata))),
                MetadataCacheHitKind::Signature,
            )
        })
    })
}

fn resolution_from_cached(
    discovered: &DiscoveredEpub,
    cached: CachedMetadataResult,
) -> MetadataResolution {
    match cached {
        CachedMetadataResult::SourceMetadata(source_metadata) => {
            let source_metadata = source_metadata.map(|metadata| *metadata);
            MetadataResolution {
                cache_entry: metadata::ScannerCacheEntry {
                    size: discovered.size,
                    modified_at: discovered.modified_at,
                    source_metadata: source_metadata.clone(),
                    metadata_error: None,
                },
                source_metadata,
                warning: None,
            }
        }
        CachedMetadataResult::MetadataError(error) => MetadataResolution {
            source_metadata: None,
            cache_entry: metadata::ScannerCacheEntry {
                size: discovered.size,
                modified_at: discovered.modified_at,
                source_metadata: None,
                metadata_error: Some(error.clone()),
            },
            warning: Some(ArchiveScanWarning {
                relative_path: discovered.relative_path.clone(),
                message: error,
            }),
        },
    }
}

fn parse_source_metadata(discovered: &DiscoveredEpub) -> MetadataResolution {
    match epub_metadata::read_core_metadata(&discovered.path) {
        Ok(metadata) => {
            let source_metadata = (!metadata.is_empty()).then_some(metadata);
            MetadataResolution {
                cache_entry: metadata::ScannerCacheEntry {
                    size: discovered.size,
                    modified_at: discovered.modified_at,
                    source_metadata: source_metadata.clone(),
                    metadata_error: None,
                },
                source_metadata,
                warning: None,
            }
        }
        Err(error) => MetadataResolution {
            source_metadata: None,
            cache_entry: metadata::ScannerCacheEntry {
                size: discovered.size,
                modified_at: discovered.modified_at,
                source_metadata: None,
                metadata_error: Some(error.clone()),
            },
            warning: Some(ArchiveScanWarning {
                relative_path: discovered.relative_path.clone(),
                message: error,
            }),
        },
    }
}

fn metadata_parse_worker_count(job_count: usize) -> usize {
    if job_count == 0 {
        return 0;
    }
    thread::available_parallelism()
        .map(|parallelism| parallelism.get())
        .unwrap_or(1)
        .min(MAX_METADATA_PARSE_WORKERS)
        .min(job_count)
        .max(1)
}

fn resolve_metadata(
    discovered: &[DiscoveredEpub],
    cache: &metadata::ScannerCache,
    signature_lookup: &SignatureLookup<'_>,
    cancellation: ScanCancellation,
    collect_metrics: bool,
) -> Result<MetadataResolutions, String> {
    let mut resolutions: Vec<Option<MetadataResolution>> = std::iter::repeat_with(|| None)
        .take(discovered.len())
        .collect();
    let mut uncached_indices = Vec::new();
    let mut metrics = MetadataResolutionMetrics::default();

    for (index, epub) in discovered.iter().enumerate() {
        cancellation.ensure_current()?;
        if let Some((cached, hit_kind)) = cached_source_metadata(epub, cache, signature_lookup) {
            if collect_metrics {
                match hit_kind {
                    MetadataCacheHitKind::Path => metrics.path_hits += 1,
                    MetadataCacheHitKind::Signature => metrics.signature_hits += 1,
                }
            }
            resolutions[index] = Some(resolution_from_cached(epub, cached));
        } else {
            uncached_indices.push(index);
        }
    }

    let worker_count = metadata_parse_worker_count(uncached_indices.len());
    if collect_metrics {
        metrics.uncached_jobs = uncached_indices.len();
    }
    if worker_count > 0 {
        let next_job = AtomicUsize::new(0);
        let active_workers = AtomicUsize::new(0);
        let max_active_workers = AtomicUsize::new(0);
        let (sender, receiver) = mpsc::channel();
        thread::scope(|scope| {
            for _ in 0..worker_count {
                let sender = sender.clone();
                let uncached_indices = &uncached_indices;
                let next_job = &next_job;
                let active_workers = &active_workers;
                let max_active_workers = &max_active_workers;
                scope.spawn(move || loop {
                    if cancellation.is_cancelled() {
                        break;
                    }
                    let job = next_job.fetch_add(1, Ordering::Relaxed);
                    let Some(&index) = uncached_indices.get(job) else {
                        break;
                    };
                    if cancellation.is_cancelled() {
                        break;
                    }
                    if collect_metrics {
                        let active = active_workers.fetch_add(1, Ordering::AcqRel) + 1;
                        max_active_workers.fetch_max(active, Ordering::AcqRel);
                    }
                    let resolution = parse_source_metadata(&discovered[index]);
                    if collect_metrics {
                        active_workers.fetch_sub(1, Ordering::AcqRel);
                    }
                    if sender.send((index, resolution)).is_err() {
                        break;
                    }
                });
            }
        });
        drop(sender);

        for (index, resolution) in receiver {
            resolutions[index] = Some(resolution);
        }
        if collect_metrics {
            metrics.max_active_parse_workers = max_active_workers.load(Ordering::Acquire);
        }
    }

    cancellation.ensure_current()?;
    let values = resolutions
        .into_iter()
        .map(|resolution| {
            resolution.ok_or_else(|| "EPUB metadata parsing did not produce a result.".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(MetadataResolutions { metrics, values })
}

fn modified_at_millis(metadata: &fs::Metadata) -> u64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis().min(u128::from(u64::MAX)) as u64)
        .unwrap_or_default()
}

fn discovered_epub(
    root: &Path,
    path: PathBuf,
    file_name: String,
    file_metadata: fs::Metadata,
) -> Result<DiscoveredEpub, String> {
    let relative_path = filesystem::path_relative_to(root, &path)?;
    let folder_path = path
        .parent()
        .map(|parent| filesystem::path_relative_to(root, parent))
        .transpose()?
        .unwrap_or_default();
    Ok(DiscoveredEpub {
        path,
        relative_path,
        file_name,
        folder_path,
        size: file_metadata.len(),
        modified_at: modified_at_millis(&file_metadata),
    })
}

fn discover_directory(
    root: &Path,
    directory: &Path,
    books: &mut Vec<DiscoveredEpub>,
    folders: &mut Vec<ScannedFolder>,
    cancellation: ScanCancellation,
) -> Result<(), String> {
    cancellation.ensure_current()?;
    let entries = fs::read_dir(directory).map_err(|error| error.to_string())?;

    for entry in entries {
        cancellation.ensure_current()?;
        let entry = entry.map_err(|error| error.to_string())?;
        let file_type = entry.file_type().map_err(|error| error.to_string())?;
        let path = entry.path();

        if file_type.is_dir() {
            if entry.file_name() == filesystem::METADATA_DIRECTORY {
                continue;
            }

            let relative_path = filesystem::path_relative_to(root, &path)?;
            let name = entry.file_name().to_string_lossy().into_owned();
            let parent_path = path
                .parent()
                .filter(|parent| *parent != root)
                .map(|parent| filesystem::path_relative_to(root, parent))
                .transpose()?;

            folders.push(ScannedFolder {
                id: format!("folder:{relative_path}"),
                name,
                relative_path,
                parent_path,
            });
            discover_directory(root, &path, books, folders, cancellation)?;
            continue;
        }

        let file_name = entry.file_name().to_string_lossy().into_owned();
        if !file_type.is_file() || filesystem::validate_epub_file_name(&file_name).is_err() {
            continue;
        }
        let file_metadata = entry.metadata().map_err(|error| error.to_string())?;
        books.push(discovered_epub(root, path, file_name, file_metadata)?);
    }

    Ok(())
}

fn scanner_cache_warning(message: impl Into<String>) -> ArchiveScanWarning {
    ArchiveScanWarning {
        relative_path: format!(
            "{}/{}",
            metadata::METADATA_DIRECTORY,
            metadata::SCANNER_CACHE_FILE
        ),
        message: message.into(),
    }
}

fn load_scanner_cache(
    root: &Path,
    warnings: &mut Vec<ArchiveScanWarning>,
) -> scanner_cache::ScannerCacheLoad {
    let loaded = scanner_cache::load_snapshot(root);
    if loaded.recovered {
        warnings.push(scanner_cache_warning("Scanner cache was rebuilt."));
    }
    if let Some(warning) = &loaded.warning {
        warnings.push(scanner_cache_warning(warning.message.clone()));
    }
    loaded
}

fn append_cache_maintenance_warning(
    warnings: &mut Vec<ArchiveScanWarning>,
    maintenance: Result<scanner_cache::ScannerCacheMaintenance, String>,
) {
    match maintenance {
        Ok(maintenance) => {
            if let Some(warning) = maintenance.warning {
                warnings.push(scanner_cache_warning(warning.message));
            }
        }
        Err(error) => warnings.push(scanner_cache_warning(format!(
            "Scanner cache could not be updated and will be repaired later: {error}"
        ))),
    }
}

fn build_scanned_books(
    discovered: Vec<DiscoveredEpub>,
    resolutions: Vec<MetadataResolution>,
    next_cache_entries: &mut BTreeMap<String, metadata::ScannerCacheEntry>,
    warnings: &mut Vec<ArchiveScanWarning>,
) -> Vec<ScannedBook> {
    discovered
        .into_iter()
        .zip(resolutions)
        .map(|(epub, resolution)| {
            if let Some(warning) = resolution.warning {
                warnings.push(warning);
            }
            next_cache_entries.insert(epub.relative_path.clone(), resolution.cache_entry);
            ScannedBook {
                discovery_id: discovery_id(&epub.relative_path, epub.size, epub.modified_at),
                relative_path: epub.relative_path,
                file_name: epub.file_name,
                folder_path: epub.folder_path,
                size: epub.size,
                modified_at: epub.modified_at,
                source_metadata: resolution.source_metadata,
            }
        })
        .collect()
}

fn scan_path_with_cancellation(
    root: PathBuf,
    cancellation: ScanCancellation,
) -> Result<ArchiveScan, String> {
    scan_path_internal(root, cancellation, None)
}

#[cfg(test)]
fn scan_path_with_measurement(
    root: PathBuf,
    cancellation: ScanCancellation,
    measurement: &mut ScannerMeasurement,
) -> Result<ArchiveScan, String> {
    scan_path_internal(root, cancellation, Some(measurement))
}

fn scan_path_internal(
    root: PathBuf,
    cancellation: ScanCancellation,
    mut measurement: Option<&mut ScannerMeasurement>,
) -> Result<ArchiveScan, String> {
    if let Some(measurement) = measurement.as_deref_mut() {
        measurement.cancellation_result = "cancelled";
    }
    if !root.is_dir() {
        return Err("The saved archive folder is unavailable.".to_string());
    }

    let mut warnings = Vec::new();
    let cache_load_started = measurement.as_ref().map(|_| Instant::now());
    let loaded_cache = load_scanner_cache(&root, &mut warnings);
    if let (Some(measurement), Some(started)) = (measurement.as_deref_mut(), cache_load_started) {
        measurement.cache_load_duration = started.elapsed();
    }
    let cache = loaded_cache.snapshot.cache();
    let signature_index_started = measurement.as_ref().map(|_| Instant::now());
    let signature_lookup = build_signature_lookup(cache);
    if let (Some(measurement), Some(started)) =
        (measurement.as_deref_mut(), signature_index_started)
    {
        measurement.signature_index_duration = started.elapsed();
    }
    let mut discovered = Vec::new();
    let mut folders = Vec::new();
    discover_directory(&root, &root, &mut discovered, &mut folders, cancellation)?;
    discovered.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    folders.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));

    let metadata_resolution_started = measurement.as_ref().map(|_| Instant::now());
    let resolutions = resolve_metadata(
        &discovered,
        cache,
        &signature_lookup,
        cancellation,
        measurement.is_some(),
    )?;
    if let (Some(measurement), Some(started)) =
        (measurement.as_deref_mut(), metadata_resolution_started)
    {
        measurement.metadata_resolution_duration = started.elapsed();
        measurement.uncached_metadata_jobs = resolutions.metrics.uncached_jobs;
        measurement.cache_path_hits = resolutions.metrics.path_hits;
        measurement.signature_hits = resolutions.metrics.signature_hits;
        measurement.max_active_parse_workers = resolutions.metrics.max_active_parse_workers;
        measurement.approximate_parser_owned_open_epubs =
            resolutions.metrics.max_active_parse_workers;
    }
    drop(signature_lookup);
    let mut next_cache = metadata::ScannerCache::default();
    let books = build_scanned_books(
        discovered,
        resolutions.values,
        &mut next_cache.entries,
        &mut warnings,
    );
    cancellation.ensure_current()?;

    let cache_publication_started = measurement.as_ref().map(|_| Instant::now());
    append_cache_maintenance_warning(
        &mut warnings,
        scanner_cache::publish_snapshot(
            &root,
            &loaded_cache.snapshot,
            &next_cache,
            scanner_cache::ScannerCachePublicationScope::Full,
        ),
    );
    if let (Some(measurement), Some(started)) = (measurement, cache_publication_started) {
        measurement.cache_publication_duration = started.elapsed();
        measurement.cancellation_result = "completed";
    }

    Ok(ArchiveScan {
        books,
        folders,
        warnings,
    })
}

#[cfg(test)]
fn scan_path(root: PathBuf) -> Result<ArchiveScan, String> {
    scan_path_with_cancellation(root, ScanCancellation::never())
}

fn discover_targeted_epubs(
    root: &Path,
    relative_paths: Vec<String>,
) -> Result<TargetedEpubDiscovery, String> {
    let canonical_root = fs::canonicalize(root)
        .map_err(|_| "The saved archive folder is unavailable.".to_string())?;
    let mut normalized_paths_by_key = BTreeMap::new();
    for path in relative_paths {
        let normalized = filesystem::normalize_archive_relative_path(&path)?;
        normalized_paths_by_key
            .entry(normalized.to_lowercase())
            .or_insert(normalized);
    }
    let normalized_paths = normalized_paths_by_key.into_values().collect::<Vec<_>>();
    let mut discovered = Vec::new();
    let mut missing = Vec::new();

    for relative_path in &normalized_paths {
        let file_name = file_name_from_relative_path(relative_path)
            .ok_or_else(|| "The selected EPUB file is unavailable.".to_string())?;
        filesystem::validate_epub_file_name(file_name)?;
        let requested_path = canonical_root.join(relative_path);
        let file_metadata = match fs::metadata(&requested_path) {
            Ok(file_metadata) if file_metadata.is_file() => file_metadata,
            Ok(_) => {
                missing.push(relative_path.clone());
                continue;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                missing.push(relative_path.clone());
                continue;
            }
            Err(error) => return Err(error.to_string()),
        };
        let canonical_path =
            fs::canonicalize(&requested_path).map_err(|error| error.to_string())?;
        if !canonical_path.starts_with(&canonical_root) {
            return Err("The selected path is outside the archive folder.".to_string());
        }
        discovered.push(discovered_epub(
            &canonical_root,
            canonical_path,
            file_name.to_string(),
            file_metadata,
        )?);
    }

    Ok(TargetedEpubDiscovery {
        discovered,
        missing_relative_paths: missing,
        normalized_relative_paths: normalized_paths,
    })
}

fn scan_epub_paths(root: PathBuf, relative_paths: Vec<String>) -> Result<ArchiveEpubScan, String> {
    scan_epub_paths_internal(root, relative_paths, None)
}

#[cfg(test)]
fn scan_epub_paths_with_measurement(
    root: PathBuf,
    relative_paths: Vec<String>,
    measurement: &mut ScannerMeasurement,
) -> Result<ArchiveEpubScan, String> {
    scan_epub_paths_internal(root, relative_paths, Some(measurement))
}

fn scan_epub_paths_internal(
    root: PathBuf,
    relative_paths: Vec<String>,
    mut measurement: Option<&mut ScannerMeasurement>,
) -> Result<ArchiveEpubScan, String> {
    if !root.is_dir() {
        return Err("The saved archive folder is unavailable.".to_string());
    }

    let mut warnings = Vec::new();
    let cache_load_started = measurement.as_ref().map(|_| Instant::now());
    let loaded_cache = load_scanner_cache(&root, &mut warnings);
    if let (Some(measurement), Some(started)) = (measurement.as_deref_mut(), cache_load_started) {
        measurement.cache_load_duration = started.elapsed();
    }
    let cache = loaded_cache.snapshot.cache();
    let signature_index_started = measurement.as_ref().map(|_| Instant::now());
    let signature_lookup = build_signature_lookup(cache);
    if let (Some(measurement), Some(started)) =
        (measurement.as_deref_mut(), signature_index_started)
    {
        measurement.signature_index_duration = started.elapsed();
    }
    let TargetedEpubDiscovery {
        mut discovered,
        missing_relative_paths,
        normalized_relative_paths,
    } = discover_targeted_epubs(&root, relative_paths)?;
    discovered.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
    let metadata_resolution_started = measurement.as_ref().map(|_| Instant::now());
    let resolutions = resolve_metadata(
        &discovered,
        cache,
        &signature_lookup,
        ScanCancellation::never(),
        measurement.is_some(),
    )?;
    if let (Some(measurement), Some(started)) =
        (measurement.as_deref_mut(), metadata_resolution_started)
    {
        measurement.metadata_resolution_duration = started.elapsed();
        measurement.uncached_metadata_jobs = resolutions.metrics.uncached_jobs;
        measurement.cache_path_hits = resolutions.metrics.path_hits;
        measurement.signature_hits = resolutions.metrics.signature_hits;
        measurement.max_active_parse_workers = resolutions.metrics.max_active_parse_workers;
        measurement.approximate_parser_owned_open_epubs =
            resolutions.metrics.max_active_parse_workers;
    }
    drop(signature_lookup);

    let requested_paths = normalized_relative_paths
        .iter()
        .map(|path| path.to_lowercase())
        .collect::<BTreeSet<_>>();
    let mut next_cache = cache.clone();
    next_cache
        .entries
        .retain(|relative_path, _| !requested_paths.contains(&relative_path.to_lowercase()));
    let books = build_scanned_books(
        discovered,
        resolutions.values,
        &mut next_cache.entries,
        &mut warnings,
    );
    let cache_publication_started = measurement.as_ref().map(|_| Instant::now());
    append_cache_maintenance_warning(
        &mut warnings,
        scanner_cache::publish_snapshot(
            &root,
            &loaded_cache.snapshot,
            &next_cache,
            scanner_cache::ScannerCachePublicationScope::Paths(&normalized_relative_paths),
        ),
    );
    if let (Some(measurement), Some(started)) = (measurement, cache_publication_started) {
        measurement.cache_publication_duration = started.elapsed();
        measurement.cancellation_result = "completed";
    }

    Ok(ArchiveEpubScan {
        books,
        missing_relative_paths,
        warnings,
    })
}

#[tauri::command]
pub async fn scan_archive(
    app: tauri::AppHandle,
    root_path: Option<String>,
) -> Result<ArchiveScan, String> {
    let path = archive_root::resolve_archive_root(&app, root_path)?;
    let cancellation = ScanCancellation::begin_full_scan();
    tauri::async_runtime::spawn_blocking(move || scan_path_with_cancellation(path, cancellation))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn scan_archive_epub_paths(
    app: tauri::AppHandle,
    root_path: Option<String>,
    relative_paths: Vec<String>,
) -> Result<ArchiveEpubScan, String> {
    let path = archive_root::resolve_archive_root(&app, root_path)?;
    tauri::async_runtime::spawn_blocking(move || scan_epub_paths(path, relative_paths))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn clear_scanner_cache(app: tauri::AppHandle, root_path: Option<String>) -> Result<(), String> {
    let path = archive_root::resolve_archive_root(&app, root_path)?;
    scanner_cache::clear(&path)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::Write,
        time::{Duration, Instant, SystemTime, UNIX_EPOCH},
    };

    use super::{
        super::{filesystem, metadata, scanner_cache},
        scan_epub_paths, scan_path, ArchiveScan, ScanCancellation,
    };

    fn write_minimal_epub(path: &std::path::Path, package_xml: &[u8]) {
        let file = fs::File::create(path).expect("EPUB should be created");
        let mut archive = zip::ZipWriter::new(file);
        let options = zip::write::SimpleFileOptions::default();
        archive
            .start_file("META-INF/container.xml", options)
            .expect("container entry should start");
        archive
            .write_all(
                br#"<?xml version="1.0"?>
                <container><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>"#,
            )
            .expect("container should be written");
        archive
            .start_file("OEBPS/content.opf", options)
            .expect("package entry should start");
        archive
            .write_all(package_xml)
            .expect("package should be written");
        archive.finish().expect("EPUB should finish");
    }

    #[test]
    #[ignore = "development-only scanner measurement"]
    fn measures_representative_scanner_fixtures() {
        struct MeasurementRun {
            details: super::ScannerMeasurement,
            elapsed: Duration,
        }

        fn print_median(
            book_count: usize,
            phase: &str,
            payload_bytes: usize,
            mut runs: Vec<MeasurementRun>,
        ) {
            runs.sort_by_key(|run| run.elapsed);
            let minimum = runs.first().unwrap().elapsed;
            let maximum = runs.last().unwrap().elapsed;
            let median = &runs[runs.len() / 2];
            println!(
                concat!(
                    "scanner measurement: implementation=final books={} phase={} repetitions={} ",
                    "median_total_ms={} min_total_ms={} max_total_ms={} payload_bytes={} ",
                    "uncached_metadata_jobs={} cache_path_hits={} signature_hits={} ",
                    "max_active_parse_workers={} approximate_parser_owned_open_epubs={} ",
                    "cache_load_ms={} signature_index_ms={} metadata_resolution_ms={} ",
                    "cache_publication_ms={} cancellation_result={}"
                ),
                book_count,
                phase,
                runs.len(),
                median.elapsed.as_millis(),
                minimum.as_millis(),
                maximum.as_millis(),
                payload_bytes,
                median.details.uncached_metadata_jobs,
                median.details.cache_path_hits,
                median.details.signature_hits,
                median.details.max_active_parse_workers,
                median.details.approximate_parser_owned_open_epubs,
                median.details.cache_load_duration.as_millis(),
                median.details.signature_index_duration.as_millis(),
                median.details.metadata_resolution_duration.as_millis(),
                median.details.cache_publication_duration.as_millis(),
                median.details.cancellation_result,
            );
        }

        for book_count in [50_usize, 500, 2_000] {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock should be valid")
                .as_nanos();
            let root = std::env::temp_dir()
                .join(format!("archeion-scanner-measurement-{book_count}-{nonce}"));
            fs::create_dir_all(&root).expect("measurement archive should be created");

            for index in 0..book_count {
                let folder = root
                    .join(format!("Shelf-{:02}", index % 20))
                    .join(format!("Series-{:02}", index % 7));
                fs::create_dir_all(&folder).expect("measurement folder should be created");
                let package = format!(
                    "<package><metadata><dc:title>Book {index}</dc:title><dc:creator>Author {}</dc:creator><dc:identifier>urn:measurement:{index}</dc:identifier></metadata></package>",
                    index % 37,
                );
                write_minimal_epub(
                    &folder.join(format!("Book-{index:04}.epub")),
                    package.as_bytes(),
                );
            }

            let mut cold_runs = Vec::new();
            let mut warm_runs = Vec::new();
            let mut targeted_path_runs = Vec::new();
            let mut targeted_signature_runs = Vec::new();
            let mut payload_bytes = 0;
            let mut targeted_path_payload_bytes = 0;
            let mut targeted_signature_payload_bytes = 0;
            let targeted_path = "Shelf-01/Series-01/Book-0001.epub";
            let signature_source = root.join("Shelf-00/Series-00/Book-0000.epub");
            let signature_target_directory = root.join("Targeted");
            let signature_target = signature_target_directory.join("Book-0000.epub");
            fs::create_dir_all(&signature_target_directory)
                .expect("targeted measurement folder should be created");
            for _ in 0..5 {
                scanner_cache::clear(&root).expect("measurement cache should clear");
                let mut cold_details = super::ScannerMeasurement::default();
                let cold_started = Instant::now();
                let cold = super::scan_path_with_measurement(
                    root.clone(),
                    ScanCancellation::never(),
                    &mut cold_details,
                )
                .expect("cold measurement scan should succeed");
                let cold_elapsed = cold_started.elapsed();
                payload_bytes = serde_json::to_vec(&cold)
                    .expect("measurement scan should serialize")
                    .len();
                let mut warm_details = super::ScannerMeasurement::default();
                let warm_started = Instant::now();
                let warm = super::scan_path_with_measurement(
                    root.clone(),
                    ScanCancellation::never(),
                    &mut warm_details,
                )
                .expect("warm measurement scan should succeed");
                let warm_elapsed = warm_started.elapsed();

                let mut targeted_path_details = super::ScannerMeasurement::default();
                let targeted_path_started = Instant::now();
                let targeted_path_scan = super::scan_epub_paths_with_measurement(
                    root.clone(),
                    vec![targeted_path.to_string()],
                    &mut targeted_path_details,
                )
                .expect("targeted path-hit measurement should succeed");
                let targeted_path_elapsed = targeted_path_started.elapsed();
                targeted_path_payload_bytes = serde_json::to_vec(&targeted_path_scan)
                    .expect("targeted path-hit scan should serialize")
                    .len();

                fs::rename(&signature_source, &signature_target)
                    .expect("signature-hit measurement EPUB should move");
                let mut targeted_signature_details = super::ScannerMeasurement::default();
                let targeted_signature_started = Instant::now();
                let targeted_signature_scan = super::scan_epub_paths_with_measurement(
                    root.clone(),
                    vec!["Targeted/Book-0000.epub".to_string()],
                    &mut targeted_signature_details,
                )
                .expect("targeted signature-hit measurement should succeed");
                let targeted_signature_elapsed = targeted_signature_started.elapsed();
                targeted_signature_payload_bytes = serde_json::to_vec(&targeted_signature_scan)
                    .expect("targeted signature-hit scan should serialize")
                    .len();
                fs::rename(&signature_target, &signature_source)
                    .expect("signature-hit measurement EPUB should be restored");

                assert_eq!(cold.books.len(), book_count);
                assert_eq!(warm.books.len(), book_count);
                assert_eq!(targeted_path_scan.books.len(), 1);
                assert_eq!(targeted_path_details.cache_path_hits, 1);
                assert_eq!(targeted_signature_scan.books.len(), 1);
                assert_eq!(targeted_signature_details.signature_hits, 1);
                cold_runs.push(MeasurementRun {
                    details: cold_details,
                    elapsed: cold_elapsed,
                });
                warm_runs.push(MeasurementRun {
                    details: warm_details,
                    elapsed: warm_elapsed,
                });
                targeted_path_runs.push(MeasurementRun {
                    details: targeted_path_details,
                    elapsed: targeted_path_elapsed,
                });
                targeted_signature_runs.push(MeasurementRun {
                    details: targeted_signature_details,
                    elapsed: targeted_signature_elapsed,
                });
            }
            print_median(book_count, "cold", payload_bytes, cold_runs);
            print_median(book_count, "warm", payload_bytes, warm_runs);
            print_median(
                book_count,
                "targeted-path-hit",
                targeted_path_payload_bytes,
                targeted_path_runs,
            );
            print_median(
                book_count,
                "targeted-signature-hit",
                targeted_signature_payload_bytes,
                targeted_signature_runs,
            );

            fs::remove_dir_all(root).expect("measurement archive should be removed");
        }
    }

    fn modified_at_millis(path: &std::path::Path) -> u64 {
        fs::metadata(path)
            .expect("file metadata should be readable")
            .modified()
            .expect("modified time should exist")
            .duration_since(UNIX_EPOCH)
            .expect("modified time should be after epoch")
            .as_millis()
            .min(u128::from(u64::MAX)) as u64
    }

    #[test]
    fn scans_core_epub_metadata_without_blocking_bad_epubs() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-metadata-{nonce}"));
        fs::create_dir_all(&root).expect("test archive should be created");
        write_minimal_epub(
            &root.join("metadata.epub"),
            br#"<package><metadata>
                <dc:title>Package Title</dc:title>
                <dc:creator>Package Author</dc:creator>
                <dc:identifier>urn:test:book</dc:identifier>
                <dc:language>en</dc:language>
            </metadata></package>"#,
        );
        fs::write(root.join("broken.epub"), b"not a zip").expect("bad EPUB should be written");

        let scan = scan_path(root.clone()).expect("archive scan should succeed");

        assert_eq!(scan.books.len(), 2);
        let book = scan
            .books
            .iter()
            .find(|book| book.file_name == "metadata.epub")
            .expect("metadata EPUB should be scanned");
        let metadata = book
            .source_metadata
            .as_ref()
            .expect("source metadata should be parsed");
        assert_eq!(metadata.title.as_deref(), Some("Package Title"));
        assert_eq!(metadata.creator.as_deref(), Some("Package Author"));
        assert_eq!(metadata.identifier.as_deref(), Some("urn:test:book"));
        assert_eq!(metadata.language.as_deref(), Some("en"));
        assert_eq!(scan.warnings.len(), 1);
        assert_eq!(scan.warnings[0].relative_path, "broken.epub");

        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn uses_cached_metadata_for_unchanged_epubs() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-cache-{nonce}"));
        fs::create_dir_all(root.join(".archeion")).expect("metadata directory should be created");
        let epub_path = root.join("cached.epub");
        fs::write(&epub_path, b"bad").expect("bad EPUB should be written");
        let modified_at = modified_at_millis(&epub_path);
        fs::write(
            root.join(".archeion").join("scanner-cache.json"),
            serde_json::json!({
                "version": 1,
                "entries": {
                    "cached.epub": {
                        "size": 3,
                        "modifiedAt": modified_at,
                        "sourceMetadata": {
                            "title": "Cached Title",
                            "creator": "Cached Author",
                            "identifier": "urn:cached"
                        }
                    }
                }
            })
            .to_string(),
        )
        .expect("scanner cache should be written");

        let scan = scan_path(root.clone()).expect("archive scan should succeed");

        assert_eq!(scan.warnings.len(), 0);
        let metadata = scan.books[0]
            .source_metadata
            .as_ref()
            .expect("cached metadata should be used");
        assert_eq!(metadata.title.as_deref(), Some("Cached Title"));
        assert_eq!(metadata.creator.as_deref(), Some("Cached Author"));
        assert_eq!(metadata.identifier.as_deref(), Some("urn:cached"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn reuses_cached_metadata_for_moved_unchanged_epubs() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-cache-moved-{nonce}"));
        let metadata_dir = root.join(".archeion");
        let moved_dir = root.join("Moved");
        fs::create_dir_all(&metadata_dir).expect("metadata directory should be created");
        fs::create_dir_all(&moved_dir).expect("moved directory should be created");
        let epub_path = moved_dir.join("cached.epub");
        fs::write(&epub_path, b"bad").expect("bad EPUB should be written");
        let modified_at = modified_at_millis(&epub_path);
        fs::write(
            metadata_dir.join("scanner-cache.json"),
            serde_json::json!({
                "version": 1,
                "entries": {
                    "Original/cached.epub": {
                        "size": 3,
                        "modifiedAt": modified_at,
                        "sourceMetadata": {
                            "title": "Moved Cached Title",
                            "identifier": "urn:moved-cache"
                        }
                    }
                }
            })
            .to_string(),
        )
        .expect("scanner cache should be written");

        let scan = scan_path(root.clone()).expect("archive scan should succeed");

        assert_eq!(scan.warnings.len(), 0);
        let metadata = scan.books[0]
            .source_metadata
            .as_ref()
            .expect("moved cached metadata should be used");
        assert_eq!(metadata.title.as_deref(), Some("Moved Cached Title"));
        assert_eq!(metadata.identifier.as_deref(), Some("urn:moved-cache"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn does_not_reuse_signature_cache_when_filename_differs() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("archeion-scanner-cache-different-name-{nonce}"));
        let metadata_dir = root.join(".archeion");
        fs::create_dir_all(&metadata_dir).expect("metadata directory should be created");
        let epub_path = root.join("different.epub");
        fs::write(&epub_path, b"bad").expect("bad EPUB should be written");
        let modified_at = modified_at_millis(&epub_path);
        fs::write(
            metadata_dir.join("scanner-cache.json"),
            serde_json::json!({
                "version": 1,
                "entries": {
                    "Original/cached.epub": {
                        "size": 3,
                        "modifiedAt": modified_at,
                        "sourceMetadata": {
                            "title": "Cached Title",
                            "identifier": "urn:cached"
                        }
                    }
                }
            })
            .to_string(),
        )
        .expect("scanner cache should be written");

        let scan = scan_path(root.clone()).expect("archive scan should succeed");

        assert_eq!(scan.books[0].source_metadata, None);
        assert_eq!(scan.warnings.len(), 1);
        assert_eq!(scan.warnings[0].relative_path, "different.epub");
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn ignores_ambiguous_signature_cache_matches() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-cache-ambiguous-{nonce}"));
        let metadata_dir = root.join(".archeion");
        fs::create_dir_all(&metadata_dir).expect("metadata directory should be created");
        let epub_path = root.join("ambiguous.epub");
        fs::write(&epub_path, b"bad").expect("bad EPUB should be written");
        let modified_at = modified_at_millis(&epub_path);
        fs::write(
            metadata_dir.join("scanner-cache.json"),
            serde_json::json!({
                "version": 1,
                "entries": {
                    "A/ambiguous.epub": {
                        "size": 3,
                        "modifiedAt": modified_at,
                        "sourceMetadata": {
                            "title": "First Cached Title",
                            "identifier": "urn:first-cache"
                        }
                    },
                    "B/ambiguous.epub": {
                        "size": 3,
                        "modifiedAt": modified_at,
                        "sourceMetadata": {
                            "title": "Second Cached Title",
                            "identifier": "urn:second-cache"
                        }
                    }
                }
            })
            .to_string(),
        )
        .expect("scanner cache should be written");

        let scan = scan_path(root.clone()).expect("archive scan should succeed");

        assert_eq!(scan.books[0].source_metadata, None);
        assert_eq!(scan.warnings.len(), 1);
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn caches_metadata_errors_for_unchanged_epubs() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-cache-errors-{nonce}"));
        fs::create_dir_all(&root).expect("test archive should be created");
        fs::write(root.join("broken.epub"), b"not a zip").expect("bad EPUB should be written");

        let first_scan = scan_path(root.clone()).expect("archive scan should succeed");

        assert_eq!(first_scan.warnings.len(), 1);
        let cache_contents = fs::read_to_string(root.join(".archeion/scanner-cache.json"))
            .expect("scanner cache should exist");
        let cache: serde_json::Value =
            serde_json::from_str(&cache_contents).expect("scanner cache should be valid JSON");
        let broken_entry = &cache["entries"]["broken.epub"];
        assert_eq!(broken_entry["size"], 9);
        assert!(broken_entry["metadataError"].as_str().is_some());
        assert!(broken_entry["sourceMetadata"].is_null());

        let second_scan = scan_path(root.clone()).expect("archive scan should succeed");

        assert_eq!(second_scan.warnings.len(), 1);
        assert_eq!(second_scan.warnings[0].relative_path, "broken.epub");
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn uses_cached_metadata_error_for_unchanged_epubs() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-cache-error-reuse-{nonce}"));
        let metadata_dir = root.join(".archeion");
        fs::create_dir_all(&metadata_dir).expect("metadata directory should be created");
        let epub_path = root.join("broken.epub");
        fs::write(&epub_path, b"not a zip").expect("bad EPUB should be written");
        let modified_at = modified_at_millis(&epub_path);
        fs::write(
            metadata_dir.join("scanner-cache.json"),
            serde_json::json!({
                "version": 1,
                "entries": {
                    "broken.epub": {
                        "size": 9,
                        "modifiedAt": modified_at,
                        "metadataError": "cached metadata failure"
                    }
                }
            })
            .to_string(),
        )
        .expect("scanner cache should be written");

        let scan = scan_path(root.clone()).expect("archive scan should succeed");

        assert_eq!(scan.books[0].source_metadata, None);
        assert_eq!(scan.warnings.len(), 1);
        assert_eq!(scan.warnings[0].relative_path, "broken.epub");
        assert_eq!(scan.warnings[0].message, "cached metadata failure");
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn refreshes_stale_metadata_error_cache_entries() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root =
            std::env::temp_dir().join(format!("archeion-scanner-cache-error-refresh-{nonce}"));
        let metadata_dir = root.join(".archeion");
        fs::create_dir_all(&metadata_dir).expect("metadata directory should be created");
        let epub_path = root.join("changed.epub");
        write_minimal_epub(
            &epub_path,
            br#"<package><metadata><dc:title>Recovered Title</dc:title></metadata></package>"#,
        );
        fs::write(
            metadata_dir.join("scanner-cache.json"),
            serde_json::json!({
                "version": 1,
                "entries": {
                    "changed.epub": {
                        "size": 1,
                        "modifiedAt": 1,
                        "metadataError": "stale metadata failure"
                    }
                }
            })
            .to_string(),
        )
        .expect("scanner cache should be written");

        let scan = scan_path(root.clone()).expect("archive scan should succeed");

        assert_eq!(scan.warnings.len(), 0);
        let metadata = scan.books[0]
            .source_metadata
            .as_ref()
            .expect("fresh metadata should be parsed after stale error cache");
        assert_eq!(metadata.title.as_deref(), Some("Recovered Title"));
        let cache_contents = fs::read_to_string(metadata_dir.join("scanner-cache.json"))
            .expect("scanner cache should exist");
        assert!(!cache_contents.contains("stale metadata failure"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn recovers_from_corrupted_scanner_cache() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-cache-corrupt-{nonce}"));
        let metadata_dir = root.join(".archeion");
        fs::create_dir_all(&metadata_dir).expect("metadata directory should be created");
        write_minimal_epub(
            &root.join("recovered.epub"),
            br#"<package><metadata><dc:title>Recovered Title</dc:title></metadata></package>"#,
        );
        fs::write(metadata_dir.join("scanner-cache.json"), b"{not-json")
            .expect("corrupted scanner cache should be written");

        let scan = scan_path(root.clone()).expect("archive scan should recover and succeed");

        assert_eq!(scan.books.len(), 1);
        assert!(scan.warnings.iter().any(|warning| {
            warning.relative_path == ".archeion/scanner-cache.json"
                && warning.message == "Scanner cache was rebuilt."
        }));
        let metadata = scan.books[0]
            .source_metadata
            .as_ref()
            .expect("metadata should be parsed after cache recovery");
        assert_eq!(metadata.title.as_deref(), Some("Recovered Title"));
        assert!(metadata_dir.join("scanner-cache.json").is_file());
        assert!(metadata_dir
            .join("backups/scanner-cache")
            .read_dir()
            .expect("metadata directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .contains("scanner-cache.json.corrupt-")));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn returns_scan_results_with_warning_when_scanner_cache_save_fails() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-cache-save-fail-{nonce}"));
        let metadata_dir = root.join(".archeion");
        fs::create_dir_all(&metadata_dir).expect("metadata directory should be created");
        fs::create_dir_all(metadata_dir.join("scanner-cache.json"))
            .expect("conflicting scanner cache directory should be created");
        write_minimal_epub(
            &root.join("Novel.epub"),
            br#"<package><metadata><dc:title>Novel</dc:title></metadata></package>"#,
        );

        let scan = scan_path(root.clone()).expect("archive scan should still succeed");

        assert_eq!(scan.books.len(), 1);
        assert!(scan.warnings.iter().any(|warning| {
            warning.relative_path == ".archeion/scanner-cache.json"
                && warning
                    .message
                    .starts_with(scanner_cache::CACHE_MAINTENANCE_WARNING_PREFIX)
        }));
        assert!(metadata_dir.join("scanner-cache.json").is_dir());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn refreshes_stale_scanner_cache_entries() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-cache-refresh-{nonce}"));
        fs::create_dir_all(root.join(".archeion")).expect("metadata directory should be created");
        write_minimal_epub(
            &root.join("changed.epub"),
            br#"<package><metadata><dc:title>Fresh Title</dc:title></metadata></package>"#,
        );
        fs::write(
            root.join(".archeion").join("scanner-cache.json"),
            serde_json::json!({
                "version": 1,
                "entries": {
                    "changed.epub": {
                        "size": 1,
                        "modifiedAt": 1,
                        "sourceMetadata": { "title": "Stale Title" }
                    }
                }
            })
            .to_string(),
        )
        .expect("scanner cache should be written");

        let scan = scan_path(root.clone()).expect("archive scan should succeed");

        let metadata = scan.books[0]
            .source_metadata
            .as_ref()
            .expect("fresh metadata should be parsed");
        assert_eq!(metadata.title.as_deref(), Some("Fresh Title"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn scans_nested_epubs_and_ignores_metadata_directory() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-{nonce}"));
        let series = root.join("Author").join("Series");
        let metadata = root.join(".archeion");
        fs::create_dir_all(&series).expect("series directory should be created");
        fs::create_dir_all(&metadata).expect("metadata directory should be created");
        fs::write(series.join("Volume 01.EPUB"), b"epub").expect("test EPUB should be written");
        fs::write(series.join("notes.txt"), b"notes").expect("text file should be written");
        fs::write(metadata.join("hidden.epub"), b"hidden")
            .expect("metadata EPUB should be written");

        let scan = scan_path(root.clone()).expect("archive scan should succeed");

        assert_eq!(scan.books.len(), 1);
        assert_eq!(scan.books[0].relative_path, "Author/Series/Volume 01.EPUB");
        assert_eq!(scan.folders.len(), 2);
        assert_eq!(scan.folders[1].parent_path.as_deref(), Some("Author"));

        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn returns_deterministic_book_and_warning_order_for_bounded_parsing() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-order-{nonce}"));
        fs::create_dir_all(&root).expect("test archive should be created");
        fs::write(root.join("z.epub"), b"broken-z").expect("bad EPUB should be written");
        fs::write(root.join("a.epub"), b"broken-a").expect("bad EPUB should be written");
        fs::write(root.join("m.epub"), b"broken-m").expect("bad EPUB should be written");

        let scan = scan_path(root.clone()).expect("archive scan should succeed");

        assert_eq!(
            scan.books
                .iter()
                .map(|book| book.relative_path.as_str())
                .collect::<Vec<_>>(),
            vec!["a.epub", "m.epub", "z.epub"]
        );
        assert_eq!(
            scan.warnings
                .iter()
                .map(|warning| warning.relative_path.as_str())
                .collect::<Vec<_>>(),
            vec!["a.epub", "m.epub", "z.epub"]
        );
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn targeted_scan_reports_missing_paths_and_preserves_unrelated_cache_entries() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-targeted-scanner-{nonce}"));
        fs::create_dir_all(&root).expect("test archive should be created");
        write_minimal_epub(
            &root.join("One.epub"),
            br#"<package><metadata><dc:title>One</dc:title></metadata></package>"#,
        );
        write_minimal_epub(
            &root.join("Two.epub"),
            br#"<package><metadata><dc:title>Two</dc:title></metadata></package>"#,
        );
        scan_path(root.clone()).expect("initial archive scan should succeed");
        fs::remove_file(root.join("One.epub")).expect("target EPUB should be removed");

        let targeted = scan_epub_paths(
            root.clone(),
            vec!["One.epub".to_string(), "Two.epub".to_string()],
        )
        .expect("targeted scan should succeed");

        assert_eq!(targeted.missing_relative_paths, vec!["One.epub"]);
        assert_eq!(targeted.books.len(), 1);
        assert_eq!(targeted.books[0].relative_path, "Two.epub");
        let cache: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(root.join(".archeion/scanner-cache.json"))
                .expect("scanner cache should be readable"),
        )
        .expect("scanner cache should be valid JSON");
        assert!(cache["entries"]["One.epub"].is_null());
        assert!(cache["entries"]["Two.epub"].is_object());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    fn scanned_title<'a>(scan: &'a ArchiveScan, relative_path: &str) -> Option<&'a str> {
        scan.books
            .iter()
            .find(|book| book.relative_path == relative_path)
            .and_then(|book| book.source_metadata.as_ref())
            .and_then(|package| package.title.as_deref())
    }

    #[test]
    fn app_owned_rename_invalidates_only_affected_scanner_cache_paths() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-rename-cache-{nonce}"));
        fs::create_dir_all(&root).expect("test archive should be created");
        write_minimal_epub(
            &root.join("Book.epub"),
            br#"<package><metadata><dc:title>Fresh</dc:title></metadata></package>"#,
        );
        write_minimal_epub(
            &root.join("Stable.epub"),
            br#"<package><metadata><dc:title>Stable</dc:title></metadata></package>"#,
        );
        scan_path(root.clone()).expect("initial archive scan should succeed");

        let mut cache =
            metadata::load_scanner_cache_at(&root).expect("scanner cache should be readable");
        let source_entry = cache
            .entries
            .get("Book.epub")
            .expect("source cache entry should exist")
            .clone();
        let stable_entry = cache
            .entries
            .get("Stable.epub")
            .expect("unaffected cache entry should exist")
            .clone();
        let mut stale_destination_entry = source_entry;
        stale_destination_entry
            .source_metadata
            .get_or_insert_default()
            .title = Some("Stale".to_string());
        cache
            .entries
            .insert("Renamed.epub".to_string(), stale_destination_entry);
        metadata::save_scanner_cache_at(&root, &cache).expect("scanner cache should be writable");

        filesystem::rename_archive_epub_at(&root, "Book.epub", "Renamed.epub")
            .expect("EPUB rename should succeed");

        let invalidated =
            metadata::load_scanner_cache_at(&root).expect("scanner cache should remain readable");
        assert!(!invalidated.entries.contains_key("Book.epub"));
        assert!(!invalidated.entries.contains_key("Renamed.epub"));
        assert_eq!(invalidated.entries.get("Stable.epub"), Some(&stable_entry));

        let refreshed = scan_path(root.clone()).expect("post-rename scan should succeed");
        assert_eq!(scanned_title(&refreshed, "Renamed.epub"), Some("Fresh"));
        let warm = scan_path(root.clone()).expect("warm scan should succeed");
        assert_eq!(scanned_title(&warm, "Renamed.epub"), Some("Fresh"));
        assert_eq!(scanned_title(&warm, "Stable.epub"), Some("Stable"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn app_owned_move_invalidates_only_affected_scanner_cache_paths() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-move-cache-{nonce}"));
        fs::create_dir_all(root.join("Destination")).expect("destination folder should be created");
        write_minimal_epub(
            &root.join("Book.epub"),
            br#"<package><metadata><dc:title>Fresh</dc:title></metadata></package>"#,
        );
        write_minimal_epub(
            &root.join("Stable.epub"),
            br#"<package><metadata><dc:title>Stable</dc:title></metadata></package>"#,
        );
        scan_path(root.clone()).expect("initial archive scan should succeed");

        let mut cache =
            metadata::load_scanner_cache_at(&root).expect("scanner cache should be readable");
        let source_entry = cache
            .entries
            .get("Book.epub")
            .expect("source cache entry should exist")
            .clone();
        let stable_entry = cache
            .entries
            .get("Stable.epub")
            .expect("unaffected cache entry should exist")
            .clone();
        let mut stale_destination_entry = source_entry;
        stale_destination_entry
            .source_metadata
            .get_or_insert_default()
            .title = Some("Stale".to_string());
        cache
            .entries
            .insert("Destination/Book.epub".to_string(), stale_destination_entry);
        metadata::save_scanner_cache_at(&root, &cache).expect("scanner cache should be writable");

        filesystem::move_archive_epub_at(&root, "Book.epub", Some("Destination"))
            .expect("EPUB move should succeed");

        let invalidated =
            metadata::load_scanner_cache_at(&root).expect("scanner cache should remain readable");
        assert!(!invalidated.entries.contains_key("Book.epub"));
        assert!(!invalidated.entries.contains_key("Destination/Book.epub"));
        assert_eq!(invalidated.entries.get("Stable.epub"), Some(&stable_entry));

        let refreshed = scan_path(root.clone()).expect("post-move scan should succeed");
        assert_eq!(
            scanned_title(&refreshed, "Destination/Book.epub"),
            Some("Fresh")
        );
        let warm = scan_path(root.clone()).expect("warm scan should succeed");
        assert_eq!(scanned_title(&warm, "Destination/Book.epub"), Some("Fresh"));
        assert_eq!(scanned_title(&warm, "Stable.epub"), Some("Stable"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn epub_move_remains_authoritative_when_cache_persistence_fails() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-move-cache-failure-{nonce}"));
        fs::create_dir_all(root.join("Destination")).expect("destination folder should be created");
        write_minimal_epub(
            &root.join("Book.epub"),
            br#"<package><metadata><dc:title>Fresh</dc:title></metadata></package>"#,
        );
        scan_path(root.clone()).expect("initial archive scan should succeed");

        let mut cache =
            metadata::load_scanner_cache_at(&root).expect("scanner cache should be readable");
        let mut stale_destination = cache
            .entries
            .get("Book.epub")
            .expect("source cache entry should exist")
            .clone();
        stale_destination
            .source_metadata
            .get_or_insert_default()
            .title = Some("Stale".to_string());
        cache
            .entries
            .insert("Destination/Book.epub".to_string(), stale_destination);
        metadata::save_scanner_cache_at(&root, &cache).expect("scanner cache should be writable");

        scanner_cache::force_cache_save_failure(&root, true);
        let change = filesystem::move_archive_epub_at(&root, "Book.epub", Some("Destination"))
            .expect("EPUB move should remain authoritative");
        let serialized = serde_json::to_value(change).expect("path result should serialize");
        assert!(serialized["cacheWarning"]["message"].as_str().is_some());
        assert!(!root.join("Book.epub").exists());
        assert!(root.join("Destination/Book.epub").is_file());

        scanner_cache::force_cache_save_failure(&root, false);
        scanner_cache::simulate_restart(&root);
        let refreshed = scan_path(root.clone()).expect("post-move scan should succeed");
        assert_eq!(
            scanned_title(&refreshed, "Destination/Book.epub"),
            Some("Fresh")
        );
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn epub_rename_remains_authoritative_when_cache_persistence_fails() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-rename-cache-failure-{nonce}"));
        fs::create_dir_all(&root).expect("test archive should be created");
        write_minimal_epub(
            &root.join("Book.epub"),
            br#"<package><metadata><dc:title>Fresh</dc:title></metadata></package>"#,
        );
        scan_path(root.clone()).expect("initial archive scan should succeed");

        scanner_cache::force_cache_save_failure(&root, true);
        let change = filesystem::rename_archive_epub_at(&root, "Book.epub", "Renamed.epub")
            .expect("EPUB rename should remain authoritative");
        let serialized = serde_json::to_value(change).expect("path result should serialize");
        assert!(serialized["cacheWarning"]["message"].as_str().is_some());
        assert!(!root.join("Book.epub").exists());
        assert!(root.join("Renamed.epub").is_file());

        scanner_cache::force_cache_save_failure(&root, false);
        scanner_cache::simulate_restart(&root);
        let refreshed = scan_path(root.clone()).expect("post-rename scan should succeed");
        assert_eq!(scanned_title(&refreshed, "Renamed.epub"), Some("Fresh"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn failed_epub_rename_keeps_the_unchanged_source_cache_safe() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-rename-failure-cache-{nonce}"));
        fs::create_dir_all(&root).expect("test archive should be created");
        write_minimal_epub(
            &root.join("Book.epub"),
            br#"<package><metadata><dc:title>Source</dc:title></metadata></package>"#,
        );
        write_minimal_epub(
            &root.join("Existing.epub"),
            br#"<package><metadata><dc:title>Existing</dc:title></metadata></package>"#,
        );
        scan_path(root.clone()).expect("initial archive scan should succeed");
        let before =
            metadata::load_scanner_cache_at(&root).expect("scanner cache should be readable");

        let error = filesystem::rename_archive_epub_at(&root, "Book.epub", "Existing.epub")
            .expect_err("conflicting rename should fail");
        assert!(error.contains("already exists"));
        assert!(root.join("Book.epub").is_file());

        let after =
            metadata::load_scanner_cache_at(&root).expect("scanner cache should remain readable");
        assert_eq!(after, before);
        let snapshot = scanner_cache::load_snapshot(&root);
        assert!(snapshot.snapshot.cache().entries.contains_key("Book.epub"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn newer_full_scan_tokens_cancel_older_scheduling_tokens() {
        let first = ScanCancellation::begin_full_scan();
        assert!(!first.is_cancelled());
        let second = ScanCancellation::begin_full_scan();

        assert!(first.is_cancelled());
        assert!(!second.is_cancelled());
    }
}
