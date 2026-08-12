use std::{
    collections::{BTreeMap, BTreeSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Condvar, Mutex, MutexGuard, OnceLock,
    },
    thread,
};

use serde::{Deserialize, Serialize};

use super::{
    archive_root,
    epub_analysis_cache::{self, EpubFileSignature},
    epub_diagnostics::{self, EpubDiagnostics},
    epub_digest::{EpubDigestArchiveSession, EpubDigestService},
    epub_duplicates::{self, EpubDuplicateCandidate, EpubDuplicateGroup},
    filesystem,
};

const MAX_CONCURRENT_DIAGNOSTICS: usize = 2;
const RETIRED_ARCHIVE_ERROR: &str = "The EPUB analysis request belongs to a retired archive.";
const RETIRED_REQUEST_ERROR: &str = "The EPUB analysis request has been superseded.";
const CHANGED_FILE_ERROR: &str = "An EPUB changed after the analysis request was created.";

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EpubAnalysisFileRequest {
    pub(crate) relative_path: String,
    pub(crate) signature: EpubFileSignature,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EpubDuplicateAnalysisCandidate {
    pub(crate) relative_path: String,
    pub(crate) signature: EpubFileSignature,
    pub(crate) identifier: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EpubDuplicateAnalysisResult {
    pub(crate) archive_generation: u64,
    pub(crate) request_revision: u64,
    pub(crate) signatures: BTreeMap<String, EpubFileSignature>,
    pub(crate) groups: Vec<EpubDuplicateGroup>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum EpubAnalysisResultSource {
    Cached,
    Computed,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EpubDiagnosticAnalysisEntry {
    pub(crate) relative_path: String,
    pub(crate) signature: EpubFileSignature,
    pub(crate) diagnostics: EpubDiagnostics,
    pub(crate) source: EpubAnalysisResultSource,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EpubDiagnosticAnalysisResult {
    pub(crate) archive_generation: u64,
    pub(crate) request_revision: u64,
    pub(crate) entries: Vec<EpubDiagnosticAnalysisEntry>,
}

#[derive(Clone, Copy)]
enum AnalysisRequestKind {
    Duplicates,
    Diagnostics,
}

struct ArchiveAnalysisState {
    root: PathBuf,
    generation: u64,
    digest_session: EpubDigestArchiveSession,
    duplicate_revision: Mutex<Option<u64>>,
    diagnostics_revision: Mutex<Option<u64>>,
}

#[derive(Default)]
struct AnalysisGateState {
    active: usize,
}

struct AnalysisGate {
    state: Mutex<AnalysisGateState>,
    available: Condvar,
    limit: usize,
}

impl AnalysisGate {
    fn new(limit: usize) -> Self {
        Self {
            state: Mutex::new(AnalysisGateState::default()),
            available: Condvar::new(),
            limit,
        }
    }

    fn acquire(&self) -> AnalysisPermit<'_> {
        let mut state = recover_lock(&self.state);
        while state.active == self.limit {
            state = self
                .available
                .wait(state)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
        state.active += 1;
        AnalysisPermit { gate: self }
    }
}

struct AnalysisPermit<'a> {
    gate: &'a AnalysisGate,
}

impl Drop for AnalysisPermit<'_> {
    fn drop(&mut self) {
        let mut state = recover_lock(&self.gate.state);
        state.active = state.active.saturating_sub(1);
        self.gate.available.notify_one();
    }
}

struct EpubAnalysisService {
    active: Mutex<Option<Arc<ArchiveAnalysisState>>>,
    diagnostics_gate: AnalysisGate,
    digest_service: EpubDigestService,
}

impl Default for EpubAnalysisService {
    fn default() -> Self {
        Self {
            active: Mutex::new(None),
            diagnostics_gate: AnalysisGate::new(MAX_CONCURRENT_DIAGNOSTICS),
            digest_service: EpubDigestService::default(),
        }
    }
}

impl EpubAnalysisService {
    fn invalidate_paths_at(&self, root: &Path, relative_paths: &[String]) -> Result<(), String> {
        let mut active = recover_lock(&self.active);
        if active.as_ref().is_some_and(|state| state.root == root) {
            let invalidation = self
                .digest_service
                .invalidate_active_archive_paths(root, relative_paths);
            *active = None;
            invalidation?;
            return Ok(());
        }
        drop(active);
        epub_analysis_cache::invalidate_paths_at(root, relative_paths).map(|_| ())
    }

    fn invalidate_prefixes_at(
        &self,
        root: &Path,
        relative_prefixes: &[String],
    ) -> Result<(), String> {
        let mut active = recover_lock(&self.active);
        if active.as_ref().is_some_and(|state| state.root == root) {
            let invalidation = self
                .digest_service
                .invalidate_active_archive_prefixes(root, relative_prefixes);
            *active = None;
            invalidation?;
            return Ok(());
        }
        drop(active);
        epub_analysis_cache::invalidate_prefixes_at(root, relative_prefixes).map(|_| ())
    }

    fn clear_at(&self, root: &Path) -> Result<(), String> {
        let mut active = recover_lock(&self.active);
        if active.as_ref().is_some_and(|state| state.root == root) {
            let invalidation = self.digest_service.clear_active_archive(root);
            *active = None;
            invalidation?;
            return Ok(());
        }
        drop(active);
        epub_analysis_cache::clear_at(root).map(|_| ())
    }

    fn retire_active_archive(&self) {
        *recover_lock(&self.active) = None;
        self.digest_service.retire_active_archive();
    }

    fn request_duplicates(
        &self,
        root: PathBuf,
        archive_generation: u64,
        request_revision: u64,
        candidates: Vec<EpubDuplicateAnalysisCandidate>,
    ) -> Result<EpubDuplicateAnalysisResult, String> {
        let state = self.begin_request(
            root,
            archive_generation,
            request_revision,
            AnalysisRequestKind::Duplicates,
        )?;
        let candidates = normalize_duplicate_candidates(candidates)?;
        let signatures = validate_duplicate_candidates(&state.root, &candidates)?;
        let classifier_candidates = candidates
            .iter()
            .map(|candidate| EpubDuplicateCandidate {
                relative_path: candidate.relative_path.clone(),
                size_bytes: candidate.signature.size_bytes,
                identifier: candidate.identifier.clone(),
            })
            .collect::<Vec<_>>();
        let groups = epub_duplicates::classify(&classifier_candidates, |relative_path| {
            self.ensure_request_current(&state, request_revision, AnalysisRequestKind::Duplicates)?;
            self.digest_service
                .digest(&state.digest_session, relative_path)
        })?;
        validate_signatures(&state.root, &signatures)?;
        self.ensure_request_current(&state, request_revision, AnalysisRequestKind::Duplicates)?;
        Ok(EpubDuplicateAnalysisResult {
            archive_generation,
            request_revision,
            signatures,
            groups,
        })
    }

    fn request_diagnostics(
        &self,
        root: PathBuf,
        archive_generation: u64,
        request_revision: u64,
        files: Vec<EpubAnalysisFileRequest>,
    ) -> Result<EpubDiagnosticAnalysisResult, String> {
        self.request_diagnostics_with(
            root,
            archive_generation,
            request_revision,
            files,
            epub_diagnostics::diagnose_epub,
        )
    }

    fn request_diagnostics_with<D>(
        &self,
        root: PathBuf,
        archive_generation: u64,
        request_revision: u64,
        files: Vec<EpubAnalysisFileRequest>,
        diagnose: D,
    ) -> Result<EpubDiagnosticAnalysisResult, String>
    where
        D: Fn(&Path) -> EpubDiagnostics + Sync,
    {
        let state = self.begin_request(
            root,
            archive_generation,
            request_revision,
            AnalysisRequestKind::Diagnostics,
        )?;
        let files = normalize_file_requests(files)?;
        validate_file_requests(&state.root, &files)?;
        let next_index = AtomicUsize::new(0);
        let results = Mutex::new(
            std::iter::repeat_with(|| None)
                .take(files.len())
                .collect::<Vec<Option<Result<EpubDiagnosticAnalysisEntry, String>>>>(),
        );

        thread::scope(|scope| {
            let worker_count = files.len().min(MAX_CONCURRENT_DIAGNOSTICS);
            for _ in 0..worker_count {
                scope.spawn(|| loop {
                    let index = next_index.fetch_add(1, Ordering::Relaxed);
                    let Some(file) = files.get(index) else {
                        break;
                    };
                    let result =
                        self.analyze_diagnostics_file(&state, request_revision, file, &diagnose);
                    recover_lock(&results)[index] = Some(result);
                });
            }
        });

        let mut entries = Vec::with_capacity(files.len());
        for result in recover_lock(&results).iter_mut() {
            entries.push(
                result
                    .take()
                    .ok_or_else(|| "EPUB diagnostics scheduling did not complete.".to_string())??,
            );
        }
        entries.sort_by(|left, right| left.relative_path.cmp(&right.relative_path));
        self.ensure_request_current(&state, request_revision, AnalysisRequestKind::Diagnostics)?;
        Ok(EpubDiagnosticAnalysisResult {
            archive_generation,
            request_revision,
            entries,
        })
    }

    fn analyze_diagnostics_file<D>(
        &self,
        state: &ArchiveAnalysisState,
        request_revision: u64,
        file: &EpubAnalysisFileRequest,
        diagnose: &D,
    ) -> Result<EpubDiagnosticAnalysisEntry, String>
    where
        D: Fn(&Path) -> EpubDiagnostics,
    {
        self.ensure_request_current(state, request_revision, AnalysisRequestKind::Diagnostics)?;
        if let Some(diagnostics) = self.digest_service.reusable_diagnostics(
            &state.digest_session,
            &file.relative_path,
            &file.signature,
        )? {
            ensure_signature(&state.root, &file.relative_path, &file.signature)?;
            self.ensure_request_current(state, request_revision, AnalysisRequestKind::Diagnostics)?;
            return Ok(EpubDiagnosticAnalysisEntry {
                relative_path: file.relative_path.clone(),
                signature: file.signature.clone(),
                diagnostics,
                source: EpubAnalysisResultSource::Cached,
            });
        }

        let _permit = self.diagnostics_gate.acquire();
        self.ensure_request_current(state, request_revision, AnalysisRequestKind::Diagnostics)?;
        let path = resolve_current_epub(&state.root, &file.relative_path, &file.signature)?;
        let diagnostics = diagnose(&path);
        self.ensure_request_current(state, request_revision, AnalysisRequestKind::Diagnostics)?;
        self.digest_service.publish_diagnostics(
            &state.digest_session,
            &file.relative_path,
            &file.signature,
            diagnostics.clone(),
        )?;
        self.ensure_request_current(state, request_revision, AnalysisRequestKind::Diagnostics)?;
        Ok(EpubDiagnosticAnalysisEntry {
            relative_path: file.relative_path.clone(),
            signature: file.signature.clone(),
            diagnostics,
            source: EpubAnalysisResultSource::Computed,
        })
    }

    fn begin_request(
        &self,
        root: PathBuf,
        archive_generation: u64,
        request_revision: u64,
        kind: AnalysisRequestKind,
    ) -> Result<Arc<ArchiveAnalysisState>, String> {
        let state = self.archive_state(root, archive_generation)?;
        let revisions = revision_owner(&state, kind);
        let mut current = recover_lock(revisions);
        if current.is_some_and(|revision| request_revision <= revision) {
            return Err(RETIRED_REQUEST_ERROR.to_string());
        }
        *current = Some(request_revision);
        drop(current);
        self.ensure_state_current(&state)?;
        Ok(state)
    }

    fn archive_state(
        &self,
        root: PathBuf,
        archive_generation: u64,
    ) -> Result<Arc<ArchiveAnalysisState>, String> {
        let mut active = recover_lock(&self.active);
        if let Some(current) = active.as_ref() {
            if archive_generation < current.generation {
                return Err(RETIRED_ARCHIVE_ERROR.to_string());
            }
            if archive_generation == current.generation {
                return if current.root == root {
                    Ok(current.clone())
                } else {
                    Err(
                        "The EPUB analysis archive generation identifies another archive."
                            .to_string(),
                    )
                };
            }
        }
        *active = None;
        let digest_session = self.digest_service.activate_archive(root.clone())?;
        let state = Arc::new(ArchiveAnalysisState {
            root,
            generation: archive_generation,
            digest_session,
            duplicate_revision: Mutex::new(None),
            diagnostics_revision: Mutex::new(None),
        });
        *active = Some(state.clone());
        Ok(state)
    }

    fn ensure_state_current(&self, state: &ArchiveAnalysisState) -> Result<(), String> {
        if recover_lock(&self.active)
            .as_ref()
            .is_some_and(|current| std::ptr::eq(current.as_ref(), state))
        {
            Ok(())
        } else {
            Err(RETIRED_ARCHIVE_ERROR.to_string())
        }
    }

    fn ensure_request_current(
        &self,
        state: &ArchiveAnalysisState,
        request_revision: u64,
        kind: AnalysisRequestKind,
    ) -> Result<(), String> {
        self.ensure_state_current(state)?;
        if *recover_lock(revision_owner(state, kind)) == Some(request_revision) {
            Ok(())
        } else {
            Err(RETIRED_REQUEST_ERROR.to_string())
        }
    }
}

fn revision_owner(state: &ArchiveAnalysisState, kind: AnalysisRequestKind) -> &Mutex<Option<u64>> {
    match kind {
        AnalysisRequestKind::Duplicates => &state.duplicate_revision,
        AnalysisRequestKind::Diagnostics => &state.diagnostics_revision,
    }
}

fn validate_duplicate_candidates(
    root: &Path,
    candidates: &[EpubDuplicateAnalysisCandidate],
) -> Result<BTreeMap<String, EpubFileSignature>, String> {
    let mut signatures = BTreeMap::new();
    for candidate in candidates {
        ensure_signature(root, &candidate.relative_path, &candidate.signature)?;
        if signatures
            .insert(candidate.relative_path.clone(), candidate.signature.clone())
            .is_some()
        {
            return Err(format!(
                "Duplicate analysis received the same EPUB path more than once: {}",
                candidate.relative_path
            ));
        }
    }
    Ok(signatures)
}

fn normalize_duplicate_candidates(
    candidates: Vec<EpubDuplicateAnalysisCandidate>,
) -> Result<Vec<EpubDuplicateAnalysisCandidate>, String> {
    let mut identities = BTreeSet::new();
    candidates
        .into_iter()
        .map(|candidate| {
            let relative_path = normalized_epub_path(&candidate.relative_path)?;
            if !identities.insert(relative_path.to_lowercase()) {
                return Err(format!(
                    "Duplicate analysis received the same EPUB path more than once: {relative_path}"
                ));
            }
            Ok(EpubDuplicateAnalysisCandidate {
                relative_path,
                signature: candidate.signature,
                identifier: candidate.identifier,
            })
        })
        .collect()
}

fn normalize_file_requests(
    files: Vec<EpubAnalysisFileRequest>,
) -> Result<Vec<EpubAnalysisFileRequest>, String> {
    let mut identities = BTreeSet::new();
    files
        .into_iter()
        .map(|file| {
            let relative_path = normalized_epub_path(&file.relative_path)?;
            if !identities.insert(relative_path.to_lowercase()) {
                return Err(format!(
                    "EPUB diagnostics received the same path more than once: {relative_path}"
                ));
            }
            Ok(EpubAnalysisFileRequest {
                relative_path,
                signature: file.signature,
            })
        })
        .collect()
}

fn validate_file_requests(root: &Path, files: &[EpubAnalysisFileRequest]) -> Result<(), String> {
    for file in files {
        ensure_signature(root, &file.relative_path, &file.signature)?;
    }
    Ok(())
}

fn validate_signatures(
    root: &Path,
    signatures: &BTreeMap<String, EpubFileSignature>,
) -> Result<(), String> {
    for (relative_path, signature) in signatures {
        ensure_signature(root, relative_path, signature)?;
    }
    Ok(())
}

fn ensure_signature(
    root: &Path,
    relative_path: &str,
    expected: &EpubFileSignature,
) -> Result<(), String> {
    resolve_current_epub(root, relative_path, expected).map(|_| ())
}

fn resolve_current_epub(
    root: &Path,
    relative_path: &str,
    expected: &EpubFileSignature,
) -> Result<PathBuf, String> {
    let normalized = normalized_epub_path(relative_path)?;
    let path = filesystem::resolve_existing_epub_path(root, &normalized)?;
    if EpubFileSignature::from_path(&path)? != *expected {
        return Err(CHANGED_FILE_ERROR.to_string());
    }
    Ok(path)
}

fn normalized_epub_path(relative_path: &str) -> Result<String, String> {
    let normalized = filesystem::normalize_archive_relative_path(relative_path)?;
    if !normalized.to_ascii_lowercase().ends_with(".epub") {
        return Err("EPUB analysis paths must identify an EPUB file.".to_string());
    }
    Ok(normalized)
}

fn analysis_service() -> &'static EpubAnalysisService {
    static SERVICE: OnceLock<EpubAnalysisService> = OnceLock::new();
    SERVICE.get_or_init(EpubAnalysisService::default)
}

pub(crate) fn invalidate_paths_at(root: &Path, relative_paths: &[String]) -> Result<(), String> {
    analysis_service().invalidate_paths_at(root, relative_paths)
}

pub(crate) fn invalidate_prefixes_at(
    root: &Path,
    relative_prefixes: &[String],
) -> Result<(), String> {
    analysis_service().invalidate_prefixes_at(root, relative_prefixes)
}

pub(crate) fn clear_at(root: &Path) -> Result<(), String> {
    analysis_service().clear_at(root)
}

pub(crate) fn retire_active_archive() {
    analysis_service().retire_active_archive();
}

fn recover_lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[tauri::command]
pub(crate) async fn request_epub_duplicate_analysis(
    app: tauri::AppHandle,
    root_path: Option<String>,
    archive_generation: u64,
    request_revision: u64,
    candidates: Vec<EpubDuplicateAnalysisCandidate>,
) -> Result<EpubDuplicateAnalysisResult, String> {
    let root = archive_root::resolve_archive_root(&app, root_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        analysis_service().request_duplicates(
            root,
            archive_generation,
            request_revision,
            candidates,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn request_epub_diagnostics(
    app: tauri::AppHandle,
    root_path: Option<String>,
    archive_generation: u64,
    request_revision: u64,
    files: Vec<EpubAnalysisFileRequest>,
) -> Result<EpubDiagnosticAnalysisResult, String> {
    let root = archive_root::resolve_archive_root(&app, root_path)?;
    tauri::async_runtime::spawn_blocking(move || {
        analysis_service().request_diagnostics(root, archive_generation, request_revision, files)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::{Path, PathBuf},
        sync::{mpsc, Arc, Barrier, Mutex},
        thread,
        time::{Duration, SystemTime},
    };

    use super::{
        recover_lock, EpubAnalysisFileRequest, EpubAnalysisResultSource, EpubAnalysisService,
        EpubDuplicateAnalysisCandidate, RETIRED_ARCHIVE_ERROR, RETIRED_REQUEST_ERROR,
    };
    use crate::commands::{
        epub_analysis_cache::{self, EpubFileSignature},
        epub_diagnostics::EpubDiagnostics,
    };

    fn test_root(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-epub-analysis-{label}-{nonce}"))
    }

    fn write_epub(root: &Path, relative_path: &str, contents: &[u8]) -> EpubFileSignature {
        let path = root.join(relative_path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, contents).unwrap();
        EpubFileSignature::from_path(&path).unwrap()
    }

    fn file(relative_path: &str, signature: EpubFileSignature) -> EpubAnalysisFileRequest {
        EpubAnalysisFileRequest {
            relative_path: relative_path.to_string(),
            signature,
        }
    }

    #[test]
    fn current_diagnostics_are_reused_and_duplicate_digests_remain_cached() {
        let root = test_root("cache-reuse");
        fs::create_dir_all(&root).unwrap();
        let first_signature = write_epub(&root, "First.epub", b"identical bytes");
        let second_signature = write_epub(&root, "Second.epub", b"identical bytes");
        let service = EpubAnalysisService::default();
        let calls = Mutex::new(0);

        let first = service
            .request_diagnostics_with(
                root.clone(),
                1,
                1,
                vec![file("First.epub", first_signature.clone())],
                |_| {
                    *recover_lock(&calls) += 1;
                    EpubDiagnostics::new(Vec::new())
                },
            )
            .unwrap();
        let second = service
            .request_diagnostics_with(
                root.clone(),
                1,
                2,
                vec![file("First.epub", first_signature.clone())],
                |_| panic!("current diagnostics should come from the analysis cache"),
            )
            .unwrap();
        assert_eq!(*recover_lock(&calls), 1);
        assert_eq!(first.entries[0].source, EpubAnalysisResultSource::Computed);
        assert_eq!(second.entries[0].source, EpubAnalysisResultSource::Cached);

        let candidates = vec![
            EpubDuplicateAnalysisCandidate {
                relative_path: "First.epub".to_string(),
                signature: first_signature,
                identifier: Some("urn:first".to_string()),
            },
            EpubDuplicateAnalysisCandidate {
                relative_path: "Second.epub".to_string(),
                signature: second_signature,
                identifier: Some("urn:second".to_string()),
            },
        ];
        let initial_duplicates = service
            .request_duplicates(root.clone(), 1, 1, candidates.clone())
            .unwrap();
        let reused_duplicates = service
            .request_duplicates(root.clone(), 1, 2, candidates)
            .unwrap();
        assert_eq!(initial_duplicates.groups, reused_duplicates.groups);
        assert_eq!(initial_duplicates.groups.len(), 1);
        let cache = epub_analysis_cache::load_at(&root).unwrap().cache;
        assert!(cache
            .reusable_digest("First.epub", &initial_duplicates.signatures["First.epub"])
            .unwrap()
            .is_some());
        assert!(cache
            .reusable_digest("Second.epub", &initial_duplicates.signatures["Second.epub"])
            .unwrap()
            .is_some());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn newer_refresh_revision_retires_an_older_completion() {
        let root = test_root("request-revision");
        fs::create_dir_all(&root).unwrap();
        let signature = write_epub(&root, "Novel.epub", b"book bytes");
        let service = Arc::new(EpubAnalysisService::default());
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let release_rx = Mutex::new(release_rx);
        let old_service = service.clone();
        let old_root = root.clone();
        let old_signature = signature.clone();
        let old = thread::spawn(move || {
            old_service.request_diagnostics_with(
                old_root,
                4,
                1,
                vec![file("Novel.epub", old_signature)],
                |_| {
                    started_tx.send(()).unwrap();
                    recover_lock(&release_rx).recv().unwrap();
                    EpubDiagnostics::new(Vec::new())
                },
            )
        });
        started_rx.recv().unwrap();

        let current = service
            .request_diagnostics_with(
                root.clone(),
                4,
                2,
                vec![file("Novel.epub", signature)],
                |_| EpubDiagnostics::new(Vec::new()),
            )
            .unwrap();
        release_tx.send(()).unwrap();

        assert_eq!(current.request_revision, 2);
        assert_eq!(old.join().unwrap().unwrap_err(), RETIRED_REQUEST_ERROR);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn archive_replacement_retires_old_analysis_publication() {
        let first_root = test_root("archive-a");
        let second_root = test_root("archive-b");
        fs::create_dir_all(&first_root).unwrap();
        fs::create_dir_all(&second_root).unwrap();
        let first_signature = write_epub(&first_root, "Novel.epub", b"archive a");
        let second_signature = write_epub(&second_root, "Novel.epub", b"archive b");
        let service = Arc::new(EpubAnalysisService::default());
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let release_rx = Mutex::new(release_rx);
        let old_service = service.clone();
        let old_root = first_root.clone();
        let old = thread::spawn(move || {
            old_service.request_diagnostics_with(
                old_root,
                8,
                1,
                vec![file("Novel.epub", first_signature)],
                |_| {
                    started_tx.send(()).unwrap();
                    recover_lock(&release_rx).recv().unwrap();
                    EpubDiagnostics::new(Vec::new())
                },
            )
        });
        started_rx.recv().unwrap();

        let current = service
            .request_diagnostics_with(
                second_root.clone(),
                9,
                1,
                vec![file("Novel.epub", second_signature)],
                |_| EpubDiagnostics::new(Vec::new()),
            )
            .unwrap();
        release_tx.send(()).unwrap();

        assert_eq!(current.archive_generation, 9);
        assert_eq!(old.join().unwrap().unwrap_err(), RETIRED_ARCHIVE_ERROR);
        fs::remove_dir_all(first_root).unwrap();
        fs::remove_dir_all(second_root).unwrap();
    }

    #[test]
    fn explicit_archive_retirement_rejects_pending_publication() {
        let root = test_root("explicit-retirement");
        fs::create_dir_all(&root).unwrap();
        let signature = write_epub(&root, "Novel.epub", b"archive bytes");
        let service = Arc::new(EpubAnalysisService::default());
        let (started_tx, started_rx) = mpsc::channel();
        let (release_tx, release_rx) = mpsc::channel();
        let release_rx = Mutex::new(release_rx);
        let old_service = service.clone();
        let old_root = root.clone();
        let pending = thread::spawn(move || {
            old_service.request_diagnostics_with(
                old_root,
                11,
                1,
                vec![file("Novel.epub", signature)],
                |_| {
                    started_tx.send(()).unwrap();
                    recover_lock(&release_rx).recv().unwrap();
                    EpubDiagnostics::new(Vec::new())
                },
            )
        });
        started_rx.recv().unwrap();

        service.retire_active_archive();
        release_tx.send(()).unwrap();

        assert_eq!(pending.join().unwrap().unwrap_err(), RETIRED_ARCHIVE_ERROR);
        assert!(!root.join(".archeion/epub-analysis-cache.json").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn diagnostics_work_never_exceeds_the_service_bound() {
        let root = test_root("bounded");
        fs::create_dir_all(&root).unwrap();
        let files = (0..4)
            .map(|index| {
                let relative_path = format!("Book-{index}.epub");
                let signature = write_epub(&root, &relative_path, relative_path.as_bytes());
                file(&relative_path, signature)
            })
            .collect::<Vec<_>>();
        let service = EpubAnalysisService::default();
        let barrier = Barrier::new(2);
        let active = Mutex::new(0_usize);
        let maximum = Mutex::new(0_usize);

        let result = service
            .request_diagnostics_with(root.clone(), 1, 1, files, |_| {
                {
                    let mut count = recover_lock(&active);
                    *count += 1;
                    let mut observed = recover_lock(&maximum);
                    *observed = (*observed).max(*count);
                }
                barrier.wait();
                thread::sleep(Duration::from_millis(10));
                *recover_lock(&active) -= 1;
                EpubDiagnostics::new(Vec::new())
            })
            .unwrap();

        assert_eq!(result.entries.len(), 4);
        assert_eq!(*recover_lock(&maximum), 2);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn stale_signatures_are_rejected_before_analysis_runs() {
        let root = test_root("stale-signature");
        fs::create_dir_all(&root).unwrap();
        let signature = write_epub(&root, "Novel.epub", b"first bytes");
        fs::write(
            root.join("Novel.epub"),
            b"replacement bytes with another size",
        )
        .unwrap();
        let service = EpubAnalysisService::default();

        let error = service
            .request_diagnostics_with(
                root.clone(),
                1,
                1,
                vec![file("Novel.epub", signature)],
                |_| panic!("stale diagnostics must not run"),
            )
            .unwrap_err();

        assert_eq!(error, super::CHANGED_FILE_ERROR);
        fs::remove_dir_all(root).unwrap();
    }
}
