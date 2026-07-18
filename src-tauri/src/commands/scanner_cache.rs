use std::{
    collections::{BTreeMap, BTreeSet, HashMap},
    fs::{self, File},
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, MutexGuard, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use super::metadata::{self, ScannerCache, ScannerCacheEntry};

type NormalizedCacheEntries = BTreeMap<String, (String, ScannerCacheEntry)>;

pub(crate) const INVALIDATION_FILE: &str = "scanner-cache-invalidations.json";
pub(crate) const CACHE_MAINTENANCE_WARNING_PREFIX: &str =
    "Scanner cache maintenance failed; affected entries remain unavailable until the cache is repaired";
const INVALIDATION_VERSION: u8 = 1;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ScannerCacheWarning {
    pub(crate) message: String,
    pub(crate) repair_required: bool,
}

fn warning(message: String, repair_required: bool) -> ScannerCacheWarning {
    ScannerCacheWarning {
        message,
        repair_required,
    }
}

fn cache_maintenance_warning(error: &str) -> ScannerCacheWarning {
    warning(
        format!("{CACHE_MAINTENANCE_WARNING_PREFIX}: {error}"),
        false,
    )
}

fn restart_safe_warning(error: &str) -> ScannerCacheWarning {
    warning(
        format!(
            "Scanner cache maintenance failed, but durable invalidations will prevent stale metadata reuse after restart: {error}"
        ),
        false,
    )
}

fn quarantined_cache_warning(error: &str) -> ScannerCacheWarning {
    warning(
        format!(
            "Scanner cache maintenance failed, so the complete scanner cache was discarded and will be rebuilt: {error}"
        ),
        false,
    )
}

fn restart_safety_failure_warning(error: &str) -> ScannerCacheWarning {
    warning(
        format!(
            "Scanner cache maintenance failed and the stale cache could not be durably invalidated or discarded. Affected entries are ignored for this session, but restart safety could not be established: {error}"
        ),
        true,
    )
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct DurableInvalidations {
    version: u8,
    #[serde(default)]
    exact_paths: BTreeSet<String>,
    #[serde(default)]
    prefixes: BTreeSet<String>,
}

impl Default for DurableInvalidations {
    fn default() -> Self {
        Self {
            version: INVALIDATION_VERSION,
            exact_paths: BTreeSet::new(),
            prefixes: BTreeSet::new(),
        }
    }
}

impl DurableInvalidations {
    fn from_state(state: &ArchiveCacheState) -> Self {
        Self {
            version: INVALIDATION_VERSION,
            exact_paths: state.invalidated_paths.keys().cloned().collect(),
            prefixes: state.invalidated_prefixes.keys().cloned().collect(),
        }
    }

    fn is_empty(&self) -> bool {
        self.exact_paths.is_empty() && self.prefixes.is_empty()
    }
}

#[derive(Default)]
struct ArchiveCacheState {
    invalidated_paths: BTreeMap<String, u64>,
    invalidated_prefixes: BTreeMap<String, u64>,
    path_revisions: BTreeMap<String, u64>,
    prefix_revisions: BTreeMap<String, u64>,
    revision: u64,
    clear_generation: u64,
    warning: Option<ScannerCacheWarning>,
}

type ScannerCacheRegistry = HashMap<String, ArchiveCacheState>;

static SCANNER_CACHE_REGISTRY: OnceLock<Mutex<ScannerCacheRegistry>> = OnceLock::new();

#[cfg(test)]
#[derive(Default)]
struct ForcedFailures {
    cache_save: BTreeSet<String>,
    invalidation_save: BTreeSet<String>,
    quarantine: BTreeSet<String>,
}

#[cfg(test)]
static FORCED_FAILURES: OnceLock<Mutex<ForcedFailures>> = OnceLock::new();

fn registry() -> &'static Mutex<ScannerCacheRegistry> {
    SCANNER_CACHE_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

fn lock_registry() -> MutexGuard<'static, ScannerCacheRegistry> {
    registry()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

#[cfg(test)]
fn forced_failures() -> &'static Mutex<ForcedFailures> {
    FORCED_FAILURES.get_or_init(|| Mutex::new(ForcedFailures::default()))
}

fn archive_key(root: &Path) -> String {
    let path = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    let normalized = path.to_string_lossy().replace('\\', "/");
    if cfg!(target_os = "windows") {
        normalized.to_lowercase()
    } else {
        normalized
    }
}

fn path_key(relative_path: &str) -> String {
    relative_path.replace('\\', "/").to_lowercase()
}

fn prefix_matches(normalized_path: &str, normalized_prefix: &str) -> bool {
    normalized_path == normalized_prefix
        || normalized_path
            .strip_prefix(normalized_prefix)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

fn normalized_entries(cache: &ScannerCache) -> NormalizedCacheEntries {
    cache
        .entries
        .iter()
        .map(|(relative_path, entry)| {
            (
                path_key(relative_path),
                (relative_path.replace('\\', "/"), entry.clone()),
            )
        })
        .collect()
}

fn path_is_invalidated(
    normalized_path: &str,
    invalidated_paths: &BTreeMap<String, u64>,
    invalidated_prefixes: &BTreeMap<String, u64>,
) -> bool {
    invalidated_paths.contains_key(normalized_path)
        || invalidated_prefixes
            .keys()
            .any(|prefix| prefix_matches(normalized_path, prefix))
}

fn path_has_newer_revision(state: &ArchiveCacheState, path: &str, snapshot_revision: u64) -> bool {
    state
        .path_revisions
        .get(path)
        .is_some_and(|revision| *revision > snapshot_revision)
        || state
            .prefix_revisions
            .iter()
            .any(|(prefix, revision)| *revision > snapshot_revision && prefix_matches(path, prefix))
}

fn filter_invalidated(cache: &mut ScannerCache, state: &ArchiveCacheState) {
    cache.entries.retain(|relative_path, _| {
        !path_is_invalidated(
            &path_key(relative_path),
            &state.invalidated_paths,
            &state.invalidated_prefixes,
        )
    });
}

fn invalidation_path(root: &Path) -> PathBuf {
    root.join(metadata::METADATA_DIRECTORY)
        .join(INVALIDATION_FILE)
}

fn invalidation_transaction_path(root: &Path, marker: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    root.join(metadata::METADATA_DIRECTORY).join(format!(
        "{INVALIDATION_FILE}.{marker}-{}-{nonce}",
        std::process::id()
    ))
}

fn read_durable_invalidations(root: &Path) -> Result<DurableInvalidations, String> {
    let path = invalidation_path(root);
    match fs::read(&path) {
        Ok(contents) => {
            let invalidations = serde_json::from_slice::<DurableInvalidations>(&contents)
                .map_err(|error| error.to_string())?;
            if invalidations.version != INVALIDATION_VERSION {
                return Err(
                    "The scanner-cache invalidation journal version is unsupported.".to_string(),
                );
            }
            Ok(invalidations)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(DurableInvalidations::default())
        }
        Err(error) => Err(error.to_string()),
    }
}

fn write_durable_invalidations(
    root: &Path,
    invalidations: &DurableInvalidations,
) -> Result<(), String> {
    #[cfg(test)]
    {
        let key = archive_key(root);
        let failures = forced_failures()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if failures.invalidation_save.contains(&key) {
            return Err("forced invalidation-journal save failure".to_string());
        }
    }

    let path = invalidation_path(root);
    if invalidations.is_empty() {
        return match fs::remove_file(path) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(error.to_string()),
        };
    }

    let parent = path
        .parent()
        .ok_or_else(|| "The scanner-cache metadata folder is unavailable.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let temporary = invalidation_transaction_path(root, "tmp-write");
    let contents = serde_json::to_vec_pretty(invalidations).map_err(|error| error.to_string())?;
    let write_result = (|| -> Result<(), String> {
        let mut file = File::create(&temporary).map_err(|error| error.to_string())?;
        file.write_all(&contents)
            .map_err(|error| error.to_string())?;
        file.sync_all().map_err(|error| error.to_string())?;
        drop(file);
        let temporary_contents = fs::read(&temporary).map_err(|error| error.to_string())?;
        serde_json::from_slice::<DurableInvalidations>(&temporary_contents)
            .map_err(|error| error.to_string())?;
        Ok(())
    })();
    if let Err(error) = write_result {
        let _ = fs::remove_file(&temporary);
        return Err(error);
    }

    if !path.exists() {
        return fs::rename(&temporary, &path).map_err(|error| {
            let _ = fs::remove_file(&temporary);
            error.to_string()
        });
    }
    if !path.is_file() {
        let _ = fs::remove_file(&temporary);
        return Err("The scanner-cache invalidation journal path is not a file.".to_string());
    }

    let backup = invalidation_transaction_path(root, "write-backup");
    if let Err(error) = fs::rename(&path, &backup) {
        let _ = fs::remove_file(&temporary);
        return Err(error.to_string());
    }
    if let Err(rename_error) = fs::rename(&temporary, &path) {
        let _ = fs::remove_file(&temporary);
        return match fs::rename(&backup, &path) {
            Ok(()) => Err(format!(
                "Scanner-cache invalidation save failed and the previous journal was restored: {rename_error}"
            )),
            Err(restore_error) => Err(format!(
                "Scanner-cache invalidation save failed and the previous journal could not be restored: {restore_error}"
            )),
        };
    }

    let _ = fs::remove_file(backup);
    Ok(())
}

fn save_cache(root: &Path, cache: &ScannerCache) -> Result<(), String> {
    #[cfg(test)]
    {
        let key = archive_key(root);
        let failures = forced_failures()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if failures.cache_save.contains(&key) {
            return Err("forced scanner-cache save failure".to_string());
        }
    }

    metadata::save_scanner_cache_at(root, cache)
}

fn quarantine_cache(root: &Path) -> Result<(), String> {
    #[cfg(test)]
    {
        let key = archive_key(root);
        let failures = forced_failures()
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if failures.quarantine.contains(&key) {
            return Err("forced scanner-cache quarantine failure".to_string());
        }
    }

    metadata::clear_scanner_cache_at(root)
}

fn absorb_durable_invalidations(
    state: &mut ArchiveCacheState,
    invalidations: DurableInvalidations,
) {
    let new_paths = invalidations
        .exact_paths
        .into_iter()
        .map(|path| path_key(&path))
        .filter(|path| !path.is_empty() && !state.invalidated_paths.contains_key(path))
        .collect::<Vec<_>>();
    let new_prefixes = invalidations
        .prefixes
        .into_iter()
        .map(|prefix| path_key(&prefix).trim_end_matches('/').to_string())
        .filter(|prefix| !prefix.is_empty() && !state.invalidated_prefixes.contains_key(prefix))
        .collect::<Vec<_>>();

    if new_paths.is_empty() && new_prefixes.is_empty() {
        return;
    }

    state.revision = state.revision.saturating_add(1);
    let revision = state.revision;
    for path in new_paths {
        state.invalidated_paths.insert(path.clone(), revision);
        state.path_revisions.insert(path, revision);
    }
    for prefix in new_prefixes {
        state.invalidated_prefixes.insert(prefix.clone(), revision);
        state.prefix_revisions.insert(prefix, revision);
    }
}

fn load_cache_for_maintenance(root: &Path) -> Result<ScannerCache, String> {
    match metadata::load_scanner_cache_with_recovery_at(root) {
        Ok((cache, _)) => Ok(cache),
        Err(error) => {
            if invalidation_path(root).exists() {
                Ok(ScannerCache::default())
            } else {
                Err(error)
            }
        }
    }
}

fn clear_active_invalidations_after_safe_cache_write(
    root: &Path,
    state: &mut ArchiveCacheState,
) -> Option<ScannerCacheWarning> {
    let previous_paths = std::mem::take(&mut state.invalidated_paths);
    let previous_prefixes = std::mem::take(&mut state.invalidated_prefixes);
    let empty = DurableInvalidations::from_state(state);
    if let Err(error) = write_durable_invalidations(root, &empty) {
        state.invalidated_paths = previous_paths;
        state.invalidated_prefixes = previous_prefixes;
        let warning = warning(
            format!(
                "The scanner cache is safe, but its durable invalidation journal could not be cleared and may reduce warm-scan reuse: {error}"
            ),
            false,
        );
        state.warning = Some(warning.clone());
        return Some(warning);
    }
    state.warning = None;
    None
}

fn handle_failed_cache_persistence(
    root: &Path,
    state: &mut ArchiveCacheState,
    cache_error: String,
    journal_persisted: bool,
) -> ScannerCacheMaintenance {
    if journal_persisted {
        let warning = restart_safe_warning(&cache_error);
        state.warning = Some(warning.clone());
        return ScannerCacheMaintenance {
            warning: Some(warning),
        };
    }

    match quarantine_cache(root) {
        Ok(()) => {
            let warning = quarantined_cache_warning(&cache_error);
            state.warning = Some(warning.clone());
            ScannerCacheMaintenance {
                warning: Some(warning),
            }
        }
        Err(quarantine_error) => {
            let warning = restart_safety_failure_warning(&format!(
                "{cache_error}; cache discard also failed: {quarantine_error}"
            ));
            state.warning = Some(warning.clone());
            ScannerCacheMaintenance {
                warning: Some(warning),
            }
        }
    }
}

#[derive(Clone)]
pub(crate) struct ScannerCacheSnapshot {
    cache: ScannerCache,
    revision: u64,
    clear_generation: u64,
    root_key: String,
}

impl ScannerCacheSnapshot {
    pub(crate) fn cache(&self) -> &ScannerCache {
        &self.cache
    }
}

pub(crate) struct ScannerCacheLoad {
    pub(crate) recovered: bool,
    pub(crate) snapshot: ScannerCacheSnapshot,
    pub(crate) warning: Option<ScannerCacheWarning>,
}

#[derive(Default)]
pub(crate) struct ScannerCacheMaintenance {
    pub(crate) warning: Option<ScannerCacheWarning>,
}

pub(crate) enum ScannerCachePublicationScope<'a> {
    Full,
    Paths(&'a [String]),
}

pub(crate) fn load_snapshot(root: &Path) -> ScannerCacheLoad {
    let root_key = archive_key(root);
    let mut registry = lock_registry();
    let state = registry.entry(root_key.clone()).or_default();
    let durable_warning = match read_durable_invalidations(root) {
        Ok(invalidations) => {
            absorb_durable_invalidations(state, invalidations);
            None
        }
        Err(error) => {
            let warning = warning(
                format!(
                    "The scanner-cache invalidation journal could not be read, so the scanner cache was ignored: {error}"
                ),
                true,
            );
            state.warning = Some(warning.clone());
            Some(warning)
        }
    };

    let (mut cache, recovered, load_warning) = if durable_warning.is_some() {
        (ScannerCache::default(), false, None)
    } else {
        match metadata::load_scanner_cache_with_recovery_at(root) {
            Ok((cache, recovered)) => (cache, recovered, None),
            Err(error) => (
                ScannerCache::default(),
                false,
                Some(warning(
                    format!("Scanner cache could not be read and will be rebuilt: {error}"),
                    false,
                )),
            ),
        }
    };
    filter_invalidated(&mut cache, state);

    ScannerCacheLoad {
        recovered,
        warning: durable_warning
            .or(load_warning)
            .or_else(|| state.warning.clone()),
        snapshot: ScannerCacheSnapshot {
            cache,
            revision: state.revision,
            clear_generation: state.clear_generation,
            root_key,
        },
    }
}

pub(crate) fn publish_snapshot(
    root: &Path,
    snapshot: &ScannerCacheSnapshot,
    proposed: &ScannerCache,
    scope: ScannerCachePublicationScope<'_>,
) -> Result<ScannerCacheMaintenance, String> {
    let root_key = archive_key(root);
    if root_key != snapshot.root_key {
        return Err("Scanner-cache snapshot belongs to a different archive.".to_string());
    }

    let mut registry = lock_registry();
    let state = registry.entry(root_key).or_default();
    if snapshot.clear_generation != state.clear_generation {
        return Ok(ScannerCacheMaintenance::default());
    }
    let journal_warning = match read_durable_invalidations(root) {
        Ok(invalidations) => {
            absorb_durable_invalidations(state, invalidations);
            None
        }
        Err(error) => {
            let warning = warning(
                format!(
                    "The scanner-cache invalidation journal could not be read, so the previous scanner cache was discarded during publication: {error}"
                ),
                true,
            );
            state.warning = Some(warning.clone());
            Some(warning)
        }
    };

    if journal_warning.is_none()
        && snapshot.revision == state.revision
        && state.warning.is_none()
        && state.invalidated_paths.is_empty()
        && state.invalidated_prefixes.is_empty()
        && proposed == snapshot.cache()
    {
        return Ok(ScannerCacheMaintenance::default());
    }

    let persisted = if journal_warning.is_some() {
        ScannerCache::default()
    } else {
        match load_cache_for_maintenance(root) {
            Ok(cache) => cache,
            Err(error) => {
                let warning = cache_maintenance_warning(&error);
                state.warning = Some(warning.clone());
                return Ok(ScannerCacheMaintenance {
                    warning: Some(warning),
                });
            }
        }
    };
    let persisted_before_publication = persisted.clone();
    let proposed_entries = normalized_entries(proposed);
    let mut owned_paths = BTreeSet::new();

    match scope {
        ScannerCachePublicationScope::Full => {
            owned_paths.extend(persisted.entries.keys().map(|path| path_key(path)));
            owned_paths.extend(snapshot.cache().entries.keys().map(|path| path_key(path)));
            owned_paths.extend(proposed_entries.keys().cloned());
        }
        ScannerCachePublicationScope::Paths(relative_paths) => {
            owned_paths.extend(relative_paths.iter().map(|path| path_key(path)));
        }
    }

    let accepted_paths = owned_paths
        .into_iter()
        .filter(|path| !path_has_newer_revision(state, path, snapshot.revision))
        .collect::<Vec<_>>();
    let mut next = persisted;
    filter_invalidated(&mut next, state);
    let mut next_entries = normalized_entries(&next);
    for normalized_path in &accepted_paths {
        next_entries.remove(normalized_path);
        if let Some((relative_path, entry)) = proposed_entries.get(normalized_path) {
            next_entries.insert(
                normalized_path.clone(),
                (relative_path.clone(), entry.clone()),
            );
        }
    }
    next.entries = next_entries
        .into_values()
        .collect::<BTreeMap<String, ScannerCacheEntry>>();

    if journal_warning.is_none()
        && state.warning.is_none()
        && state.invalidated_paths.is_empty()
        && state.invalidated_prefixes.is_empty()
        && next == persisted_before_publication
    {
        return Ok(ScannerCacheMaintenance::default());
    }

    if let Err(error) = save_cache(root, &next) {
        if state.invalidated_paths.is_empty() && state.invalidated_prefixes.is_empty() {
            let warning = journal_warning.unwrap_or_else(|| cache_maintenance_warning(&error));
            state.warning = Some(warning.clone());
            return Ok(ScannerCacheMaintenance {
                warning: Some(warning),
            });
        }

        let journal_persisted =
            write_durable_invalidations(root, &DurableInvalidations::from_state(state)).is_ok();
        return Ok(handle_failed_cache_persistence(
            root,
            state,
            error,
            journal_persisted,
        ));
    }

    if !accepted_paths.is_empty() {
        state.revision = state.revision.saturating_add(1);
        let publication_revision = state.revision;
        for normalized_path in accepted_paths {
            state
                .path_revisions
                .insert(normalized_path, publication_revision);
        }
    }
    let warning =
        clear_active_invalidations_after_safe_cache_write(root, state).or(journal_warning);
    Ok(ScannerCacheMaintenance { warning })
}

pub(crate) fn invalidate(
    root: &Path,
    exact_paths: &[String],
    prefixes: &[String],
) -> ScannerCacheMaintenance {
    let normalized_paths = exact_paths
        .iter()
        .map(|path| path_key(path))
        .filter(|path| !path.is_empty())
        .collect::<BTreeSet<_>>();
    let normalized_prefixes = prefixes
        .iter()
        .map(|prefix| path_key(prefix).trim_end_matches('/').to_string())
        .filter(|prefix| !prefix.is_empty())
        .collect::<BTreeSet<_>>();
    if normalized_paths.is_empty() && normalized_prefixes.is_empty() {
        return ScannerCacheMaintenance::default();
    }

    let root_key = archive_key(root);
    let mut registry = lock_registry();
    let state = registry.entry(root_key).or_default();
    state.revision = state.revision.saturating_add(1);
    let invalidation_revision = state.revision;
    for normalized_path in &normalized_paths {
        state
            .invalidated_paths
            .insert(normalized_path.clone(), invalidation_revision);
        state
            .path_revisions
            .insert(normalized_path.clone(), invalidation_revision);
    }
    for normalized_prefix in &normalized_prefixes {
        state
            .invalidated_prefixes
            .insert(normalized_prefix.clone(), invalidation_revision);
        state
            .prefix_revisions
            .insert(normalized_prefix.clone(), invalidation_revision);
    }

    let journal_persisted =
        write_durable_invalidations(root, &DurableInvalidations::from_state(state)).is_ok();
    let persisted = match load_cache_for_maintenance(root) {
        Ok(cache) => cache,
        Err(error) => {
            return handle_failed_cache_persistence(root, state, error, journal_persisted);
        }
    };
    let mut next = persisted;
    filter_invalidated(&mut next, state);

    if let Err(error) = save_cache(root, &next) {
        return handle_failed_cache_persistence(root, state, error, journal_persisted);
    }

    let warning = clear_active_invalidations_after_safe_cache_write(root, state);
    ScannerCacheMaintenance { warning }
}

pub(crate) fn invalidate_paths(root: &Path, relative_paths: &[String]) -> ScannerCacheMaintenance {
    invalidate(root, relative_paths, &[])
}

pub(crate) fn invalidate_prefixes(root: &Path, prefixes: &[String]) -> ScannerCacheMaintenance {
    invalidate(root, &[], prefixes)
}

pub(crate) fn update_entry(
    root: &Path,
    relative_path: &str,
    entry: ScannerCacheEntry,
) -> ScannerCacheMaintenance {
    let root_key = archive_key(root);
    let normalized_path = path_key(relative_path);
    let mut registry = lock_registry();
    let state = registry.entry(root_key).or_default();
    state.revision = state.revision.saturating_add(1);
    let update_revision = state.revision;
    state
        .path_revisions
        .insert(normalized_path.clone(), update_revision);

    let mut next = match load_cache_for_maintenance(root) {
        Ok(cache) => cache,
        Err(error) => {
            state
                .invalidated_paths
                .insert(normalized_path, update_revision);
            let journal_persisted =
                write_durable_invalidations(root, &DurableInvalidations::from_state(state)).is_ok();
            return handle_failed_cache_persistence(root, state, error, journal_persisted);
        }
    };
    filter_invalidated(&mut next, state);
    next.entries.insert(relative_path.replace('\\', "/"), entry);

    if let Err(error) = save_cache(root, &next) {
        state
            .invalidated_paths
            .insert(normalized_path, update_revision);
        let journal_persisted =
            write_durable_invalidations(root, &DurableInvalidations::from_state(state)).is_ok();
        return handle_failed_cache_persistence(root, state, error, journal_persisted);
    }

    let warning = clear_active_invalidations_after_safe_cache_write(root, state);
    ScannerCacheMaintenance { warning }
}

pub(crate) fn clear(root: &Path) -> Result<(), String> {
    let root_key = archive_key(root);
    let mut registry = lock_registry();
    let state = registry.entry(root_key).or_default();
    state.clear_generation = state.clear_generation.saturating_add(1);

    metadata::clear_scanner_cache_at(root).map_err(|error| {
        format!(
            "Scanner cache clear could not complete safely: scanner cache removal failed: {error}"
        )
    })?;
    write_durable_invalidations(root, &DurableInvalidations::default()).map_err(|error| {
        format!(
            "Scanner cache clear could not complete safely: invalidation journal removal failed: {error}"
        )
    })?;

    state.invalidated_paths.clear();
    state.invalidated_prefixes.clear();
    state.path_revisions.clear();
    state.prefix_revisions.clear();
    state.revision = state.revision.saturating_add(1);
    state.warning = None;
    Ok(())
}

#[cfg(test)]
pub(crate) fn force_cache_save_failure(root: &Path, enabled: bool) {
    let key = archive_key(root);
    let mut failures = forced_failures()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if enabled {
        failures.cache_save.insert(key);
    } else {
        failures.cache_save.remove(&key);
    }
}

#[cfg(test)]
pub(crate) fn force_invalidation_save_failure(root: &Path, enabled: bool) {
    let key = archive_key(root);
    let mut failures = forced_failures()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if enabled {
        failures.invalidation_save.insert(key);
    } else {
        failures.invalidation_save.remove(&key);
    }
}

#[cfg(test)]
pub(crate) fn force_quarantine_failure(root: &Path, enabled: bool) {
    let key = archive_key(root);
    let mut failures = forced_failures()
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    if enabled {
        failures.quarantine.insert(key);
    } else {
        failures.quarantine.remove(&key);
    }
}

#[cfg(test)]
pub(crate) fn simulate_restart(root: &Path) {
    lock_registry().remove(&archive_key(root));
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;

    fn test_archive(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-scanner-cache-{name}-{nonce}"));
        fs::create_dir_all(&root).expect("test archive should be created");
        root
    }

    fn entry(size: u64) -> ScannerCacheEntry {
        ScannerCacheEntry {
            size,
            modified_at: size,
            source_metadata: None,
            metadata_error: None,
        }
    }

    fn initialize(root: &Path, entries: &[(&str, u64)]) {
        fs::create_dir_all(root.join(metadata::METADATA_DIRECTORY))
            .expect("metadata directory should be created");
        let mut cache = ScannerCache::default();
        for (relative_path, size) in entries {
            cache
                .entries
                .insert((*relative_path).to_string(), entry(*size));
        }
        metadata::save_scanner_cache_at(root, &cache).expect("scanner cache should be initialized");
    }

    #[test]
    fn unchanged_publication_does_not_attempt_another_cache_write() {
        let root = test_archive("unchanged-publication");
        initialize(&root, &[("Novel.epub", 10)]);
        let loaded = load_snapshot(&root);
        let proposed = loaded.snapshot.cache().clone();
        force_cache_save_failure(&root, true);

        let maintenance = publish_snapshot(
            &root,
            &loaded.snapshot,
            &proposed,
            ScannerCachePublicationScope::Full,
        )
        .expect("unchanged publication should succeed without writing");

        assert!(maintenance.warning.is_none());
        force_cache_save_failure(&root, false);
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn targeted_publication_cannot_restore_later_invalidations() {
        let root = test_archive("targeted-overlap");
        initialize(&root, &[("Book.epub", 1), ("Other.epub", 2)]);

        let loaded = load_snapshot(&root);
        invalidate_paths(&root, &["Book.epub".to_string()]);
        let mut proposed = loaded.snapshot.cache().clone();
        proposed.entries.insert("Book.epub".to_string(), entry(3));
        publish_snapshot(
            &root,
            &loaded.snapshot,
            &proposed,
            ScannerCachePublicationScope::Paths(&["Book.epub".to_string()]),
        )
        .unwrap();

        let next = load_snapshot(&root);
        assert!(!next.snapshot.cache().entries.contains_key("Book.epub"));
        assert!(next.snapshot.cache().entries.contains_key("Other.epub"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn full_publication_cannot_undo_a_later_rename_invalidation() {
        let root = test_archive("full-overlap");
        initialize(&root, &[("Old.epub", 1), ("Other.epub", 2)]);

        let loaded = load_snapshot(&root);
        invalidate_paths(&root, &["Old.epub".to_string(), "Renamed.epub".to_string()]);
        let mut proposed = ScannerCache::default();
        proposed.entries.insert("Old.epub".to_string(), entry(1));
        proposed.entries.insert("Other.epub".to_string(), entry(2));
        publish_snapshot(
            &root,
            &loaded.snapshot,
            &proposed,
            ScannerCachePublicationScope::Full,
        )
        .unwrap();

        let next = load_snapshot(&root);
        assert!(!next.snapshot.cache().entries.contains_key("Old.epub"));
        assert!(!next.snapshot.cache().entries.contains_key("Renamed.epub"));
        assert!(next.snapshot.cache().entries.contains_key("Other.epub"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn prefix_invalidation_is_case_insensitive_and_preserves_siblings() {
        let root = test_archive("prefix-case");
        initialize(
            &root,
            &[
                ("Folder/Book.epub", 1),
                ("Folder/Nested/Other.epub", 2),
                ("Folder Two/Stable.epub", 3),
            ],
        );

        invalidate_prefixes(&root, &["folder".to_string()]);

        let cache = load_snapshot(&root);
        assert!(!cache
            .snapshot
            .cache()
            .entries
            .contains_key("Folder/Book.epub"));
        assert!(!cache
            .snapshot
            .cache()
            .entries
            .contains_key("Folder/Nested/Other.epub"));
        assert!(cache
            .snapshot
            .cache()
            .entries
            .contains_key("Folder Two/Stable.epub"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn one_maintenance_operation_invalidates_exact_paths_and_prefixes() {
        let root = test_archive("combined-invalidation");
        initialize(
            &root,
            &[
                ("Loose.epub", 1),
                ("Folder/Book.epub", 2),
                ("Folder Two/Stable.epub", 3),
                ("Unrelated.epub", 4),
            ],
        );

        invalidate(&root, &["LOOSE.EPUB".to_string()], &["folder".to_string()]);

        let cache = load_snapshot(&root);
        assert!(!cache.snapshot.cache().entries.contains_key("Loose.epub"));
        assert!(!cache
            .snapshot
            .cache()
            .entries
            .contains_key("Folder/Book.epub"));
        assert!(cache
            .snapshot
            .cache()
            .entries
            .contains_key("Folder Two/Stable.epub"));
        assert!(cache
            .snapshot
            .cache()
            .entries
            .contains_key("Unrelated.epub"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn old_and_destination_prefixes_reject_an_older_full_publication() {
        let root = test_archive("prefix-overlap");
        initialize(
            &root,
            &[
                ("Old/Book.epub", 1),
                ("Destination/Stale.epub", 2),
                ("Stable.epub", 3),
            ],
        );
        let loaded = load_snapshot(&root);

        invalidate_prefixes(&root, &["Old".to_string(), "Destination".to_string()]);
        let mut proposed = loaded.snapshot.cache().clone();
        proposed
            .entries
            .insert("Old/Book.epub".to_string(), entry(4));
        proposed
            .entries
            .insert("Destination/Stale.epub".to_string(), entry(5));
        publish_snapshot(
            &root,
            &loaded.snapshot,
            &proposed,
            ScannerCachePublicationScope::Full,
        )
        .unwrap();

        let cache = load_snapshot(&root);
        assert!(!cache.snapshot.cache().entries.contains_key("Old/Book.epub"));
        assert!(!cache
            .snapshot
            .cache()
            .entries
            .contains_key("Destination/Stale.epub"));
        assert!(cache.snapshot.cache().entries.contains_key("Stable.epub"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn invalidation_matches_paths_case_insensitively() {
        let root = test_archive("case-insensitive");
        initialize(&root, &[("Folder/Book.epub", 1), ("Folder/Other.epub", 2)]);

        invalidate_paths(&root, &["folder/BOOK.EPUB".to_string()]);

        let cache = load_snapshot(&root);
        assert!(!cache
            .snapshot
            .cache()
            .entries
            .contains_key("Folder/Book.epub"));
        assert!(cache
            .snapshot
            .cache()
            .entries
            .contains_key("Folder/Other.epub"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn durable_invalidation_survives_restart_after_cache_save_failure() {
        let root = test_archive("restart-safe");
        initialize(&root, &[("Book.epub", 1), ("Other.epub", 2)]);

        force_cache_save_failure(&root, true);
        let maintenance = invalidate_paths(&root, &["Book.epub".to_string()]);
        assert!(maintenance
            .warning
            .as_ref()
            .is_some_and(|warning| warning.message.contains("durable invalidations")));
        force_cache_save_failure(&root, false);
        simulate_restart(&root);

        let restarted = load_snapshot(&root);
        assert!(!restarted.snapshot.cache().entries.contains_key("Book.epub"));
        assert!(restarted
            .snapshot
            .cache()
            .entries
            .contains_key("Other.epub"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn successive_durable_invalidations_survive_journal_replacement() {
        let root = test_archive("journal-replacement");
        initialize(
            &root,
            &[("First.epub", 1), ("Second.epub", 2), ("Stable.epub", 3)],
        );

        force_cache_save_failure(&root, true);
        invalidate_paths(&root, &["First.epub".to_string()]);
        invalidate_paths(&root, &["Second.epub".to_string()]);
        force_cache_save_failure(&root, false);
        simulate_restart(&root);

        let restarted = load_snapshot(&root);
        assert!(!restarted
            .snapshot
            .cache()
            .entries
            .contains_key("First.epub"));
        assert!(!restarted
            .snapshot
            .cache()
            .entries
            .contains_key("Second.epub"));
        assert!(restarted
            .snapshot
            .cache()
            .entries
            .contains_key("Stable.epub"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn cache_is_quarantined_when_selective_and_journal_persistence_fail() {
        let root = test_archive("quarantine");
        initialize(&root, &[("Book.epub", 1), ("Other.epub", 2)]);

        force_cache_save_failure(&root, true);
        force_invalidation_save_failure(&root, true);
        let maintenance = invalidate_paths(&root, &["Book.epub".to_string()]);
        assert!(maintenance.warning.as_ref().is_some_and(|warning| {
            warning
                .message
                .contains("complete scanner cache was discarded")
        }));
        force_cache_save_failure(&root, false);
        force_invalidation_save_failure(&root, false);
        simulate_restart(&root);

        let restarted = load_snapshot(&root);
        assert!(restarted.snapshot.cache().entries.is_empty());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn failed_quarantine_reports_that_restart_safety_was_not_established() {
        let root = test_archive("quarantine-failure");
        initialize(&root, &[("Book.epub", 1), ("Other.epub", 2)]);

        force_cache_save_failure(&root, true);
        force_invalidation_save_failure(&root, true);
        force_quarantine_failure(&root, true);
        let maintenance = invalidate_paths(&root, &["Book.epub".to_string()]);
        assert!(maintenance.warning.as_ref().is_some_and(|warning| {
            warning.repair_required
                && warning
                    .message
                    .contains("restart safety could not be established")
        }));
        let in_process = load_snapshot(&root);
        assert!(!in_process
            .snapshot
            .cache()
            .entries
            .contains_key("Book.epub"));
        assert!(metadata::load_scanner_cache_at(&root)
            .expect("stale disk cache should remain")
            .entries
            .contains_key("Book.epub"));

        force_cache_save_failure(&root, false);
        force_invalidation_save_failure(&root, false);
        force_quarantine_failure(&root, false);
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn publication_loaded_after_durable_invalidation_repopulates_the_fresh_path() {
        let root = test_archive("fresh-publication");
        initialize(&root, &[("Book.epub", 1), ("Other.epub", 2)]);

        force_cache_save_failure(&root, true);
        invalidate_paths(&root, &["Book.epub".to_string()]);
        force_cache_save_failure(&root, false);

        let loaded = load_snapshot(&root);
        let mut proposed = loaded.snapshot.cache().clone();
        proposed.entries.insert("Book.epub".to_string(), entry(3));
        publish_snapshot(
            &root,
            &loaded.snapshot,
            &proposed,
            ScannerCachePublicationScope::Paths(&["Book.epub".to_string()]),
        )
        .unwrap();

        let next = load_snapshot(&root);
        assert_eq!(
            next.snapshot.cache().entries.get("Book.epub"),
            Some(&entry(3))
        );
        assert!(next.snapshot.cache().entries.contains_key("Other.epub"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn newer_entry_publication_survives_an_older_full_scan() {
        let root = test_archive("entry-overlap");
        initialize(&root, &[("Book.epub", 1), ("Other.epub", 2)]);

        let loaded = load_snapshot(&root);
        update_entry(&root, "Book.epub", entry(7));
        let mut stale_full_scan = ScannerCache::default();
        stale_full_scan
            .entries
            .insert("Book.epub".to_string(), entry(1));
        stale_full_scan
            .entries
            .insert("Other.epub".to_string(), entry(2));
        publish_snapshot(
            &root,
            &loaded.snapshot,
            &stale_full_scan,
            ScannerCachePublicationScope::Full,
        )
        .unwrap();

        let next = load_snapshot(&root);
        assert_eq!(
            next.snapshot.cache().entries.get("Book.epub"),
            Some(&entry(7))
        );
        assert_eq!(
            next.snapshot.cache().entries.get("Other.epub"),
            Some(&entry(2))
        );
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn clear_rejects_full_and_targeted_publications_loaded_before_clear() {
        let root = test_archive("clear-publication-barrier");
        initialize(&root, &[("Book.epub", 1), ("Other.epub", 2)]);
        let stale_full = load_snapshot(&root);
        let stale_targeted = load_snapshot(&root);

        clear(&root).expect("scanner cache should clear");
        assert!(!root
            .join(metadata::METADATA_DIRECTORY)
            .join(metadata::SCANNER_CACHE_FILE)
            .exists());

        let mut full_proposed = ScannerCache::default();
        full_proposed
            .entries
            .insert("Book.epub".to_string(), entry(1));
        publish_snapshot(
            &root,
            &stale_full.snapshot,
            &full_proposed,
            ScannerCachePublicationScope::Full,
        )
        .expect("stale full publication should be rejected safely");
        publish_snapshot(
            &root,
            &stale_targeted.snapshot,
            &full_proposed,
            ScannerCachePublicationScope::Paths(&["Book.epub".to_string()]),
        )
        .expect("stale targeted publication should be rejected safely");

        assert!(!root
            .join(metadata::METADATA_DIRECTORY)
            .join(metadata::SCANNER_CACHE_FILE)
            .exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn snapshot_loaded_after_clear_can_rebuild_the_cache() {
        let root = test_archive("clear-fresh-publication");
        initialize(&root, &[("Old.epub", 1)]);
        clear(&root).expect("scanner cache should clear");

        let fresh = load_snapshot(&root);
        let mut proposed = ScannerCache::default();
        proposed.entries.insert("Fresh.epub".to_string(), entry(2));
        publish_snapshot(
            &root,
            &fresh.snapshot,
            &proposed,
            ScannerCachePublicationScope::Full,
        )
        .expect("fresh publication should rebuild the cache");

        let reloaded = load_snapshot(&root);
        assert_eq!(
            reloaded.snapshot.cache().entries.get("Fresh.epub"),
            Some(&entry(2))
        );
        assert!(!reloaded.snapshot.cache().entries.contains_key("Old.epub"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn clear_removes_active_invalidations_and_survives_restart() {
        let root = test_archive("clear-invalidations");
        initialize(&root, &[("Book.epub", 1), ("Other.epub", 2)]);
        force_cache_save_failure(&root, true);
        invalidate_paths(&root, &["Book.epub".to_string()]);
        force_cache_save_failure(&root, false);
        assert!(invalidation_path(&root).exists());

        clear(&root).expect("clear should remove cache and invalidation journal");
        assert!(!invalidation_path(&root).exists());
        simulate_restart(&root);
        let restarted = load_snapshot(&root);
        assert!(restarted.snapshot.cache().entries.is_empty());
        assert!(restarted.warning.is_none());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn clear_failure_is_reported_and_stale_publication_remains_blocked() {
        let root = test_archive("clear-failure");
        initialize(&root, &[("Book.epub", 1)]);
        let stale = load_snapshot(&root);
        force_cache_save_failure(&root, true);
        invalidate_paths(&root, &["Book.epub".to_string()]);
        force_cache_save_failure(&root, false);
        assert!(invalidation_path(&root).exists());
        let cache_path = root
            .join(metadata::METADATA_DIRECTORY)
            .join(metadata::SCANNER_CACHE_FILE);
        fs::remove_file(&cache_path).expect("cache file should be removable");
        fs::create_dir(&cache_path).expect("cache path directory should force clear failure");

        let error = clear(&root).expect_err("clear failure should be reported");
        assert!(error.contains("scanner cache removal failed"));
        assert!(invalidation_path(&root).exists());
        let mut proposed = ScannerCache::default();
        proposed.entries.insert("Book.epub".to_string(), entry(1));
        publish_snapshot(
            &root,
            &stale.snapshot,
            &proposed,
            ScannerCachePublicationScope::Full,
        )
        .expect("publication predating failed clear should remain blocked");
        assert!(cache_path.is_dir());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn clear_reports_journal_removal_failure_without_clearing_process_state() {
        let root = test_archive("clear-journal-failure");
        initialize(&root, &[("Book.epub", 1)]);
        force_cache_save_failure(&root, true);
        invalidate_paths(&root, &["Book.epub".to_string()]);
        force_cache_save_failure(&root, false);
        assert!(invalidation_path(&root).exists());

        force_invalidation_save_failure(&root, true);
        let error = clear(&root).expect_err("journal clear failure should be reported");
        force_invalidation_save_failure(&root, false);

        assert!(error.contains("invalidation journal removal failed"));
        assert!(invalidation_path(&root).exists());
        let current = load_snapshot(&root);
        assert!(!current.snapshot.cache().entries.contains_key("Book.epub"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }
}
