use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, OnceLock},
};

use super::filesystem;

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct EpubMutationKey {
    canonical_root: PathBuf,
    normalized_relative_path: String,
}

#[derive(Default)]
struct EpubMutationCoordinator {
    locks: Mutex<HashMap<EpubMutationKey, Arc<Mutex<()>>>>,
}

impl EpubMutationCoordinator {
    fn run<T>(
        &self,
        root: &Path,
        relative_path: &str,
        operation: impl FnOnce(&str) -> Result<T, String>,
    ) -> Result<T, String> {
        let key = mutation_key(root, relative_path)?;
        let mutation_lock = {
            let mut locks = self.locks.lock().map_err(|_| {
                "The EPUB mutation coordinator is unavailable because a previous operation panicked."
                    .to_string()
            })?;
            locks
                .entry(key.clone())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };

        let _mutation = mutation_lock.lock().map_err(|_| {
            "The EPUB mutation is unavailable because a previous writeback panicked.".to_string()
        })?;
        operation(&key.normalized_relative_path)
    }
}

fn mutation_key(root: &Path, relative_path: &str) -> Result<EpubMutationKey, String> {
    Ok(EpubMutationKey {
        canonical_root: fs::canonicalize(root).map_err(|error| error.to_string())?,
        normalized_relative_path: filesystem::normalize_archive_relative_path(relative_path)?,
    })
}

pub(crate) fn run<T>(
    root: &Path,
    relative_path: &str,
    operation: impl FnOnce(&str) -> Result<T, String>,
) -> Result<T, String> {
    static COORDINATOR: OnceLock<EpubMutationCoordinator> = OnceLock::new();
    COORDINATOR
        .get_or_init(EpubMutationCoordinator::default)
        .run(root, relative_path, operation)
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        path::PathBuf,
        sync::{mpsc, Arc, Barrier},
        thread,
        time::Duration,
    };

    use super::EpubMutationCoordinator;

    fn test_root(name: &str) -> PathBuf {
        let nonce = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        let root = std::env::temp_dir().join(format!("archeion-epub-mutation-{name}-{nonce}"));
        fs::create_dir_all(&root).expect("test root should be created");
        root
    }

    #[test]
    fn serializes_metadata_and_cover_mutations_for_the_same_epub() {
        let coordinator = Arc::new(EpubMutationCoordinator::default());
        let root = test_root("cross-operation");
        let (metadata_started_tx, metadata_started_rx) = mpsc::channel();
        let (release_metadata_tx, release_metadata_rx) = mpsc::channel();
        let (cover_started_tx, cover_started_rx) = mpsc::channel();

        let metadata_coordinator = coordinator.clone();
        let metadata_root = root.clone();
        let metadata = thread::spawn(move || {
            metadata_coordinator
                .run(&metadata_root, "book.epub", |_| {
                    metadata_started_tx.send(()).unwrap();
                    release_metadata_rx.recv().unwrap();
                    Ok(())
                })
                .unwrap();
        });
        metadata_started_rx.recv().unwrap();

        let cover_coordinator = coordinator.clone();
        let cover_root = root.clone();
        let cover = thread::spawn(move || {
            cover_coordinator
                .run(&cover_root, "book.epub", |_| {
                    cover_started_tx.send(()).unwrap();
                    Ok(())
                })
                .unwrap();
        });

        assert!(cover_started_rx
            .recv_timeout(Duration::from_millis(50))
            .is_err());
        release_metadata_tx.send(()).unwrap();
        cover_started_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("cover mutation should run after metadata releases ownership");

        metadata.join().unwrap();
        cover.join().unwrap();
        fs::remove_dir_all(root).expect("test root should be removed");
    }

    #[test]
    fn two_metadata_mutations_use_the_same_serialization_owner() {
        let coordinator = Arc::new(EpubMutationCoordinator::default());
        let root = test_root("metadata");
        let (first_started_tx, first_started_rx) = mpsc::channel();
        let (release_first_tx, release_first_rx) = mpsc::channel();
        let (second_started_tx, second_started_rx) = mpsc::channel();

        let first_coordinator = coordinator.clone();
        let first_root = root.clone();
        let first = thread::spawn(move || {
            first_coordinator
                .run(&first_root, "book.epub", |_| {
                    first_started_tx.send(()).unwrap();
                    release_first_rx.recv().unwrap();
                    Ok(())
                })
                .unwrap();
        });
        first_started_rx.recv().unwrap();

        let second_coordinator = coordinator.clone();
        let second_root = root.clone();
        let second = thread::spawn(move || {
            second_coordinator
                .run(&second_root, "book.epub", |_| {
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
            .expect("second metadata mutation should run after the first");

        first.join().unwrap();
        second.join().unwrap();
        fs::remove_dir_all(root).expect("test root should be removed");
    }

    #[test]
    fn different_epubs_are_not_globally_serialized() {
        let coordinator = Arc::new(EpubMutationCoordinator::default());
        let root = test_root("different-books");
        let entered = Arc::new(Barrier::new(3));
        let release = Arc::new(Barrier::new(3));
        let mut threads = Vec::new();

        for relative_path in ["first.epub", "second.epub"] {
            let coordinator = coordinator.clone();
            let root = root.clone();
            let entered = entered.clone();
            let release = release.clone();
            threads.push(thread::spawn(move || {
                coordinator
                    .run(&root, relative_path, |_| {
                        entered.wait();
                        release.wait();
                        Ok(())
                    })
                    .unwrap();
            }));
        }

        entered.wait();
        release.wait();
        for thread in threads {
            thread.join().unwrap();
        }
        fs::remove_dir_all(root).expect("test root should be removed");
    }

    #[test]
    fn canonically_equivalent_roots_and_relative_paths_share_a_key() {
        let coordinator = Arc::new(EpubMutationCoordinator::default());
        let root = test_root("canonical");
        let nested = root.join("nested");
        fs::create_dir_all(&nested).expect("nested root should be created");
        let equivalent_root = nested.join("..");
        let (first_started_tx, first_started_rx) = mpsc::channel();
        let (release_first_tx, release_first_rx) = mpsc::channel();
        let (second_started_tx, second_started_rx) = mpsc::channel();

        let first_coordinator = coordinator.clone();
        let first_root = root.clone();
        let first = thread::spawn(move || {
            first_coordinator
                .run(&first_root, "folder/./book.epub", |_| {
                    first_started_tx.send(()).unwrap();
                    release_first_rx.recv().unwrap();
                    Ok(())
                })
                .unwrap();
        });
        first_started_rx.recv().unwrap();

        let second_coordinator = coordinator.clone();
        let second = thread::spawn(move || {
            second_coordinator
                .run(&equivalent_root, "folder\\book.epub", |_| {
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
            .expect("equivalent mutation key should serialize");

        first.join().unwrap();
        second.join().unwrap();
        fs::remove_dir_all(root).expect("test root should be removed");
    }

    #[test]
    fn failure_releases_keyed_ownership() {
        let coordinator = EpubMutationCoordinator::default();
        let root = test_root("failure-release");

        assert_eq!(
            coordinator
                .run::<()>(&root, "book.epub", |_| Err("simulated failure".to_string()))
                .unwrap_err(),
            "simulated failure"
        );
        coordinator
            .run(&root, "book.epub", |_| Ok(()))
            .expect("later mutation should proceed");

        fs::remove_dir_all(root).expect("test root should be removed");
    }
}
