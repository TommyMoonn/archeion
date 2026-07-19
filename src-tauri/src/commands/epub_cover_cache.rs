use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};

use super::epub_cover_requests;

const MAX_MAINTENANCE_ENTRIES: usize = 512;

#[derive(Debug, Default, Eq, PartialEq)]
pub(crate) struct CoverCacheMaintenanceResult {
    pub(crate) inspected_entries: usize,
    pub(crate) removed_revisions: usize,
    pub(crate) removed_temporary_files: usize,
    pub(crate) skipped_active_files: usize,
}

#[derive(Debug)]
struct CoverRevision {
    path: PathBuf,
    book_id: String,
    revision: Option<(u128, u64)>,
    generated_at: SystemTime,
}

enum CoverCacheEntry {
    Revision(CoverRevision),
    Temporary { owner: PathBuf, path: PathBuf },
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum MaintenancePass {
    Discovery,
    Revisions,
}

fn valid_book_id(book_id: &str) -> bool {
    !book_id.is_empty()
        && book_id
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || "-_".contains(character))
}

fn parse_cover_name(name: &str) -> Option<(String, Option<(u128, u64)>)> {
    let stem = name.strip_suffix(".cover")?;
    let mut parts = stem.rsplitn(3, '-');
    let modified = parts.next()?.parse::<u128>();
    let length = parts.next().and_then(|part| part.parse::<u64>().ok());
    let book_id = parts.next();

    if let (Ok(modified), Some(length), Some(book_id)) = (modified, length, book_id) {
        return valid_book_id(book_id).then(|| (book_id.to_string(), Some((modified, length))));
    }

    valid_book_id(stem).then(|| (stem.to_string(), None))
}

fn cover_revision(path: PathBuf, name: &str, generated_at: SystemTime) -> Option<CoverRevision> {
    let (book_id, revision) = parse_cover_name(name)?;
    Some(CoverRevision {
        path,
        book_id,
        revision,
        generated_at,
    })
}

fn compare_revisions(left: &CoverRevision, right: &CoverRevision) -> Ordering {
    left.generated_at
        .cmp(&right.generated_at)
        .then_with(|| left.revision.cmp(&right.revision))
        .then_with(|| left.path.cmp(&right.path))
}

fn temporary_cache_owner(path: &Path, name: &str) -> Option<PathBuf> {
    let cover_name = name.strip_suffix(".tmp")?;
    parse_cover_name(cover_name)?;
    Some(path.with_file_name(cover_name))
}

fn remove_candidate(request_key: &Path, candidate: &Path) -> Result<bool, String> {
    epub_cover_requests::remove_cache_file_if_inactive(request_key, candidate)
        .map_err(|error| error.to_string())
}

fn inspect_entry(path: PathBuf) -> Result<Option<CoverCacheEntry>, String> {
    let metadata = match fs::symlink_metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if !metadata.is_file() {
        return Ok(None);
    }
    let Some(name) = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(str::to_owned)
    else {
        return Ok(None);
    };

    if let Some(owner) = temporary_cache_owner(&path, &name) {
        return Ok(Some(CoverCacheEntry::Temporary { owner, path }));
    }
    Ok(cover_revision(
        path,
        &name,
        metadata.modified().map_err(|error| error.to_string())?,
    )
    .map(CoverCacheEntry::Revision))
}

fn next_batch<I>(entries: &mut I) -> Result<Vec<PathBuf>, String>
where
    I: Iterator<Item = Result<PathBuf, String>>,
{
    let mut batch = Vec::with_capacity(MAX_MAINTENANCE_ENTRIES);
    for _ in 0..MAX_MAINTENANCE_ENTRIES {
        let Some(path) = entries.next() else {
            break;
        };
        batch.push(path?);
    }
    Ok(batch)
}

fn directory_paths(
    cache_dir: &Path,
) -> Result<impl Iterator<Item = Result<PathBuf, String>>, std::io::Error> {
    fs::read_dir(cache_dir).map(|entries| {
        entries.map(|entry| {
            entry
                .map(|entry| entry.path())
                .map_err(|error| error.to_string())
        })
    })
}

pub(crate) fn remove_previous_cache_path(previous: &Path, current: &Path) -> Result<bool, String> {
    if previous == current {
        return Ok(false);
    }

    let previous_name = previous
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(parse_cover_name);
    let current_name = current
        .file_name()
        .and_then(|name| name.to_str())
        .and_then(parse_cover_name);
    if previous_name.as_ref().map(|entry| &entry.0) != current_name.as_ref().map(|entry| &entry.0)
        || previous_name.is_none()
    {
        return Err("The previous cover cache path does not match the current book.".to_string());
    }

    remove_candidate(previous, previous)
}

fn maintain_revisions_for_books<F>(
    cache_dir: &Path,
    book_ids: &HashSet<String>,
    result: &mut CoverCacheMaintenanceResult,
    observe_batch: &mut F,
) -> Result<(), String>
where
    F: FnMut(MaintenancePass, usize),
{
    let mut entries = directory_paths(cache_dir).map_err(|error| error.to_string())?;
    let mut winners: HashMap<String, CoverRevision> = HashMap::with_capacity(book_ids.len());

    loop {
        let batch = next_batch(&mut entries)?;
        if batch.is_empty() {
            break;
        }
        observe_batch(MaintenancePass::Revisions, batch.len());
        for path in batch {
            let Some(CoverCacheEntry::Revision(candidate)) = inspect_entry(path)? else {
                continue;
            };
            if !book_ids.contains(&candidate.book_id) {
                continue;
            }

            match winners.entry(candidate.book_id.clone()) {
                std::collections::hash_map::Entry::Vacant(entry) => {
                    entry.insert(candidate);
                }
                std::collections::hash_map::Entry::Occupied(mut entry) => {
                    let (stale, current) = if compare_revisions(&candidate, entry.get()).is_gt() {
                        let previous = entry.insert(candidate);
                        (previous.path, entry.get().path.clone())
                    } else {
                        (candidate.path, entry.get().path.clone())
                    };
                    if remove_previous_cache_path(&stale, &current)? {
                        result.removed_revisions += 1;
                    } else if stale.exists() {
                        result.skipped_active_files += 1;
                    }
                }
            }
        }
    }

    Ok(())
}

fn maintain_session<I, F>(
    cache_dir: &Path,
    entries: &mut I,
    mut observe_batch: F,
) -> Result<CoverCacheMaintenanceResult, String>
where
    I: Iterator<Item = Result<PathBuf, String>>,
    F: FnMut(MaintenancePass, usize),
{
    let mut result = CoverCacheMaintenanceResult::default();

    loop {
        let batch = next_batch(entries)?;
        if batch.is_empty() {
            break;
        }
        result.inspected_entries += batch.len();
        observe_batch(MaintenancePass::Discovery, batch.len());
        let mut book_ids = HashSet::with_capacity(batch.len());

        for path in batch {
            match inspect_entry(path)? {
                Some(CoverCacheEntry::Temporary { owner, path }) => {
                    if remove_candidate(&owner, &path)? {
                        result.removed_temporary_files += 1;
                    } else if path.exists() {
                        result.skipped_active_files += 1;
                    }
                }
                Some(CoverCacheEntry::Revision(revision)) => {
                    book_ids.insert(revision.book_id);
                }
                None => {}
            }
        }

        if !book_ids.is_empty() {
            maintain_revisions_for_books(cache_dir, &book_ids, &mut result, &mut observe_batch)?;
        }
    }

    Ok(result)
}

pub(crate) fn maintain_at(cache_dir: &Path) -> Result<CoverCacheMaintenanceResult, String> {
    let mut entries = match directory_paths(cache_dir) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(CoverCacheMaintenanceResult::default())
        }
        Err(error) => return Err(error.to_string()),
    };
    maintain_session(cache_dir, &mut entries, |_, _| {})
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        sync::{mpsc, Arc, Barrier},
        thread,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;

    fn test_root(name: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system time should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-cover-maintenance-{name}-{nonce}"))
    }

    #[test]
    fn direct_previous_key_cleanup_removes_only_the_known_revision() {
        let root = test_root("direct");
        fs::create_dir_all(&root).expect("cache directory should be created");
        let previous = root.join("book-10-100.cover");
        let current = root.join("book-11-200.cover");
        let unrelated = root.join("other-10-100.cover");
        fs::write(&previous, b"previous").expect("previous cache should be written");
        fs::write(&current, b"current").expect("current cache should be written");
        fs::write(&unrelated, b"unrelated").expect("unrelated cache should be written");

        assert!(remove_previous_cache_path(&previous, &current)
            .expect("known previous cache should be removed"));

        assert!(!previous.exists());
        assert!(current.is_file());
        assert!(unrelated.is_file());
        fs::remove_dir_all(root).expect("test cache should be removed");
    }

    #[test]
    fn maintenance_removes_strict_temporary_files_and_orphaned_revisions() {
        let root = test_root("stale");
        fs::create_dir_all(&root).expect("cache directory should be created");
        let stale = root.join("book-99-100.cover");
        let current = root.join("book-11-200.cover");
        let temporary = root.join("book-11-200.cover.tmp");
        let unrelated = root.join("notes.cover.tmp.txt");
        fs::write(&stale, b"stale").expect("stale cache should be written");
        fs::write(&current, b"current").expect("current cache should be written");
        fs::write(&temporary, b"partial").expect("temporary cache should be written");
        fs::write(&unrelated, b"notes").expect("unrelated file should be written");

        let result = maintain_at(&root).expect("maintenance should finish");

        assert_eq!(result.removed_revisions, 1);
        assert_eq!(result.removed_temporary_files, 1);
        assert!(!stale.exists());
        assert!(current.is_file());
        assert!(!temporary.exists());
        assert!(unrelated.is_file());
        fs::remove_dir_all(root).expect("test cache should be removed");
    }

    #[test]
    fn maintenance_preserves_active_final_and_temporary_paths() {
        let root = Arc::new(test_root("active"));
        fs::create_dir_all(root.as_path()).expect("cache directory should be created");
        let active = root.join("book-10-100.cover");
        let newer = root.join("book-11-200.cover");
        let temporary = root.join("book-10-100.cover.tmp");
        fs::write(&active, b"active").expect("active cache should be written");
        fs::write(&newer, b"newer").expect("newer cache should be written");
        fs::write(&temporary, b"partial").expect("temporary cache should be written");
        let release = Arc::new(Barrier::new(2));
        let (started, observed) = mpsc::channel();
        let request_key = active.clone();
        let thread_release = Arc::clone(&release);
        let handle = thread::spawn(move || {
            epub_cover_requests::load_once(request_key, || {
                started.send(()).expect("request start should be observed");
                thread_release.wait();
                Ok(vec![1])
            })
        });
        observed.recv().expect("cover request should start");

        let result = maintain_at(root.as_path()).expect("maintenance should finish");

        assert_eq!(result.skipped_active_files, 2);
        assert!(active.is_file());
        assert!(temporary.is_file());
        release.wait();
        assert_eq!(handle.join().expect("request should finish"), Ok(vec![1]));

        let retry = maintain_at(root.as_path()).expect("later maintenance should finish");

        assert_eq!(retry.removed_revisions, 1);
        assert_eq!(retry.removed_temporary_files, 1);
        assert!(!active.exists());
        assert!(!temporary.exists());
        assert!(newer.is_file());
        fs::remove_dir_all(root.as_path()).expect("test cache should be removed");
    }

    #[test]
    fn cross_batch_revision_cleanup_retains_the_global_winner_and_retries_active_stale_entries() {
        let root = Arc::new(test_root("cross-batch-active"));
        fs::create_dir_all(root.as_path()).expect("cache directory should be created");
        let active_stale = root.join("shared-99-100.cover");
        fs::write(&active_stale, b"active stale").expect("stale cache should be written");
        let mut ordered_paths = Vec::new();
        for index in 0..(MAX_MAINTENANCE_ENTRIES - 1) {
            let path = root.join(format!("book{index}-1-100.cover"));
            fs::write(&path, b"current").expect("current cache should be written");
            ordered_paths.push(path);
        }
        ordered_paths.push(active_stale.clone());
        let current = root.join("shared-10-200.cover");
        fs::write(&current, b"global winner").expect("current cache should be written");
        ordered_paths.push(current.clone());

        let release = Arc::new(Barrier::new(2));
        let (started, observed) = mpsc::channel();
        let request_key = active_stale.clone();
        let thread_release = Arc::clone(&release);
        let handle = thread::spawn(move || {
            epub_cover_requests::load_once(request_key, || {
                started.send(()).expect("request start should be observed");
                thread_release.wait();
                Ok(vec![1])
            })
        });
        observed.recv().expect("cover request should start");
        let mut entries = ordered_paths.into_iter().map(Ok);

        let result = maintain_session(root.as_path(), &mut entries, |_, _| {})
            .expect("maintenance session should finish");

        assert!(result.skipped_active_files >= 1);
        assert!(active_stale.is_file());
        assert!(current.is_file());
        release.wait();
        assert_eq!(handle.join().expect("request should finish"), Ok(vec![1]));

        let retry = maintain_at(root.as_path()).expect("later maintenance should finish");

        assert_eq!(retry.removed_revisions, 1);
        assert!(!active_stale.exists());
        assert!(current.is_file());
        fs::remove_dir_all(root.as_path()).expect("test cache should be removed");
    }

    #[test]
    fn maintenance_preserves_an_empty_negative_cache() {
        let root = test_root("negative");
        fs::create_dir_all(&root).expect("cache directory should be created");
        let negative = root.join("book-10-100.cover");
        fs::write(&negative, []).expect("negative cache should be written");

        let result = maintain_at(&root).expect("maintenance should finish");

        assert_eq!(result.removed_revisions, 0);
        assert!(negative.is_file());
        assert_eq!(
            fs::metadata(&negative).expect("cache should exist").len(),
            0
        );
        fs::remove_dir_all(root).expect("test cache should be removed");
    }

    #[test]
    fn one_session_progresses_past_a_non_removable_first_batch() {
        let root = test_root("progress");
        fs::create_dir_all(&root).expect("cache directory should be created");
        let mut ordered_paths = Vec::new();
        for index in 0..MAX_MAINTENANCE_ENTRIES {
            let path = root.join(format!("book{index}-1-100.cover"));
            fs::write(&path, b"current").expect("current cache should be written");
            ordered_paths.push(path);
        }
        let temporary = root.join("late-1-100.cover.tmp");
        let stale = root.join("shared-99-100.cover");
        let current = root.join("shared-10-200.cover");
        fs::write(&temporary, b"partial").expect("temporary cache should be written");
        fs::write(&stale, b"stale").expect("stale cache should be written");
        fs::write(&current, b"current").expect("current cache should be written");
        ordered_paths.extend([temporary.clone(), stale.clone(), current.clone()]);
        let mut entries = ordered_paths.into_iter().map(Ok);
        let mut discovery_batches = Vec::new();

        let result = maintain_session(&root, &mut entries, |pass, size| {
            if pass == MaintenancePass::Discovery {
                discovery_batches.push(size);
            }
        })
        .expect("maintenance session should finish");

        assert_eq!(discovery_batches, [MAX_MAINTENANCE_ENTRIES, 3]);
        assert_eq!(result.inspected_entries, MAX_MAINTENANCE_ENTRIES + 3);
        assert_eq!(result.removed_temporary_files, 1);
        assert_eq!(result.removed_revisions, 1);
        assert!(!temporary.exists());
        assert!(!stale.exists());
        assert!(current.is_file());
        fs::remove_dir_all(root).expect("test cache should be removed");
    }

    #[test]
    fn every_internal_batch_is_bounded_while_the_session_reaches_exhaustion() {
        let root = test_root("bounded");
        fs::create_dir_all(&root).expect("cache directory should be created");
        let mut ordered_paths = Vec::new();
        for index in 0..(MAX_MAINTENANCE_ENTRIES * 2 + 1) {
            let path = root.join(format!("unrelated-{index}.txt"));
            fs::write(&path, b"unrelated").expect("unrelated file should be written");
            ordered_paths.push(path);
        }
        let mut entries = ordered_paths.into_iter().map(Ok);
        let mut batches = Vec::new();

        let result = maintain_session(&root, &mut entries, |pass, size| {
            batches.push((pass, size));
        })
        .expect("maintenance session should finish");

        assert_eq!(
            batches,
            [
                (MaintenancePass::Discovery, MAX_MAINTENANCE_ENTRIES),
                (MaintenancePass::Discovery, MAX_MAINTENANCE_ENTRIES),
                (MaintenancePass::Discovery, 1),
            ]
        );
        assert!(batches
            .iter()
            .all(|(_, size)| *size <= MAX_MAINTENANCE_ENTRIES));
        assert_eq!(result.inspected_entries, MAX_MAINTENANCE_ENTRIES * 2 + 1);
        assert_eq!(result.removed_temporary_files, 0);
        assert_eq!(result.removed_revisions, 0);
        fs::remove_dir_all(root).expect("test cache should be removed");
    }
}
