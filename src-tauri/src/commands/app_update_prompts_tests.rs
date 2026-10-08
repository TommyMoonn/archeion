use super::*;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

#[derive(Default)]
struct Store {
    metadata: Mutex<UpdatePromptMetadata>,
    fail: AtomicBool,
}
impl UpdatePromptPersistence for Store {
    fn load(&self) -> Result<UpdatePromptMetadata, String> {
        Ok(self.metadata.lock().unwrap().clone())
    }
    fn save(&self, metadata: &UpdatePromptMetadata) -> Result<(), String> {
        if self.fail.load(Ordering::SeqCst) {
            return Err("fixture write failed".to_string());
        }
        *self.metadata.lock().unwrap() = metadata.clone();
        Ok(())
    }
}
fn load(store: Arc<Store>, current: &str, now: u64) -> UpdatePromptPolicy {
    UpdatePromptPolicy::load(current, store, move || Ok(now)).unwrap()
}

#[test]
fn snooze_persists_exact_utc_window_and_survives_reopening() {
    let store = Arc::new(Store::default());
    let now = 1_791_417_600_000;
    let mut policy = load(store.clone(), "1.6.0", now);
    policy.snooze("1.6.1").unwrap();
    let reopened = load(store.clone(), "1.6.0", now + 1000);
    assert_eq!(
        reopened.snapshot().snoozed_version.as_deref(),
        Some("1.6.1")
    );
    assert_eq!(reopened.snapshot().snoozed_until, Some(now + 86_400_000));
    policy.clear_snooze("1.6.2").unwrap();
    assert_eq!(policy.snapshot().snoozed_until, Some(now + 86_400_000));
    policy.clear_snooze("1.6.1").unwrap();
    assert_eq!(load(store, "1.6.0", now).snapshot().snoozed_until, None);
}

#[test]
fn ready_later_never_writes_a_snooze_and_resets_each_process() {
    let store = Arc::new(Store::default());
    store.fail.store(true, Ordering::SeqCst);
    let mut policy = load(store.clone(), "1.6.0", 100);
    policy.defer_restart();
    assert!(policy.snapshot().restart_deferred);
    assert_eq!(store.load().unwrap(), UpdatePromptMetadata::default());
    assert!(!load(store, "1.6.0", 200).snapshot().restart_deferred);
}

#[test]
fn failed_persistence_and_invalid_clock_do_not_commit_snoozes() {
    let store = Arc::new(Store::default());
    let mut policy = load(store.clone(), "1.6.0", 100);
    store.fail.store(true, Ordering::SeqCst);
    assert!(policy.snooze("1.6.1").is_err());
    assert_eq!(policy.snapshot(), UpdatePromptSnapshot::default());
    store.fail.store(false, Ordering::SeqCst);
    let mut policy = load(store.clone(), "1.6.0", u64::MAX);
    assert!(policy.snooze("1.6.1").is_err());
    assert_eq!(store.load().unwrap(), UpdatePromptMetadata::default());
}

#[test]
fn only_matching_updater_transition_creates_one_durable_acknowledgement() {
    let store = Arc::new(Store::default());
    assert_eq!(
        load(store.clone(), "1.6.1", 100)
            .snapshot()
            .completed_version,
        None
    );
    load(store.clone(), "1.6.0", 100)
        .prepare_install("1.6.0", "1.6.1")
        .unwrap();
    let mut target = load(store.clone(), "1.6.1", 200);
    assert_eq!(
        target.snapshot().completed_version.as_deref(),
        Some("1.6.1")
    );
    assert_eq!(store.load().unwrap().pending_transition, None);
    assert_eq!(
        load(store.clone(), "1.6.1", 300)
            .snapshot()
            .completed_version
            .as_deref(),
        Some("1.6.1")
    );
    assert!(target.acknowledge("1.6.2").is_err());
    target.acknowledge("1.6.1").unwrap();
    assert_eq!(load(store, "1.6.1", 400).snapshot().completed_version, None);
}

#[test]
fn failed_or_unmatched_attempt_cannot_become_a_later_manual_completion() {
    let store = Arc::new(Store::default());
    let mut source = load(store.clone(), "1.6.0", 100);
    source.prepare_install("1.6.0", "1.6.1").unwrap();
    source.cancel_install().unwrap();
    assert_eq!(
        load(store.clone(), "1.6.1", 200)
            .snapshot()
            .completed_version,
        None
    );
    source.prepare_install("1.6.0", "1.6.1").unwrap();
    assert_eq!(
        load(store.clone(), "1.6.0", 200)
            .snapshot()
            .completed_version,
        None
    );
    assert_eq!(load(store, "1.6.1", 300).snapshot().completed_version, None);
}

#[test]
fn marker_reconciliation_failure_is_not_reported_as_success() {
    let store = Arc::new(Store::default());
    load(store.clone(), "1.6.0", 100)
        .prepare_install("1.6.0", "1.6.1")
        .unwrap();
    store.fail.store(true, Ordering::SeqCst);
    assert!(UpdatePromptPolicy::load("1.6.1", store, || Ok(200)).is_err());
}

#[test]
fn app_global_file_round_trips_and_recovers_an_interrupted_replace() {
    let root = std::env::temp_dir().join(format!(
        "archeion-update-prompts-{}",
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let path = root.join("app-update-prompts.json");
    let store = Arc::new(FileUpdatePromptPersistence(path.clone()));
    assert_eq!(store.load().unwrap(), UpdatePromptMetadata::default());
    let mut policy = UpdatePromptPolicy::load("1.6.0", store.clone(), || Ok(100)).unwrap();
    policy.snooze("1.6.1").unwrap();
    let backup = transaction_path(&path, "write-backup");
    fs::rename(&path, &backup).unwrap();
    assert_eq!(store.load().unwrap().snoozed_until, Some(86_400_100));
    assert!(!backup.exists());
    policy.clear_snooze("1.6.1").unwrap();
    assert_eq!(store.load().unwrap().snoozed_until, None);
    fs::write(&path, b"invalid").unwrap();
    assert!(store.load().is_err());
    assert_eq!(fs::read(&path).unwrap(), b"invalid");
    fs::remove_dir_all(root).unwrap();
}
