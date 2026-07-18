use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};

#[derive(Default)]
struct ArchiveImportTransactionRegistry {
    archive_locks: Mutex<HashMap<PathBuf, Arc<Mutex<()>>>>,
}

#[derive(Clone, Default)]
pub struct ArchiveImportTransactionState {
    registry: Arc<ArchiveImportTransactionRegistry>,
}

impl ArchiveImportTransactionState {
    pub(crate) fn run<T>(
        &self,
        canonical_root: &Path,
        operation: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let archive_lock = {
            let mut registry = self.registry.archive_locks.lock().map_err(|_| {
                "The archive import transaction registry is unavailable because a previous operation panicked."
                    .to_string()
            })?;
            registry
                .entry(canonical_root.to_path_buf())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };

        let _transaction = archive_lock.lock().map_err(|_| {
            "The archive import transaction is unavailable because a previous import panicked."
                .to_string()
        })?;
        operation()
    }
}

#[cfg(test)]
mod tests {
    use std::{path::Path, sync::mpsc, thread, time::Duration};

    use super::ArchiveImportTransactionState;

    #[test]
    fn serializes_operations_for_the_same_archive() {
        let state = ArchiveImportTransactionState::default();
        let root = std::env::temp_dir().join("archeion-import-transaction-same-root");
        let (first_started_tx, first_started_rx) = mpsc::channel();
        let (release_first_tx, release_first_rx) = mpsc::channel();
        let (second_started_tx, second_started_rx) = mpsc::channel();

        let first_state = state.clone();
        let first_root = root.clone();
        let first = thread::spawn(move || {
            first_state
                .run(&first_root, || {
                    first_started_tx.send(()).unwrap();
                    release_first_rx.recv().unwrap();
                    Ok(())
                })
                .unwrap();
        });
        first_started_rx.recv().unwrap();

        let second_state = state.clone();
        let second_root = root.clone();
        let second = thread::spawn(move || {
            second_state
                .run(&second_root, || {
                    second_started_tx.send(()).unwrap();
                    Ok(())
                })
                .unwrap();
        });

        assert!(second_started_rx
            .recv_timeout(Duration::from_millis(50))
            .is_err());
        release_first_tx.send(()).unwrap();
        second_started_rx
            .recv_timeout(Duration::from_secs(1))
            .unwrap();
        first.join().unwrap();
        second.join().unwrap();
    }

    #[test]
    fn allows_different_archives_to_run_concurrently() {
        let state = ArchiveImportTransactionState::default();
        let (first_started_tx, first_started_rx) = mpsc::channel();
        let (second_started_tx, second_started_rx) = mpsc::channel();
        let (release_first_tx, release_first_rx) = mpsc::channel();
        let (release_second_tx, release_second_rx) = mpsc::channel();
        let first_state = state.clone();
        let first = thread::spawn(move || {
            first_state
                .run(Path::new("archive-a"), || {
                    first_started_tx.send(()).unwrap();
                    release_first_rx.recv().unwrap();
                    Ok(())
                })
                .unwrap();
        });
        let second_state = state.clone();
        let second = thread::spawn(move || {
            second_state
                .run(Path::new("archive-b"), || {
                    second_started_tx.send(()).unwrap();
                    release_second_rx.recv().unwrap();
                    Ok(())
                })
                .unwrap();
        });

        first_started_rx
            .recv_timeout(Duration::from_secs(1))
            .unwrap();
        second_started_rx
            .recv_timeout(Duration::from_secs(1))
            .unwrap();
        release_first_tx.send(()).unwrap();
        release_second_tx.send(()).unwrap();
        first.join().unwrap();
        second.join().unwrap();
    }

    #[test]
    fn reports_a_poisoned_archive_lock_explicitly() {
        let state = ArchiveImportTransactionState::default();
        let root = Path::new("archive-poisoned");
        let poisoned_state = state.clone();
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = poisoned_state.run(root, || -> Result<(), String> {
                panic!("simulated import panic");
            });
        }));

        assert_eq!(
            state.run(root, || Ok(())).unwrap_err(),
            "The archive import transaction is unavailable because a previous import panicked."
        );
    }
}
