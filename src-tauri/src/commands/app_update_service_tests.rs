use super::super::app_update_prompts::{
    UpdatePromptMetadata, UpdatePromptPersistence, UpdatePromptPolicy,
};
use super::*;
use std::{
    collections::VecDeque,
    sync::atomic::{AtomicUsize, Ordering},
};
use tokio::sync::{Notify, Semaphore};

#[derive(Default)]
struct PromptStore {
    metadata: Mutex<UpdatePromptMetadata>,
    fail: std::sync::atomic::AtomicBool,
}
impl UpdatePromptPersistence for PromptStore {
    fn load(&self) -> Result<UpdatePromptMetadata, String> {
        Ok(self.metadata.lock().unwrap().clone())
    }
    fn save(&self, value: &UpdatePromptMetadata) -> Result<(), String> {
        if self.fail.load(Ordering::SeqCst) {
            return Err("fixture metadata write failed".to_string());
        }
        *self.metadata.lock().unwrap() = value.clone();
        Ok(())
    }
}

type CheckResult = Result<Option<PendingUpdate>, String>;

struct FakeBackend {
    calls: Arc<AtomicUsize>,
    results: Arc<Mutex<VecDeque<CheckResult>>>,
    gate: Arc<Semaphore>,
    started: Arc<Notify>,
}

impl UpdateBackend for FakeBackend {
    fn check(&self) -> UpdateFuture<Option<PendingUpdate>> {
        let calls = self.calls.clone();
        let results = self.results.clone();
        let gate = self.gate.clone();
        let started = self.started.clone();
        Box::pin(async move {
            calls.fetch_add(1, Ordering::SeqCst);
            started.notify_one();
            gate.acquire().await.unwrap().forget();
            results.lock().unwrap().pop_front().unwrap()
        })
    }
}

struct FakeHandle {
    downloads: Arc<AtomicUsize>,
    installs: Arc<AtomicUsize>,
    downloaded: Arc<Notify>,
    installing: Arc<Notify>,
    download_gate: Arc<Semaphore>,
    install_gate: Arc<Semaphore>,
    callback: Arc<Mutex<Option<DownloadProgress>>>,
    total: Option<u64>,
    fail_download: bool,
    fail_install: bool,
    installed_bytes: Arc<Mutex<Vec<u8>>>,
}

impl Default for FakeHandle {
    fn default() -> Self {
        Self {
            downloads: Arc::new(AtomicUsize::new(0)),
            installs: Arc::new(AtomicUsize::new(0)),
            downloaded: Arc::new(Notify::new()),
            installing: Arc::new(Notify::new()),
            download_gate: Arc::new(Semaphore::new(1)),
            install_gate: Arc::new(Semaphore::new(1)),
            callback: Arc::new(Mutex::new(None)),
            total: Some(4),
            fail_download: false,
            fail_install: false,
            installed_bytes: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

impl UpdateHandle for FakeHandle {
    fn download(&self, progress: DownloadProgress) -> UpdateFuture<Vec<u8>> {
        self.downloads.fetch_add(1, Ordering::SeqCst);
        *self.callback.lock().unwrap() = Some(progress.clone());
        let gate = self.download_gate.clone();
        let started = self.downloaded.clone();
        let total = self.total;
        let fail = self.fail_download;
        Box::pin(async move {
            progress(1, total);
            progress(3, total);
            started.notify_one();
            gate.acquire().await.unwrap().forget();
            if fail {
                Err("fixture signature/version verification failed".to_string())
            } else {
                Ok(vec![1, 2, 3, 4])
            }
        })
    }

    fn install(&self, bytes: Vec<u8>) -> UpdateFuture<()> {
        self.installs.fetch_add(1, Ordering::SeqCst);
        *self.installed_bytes.lock().unwrap() = bytes;
        let gate = self.install_gate.clone();
        let started = self.installing.clone();
        let fail = self.fail_install;
        Box::pin(async move {
            started.notify_one();
            gate.acquire().await.unwrap().forget();
            if fail {
                Err("fixture installer launch failed".to_string())
            } else {
                Ok(())
            }
        })
    }
}

fn candidate(handle: Arc<FakeHandle>) -> PendingUpdate {
    PendingUpdate {
        metadata: UpdateMetadata {
            version: "1.6.1".to_string(),
            notes: Some("Fixture notes".to_string()),
            published_at: Some("2026-10-08T00:00:00Z".to_string()),
        },
        handle,
    }
}

type Events = Arc<Mutex<Vec<AppUpdateSnapshot>>>;

fn fixture(
    results: Vec<Result<Option<PendingUpdate>, String>>,
    supported: bool,
) -> (AppUpdateService, Arc<FakeBackend>, Events) {
    let permits = results.len();
    let backend = Arc::new(FakeBackend {
        calls: Arc::new(AtomicUsize::new(0)),
        results: Arc::new(Mutex::new(results.into())),
        gate: Arc::new(Semaphore::new(permits)),
        started: Arc::new(Notify::new()),
    });
    let events = Arc::new(Mutex::new(Vec::new()));
    let published = events.clone();
    let service = AppUpdateService::new(
        "1.6.0".to_string(),
        supported,
        backend.clone(),
        UpdatePromptPolicy::load("1.6.0", Arc::new(PromptStore::default()), || Ok(1000)).unwrap(),
        move |snapshot| published.lock().unwrap().push(snapshot),
    );
    (service, backend, events)
}

#[tokio::test]
async fn available_later_is_version_guarded_and_manual_checks_bypass_snooze() {
    let handle = Arc::new(FakeHandle::default());
    let (service, backend, events) = fixture(
        vec![
            Ok(Some(candidate(handle.clone()))),
            Ok(Some(candidate(handle))),
        ],
        true,
    );
    service.check(CheckIntent::Automatic).await.unwrap();
    assert!(service.defer("1.6.2").is_err());
    let snoozed = service.defer("1.6.1").unwrap();
    assert_eq!(snoozed.prompt.snoozed_until, Some(86_401_000));
    let manual = service.check(CheckIntent::Manual).await.unwrap();
    assert_eq!(backend.calls.load(Ordering::SeqCst), 2);
    assert_eq!(manual.available.unwrap().version, "1.6.1");
    assert_eq!(manual.prompt.snoozed_until, snoozed.prompt.snoozed_until);
    assert_eq!(events.lock().unwrap().last().unwrap().prompt, manual.prompt);
}

#[tokio::test]
async fn download_clears_selected_snooze_and_ready_later_only_defers_the_session() {
    let (service, _, _) = fixture(
        vec![Ok(Some(candidate(Arc::new(FakeHandle::default()))))],
        true,
    );
    service.check(CheckIntent::Manual).await.unwrap();
    service.defer("1.6.1").unwrap();
    let ready = service.download().await.unwrap();
    assert_eq!(ready.prompt.snoozed_version, None);
    let later = service.defer("1.6.1").unwrap();
    assert!(later.prompt.restart_deferred);
    assert_eq!(later.prompt.snoozed_until, None);
    assert!(service.state.lock().unwrap().verified_bytes.is_some());
    assert_eq!(
        service.install().await.unwrap().status,
        UpdateStatus::Installing
    );
}

#[tokio::test]
async fn install_writes_marker_before_plugin_and_persistence_failure_retains_ready_bytes() {
    let handle = Arc::new(FakeHandle::default());
    let (service, _, _) = fixture(vec![Ok(Some(candidate(handle.clone())))], true);
    let store = Arc::new(PromptStore::default());
    service.state.lock().unwrap().prompt =
        UpdatePromptPolicy::load("1.6.0", store.clone(), || Ok(100)).unwrap();
    service.check(CheckIntent::Manual).await.unwrap();
    service.download().await.unwrap();
    store.fail.store(true, Ordering::SeqCst);
    assert!(service.install().await.is_err());
    assert_eq!(handle.installs.load(Ordering::SeqCst), 0);
    assert_eq!(service.snapshot().unwrap().status, UpdateStatus::Ready);
    assert!(service.state.lock().unwrap().verified_bytes.is_some());
    store.fail.store(false, Ordering::SeqCst);
    handle.install_gate.acquire().await.unwrap().forget();
    let installing_service = service.clone();
    let operation = tokio::spawn(async move { installing_service.install().await });
    handle.installing.notified().await;
    assert!(store.load().unwrap().pending_transition.is_some());
    handle.install_gate.add_permits(1);
    operation.await.unwrap().unwrap();
    let target = UpdatePromptPolicy::load("1.6.1", store, || Ok(200)).unwrap();
    assert_eq!(
        target.snapshot().completed_version.as_deref(),
        Some("1.6.1")
    );
}

#[tokio::test]
async fn failed_install_clears_attempt_and_retires_the_operation() {
    let handle = Arc::new(FakeHandle {
        fail_install: true,
        ..Default::default()
    });
    let (service, _, _) = fixture(vec![Ok(Some(candidate(handle.clone())))], true);
    let store = Arc::new(PromptStore::default());
    service.state.lock().unwrap().prompt =
        UpdatePromptPolicy::load("1.6.0", store.clone(), || Ok(100)).unwrap();
    service.check(CheckIntent::Manual).await.unwrap();
    service.download().await.unwrap();
    assert!(service.install().await.is_err());
    assert_eq!(store.load().unwrap().pending_transition, None);
    assert!(service.state.lock().unwrap().active.is_none());
}

#[tokio::test]
async fn failed_prompt_write_does_not_publish_a_snooze_or_start_a_download() {
    let handle = Arc::new(FakeHandle::default());
    let (service, _, events) = fixture(vec![Ok(Some(candidate(handle.clone())))], true);
    let store = Arc::new(PromptStore::default());
    service.state.lock().unwrap().prompt =
        UpdatePromptPolicy::load("1.6.0", store.clone(), || Ok(100)).unwrap();
    service.check(CheckIntent::Manual).await.unwrap();
    let before = service.snapshot().unwrap();
    let event_count = events.lock().unwrap().len();
    store.fail.store(true, Ordering::SeqCst);
    assert!(service.defer("1.6.1").is_err());
    assert_eq!(service.snapshot().unwrap(), before);
    assert_eq!(events.lock().unwrap().len(), event_count);
    store.fail.store(false, Ordering::SeqCst);
    service.defer("1.6.1").unwrap();
    store.fail.store(true, Ordering::SeqCst);
    assert!(service.download().await.is_err());
    assert_eq!(handle.downloads.load(Ordering::SeqCst), 0);
    assert_eq!(service.snapshot().unwrap().status, UpdateStatus::Available);
}

#[tokio::test]
async fn marker_cleanup_failure_does_not_strand_a_failed_install_operation() {
    let handle = Arc::new(FakeHandle {
        fail_install: true,
        ..Default::default()
    });
    let (service, _, _) = fixture(vec![Ok(Some(candidate(handle.clone())))], true);
    let store = Arc::new(PromptStore::default());
    service.state.lock().unwrap().prompt =
        UpdatePromptPolicy::load("1.6.0", store.clone(), || Ok(100)).unwrap();
    service.check(CheckIntent::Manual).await.unwrap();
    service.download().await.unwrap();
    handle.install_gate.acquire().await.unwrap().forget();
    let installing_service = service.clone();
    let operation = tokio::spawn(async move { installing_service.install().await });
    handle.installing.notified().await;
    store.fail.store(true, Ordering::SeqCst);
    handle.install_gate.add_permits(1);
    assert!(operation.await.unwrap().is_err());
    let snapshot = service.snapshot().unwrap();
    assert_eq!(snapshot.status, UpdateStatus::Idle);
    assert_eq!(snapshot.error.unwrap().operation, UpdateOperation::Install);
    assert!(service.state.lock().unwrap().active.is_none());
    store.fail.store(false, Ordering::SeqCst);
    let old_build = UpdatePromptPolicy::load("1.6.0", store.clone(), || Ok(200)).unwrap();
    assert_eq!(old_build.snapshot().completed_version, None);
    assert_eq!(store.load().unwrap().pending_transition, None);
}

#[tokio::test]
async fn no_update_returns_idle_and_publishes_one_revisioned_contract() {
    let (service, backend, events) = fixture(vec![Ok(None)], true);
    assert_eq!(backend.calls.load(Ordering::SeqCst), 0);
    let snapshot = service.check(CheckIntent::Manual).await.unwrap();
    assert_eq!(snapshot.status, UpdateStatus::Idle);
    assert_eq!(snapshot.current_version, "1.6.0");
    assert_eq!(snapshot.available, None);
    let events = events.lock().unwrap();
    assert_eq!(
        events.iter().map(|event| event.status).collect::<Vec<_>>(),
        vec![UpdateStatus::Checking, UpdateStatus::Idle]
    );
    assert!(events
        .windows(2)
        .all(|pair| pair[0].revision < pair[1].revision));
    assert_eq!(
        serde_json::to_value(&snapshot).unwrap()["currentVersion"],
        "1.6.0"
    );
    assert_eq!(
        serde_json::to_value(&snapshot).unwrap()["downloadedBytes"],
        0
    );
}

#[tokio::test]
async fn available_update_replaces_metadata_without_downloading() {
    let first = Arc::new(FakeHandle::default());
    let second = Arc::new(FakeHandle::default());
    let mut newer = candidate(second.clone());
    newer.metadata.version = "1.6.2".to_string();
    let (service, _, _) = fixture(
        vec![Ok(Some(candidate(first.clone()))), Ok(Some(newer))],
        true,
    );
    let snapshot = service.check(CheckIntent::Automatic).await.unwrap();
    assert_eq!(snapshot.status, UpdateStatus::Available);
    assert_eq!(snapshot.available, Some(candidate(first.clone()).metadata));
    assert_eq!(
        service
            .check(CheckIntent::Manual)
            .await
            .unwrap()
            .available
            .unwrap()
            .version,
        "1.6.2"
    );
    assert_eq!(first.downloads.load(Ordering::SeqCst), 0);
    assert_eq!(second.downloads.load(Ordering::SeqCst), 0);
}

#[tokio::test]
async fn duplicate_checks_join_the_app_owned_operation_and_promote_manual_failure() {
    let (service, backend, _) = fixture(vec![Err("offline".to_string())], true);
    backend.gate.acquire().await.unwrap().forget();
    let owner = service.clone();
    let caller = tokio::spawn(async move { owner.check(CheckIntent::Automatic).await });
    backend.started.notified().await;
    let manual = service.check(CheckIntent::Manual);
    tokio::pin!(manual);
    // Poll the duplicate until it has subscribed, before releasing the backend.
    assert!(
        std::future::poll_fn(|cx| std::task::Poll::Ready(manual.as_mut().poll(cx).is_pending()))
            .await
    );
    backend.gate.add_permits(1);
    assert!(caller.await.unwrap().is_err());
    assert!(manual.await.is_err());
    assert_eq!(backend.calls.load(Ordering::SeqCst), 1);
    let snapshot = service.snapshot().unwrap();
    assert_eq!(snapshot.status, UpdateStatus::Idle);
    assert_eq!(snapshot.error.unwrap().operation, UpdateOperation::Check);
}

#[tokio::test]
async fn caller_cancellation_does_not_strand_the_shared_check() {
    let (service, backend, _) = fixture(vec![Ok(None)], true);
    backend.gate.acquire().await.unwrap().forget();
    let owner = service.clone();
    let caller = tokio::spawn(async move { owner.check(CheckIntent::Automatic).await });
    backend.started.notified().await;
    caller.abort();
    let manual = service.check(CheckIntent::Manual);
    tokio::pin!(manual);
    assert!(
        std::future::poll_fn(|cx| std::task::Poll::Ready(manual.as_mut().poll(cx).is_pending()))
            .await
    );
    backend.gate.add_permits(1);
    assert_eq!(manual.await.unwrap().status, UpdateStatus::Idle);
    assert_eq!(backend.calls.load(Ordering::SeqCst), 1);
}

#[tokio::test]
async fn automatic_failure_is_silent_and_preserves_available_information() {
    let handle = Arc::new(FakeHandle::default());
    let (service, _, _) = fixture(
        vec![Ok(Some(candidate(handle))), Err("offline".to_string())],
        true,
    );
    let available = service.check(CheckIntent::Manual).await.unwrap().available;
    let snapshot = service.check(CheckIntent::Automatic).await.unwrap();
    assert_eq!(snapshot.status, UpdateStatus::Available);
    assert_eq!(snapshot.available, available);
    assert_eq!(snapshot.error, None);
}

#[tokio::test]
async fn download_progress_is_truthful_with_known_unknown_and_zero_totals() {
    for total in [Some(4), None, Some(0)] {
        let handle = Arc::new(FakeHandle {
            total,
            download_gate: Arc::new(Semaphore::new(0)),
            ..FakeHandle::default()
        });
        let (service, backend, _) = fixture(vec![Ok(Some(candidate(handle.clone())))], true);
        service.check(CheckIntent::Manual).await.unwrap();
        let owner = service.clone();
        let download = tokio::spawn(async move { owner.download().await });
        handle.downloaded.notified().await;
        let snapshot = service.snapshot().unwrap();
        assert_eq!(snapshot.status, UpdateStatus::Downloading);
        assert_eq!(snapshot.downloaded_bytes, 4);
        assert_eq!(snapshot.total_bytes, total.filter(|total| *total > 0));
        assert!(service.install().await.is_err());
        assert_eq!(
            service.check(CheckIntent::Manual).await.unwrap().status,
            UpdateStatus::Downloading
        );
        let duplicate = service.download();
        tokio::pin!(duplicate);
        assert!(
            std::future::poll_fn(|cx| std::task::Poll::Ready(
                duplicate.as_mut().poll(cx).is_pending()
            ))
            .await
        );
        handle.download_gate.add_permits(1);
        assert_eq!(download.await.unwrap().unwrap().status, UpdateStatus::Ready);
        assert_eq!(duplicate.await.unwrap().status, UpdateStatus::Ready);
        assert_eq!(handle.downloads.load(Ordering::SeqCst), 1);
        assert_eq!(backend.calls.load(Ordering::SeqCst), 1);
        assert_eq!(
            service.state.lock().unwrap().verified_bytes,
            Some(vec![1, 2, 3, 4])
        );
        let ready = service.snapshot().unwrap();
        handle.callback.lock().unwrap().as_ref().unwrap()(100, Some(104));
        assert_eq!(service.snapshot().unwrap(), ready);
        service.download().await.unwrap();
        service.check(CheckIntent::Automatic).await.unwrap();
        assert_eq!(handle.downloads.load(Ordering::SeqCst), 1);
        assert_eq!(backend.calls.load(Ordering::SeqCst), 1);
    }
}

#[tokio::test]
async fn installation_consumes_verified_bytes_once_across_duplicate_callers() {
    let handle = Arc::new(FakeHandle {
        install_gate: Arc::new(Semaphore::new(0)),
        ..FakeHandle::default()
    });
    let (service, _, _) = fixture(vec![Ok(Some(candidate(handle.clone())))], true);
    assert!(service.install().await.is_err());
    service.check(CheckIntent::Manual).await.unwrap();
    assert!(service.install().await.is_err());
    service.download().await.unwrap();
    let owner = service.clone();
    let install = tokio::spawn(async move { owner.install().await });
    handle.installing.notified().await;
    let duplicate = service.install();
    tokio::pin!(duplicate);
    assert!(
        std::future::poll_fn(|cx| std::task::Poll::Ready(duplicate.as_mut().poll(cx).is_pending()))
            .await
    );
    assert_eq!(*handle.installed_bytes.lock().unwrap(), vec![1, 2, 3, 4]);
    assert!(service.state.lock().unwrap().verified_bytes.is_none());
    handle.install_gate.add_permits(1);
    assert_eq!(
        install.await.unwrap().unwrap().status,
        UpdateStatus::Installing
    );
    duplicate.await.unwrap();
    service.install().await.unwrap();
    assert_eq!(handle.installs.load(Ordering::SeqCst), 1);
    assert!(service.state.lock().unwrap().pending.is_none());
}

#[tokio::test]
async fn failed_verification_never_enters_ready_and_install_failure_requires_recheck() {
    for (fail_download, operation) in [
        (true, UpdateOperation::Download),
        (false, UpdateOperation::Install),
    ] {
        let handle = Arc::new(FakeHandle {
            fail_download,
            fail_install: !fail_download,
            ..FakeHandle::default()
        });
        let (service, _, _) = fixture(vec![Ok(Some(candidate(handle)))], true);
        service.check(CheckIntent::Manual).await.unwrap();
        let result = if fail_download {
            service.download().await
        } else {
            service.download().await.unwrap();
            service.install().await
        };
        assert!(result.is_err());
        let snapshot = service.snapshot().unwrap();
        assert_eq!(snapshot.error.unwrap().operation, operation);
        assert_ne!(snapshot.status, UpdateStatus::Ready);
        assert!(service.state.lock().unwrap().verified_bytes.is_none());
        assert!(service.install().await.is_err());
        if !fail_download {
            assert!(snapshot.available.is_none());
        }
    }
}

#[tokio::test]
async fn stale_completions_cannot_replace_a_newer_state() {
    let handle = Arc::new(FakeHandle {
        download_gate: Arc::new(Semaphore::new(0)),
        ..FakeHandle::default()
    });
    let (service, _, _) = fixture(vec![Ok(Some(candidate(handle.clone())))], true);
    service.check(CheckIntent::Manual).await.unwrap();
    let owner = service.clone();
    let download = tokio::spawn(async move { owner.download().await });
    handle.downloaded.notified().await;
    let snapshot = service.snapshot().unwrap();
    assert_eq!(snapshot.status, UpdateStatus::Downloading);
    assert!(service
        .finish(1, Ok(()), |state, ()| state.snapshot.status =
            UpdateStatus::Idle)
        .is_err());
    service.progress(1, 99, Some(100));
    assert_eq!(service.snapshot().unwrap(), snapshot);
    handle.download_gate.add_permits(1);
    assert_eq!(download.await.unwrap().unwrap().status, UpdateStatus::Ready);
}

#[tokio::test]
async fn check_errors_respect_intent_and_recovery_clears_actionable_errors() {
    for intent in [CheckIntent::Automatic, CheckIntent::Manual] {
        let (service, _, _) = fixture(vec![Err("offline detail".to_string()), Ok(None)], true);
        let result = service.check(intent).await;
        let failed = service.snapshot().unwrap();
        assert_eq!(failed.status, UpdateStatus::Idle);
        if intent == CheckIntent::Manual {
            assert!(result.is_err());
            assert_eq!(
                failed.error.unwrap(),
                UpdateOperationError {
                    operation: UpdateOperation::Check,
                    message: "Updates could not be checked. Try again.".to_string(),
                }
            );
        } else {
            assert!(result.is_ok());
            assert!(failed.error.is_none());
        }
        assert!(service
            .check(CheckIntent::Manual)
            .await
            .unwrap()
            .error
            .is_none());
    }
}

#[test]
fn snapshot_wire_contract_exposes_only_public_metadata() {
    let (service, _, _) = fixture(vec![], true);
    assert_eq!(
        serde_json::to_value(service.snapshot().unwrap()).unwrap(),
        serde_json::json!({
            "revision": 0, "supported": true, "currentVersion": "1.6.0", "status": "idle",
            "available": null, "downloadedBytes": 0, "totalBytes": null, "error": null,
            "prompt": { "snoozedVersion": null, "snoozedUntil": null, "restartDeferred": false, "completedVersion": null },
        })
    );
    assert_eq!(
        serde_json::from_str::<CheckIntent>("\"manual\"").unwrap(),
        CheckIntent::Manual
    );
    assert_eq!(
        serde_json::from_str::<CheckIntent>("\"automatic\"").unwrap(),
        CheckIntent::Automatic
    );
    assert!(serde_json::from_str::<CheckIntent>("\"arbitrary-endpoint\"").is_err());
}

#[tokio::test]
async fn unsupported_build_never_calls_backend_or_emits_operation_events() {
    let (service, backend, events) = fixture(vec![], false);
    assert!(!service.snapshot().unwrap().supported);
    assert!(service.check(CheckIntent::Manual).await.is_err());
    assert!(service.check(CheckIntent::Automatic).await.is_err());
    assert!(service.download().await.is_err());
    assert!(service.install().await.is_err());
    assert_eq!(backend.calls.load(Ordering::SeqCst), 0);
    assert!(events.lock().unwrap().is_empty());
}

#[tokio::test]
async fn failed_install_can_recover_only_through_a_fresh_check_and_verified_download() {
    let failed = Arc::new(FakeHandle {
        fail_install: true,
        ..FakeHandle::default()
    });
    let recovered = Arc::new(FakeHandle::default());
    let (service, _, _) = fixture(
        vec![
            Ok(Some(candidate(failed.clone()))),
            Ok(Some(candidate(recovered.clone()))),
        ],
        true,
    );
    service.check(CheckIntent::Manual).await.unwrap();
    service.download().await.unwrap();
    assert!(service.install().await.is_err());
    assert!(service.download().await.is_err());
    assert!(service.install().await.is_err());
    service.check(CheckIntent::Manual).await.unwrap();
    service.download().await.unwrap();
    service.install().await.unwrap();
    assert_eq!(failed.installs.load(Ordering::SeqCst), 1);
    assert_eq!(recovered.downloads.load(Ordering::SeqCst), 1);
    assert_eq!(recovered.installs.load(Ordering::SeqCst), 1);
}
