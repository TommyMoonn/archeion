use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Condvar, Mutex,
    },
    time::{Duration, Instant},
};

use notify::{
    event::ModifyKind, Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
};
use serde::Serialize;
use tauri::{Emitter, State};

use super::{archive_import_artifacts, archive_root, metadata, scanner_cache};

const ARCHIVE_CHANGED_EVENT: &str = "archive://changed";
const ARCHIVE_WATCHER_ERROR_EVENT: &str = "archive://watcher-error";
const METADATA_DIRECTORY: &str = ".archeion";
const IMPORT_SUPPRESSION_TAIL: Duration = Duration::from_secs(2);
const MAX_RECORDED_SUPPRESSED_CHANGES: usize = 64;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct ImportSuppressionKey {
    root: String,
    relative_path: String,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SuppressedWatcherChange {
    pub(crate) kind: &'static str,
    pub(crate) relative_paths: Vec<String>,
}

#[derive(Clone, Debug)]
struct RecordedSuppressedWatcherChange {
    sequence: u64,
    change: SuppressedWatcherChange,
}

#[derive(Clone, Debug)]
struct ImportSuppressionEntry {
    active_count: usize,
    expires_at: Instant,
    dirty_changes: Vec<RecordedSuppressedWatcherChange>,
    expiry_revision: u64,
}

type TailEventEmitter = Arc<dyn Fn(ArchiveWatcherEvent) + Send + Sync>;

#[derive(Clone)]
struct TailEmitterRegistration {
    root: String,
    emit: TailEventEmitter,
}

#[derive(Default)]
struct SuppressionRegistryState {
    entries: HashMap<ImportSuppressionKey, ImportSuppressionEntry>,
    tail_emitter: Option<TailEmitterRegistration>,
    worker_running: bool,
    worker_starts: usize,
    next_event_sequence: u64,
}

#[derive(Default)]
struct SuppressionRegistry {
    state: Mutex<SuppressionRegistryState>,
    wake: Condvar,
}

#[derive(Clone, Default)]
pub(crate) struct ArchiveWatcherSuppressionOwner {
    registry: Arc<SuppressionRegistry>,
}

pub(crate) struct ArchiveWatcherSuppressionGuard {
    owner: ArchiveWatcherSuppressionOwner,
    keys: Vec<ImportSuppressionKey>,
    finished: bool,
}

fn import_suppression_root_identity(root: &Path) -> (String, bool) {
    let normalized = root.to_string_lossy().replace('\\', "/");
    let bytes = normalized.as_bytes();
    let windows_semantics = cfg!(windows)
        || normalized.starts_with("//")
        || (bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':');
    let identity = if windows_semantics {
        normalized.to_lowercase()
    } else {
        normalized
    };
    (identity, windows_semantics)
}

fn import_suppression_path_identity(relative_path: &str, case_insensitive: bool) -> String {
    let normalized = relative_path
        .replace('\\', "/")
        .trim_matches('/')
        .to_string();
    if case_insensitive {
        normalized.to_lowercase()
    } else {
        normalized
    }
}

impl ArchiveWatcherSuppressionOwner {
    fn drain_expired_at(&self, now: Instant) -> Vec<(String, SuppressedWatcherChange)> {
        let Ok(mut state) = self.registry.state.lock() else {
            return Vec::new();
        };
        drain_expired_entries(&mut state, now)
    }

    fn emit_expired_at(&self, now: Instant) {
        let expired = self.drain_expired_at(now);
        let emitter = self
            .registry
            .state
            .lock()
            .ok()
            .and_then(|state| state.tail_emitter.clone());
        for (root, change) in expired {
            if let Some(emitter) = emitter.as_ref().filter(|emitter| emitter.root == root) {
                (emitter.emit)(ArchiveWatcherEvent {
                    kind: change.kind,
                    relative_paths: change.relative_paths,
                    overflow: false,
                });
            }
        }
    }

    #[cfg(test)]
    fn expired_events_at(&self, now: Instant) -> Vec<ArchiveWatcherEvent> {
        self.drain_expired_at(now)
            .into_iter()
            .map(|(_, change)| ArchiveWatcherEvent {
                kind: change.kind,
                relative_paths: change.relative_paths,
                overflow: false,
            })
            .collect()
    }

    fn ensure_expiry_worker(&self) {
        let should_start = {
            let Ok(mut state) = self.registry.state.lock() else {
                return;
            };
            if state.worker_running || earliest_tail_expiry(&state).is_none() {
                false
            } else {
                state.worker_running = true;
                state.worker_starts += 1;
                true
            }
        };
        self.registry.wake.notify_all();
        if should_start {
            let owner = self.clone();
            std::thread::spawn(move || owner.run_expiry_worker());
        }
    }

    fn run_expiry_worker(&self) {
        loop {
            let (expired, emitter) = {
                let Ok(mut state) = self.registry.state.lock() else {
                    return;
                };
                loop {
                    let Some(expires_at) = earliest_tail_expiry(&state) else {
                        state.worker_running = false;
                        self.registry.wake.notify_all();
                        return;
                    };
                    let now = Instant::now();
                    if expires_at <= now {
                        let expired = drain_expired_entries(&mut state, now);
                        let emitter = state.tail_emitter.clone();
                        break (expired, emitter);
                    }
                    let wait = expires_at.saturating_duration_since(now);
                    let Ok((next_state, _)) = self.registry.wake.wait_timeout(state, wait) else {
                        return;
                    };
                    state = next_state;
                }
            };

            for (root, change) in expired {
                if let Some(emitter) = emitter.as_ref().filter(|emitter| emitter.root == root) {
                    (emitter.emit)(ArchiveWatcherEvent {
                        kind: change.kind,
                        relative_paths: change.relative_paths,
                        overflow: false,
                    });
                }
            }
        }
    }

    fn install_tail_emitter(&self, root: &Path, emit: TailEventEmitter) {
        let (root, _) = import_suppression_root_identity(root);
        if let Ok(mut state) = self.registry.state.lock() {
            state.tail_emitter = Some(TailEmitterRegistration { root, emit });
        }
        self.registry.wake.notify_all();
        self.ensure_expiry_worker();
    }

    fn clear_tail_emitter(&self, root: &Path) {
        let (root, _) = import_suppression_root_identity(root);
        if let Ok(mut state) = self.registry.state.lock() {
            if state
                .tail_emitter
                .as_ref()
                .is_some_and(|emitter| emitter.root == root)
            {
                state.tail_emitter = None;
                state
                    .entries
                    .retain(|key, entry| key.root != root || entry.active_count > 0);
                for (key, entry) in &mut state.entries {
                    if key.root == root {
                        entry.dirty_changes.clear();
                    }
                }
            }
        }
        self.registry.wake.notify_all();
    }

    fn begin_at(
        &self,
        root: &Path,
        relative_paths: &[String],
        now: Instant,
    ) -> Result<ArchiveWatcherSuppressionGuard, String> {
        let (root, case_insensitive) = import_suppression_root_identity(root);
        let mut unique_paths = HashSet::new();
        let keys = relative_paths
            .iter()
            .filter_map(|relative_path| {
                let relative_path =
                    import_suppression_path_identity(relative_path, case_insensitive);
                unique_paths
                    .insert(relative_path.clone())
                    .then_some(ImportSuppressionKey {
                        root: root.clone(),
                        relative_path,
                    })
            })
            .collect::<Vec<_>>();

        self.emit_expired_at(now);
        let mut state = self.registry.state.lock().map_err(|_| {
            "The native watcher suppression registry is unavailable because a previous operation panicked."
                .to_string()
        })?;
        state
            .entries
            .retain(|_, entry| entry.active_count > 0 || entry.expires_at > now);
        for key in &keys {
            let entry = state
                .entries
                .entry(key.clone())
                .or_insert(ImportSuppressionEntry {
                    active_count: 0,
                    expires_at: now,
                    dirty_changes: Vec::new(),
                    expiry_revision: 0,
                });
            entry.active_count += 1;
            entry.expires_at = now;
            entry.expiry_revision = entry.expiry_revision.wrapping_add(1);
        }
        drop(state);
        self.registry.wake.notify_all();

        Ok(ArchiveWatcherSuppressionGuard {
            owner: self.clone(),
            keys,
            finished: false,
        })
    }

    pub(crate) fn begin(
        &self,
        root: &Path,
        relative_paths: &[String],
    ) -> Result<ArchiveWatcherSuppressionGuard, String> {
        self.begin_at(root, relative_paths, Instant::now())
    }

    #[cfg(test)]
    fn is_suppressed_at(&self, root: &Path, relative_path: &str, now: Instant) -> bool {
        self.emit_expired_at(now);
        let (root, case_insensitive) = import_suppression_root_identity(root);
        let key = ImportSuppressionKey {
            root,
            relative_path: import_suppression_path_identity(relative_path, case_insensitive),
        };
        let Ok(state) = self.registry.state.lock() else {
            return false;
        };
        state
            .entries
            .get(&key)
            .is_some_and(|entry| entry.active_count > 0 || entry.expires_at > now)
    }

    fn record_event_at(
        &self,
        root: &Path,
        kind: &'static str,
        relative_paths: &[String],
        now: Instant,
    ) -> HashSet<String> {
        self.emit_expired_at(now);
        let (root, case_insensitive) = import_suppression_root_identity(root);
        let mut matched = HashSet::new();
        let Ok(mut state) = self.registry.state.lock() else {
            return matched;
        };
        let mut matched_keys = Vec::new();

        for relative_path in relative_paths {
            let relative_path = import_suppression_path_identity(relative_path, case_insensitive);
            let key = ImportSuppressionKey {
                root: root.clone(),
                relative_path: relative_path.clone(),
            };
            let Some(entry) = state.entries.get_mut(&key) else {
                continue;
            };
            if entry.active_count == 0 && entry.expires_at <= now {
                continue;
            }
            matched.insert(relative_path.clone());
            matched_keys.push(key);
        }
        if matched_keys.is_empty() {
            return matched;
        }

        state.next_event_sequence = state.next_event_sequence.wrapping_add(1);
        let sequence = state.next_event_sequence;
        let folded_paths = if kind == "rename" || kind == "unknown" {
            relative_paths.to_vec()
        } else {
            relative_paths
                .iter()
                .filter(|path| {
                    matched.contains(&import_suppression_path_identity(path, case_insensitive))
                })
                .cloned()
                .collect()
        };
        let incoming = SuppressedWatcherChange {
            kind,
            relative_paths: folded_paths,
        };
        for key in &matched_keys {
            if let Some(entry) = state.entries.get_mut(key) {
                record_suppressed_change(entry, sequence, &incoming);
            }
        }
        let has_inactive_match = matched.iter().any(|relative_path| {
            state
                .entries
                .get(&ImportSuppressionKey {
                    root: root.clone(),
                    relative_path: relative_path.clone(),
                })
                .is_some_and(|entry| entry.active_count == 0)
        });
        drop(state);
        if has_inactive_match {
            self.ensure_expiry_worker();
        }
        matched
    }

    #[cfg(test)]
    pub(crate) fn is_suppressed(&self, root: &Path, relative_path: &str) -> bool {
        self.is_suppressed_at(root, relative_path, Instant::now())
    }

    #[cfg(test)]
    pub(crate) fn is_actively_suppressed(&self, root: &Path, relative_path: &str) -> bool {
        let (root, case_insensitive) = import_suppression_root_identity(root);
        let key = ImportSuppressionKey {
            root,
            relative_path: import_suppression_path_identity(relative_path, case_insensitive),
        };
        self.registry
            .state
            .lock()
            .ok()
            .and_then(|state| state.entries.get(&key).cloned())
            .is_some_and(|entry| entry.active_count > 0)
    }

    #[cfg(test)]
    pub(crate) fn record_test_event(
        &self,
        root: &Path,
        kind: &'static str,
        relative_paths: &[String],
    ) -> bool {
        !self
            .record_event_at(root, kind, relative_paths, Instant::now())
            .is_empty()
    }

    #[cfg(test)]
    fn worker_start_count(&self) -> usize {
        self.registry
            .state
            .lock()
            .map(|state| state.worker_starts)
            .unwrap_or_default()
    }

    #[cfg(test)]
    fn worker_is_running(&self) -> bool {
        self.registry
            .state
            .lock()
            .map(|state| state.worker_running)
            .unwrap_or(false)
    }

    #[cfg(test)]
    fn entry_count(&self) -> usize {
        self.registry
            .state
            .lock()
            .map(|state| state.entries.len())
            .unwrap_or_default()
    }

    #[cfg(test)]
    fn wait_until_worker_idle(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        let Ok(mut state) = self.registry.state.lock() else {
            return false;
        };
        while state.worker_running {
            let now = Instant::now();
            if now >= deadline {
                return false;
            }
            let Ok((next_state, wait)) = self
                .registry
                .wake
                .wait_timeout(state, deadline.saturating_duration_since(now))
            else {
                return false;
            };
            state = next_state;
            if wait.timed_out() && state.worker_running {
                return false;
            }
        }
        true
    }
}

fn record_suppressed_change(
    entry: &mut ImportSuppressionEntry,
    sequence: u64,
    incoming: &SuppressedWatcherChange,
) {
    if entry
        .dirty_changes
        .last()
        .is_some_and(|recorded| recorded.change == *incoming)
    {
        return;
    }
    if entry.dirty_changes.len() >= MAX_RECORDED_SUPPRESSED_CHANGES {
        let mut paths = entry
            .dirty_changes
            .iter()
            .flat_map(|recorded| recorded.change.relative_paths.iter().cloned())
            .collect::<Vec<_>>();
        paths.extend(incoming.relative_paths.iter().cloned());
        paths.sort();
        paths.dedup();
        entry.dirty_changes.clear();
        entry.dirty_changes.push(RecordedSuppressedWatcherChange {
            sequence,
            change: SuppressedWatcherChange {
                kind: "unknown",
                relative_paths: paths,
            },
        });
        return;
    }
    entry.dirty_changes.push(RecordedSuppressedWatcherChange {
        sequence,
        change: incoming.clone(),
    });
}

fn ordered_suppressed_changes(
    recorded: impl IntoIterator<Item = RecordedSuppressedWatcherChange>,
) -> Vec<SuppressedWatcherChange> {
    let mut ordered = BTreeMap::new();
    for recorded in recorded {
        match ordered.entry(recorded.sequence) {
            std::collections::btree_map::Entry::Vacant(entry) => {
                entry.insert(recorded.change);
            }
            std::collections::btree_map::Entry::Occupied(mut entry)
                if entry.get() != &recorded.change =>
            {
                let mut paths = entry.get().relative_paths.clone();
                paths.extend(recorded.change.relative_paths);
                paths.sort();
                paths.dedup();
                entry.insert(SuppressedWatcherChange {
                    kind: "unknown",
                    relative_paths: paths,
                });
            }
            std::collections::btree_map::Entry::Occupied(_) => {}
        }
    }
    ordered
        .into_values()
        .fold(Vec::new(), |mut changes, change| {
            if changes.last() != Some(&change) {
                changes.push(change);
            }
            changes
        })
}

fn earliest_tail_expiry(state: &SuppressionRegistryState) -> Option<Instant> {
    let emitter_root = state.tail_emitter.as_ref()?.root.as_str();
    state
        .entries
        .iter()
        .filter(|(key, entry)| key.root == emitter_root && entry.active_count == 0)
        .map(|(_, entry)| entry.expires_at)
        .min()
}

fn drain_expired_entries(
    state: &mut SuppressionRegistryState,
    now: Instant,
) -> Vec<(String, SuppressedWatcherChange)> {
    let expired_keys = state
        .entries
        .iter()
        .filter_map(|(key, entry)| {
            (entry.active_count == 0 && entry.expires_at <= now).then_some(key.clone())
        })
        .collect::<Vec<_>>();
    let mut changes_by_root = HashMap::<String, Vec<RecordedSuppressedWatcherChange>>::new();
    for key in expired_keys {
        if let Some(entry) = state.entries.remove(&key) {
            changes_by_root
                .entry(key.root)
                .or_default()
                .extend(entry.dirty_changes);
        }
    }
    changes_by_root
        .into_iter()
        .flat_map(|(root, changes)| {
            ordered_suppressed_changes(changes)
                .into_iter()
                .map(move |change| (root.clone(), change))
        })
        .collect()
}

impl ArchiveWatcherSuppressionGuard {
    fn release_at(&mut self, now: Instant, fold_dirty: bool) -> Vec<SuppressedWatcherChange> {
        if self.finished {
            return Vec::new();
        }
        self.finished = true;
        let Ok(mut state) = self.owner.registry.state.lock() else {
            return Vec::new();
        };
        let mut folded_changes = Vec::new();
        let mut should_schedule = false;
        for key in &self.keys {
            let Some(entry) = state.entries.get_mut(key) else {
                continue;
            };
            entry.active_count = entry.active_count.saturating_sub(1);
            if entry.active_count == 0 {
                entry.expires_at = now + IMPORT_SUPPRESSION_TAIL;
                entry.expiry_revision = entry.expiry_revision.wrapping_add(1);
                should_schedule = true;
                if fold_dirty {
                    folded_changes.append(&mut entry.dirty_changes);
                }
            }
        }
        drop(state);
        self.owner.registry.wake.notify_all();
        if should_schedule {
            self.owner.ensure_expiry_worker();
        }
        ordered_suppressed_changes(folded_changes)
    }

    fn finish_at(&mut self, now: Instant) -> Vec<SuppressedWatcherChange> {
        self.release_at(now, true)
    }

    pub(crate) fn finish(mut self) -> Vec<SuppressedWatcherChange> {
        self.finish_at(Instant::now())
    }
}

impl Drop for ArchiveWatcherSuppressionGuard {
    fn drop(&mut self) {
        let _ = self.release_at(Instant::now(), false);
    }
}

#[derive(Default)]
pub struct ArchiveWatcherState {
    watcher: Mutex<Option<ActiveArchiveWatcher>>,
    next_id: AtomicU64,
    import_suppressions: ArchiveWatcherSuppressionOwner,
}

impl ArchiveWatcherState {
    pub(crate) fn with_import_suppressions(
        import_suppressions: ArchiveWatcherSuppressionOwner,
    ) -> Self {
        Self {
            watcher: Mutex::default(),
            next_id: AtomicU64::default(),
            import_suppressions,
        }
    }

    fn next_watcher_id(&self) -> String {
        let sequence = self.next_id.fetch_add(1, Ordering::Relaxed) + 1;
        format!("archive-watcher-{sequence}")
    }

    pub(crate) fn import_suppression_owner(&self) -> ArchiveWatcherSuppressionOwner {
        self.import_suppressions.clone()
    }
}

struct ActiveArchiveWatcher {
    id: String,
    root: PathBuf,
    _watcher: RecommendedWatcher,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveWatcherEvent {
    kind: &'static str,
    relative_paths: Vec<String>,
    overflow: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ArchiveWatcherError {
    message: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
enum WatchPathPrefix {
    Drive(String),
    Relative,
    Unc(String, String),
    Unix,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ParsedWatchPath {
    components: Vec<String>,
    prefix: WatchPathPrefix,
    windows_semantics: bool,
}

fn strip_ascii_case_prefix<'a>(value: &'a str, prefix: &str) -> Option<&'a str> {
    value
        .get(..prefix.len())
        .filter(|candidate| candidate.eq_ignore_ascii_case(prefix))
        .map(|_| &value[prefix.len()..])
}

fn normalized_components(value: &str) -> Option<Vec<String>> {
    let components = value
        .split('/')
        .filter(|component| !component.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    if components
        .iter()
        .any(|component| component == "." || component == ".." || component.contains('\0'))
    {
        return None;
    }
    Some(components)
}

fn parse_watch_path(path: &Path) -> Option<ParsedWatchPath> {
    let replaced = path.to_str()?.replace('\\', "/");
    let normalized = if let Some(remainder) = strip_ascii_case_prefix(&replaced, "//?/UNC/") {
        format!("//{remainder}")
    } else if let Some(remainder) = strip_ascii_case_prefix(&replaced, "//?/") {
        remainder.to_string()
    } else {
        replaced
    };

    if let Some(remainder) = normalized.strip_prefix("//") {
        let mut components = normalized_components(remainder)?;
        if components.len() < 2 {
            return None;
        }
        let share = components.remove(1);
        let server = components.remove(0);
        return Some(ParsedWatchPath {
            components,
            prefix: WatchPathPrefix::Unc(server, share),
            windows_semantics: true,
        });
    }

    let bytes = normalized.as_bytes();
    if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'/' {
        return Some(ParsedWatchPath {
            components: normalized_components(&normalized[3..])?,
            prefix: WatchPathPrefix::Drive(normalized[..1].to_ascii_uppercase()),
            windows_semantics: true,
        });
    }

    if let Some(remainder) = normalized.strip_prefix('/') {
        return Some(ParsedWatchPath {
            components: normalized_components(remainder)?,
            prefix: WatchPathPrefix::Unix,
            windows_semantics: false,
        });
    }

    Some(ParsedWatchPath {
        components: normalized_components(&normalized)?,
        prefix: WatchPathPrefix::Relative,
        windows_semantics: false,
    })
}

fn path_prefixes_match(root: &ParsedWatchPath, path: &ParsedWatchPath) -> bool {
    match (&root.prefix, &path.prefix) {
        (WatchPathPrefix::Drive(left), WatchPathPrefix::Drive(right)) => {
            left.eq_ignore_ascii_case(right)
        }
        (
            WatchPathPrefix::Unc(left_server, left_share),
            WatchPathPrefix::Unc(right_server, right_share),
        ) => {
            left_server.eq_ignore_ascii_case(right_server)
                && left_share.eq_ignore_ascii_case(right_share)
        }
        (WatchPathPrefix::Relative, WatchPathPrefix::Relative)
        | (WatchPathPrefix::Unix, WatchPathPrefix::Unix) => true,
        _ => false,
    }
}

fn path_component_matches(left: &str, right: &str, case_insensitive: bool) -> bool {
    if case_insensitive {
        left.eq_ignore_ascii_case(right)
    } else {
        left == right
    }
}

fn archive_relative_path(root: &Path, path: &Path) -> Option<String> {
    let root = parse_watch_path(root)?;
    let path = parse_watch_path(path)?;
    if !path_prefixes_match(&root, &path) || root.components.len() > path.components.len() {
        return None;
    }

    let case_insensitive = root.windows_semantics || path.windows_semantics;
    if !root
        .components
        .iter()
        .zip(&path.components)
        .all(|(root_component, path_component)| {
            path_component_matches(root_component, path_component, case_insensitive)
        })
    {
        return None;
    }

    Some(path.components[root.components.len()..].join("/"))
}

fn relative_path_is_inside_metadata_directory(relative_path: &str) -> bool {
    relative_path
        .split('/')
        .next()
        .is_some_and(|component| component.eq_ignore_ascii_case(METADATA_DIRECTORY))
}

fn relative_path_is_scanner_cache_artifact(relative_path: &str) -> bool {
    let mut components = relative_path.split('/');
    if !components
        .next()
        .is_some_and(|component| component.eq_ignore_ascii_case(METADATA_DIRECTORY))
    {
        return false;
    }
    components.next().is_some_and(|file_name| {
        [
            metadata::SCANNER_CACHE_FILE,
            scanner_cache::INVALIDATION_FILE,
        ]
        .iter()
        .any(|artifact_name| {
            file_name
                .get(..artifact_name.len())
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case(artifact_name))
        })
    })
}

fn path_may_affect_archive(relative_path: &str, path: &Path) -> bool {
    if relative_path_is_scanner_cache_artifact(relative_path) {
        return false;
    }
    if relative_path_is_inside_metadata_directory(relative_path) {
        return true;
    }
    if relative_path.is_empty() {
        return true;
    }

    if Path::new(relative_path)
        .extension()
        .is_some_and(|extension| extension.to_string_lossy().eq_ignore_ascii_case("epub"))
    {
        return true;
    }

    if path.exists() {
        return path.is_dir() || path.extension().is_none();
    }

    true
}

struct EventRelativePaths {
    relative_paths: Vec<String>,
    unresolved: bool,
}

fn is_internal_import_transaction_rename(root: &Path, event: &Event) -> bool {
    if !matches!(event.kind, EventKind::Modify(ModifyKind::Name(_))) || event.paths.len() != 2 {
        return false;
    }

    let Some(first) = archive_relative_path(root, &event.paths[0]) else {
        return false;
    };
    let Some(second) = archive_relative_path(root, &event.paths[1]) else {
        return false;
    };
    let (_, case_insensitive) = import_suppression_root_identity(root);
    let identity = |path: &str| import_suppression_path_identity(path, case_insensitive);
    let matches_artifact_destination = |artifact_path: &str, destination_path: &str| {
        archive_import_artifacts::archive_import_artifact_destination_relative_path(artifact_path)
            .is_some_and(|destination| identity(&destination) == identity(destination_path))
    };

    matches_artifact_destination(&first, &second) || matches_artifact_destination(&second, &first)
}

fn event_relative_paths(root: &Path, event: &Event) -> EventRelativePaths {
    let mut relative_paths = Vec::new();
    let mut unresolved = false;

    for path in &event.paths {
        let Some(relative_path) = archive_relative_path(root, path) else {
            unresolved = true;
            continue;
        };
        if archive_import_artifacts::is_archive_import_artifact_relative_path(&relative_path) {
            continue;
        }
        if path_may_affect_archive(&relative_path, path) {
            relative_paths.push(relative_path);
        }
    }

    EventRelativePaths {
        relative_paths,
        unresolved,
    }
}

fn event_kind_for_payload(event: &Event, relative_paths: &[String]) -> &'static str {
    if relative_paths
        .iter()
        .any(|path| relative_path_is_inside_metadata_directory(path))
    {
        return "metadata";
    }

    match &event.kind {
        EventKind::Create(_) => "create",
        EventKind::Modify(ModifyKind::Name(_)) => "rename",
        EventKind::Modify(_) => "modify",
        EventKind::Remove(_) => "remove",
        _ => "unknown",
    }
}

fn overflow_watcher_event() -> ArchiveWatcherEvent {
    ArchiveWatcherEvent {
        kind: "unknown",
        relative_paths: Vec::new(),
        overflow: true,
    }
}

fn watcher_event_with_suppression(
    root: &Path,
    event: &Event,
    suppressions: Option<&ArchiveWatcherSuppressionOwner>,
    now: Instant,
) -> Option<ArchiveWatcherEvent> {
    if is_internal_import_transaction_rename(root, event) {
        return None;
    }

    let mut paths = event_relative_paths(root, event);
    if paths.unresolved {
        return Some(overflow_watcher_event());
    }
    if paths.relative_paths.is_empty() {
        return None;
    }
    let kind = event_kind_for_payload(event, &paths.relative_paths);
    if let Some(owner) = suppressions {
        let suppressed = owner.record_event_at(root, kind, &paths.relative_paths, now);
        if !suppressed.is_empty() {
            if kind == "rename" {
                return None;
            }
            let (_, case_insensitive) = import_suppression_root_identity(root);
            paths.relative_paths.retain(|relative_path| {
                !suppressed.contains(&import_suppression_path_identity(
                    relative_path,
                    case_insensitive,
                ))
            });
            if paths.relative_paths.is_empty() {
                return None;
            }
        }
    }
    Some(ArchiveWatcherEvent {
        kind,
        relative_paths: paths.relative_paths,
        overflow: false,
    })
}

#[cfg(test)]
fn watcher_event(root: &Path, event: &Event) -> Option<ArchiveWatcherEvent> {
    watcher_event_with_suppression(root, event, None, Instant::now())
}

#[tauri::command]
pub fn start_archive_watcher(
    app: tauri::AppHandle,
    state: State<'_, ArchiveWatcherState>,
) -> Result<String, String> {
    let root = archive_root::read_archive_path(&app)?
        .map(PathBuf::from)
        .ok_or_else(|| "No archive folder has been selected.".to_string())?;

    if !root.is_dir() {
        return Err("The selected archive folder is unavailable.".to_string());
    }

    let canonical_root = root.canonicalize().unwrap_or(root);
    let mut guard = state.watcher.lock().map_err(|error| error.to_string())?;
    if let Some(active) = guard
        .as_ref()
        .filter(|active| active.root == canonical_root)
    {
        return Ok(active.id.clone());
    }

    if let Some(active) = guard.take() {
        state.import_suppressions.clear_tail_emitter(&active.root);
    }

    let emit_app = app.clone();
    let tail_emit_app = app.clone();
    let watched_root = canonical_root.clone();
    let import_suppressions = state.import_suppression_owner();
    let mut watcher = RecommendedWatcher::new(
        move |result: notify::Result<Event>| match result {
            Ok(event) => {
                if let Some(payload) = watcher_event_with_suppression(
                    &watched_root,
                    &event,
                    Some(&import_suppressions),
                    Instant::now(),
                ) {
                    let _ = emit_app.emit(ARCHIVE_CHANGED_EVENT, payload);
                }
            }
            Err(error) => {
                let _ = emit_app.emit(
                    ARCHIVE_WATCHER_ERROR_EVENT,
                    ArchiveWatcherError {
                        message: error.to_string(),
                    },
                );
                let _ = emit_app.emit(ARCHIVE_CHANGED_EVENT, overflow_watcher_event());
            }
        },
        Config::default(),
    )
    .map_err(|error| error.to_string())?;

    watcher
        .watch(&canonical_root, RecursiveMode::Recursive)
        .map_err(|error| error.to_string())?;
    state.import_suppressions.install_tail_emitter(
        &canonical_root,
        Arc::new(move |payload| {
            let _ = tail_emit_app.emit(ARCHIVE_CHANGED_EVENT, payload);
        }),
    );

    let watcher_id = state.next_watcher_id();
    *guard = Some(ActiveArchiveWatcher {
        id: watcher_id.clone(),
        root: canonical_root,
        _watcher: watcher,
    });

    Ok(watcher_id)
}

#[tauri::command]
pub fn stop_archive_watcher(
    state: State<'_, ArchiveWatcherState>,
    watcher_id: String,
) -> Result<(), String> {
    let mut guard = state.watcher.lock().map_err(|error| error.to_string())?;
    if guard.as_ref().is_some_and(|active| active.id == watcher_id) {
        if let Some(active) = guard.take() {
            state.import_suppressions.clear_tail_emitter(&active.root);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use std::{
        path::{Path, PathBuf},
        sync::{mpsc, Arc},
        time::{Duration, Instant},
    };

    use notify::{event::ModifyKind, Event, EventKind};

    use super::{
        archive_relative_path, path_may_affect_archive, watcher_event,
        watcher_event_with_suppression, ArchiveWatcherSuppressionOwner, IMPORT_SUPPRESSION_TAIL,
    };

    fn rename_event(paths: &[&str]) -> Event {
        let mut event = Event::new(EventKind::Modify(ModifyKind::Name(
            notify::event::RenameMode::Both,
        )));
        event
            .paths
            .extend(paths.iter().map(|path| PathBuf::from(*path)));
        event
    }

    #[test]
    fn normalizes_extended_and_normal_windows_drive_paths() {
        assert_eq!(
            archive_relative_path(
                Path::new(r"C:\Books\Archive"),
                Path::new(r"\\?\C:\Books\Archive\Author\Book.epub")
            ),
            Some("Author/Book.epub".to_string())
        );
        assert_eq!(
            archive_relative_path(
                Path::new(r"\\?\C:\Books\Archive"),
                Path::new(r"c:/books/archive/Book.epub")
            ),
            Some("Book.epub".to_string())
        );
    }

    #[test]
    fn normalizes_extended_and_normal_unc_paths() {
        assert_eq!(
            archive_relative_path(
                Path::new(r"\\server\share\Archive"),
                Path::new(r"\\?\UNC\SERVER\SHARE\Archive\Book.epub")
            ),
            Some("Book.epub".to_string())
        );
        assert_eq!(
            archive_relative_path(
                Path::new(r"\\?\UNC\server\share\Archive"),
                Path::new(r"//server/share/archive/Author/Book.epub")
            ),
            Some("Author/Book.epub".to_string())
        );
    }

    #[test]
    fn normalizes_mixed_slashes_unicode_and_root_level_epubs() {
        assert_eq!(
            archive_relative_path(
                Path::new(r"C:\Books/Archive"),
                Path::new(r"c:/books\archive/作者\本.epub")
            ),
            Some("作者/本.epub".to_string())
        );
        assert_eq!(
            archive_relative_path(
                Path::new(r"C:\Books\Archive"),
                Path::new(r"C:\Books\Archive\Root.epub")
            ),
            Some("Root.epub".to_string())
        );
    }

    #[test]
    fn rejects_paths_outside_the_archive_by_component_boundary() {
        assert_eq!(
            archive_relative_path(
                Path::new(r"C:\Books\Archive"),
                Path::new(r"C:\Books\Archive-Other\Book.epub")
            ),
            None
        );
        let event = rename_event(&[r"C:\Books\Archive\Old.epub", r"C:\Outside\New.epub"]);
        let payload = watcher_event(Path::new(r"C:\Books\Archive"), &event)
            .expect("unresolved watcher paths should force fallback");
        assert_eq!(payload.kind, "unknown");
        assert!(payload.relative_paths.is_empty());
        assert!(payload.overflow);
    }

    #[test]
    fn preserves_rename_pair_order() {
        let event = rename_event(&[
            r"C:\Books\Archive\Author\Old.epub",
            r"C:\Books\Archive\Author\New.epub",
        ]);
        let payload = watcher_event(Path::new(r"C:\Books\Archive"), &event)
            .expect("rename should be reported");
        assert_eq!(payload.kind, "rename");
        assert_eq!(
            payload.relative_paths,
            ["Author/Old.epub", "Author/New.epub"]
        );
    }

    #[test]
    fn records_the_independent_payload_count_for_a_two_thousand_event_watcher_burst() {
        let root = Path::new(r"C:\Books\Archive");
        let mut payload_count = 0;

        for index in 0..2_000 {
            let mut event = Event::new(EventKind::Modify(ModifyKind::Data(
                notify::event::DataChange::Any,
            )));
            event.paths.push(PathBuf::from(format!(
                r"C:\Books\Archive\Book-{index:04}.epub"
            )));
            let payload = watcher_event(root, &event).expect("EPUB change should be visible");
            payload_count += 1;
            assert_eq!(payload.relative_paths.len(), 1);
        }

        assert_eq!(payload_count, 2_000);
    }

    #[test]
    fn identifies_metadata_paths_but_ignores_scanner_cache_artifacts() {
        let root = PathBuf::from("/archive");
        let mut metadata = Event::new(EventKind::Modify(ModifyKind::Data(
            notify::event::DataChange::Any,
        )));
        metadata.paths.push(root.join(".archeion/library.json"));
        let payload = watcher_event(&root, &metadata).expect("metadata should be reported");
        assert_eq!(payload.kind, "metadata");
        assert_eq!(payload.relative_paths, [".archeion/library.json"]);

        let mut scanner_cache = Event::new(EventKind::Modify(ModifyKind::Data(
            notify::event::DataChange::Any,
        )));
        scanner_cache
            .paths
            .push(root.join(".archeion/scanner-cache.json.tmp-write-1"));
        assert!(watcher_event(&root, &scanner_cache).is_none());

        let mut invalidation_journal = Event::new(EventKind::Modify(ModifyKind::Data(
            notify::event::DataChange::Any,
        )));
        invalidation_journal
            .paths
            .push(root.join(".archeion/scanner-cache-invalidations.json.tmp-write-1"));
        assert!(watcher_event(&root, &invalidation_journal).is_none());

        let mut invalidation_backup = Event::new(EventKind::Modify(ModifyKind::Data(
            notify::event::DataChange::Any,
        )));
        invalidation_backup
            .paths
            .push(root.join(".archeion/scanner-cache-invalidations.json.write-backup-1"));
        assert!(watcher_event(&root, &invalidation_backup).is_none());
    }

    #[test]
    fn filters_existing_non_epub_files_but_keeps_archive_paths() {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-watcher-filter-{nonce}"));
        std::fs::create_dir_all(root.join("Author/Series.v1"))
            .expect("test directory should be created");
        std::fs::write(root.join("notes.txt"), b"notes").expect("test file should be written");

        assert!(!path_may_affect_archive(
            "notes.txt",
            &root.join("notes.txt")
        ));
        assert!(path_may_affect_archive(
            "Author/Book.epub",
            &root.join("Author/Book.epub")
        ));
        assert!(path_may_affect_archive(
            "Author/Series.v1",
            &root.join("Author/Series.v1")
        ));
        assert!(path_may_affect_archive(
            "Author/Deleted.Series.v1",
            &root.join("Author/Deleted.Series.v1")
        ));

        std::fs::remove_dir_all(root).expect("test directory should be removed");
    }

    #[test]
    fn suppresses_exact_planned_import_paths_and_keeps_unrelated_events_visible() {
        let root = Path::new(r"C:\Books\Archive");
        let owner = ArchiveWatcherSuppressionOwner::default();
        let now = Instant::now();
        let mut guard = owner
            .begin_at(root, &["Novel (2).epub".to_string()], now)
            .unwrap();
        let mut planned = Event::new(EventKind::Create(notify::event::CreateKind::File));
        planned
            .paths
            .push(PathBuf::from(r"C:\Books\Archive\Novel (2).epub"));
        let mut external = Event::new(EventKind::Create(notify::event::CreateKind::File));
        external
            .paths
            .push(PathBuf::from(r"C:\Books\Archive\External.epub"));

        assert!(watcher_event_with_suppression(root, &planned, Some(&owner), now).is_none());
        assert_eq!(
            watcher_event_with_suppression(root, &external, Some(&owner), now)
                .unwrap()
                .relative_paths,
            vec!["External.epub"]
        );

        let finished_at = now + Duration::from_millis(10);
        guard.finish_at(finished_at);
        assert!(watcher_event_with_suppression(
            root,
            &planned,
            Some(&owner),
            finished_at + IMPORT_SUPPRESSION_TAIL - Duration::from_millis(1),
        )
        .is_none());
        assert!(watcher_event_with_suppression(
            root,
            &planned,
            Some(&owner),
            finished_at + IMPORT_SUPPRESSION_TAIL + Duration::from_millis(1),
        )
        .is_some());
    }

    #[test]
    fn folds_active_import_events_into_the_last_owner_result() {
        let root = Path::new(r"C:\Books\Archive");
        let owner = ArchiveWatcherSuppressionOwner::default();
        let now = Instant::now();
        let mut first = owner
            .begin_at(root, &["Novel.epub".to_string()], now)
            .unwrap();
        let mut second = owner
            .begin_at(root, &["Novel.epub".to_string()], now)
            .unwrap();
        let mut modified = Event::new(EventKind::Modify(ModifyKind::Data(
            notify::event::DataChange::Any,
        )));
        modified
            .paths
            .push(PathBuf::from(r"C:\Books\Archive\Novel.epub"));

        assert!(watcher_event_with_suppression(root, &modified, Some(&owner), now).is_none());
        assert!(first.finish_at(now + Duration::from_millis(1)).is_empty());
        assert!(owner.is_actively_suppressed(root, "Novel.epub"));
        assert_eq!(
            second.finish_at(now + Duration::from_millis(2)),
            [super::SuppressedWatcherChange {
                kind: "modify",
                relative_paths: vec!["Novel.epub".to_string()],
            }]
        );
        assert!(!owner.is_actively_suppressed(root, "Novel.epub"));
        assert!(owner
            .expired_events_at(now + IMPORT_SUPPRESSION_TAIL + Duration::from_secs(1))
            .is_empty());
    }

    #[test]
    fn active_folding_preserves_typed_event_order_and_complete_renames() {
        let root = Path::new(r"C:\Books\Archive");
        let owner = ArchiveWatcherSuppressionOwner::default();
        let now = Instant::now();
        let mut guard = owner
            .begin_at(
                root,
                &["Novel.epub".to_string(), "Renamed.epub".to_string()],
                now,
            )
            .unwrap();
        let mut created = Event::new(EventKind::Create(notify::event::CreateKind::File));
        created
            .paths
            .push(PathBuf::from(r"C:\Books\Archive\Novel.epub"));
        let mut removed = Event::new(EventKind::Remove(notify::event::RemoveKind::File));
        removed
            .paths
            .push(PathBuf::from(r"C:\Books\Archive\Novel.epub"));
        let renamed = rename_event(&[
            r"C:\Books\Archive\Novel.epub",
            r"C:\Books\Archive\Renamed.epub",
        ]);

        for event in [&created, &removed, &renamed] {
            assert!(watcher_event_with_suppression(root, event, Some(&owner), now).is_none());
        }
        let changes = guard.finish_at(now + Duration::from_millis(1));

        assert_eq!(
            changes.iter().map(|change| change.kind).collect::<Vec<_>>(),
            ["create", "remove", "rename"]
        );
        assert_eq!(changes[2].relative_paths, ["Novel.epub", "Renamed.epub"]);
    }

    #[test]
    fn ignores_temporary_import_to_destination_rename_during_active_suppression() {
        let root = Path::new(r"C:\Books\Archive");
        let owner = ArchiveWatcherSuppressionOwner::default();
        let now = Instant::now();
        let mut guard = owner
            .begin_at(root, &["Novel.epub".to_string()], now)
            .unwrap();
        let renamed = rename_event(&[
            r"C:\Books\Archive\Novel.epub.tmp-import-123-45",
            r"C:\Books\Archive\Novel.epub",
        ]);

        assert!(watcher_event_with_suppression(root, &renamed, Some(&owner), now).is_none());
        assert!(guard.finish_at(now + Duration::from_millis(1)).is_empty());
    }

    #[test]
    fn ignores_replacement_transaction_renames_during_active_suppression() {
        let root = Path::new(r"C:\Books\Archive");
        let owner = ArchiveWatcherSuppressionOwner::default();
        let now = Instant::now();
        let mut guard = owner
            .begin_at(root, &["Novel.epub".to_string()], now)
            .unwrap();
        let destination_to_backup = rename_event(&[
            r"C:\Books\Archive\Novel.epub",
            r"C:\Books\Archive\Novel.epub.replace-backup-123-45",
        ]);
        let temporary_to_destination = rename_event(&[
            r"C:\Books\Archive\Novel.epub.tmp-import-456-45",
            r"C:\Books\Archive\Novel.epub",
        ]);

        for event in [&destination_to_backup, &temporary_to_destination] {
            assert!(watcher_event_with_suppression(root, event, Some(&owner), now).is_none());
        }
        assert!(guard.finish_at(now + Duration::from_millis(1)).is_empty());
    }

    #[test]
    fn ignores_replacement_backup_restoration_rename() {
        let root = Path::new(r"C:\Books\Archive");
        let owner = ArchiveWatcherSuppressionOwner::default();
        let now = Instant::now();
        let mut guard = owner
            .begin_at(root, &["Novel.epub".to_string()], now)
            .unwrap();
        let restored = rename_event(&[
            r"C:\Books\Archive\Novel.epub.replace-backup-123-45",
            r"C:\Books\Archive\Novel.epub",
        ]);

        assert!(watcher_event_with_suppression(root, &restored, Some(&owner), now).is_none());
        assert!(guard.finish_at(now + Duration::from_millis(1)).is_empty());
    }

    #[test]
    fn ignores_delayed_internal_transaction_rename_during_the_tail() {
        let root = Path::new(r"C:\Books\Archive");
        let owner = ArchiveWatcherSuppressionOwner::default();
        let now = Instant::now();
        let mut guard = owner
            .begin_at(root, &["Novel.epub".to_string()], now)
            .unwrap();
        assert!(guard.finish_at(now).is_empty());
        let renamed = rename_event(&[
            r"C:\Books\Archive\Novel.epub.tmp-import-123-45",
            r"C:\Books\Archive\Novel.epub",
        ]);

        assert!(watcher_event_with_suppression(
            root,
            &renamed,
            Some(&owner),
            now + Duration::from_millis(1),
        )
        .is_none());
        assert!(owner
            .expired_events_at(now + IMPORT_SUPPRESSION_TAIL)
            .is_empty());
    }

    #[test]
    fn keeps_genuine_incomplete_renames_ambiguous() {
        let root = Path::new(r"C:\Books\Archive");
        let owner = ArchiveWatcherSuppressionOwner::default();
        let now = Instant::now();
        let mut guard = owner
            .begin_at(root, &["Novel.epub".to_string()], now)
            .unwrap();
        let incomplete = rename_event(&[r"C:\Books\Archive\Novel.epub"]);

        assert!(watcher_event_with_suppression(root, &incomplete, Some(&owner), now).is_none());
        assert_eq!(
            guard.finish_at(now + Duration::from_millis(1)),
            [super::SuppressedWatcherChange {
                kind: "rename",
                relative_paths: vec!["Novel.epub".to_string()],
            }]
        );
    }

    #[test]
    fn does_not_hide_an_artifact_rename_with_a_different_destination() {
        let root = Path::new(r"C:\Books\Archive");
        let renamed = rename_event(&[
            r"C:\Books\Archive\Novel.epub.tmp-import-123-45",
            r"C:\Books\Archive\Other.epub",
        ]);

        let payload = watcher_event(root, &renamed).expect("mismatched rename should be visible");
        assert_eq!(payload.kind, "rename");
        assert_eq!(payload.relative_paths, ["Other.epub"]);
    }

    #[test]
    fn emits_one_targeted_dirty_event_after_the_suppression_tail() {
        let root = Path::new(r"C:\Books\Archive");
        let owner = ArchiveWatcherSuppressionOwner::default();
        let now = Instant::now();
        let mut guard = owner
            .begin_at(root, &["Novel.epub".to_string()], now)
            .unwrap();
        let finished_at = now + Duration::from_millis(10);
        assert!(guard.finish_at(finished_at).is_empty());
        let mut modified = Event::new(EventKind::Modify(ModifyKind::Data(
            notify::event::DataChange::Any,
        )));
        modified
            .paths
            .push(PathBuf::from(r"C:\Books\Archive\Novel.epub"));

        assert!(watcher_event_with_suppression(
            root,
            &modified,
            Some(&owner),
            finished_at + Duration::from_millis(20),
        )
        .is_none());
        assert!(watcher_event_with_suppression(
            root,
            &modified,
            Some(&owner),
            finished_at + Duration::from_millis(30),
        )
        .is_none());

        let events = owner.expired_events_at(finished_at + IMPORT_SUPPRESSION_TAIL);
        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, "modify");
        assert_eq!(events[0].relative_paths, ["Novel.epub"]);
        assert!(owner
            .expired_events_at(finished_at + IMPORT_SUPPRESSION_TAIL)
            .is_empty());
    }

    #[test]
    fn clean_suppression_tail_expires_without_a_follow_up_event() {
        let root = Path::new(r"C:\Books\Archive");
        let owner = ArchiveWatcherSuppressionOwner::default();
        let now = Instant::now();
        let mut guard = owner
            .begin_at(root, &["Novel.epub".to_string()], now)
            .unwrap();
        assert!(guard.finish_at(now).is_empty());

        assert!(owner
            .expired_events_at(now + IMPORT_SUPPRESSION_TAIL)
            .is_empty());
        assert!(!owner.is_suppressed_at(root, "Novel.epub", now + IMPORT_SUPPRESSION_TAIL,));
    }

    #[test]
    fn clean_tail_scheduler_empties_the_registry_without_emitting() {
        let root = Path::new(r"C:\Books\Archive");
        let owner = ArchiveWatcherSuppressionOwner::default();
        let (sender, receiver) = mpsc::channel();
        owner.install_tail_emitter(root, Arc::new(move |event| sender.send(event).unwrap()));
        let began_at = Instant::now() - IMPORT_SUPPRESSION_TAIL - Duration::from_secs(1);
        let mut guard = owner
            .begin_at(root, &["Novel.epub".to_string()], began_at)
            .unwrap();

        assert!(guard.finish_at(began_at).is_empty());
        assert!(owner.wait_until_worker_idle(Duration::from_secs(1)));
        assert_eq!(owner.worker_start_count(), 1);
        assert_eq!(owner.entry_count(), 0);
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn scheduled_tail_expiry_emits_without_holding_the_suppression_lock() {
        let root = Path::new(r"C:\Books\Archive");
        let owner = ArchiveWatcherSuppressionOwner::default();
        let (sender, receiver) = mpsc::channel();
        let callback_owner = owner.clone();
        owner.install_tail_emitter(
            root,
            Arc::new(move |event| {
                let worker_count = callback_owner.worker_start_count();
                sender.send((event, worker_count)).unwrap();
            }),
        );
        let began_at = Instant::now();
        let mut guard = owner
            .begin_at(root, &["Novel.epub".to_string()], began_at)
            .unwrap();
        guard.finish_at(began_at);
        let event_at = began_at + Duration::from_millis(1);
        let mut modified = Event::new(EventKind::Modify(ModifyKind::Any));
        modified
            .paths
            .push(PathBuf::from(r"C:\Books\Archive\Novel.epub"));

        assert!(watcher_event_with_suppression(root, &modified, Some(&owner), event_at).is_none());
        assert!(watcher_event_with_suppression(root, &modified, Some(&owner), event_at).is_none());
        {
            let mut state = owner.registry.state.lock().unwrap();
            for entry in state.entries.values_mut() {
                entry.expires_at = Instant::now();
            }
        }
        owner.registry.wake.notify_all();

        let (emitted, worker_count) = receiver.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(emitted.kind, "modify");
        assert_eq!(emitted.relative_paths, ["Novel.epub"]);
        assert_eq!(worker_count, 1);
        assert!(receiver.try_recv().is_err());
        assert!(owner.wait_until_worker_idle(Duration::from_secs(1)));
    }

    #[test]
    fn two_thousand_dirty_paths_share_one_expiry_worker_and_one_drain() {
        let root = Path::new(r"C:\Books\Archive");
        let owner = ArchiveWatcherSuppressionOwner::default();
        let (sender, receiver) = mpsc::channel();
        owner.install_tail_emitter(root, Arc::new(move |event| sender.send(event).unwrap()));
        let paths = (0..2_000)
            .map(|index| format!("Book-{index:04}.epub"))
            .collect::<Vec<_>>();
        let began_at = Instant::now();
        let mut guard = owner.begin_at(root, &paths, began_at).unwrap();
        guard.finish_at(began_at);
        let mut modified = Event::new(EventKind::Modify(ModifyKind::Any));
        modified.paths.extend(
            paths
                .iter()
                .map(|path| PathBuf::from(format!(r"C:\Books\Archive\{path}"))),
        );

        assert!(watcher_event_with_suppression(
            root,
            &modified,
            Some(&owner),
            began_at + Duration::from_millis(1),
        )
        .is_none());
        {
            let mut state = owner.registry.state.lock().unwrap();
            for entry in state.entries.values_mut() {
                entry.expires_at = Instant::now();
            }
        }
        owner.registry.wake.notify_all();

        let emitted = receiver.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(emitted.kind, "modify");
        assert_eq!(emitted.relative_paths.len(), 2_000);
        assert_eq!(owner.worker_start_count(), 1);
        assert!(owner.wait_until_worker_idle(Duration::from_secs(1)));
        assert!(!owner.worker_is_running());
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn an_earlier_expiry_wakes_the_existing_worker() {
        let root = Path::new(r"C:\Books\Archive");
        let owner = ArchiveWatcherSuppressionOwner::default();
        let (sender, receiver) = mpsc::channel();
        owner.install_tail_emitter(root, Arc::new(move |event| sender.send(event).unwrap()));
        let now = Instant::now();

        for path in ["Later.epub", "Earlier.epub"] {
            let mut guard = owner.begin_at(root, &[path.to_string()], now).unwrap();
            guard.finish_at(now);
            assert!(owner.record_test_event(root, "modify", &[path.to_string()]));
        }
        let (root_identity, case_insensitive) = super::import_suppression_root_identity(root);
        let earlier_key = super::ImportSuppressionKey {
            root: root_identity,
            relative_path: super::import_suppression_path_identity(
                "Earlier.epub",
                case_insensitive,
            ),
        };
        {
            let mut state = owner.registry.state.lock().unwrap();
            state.entries.get_mut(&earlier_key).unwrap().expires_at = Instant::now();
        }
        owner.registry.wake.notify_all();

        let emitted = receiver.recv_timeout(Duration::from_secs(1)).unwrap();
        assert_eq!(emitted.relative_paths, ["Earlier.epub"]);
        assert_eq!(owner.worker_start_count(), 1);
        owner.clear_tail_emitter(root);
        assert!(owner.wait_until_worker_idle(Duration::from_secs(1)));
        assert!(receiver.try_recv().is_err());
    }

    #[test]
    fn reactivating_one_path_does_not_delay_an_unrelated_expired_path() {
        let root = Path::new(r"C:\Books\Archive");
        let owner = ArchiveWatcherSuppressionOwner::default();
        let now = Instant::now();
        let mut guard = owner
            .begin_at(
                root,
                &["Reactivated.epub".to_string(), "Ready.epub".to_string()],
                now,
            )
            .unwrap();
        guard.finish_at(now);
        assert!(owner.record_test_event(root, "modify", &["Reactivated.epub".to_string()]));
        assert!(owner.record_test_event(root, "remove", &["Ready.epub".to_string()]));
        let _reactivated = owner
            .begin_at(
                root,
                &["Reactivated.epub".to_string()],
                now + Duration::from_millis(1),
            )
            .unwrap();

        let events = owner.expired_events_at(now + IMPORT_SUPPRESSION_TAIL);

        assert_eq!(events.len(), 1);
        assert_eq!(events[0].kind, "remove");
        assert_eq!(events[0].relative_paths, ["Ready.epub"]);
        assert!(owner.is_actively_suppressed(root, "Reactivated.epub"));
    }

    #[test]
    fn clearing_the_active_watcher_stops_the_worker_without_wrong_archive_emission() {
        let first_root = Path::new(r"C:\Books\First");
        let second_root = Path::new(r"C:\Books\Second");
        let owner = ArchiveWatcherSuppressionOwner::default();
        let (sender, receiver) = mpsc::channel();
        owner.install_tail_emitter(
            first_root,
            Arc::new(move |event| sender.send(event).unwrap()),
        );
        let now = Instant::now();
        let mut guard = owner
            .begin_at(first_root, &["Novel.epub".to_string()], now)
            .unwrap();
        guard.finish_at(now);
        assert!(owner.record_test_event(first_root, "modify", &["Novel.epub".to_string()]));
        assert!(owner.worker_is_running());

        owner.clear_tail_emitter(first_root);
        assert!(owner.wait_until_worker_idle(Duration::from_secs(1)));
        owner.install_tail_emitter(second_root, Arc::new(|_| panic!("wrong archive emission")));

        assert!(receiver.try_recv().is_err());
        owner.clear_tail_emitter(second_root);
    }

    #[test]
    fn retains_delete_and_rename_semantics_during_the_tail() {
        let root = Path::new(r"C:\Books\Archive");
        let now = Instant::now();

        let remove_owner = ArchiveWatcherSuppressionOwner::default();
        let mut remove_guard = remove_owner
            .begin_at(root, &["Novel.epub".to_string()], now)
            .unwrap();
        remove_guard.finish_at(now);
        let mut removed = Event::new(EventKind::Remove(notify::event::RemoveKind::File));
        removed
            .paths
            .push(PathBuf::from(r"C:\Books\Archive\Novel.epub"));
        assert!(watcher_event_with_suppression(root, &removed, Some(&remove_owner), now).is_none());
        let removed_events = remove_owner.expired_events_at(now + IMPORT_SUPPRESSION_TAIL);
        assert_eq!(removed_events[0].kind, "remove");
        assert_eq!(removed_events[0].relative_paths, ["Novel.epub"]);

        for paths in [
            ["Novel.epub", "Renamed.epub"].as_slice(),
            ["Original.epub", "Novel.epub"].as_slice(),
            ["Novel.epub"].as_slice(),
        ] {
            let rename_owner = ArchiveWatcherSuppressionOwner::default();
            let mut rename_guard = rename_owner
                .begin_at(root, &["Novel.epub".to_string()], now)
                .unwrap();
            rename_guard.finish_at(now);
            let absolute_paths = paths
                .iter()
                .map(|path| format!(r"C:\Books\Archive\{path}"))
                .collect::<Vec<_>>();
            let event = rename_event(
                &absolute_paths
                    .iter()
                    .map(String::as_str)
                    .collect::<Vec<_>>(),
            );
            assert!(
                watcher_event_with_suppression(root, &event, Some(&rename_owner), now).is_none()
            );
            let events = rename_owner.expired_events_at(now + IMPORT_SUPPRESSION_TAIL);
            assert_eq!(events[0].kind, "rename");
            assert_eq!(events[0].relative_paths, paths);
        }
    }

    #[test]
    fn reactivation_invalidates_stale_expiry_and_preserves_dirty_state() {
        let root = Path::new(r"C:\Books\Archive");
        let owner = ArchiveWatcherSuppressionOwner::default();
        let now = Instant::now();
        let mut first = owner
            .begin_at(root, &["Novel.epub".to_string()], now)
            .unwrap();
        first.finish_at(now);
        let mut modified = Event::new(EventKind::Modify(ModifyKind::Any));
        modified
            .paths
            .push(PathBuf::from(r"C:\Books\Archive\Novel.epub"));
        assert!(watcher_event_with_suppression(root, &modified, Some(&owner), now).is_none());

        let mut second = owner
            .begin_at(
                root,
                &["Novel.epub".to_string()],
                now + Duration::from_millis(1),
            )
            .unwrap();
        assert!(owner
            .expired_events_at(now + IMPORT_SUPPRESSION_TAIL)
            .is_empty());
        assert_eq!(
            second.finish_at(now + IMPORT_SUPPRESSION_TAIL + Duration::from_millis(1)),
            [super::SuppressedWatcherChange {
                kind: "modify",
                relative_paths: vec!["Novel.epub".to_string()],
            }]
        );
    }

    #[test]
    fn ignores_strict_import_artifacts_without_hiding_similar_user_files() {
        let root = Path::new(r"C:\Books\Archive");
        let mut artifact = Event::new(EventKind::Remove(notify::event::RemoveKind::File));
        artifact.paths.push(PathBuf::from(
            r"C:\Books\Archive\Novel.epub.replace-backup-123-45",
        ));
        let mut user_file = Event::new(EventKind::Remove(notify::event::RemoveKind::File));
        user_file.paths.push(PathBuf::from(
            r"C:\Books\Archive\Novel.epub.replace-backup-notes",
        ));

        assert!(watcher_event(root, &artifact).is_none());
        assert!(watcher_event(root, &user_file).is_some());

        let user_rename = rename_event(&[
            r"C:\Books\Archive\Novel.epub.tmp-import-notes",
            r"C:\Books\Archive\Novel.epub",
        ]);
        let payload = watcher_event(root, &user_rename).expect("user rename should remain visible");
        assert_eq!(payload.kind, "rename");
        assert_eq!(
            payload.relative_paths,
            ["Novel.epub.tmp-import-notes", "Novel.epub"]
        );
    }
}
