use std::{
    fs::File,
    io::{BufReader, Read},
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex, MutexGuard},
};

use sha2::{Digest, Sha256};

use super::{
    epub_analysis_cache::{self, CachedEpubDigest, EpubAnalysisCache, EpubFileSignature},
    epub_diagnostics::EpubDiagnostics,
    filesystem,
};

const DIGEST_BUFFER_BYTES: usize = 64 * 1024;
const MAX_CONCURRENT_DIGESTS: usize = 2;
const RETIRED_DIGEST_ERROR: &str = "The EPUB digest request belongs to a retired archive.";
const CHANGED_DIGEST_ERROR: &str = "The EPUB changed while its digest was being calculated.";

#[derive(Clone)]
pub(crate) struct EpubDigestArchiveSession {
    state: Arc<ArchiveDigestState>,
}

struct ArchiveDigestState {
    cache: Mutex<EpubAnalysisCache>,
    root: PathBuf,
}

#[derive(Default)]
struct DigestGateState {
    active: usize,
}

struct DigestGate {
    state: Mutex<DigestGateState>,
    available: Condvar,
    limit: usize,
}

impl DigestGate {
    fn new(limit: usize) -> Self {
        Self {
            state: Mutex::new(DigestGateState::default()),
            available: Condvar::new(),
            limit,
        }
    }

    fn acquire(&self) -> DigestPermit<'_> {
        let mut state = recover_lock(&self.state);
        while state.active == self.limit {
            state = self
                .available
                .wait(state)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
        }
        state.active += 1;
        DigestPermit { gate: self }
    }
}

struct DigestPermit<'a> {
    gate: &'a DigestGate,
}

impl Drop for DigestPermit<'_> {
    fn drop(&mut self) {
        let mut state = recover_lock(&self.gate.state);
        state.active = state.active.saturating_sub(1);
        self.gate.available.notify_one();
    }
}

pub(crate) struct EpubDigestService {
    active: Mutex<Option<Arc<ArchiveDigestState>>>,
    gate: DigestGate,
}

impl Default for EpubDigestService {
    fn default() -> Self {
        Self {
            active: Mutex::new(None),
            gate: DigestGate::new(MAX_CONCURRENT_DIGESTS),
        }
    }
}

impl EpubDigestService {
    pub(crate) fn activate_archive(
        &self,
        root: PathBuf,
    ) -> Result<EpubDigestArchiveSession, String> {
        let loaded = epub_analysis_cache::load_at(&root)?;
        let state = Arc::new(ArchiveDigestState {
            cache: Mutex::new(loaded.cache),
            root,
        });
        *recover_lock(&self.active) = Some(state.clone());
        Ok(EpubDigestArchiveSession { state })
    }

    pub(crate) fn digest(
        &self,
        session: &EpubDigestArchiveSession,
        relative_path: &str,
    ) -> Result<CachedEpubDigest, String> {
        self.digest_with(session, relative_path, hash_file)
    }

    pub(crate) fn reusable_diagnostics(
        &self,
        session: &EpubDigestArchiveSession,
        relative_path: &str,
        signature: &EpubFileSignature,
    ) -> Result<Option<EpubDiagnostics>, String> {
        self.ensure_current(session)?;
        let diagnostics = recover_lock(&session.state.cache)
            .reusable_diagnostics(relative_path, signature)?
            .cloned();
        self.ensure_current(session)?;
        Ok(diagnostics)
    }

    pub(crate) fn publish_diagnostics(
        &self,
        session: &EpubDigestArchiveSession,
        relative_path: &str,
        signature: &EpubFileSignature,
        diagnostics: EpubDiagnostics,
    ) -> Result<(), String> {
        self.ensure_current(session)?;
        let normalized = filesystem::normalize_archive_relative_path(relative_path)?;
        let path = filesystem::resolve_existing_epub_path(&session.state.root, &normalized)?;
        if EpubFileSignature::from_path(&path)? != *signature {
            return Err(CHANGED_DIGEST_ERROR.to_string());
        }
        let active = recover_lock(&self.active);
        if !active
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, &session.state))
        {
            return Err(RETIRED_DIGEST_ERROR.to_string());
        }
        let mut next_cache = recover_lock(&session.state.cache).clone();
        next_cache.update_diagnostics(&normalized, signature.clone(), diagnostics)?;
        epub_analysis_cache::save_at(&session.state.root, &next_cache)?;
        *recover_lock(&session.state.cache) = next_cache;
        Ok(())
    }

    fn digest_with<H>(
        &self,
        session: &EpubDigestArchiveSession,
        relative_path: &str,
        hash: H,
    ) -> Result<CachedEpubDigest, String>
    where
        H: FnOnce(&Path) -> Result<CachedEpubDigest, String>,
    {
        self.ensure_current(session)?;
        let normalized = filesystem::normalize_archive_relative_path(relative_path)?;
        if !normalized.to_ascii_lowercase().ends_with(".epub") {
            return Err("EPUB digest paths must identify an EPUB file.".to_string());
        }
        let path = filesystem::resolve_existing_epub_path(&session.state.root, &normalized)?;
        let signature = EpubFileSignature::from_path(&path)?;
        if let Some(digest) = recover_lock(&session.state.cache)
            .reusable_digest(&normalized, &signature)?
            .cloned()
        {
            self.ensure_current(session)?;
            return Ok(digest);
        }

        let _permit = self.gate.acquire();
        self.ensure_current(session)?;
        let digest = hash(&path)?;
        let active = recover_lock(&self.active);
        if !active
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, &session.state))
        {
            return Err(RETIRED_DIGEST_ERROR.to_string());
        }
        if EpubFileSignature::from_path(&path)? != signature {
            return Err(CHANGED_DIGEST_ERROR.to_string());
        }
        let mut next_cache = recover_lock(&session.state.cache).clone();
        next_cache.update_digest(&normalized, signature, digest.clone())?;
        epub_analysis_cache::save_at(&session.state.root, &next_cache)?;
        *recover_lock(&session.state.cache) = next_cache;
        drop(active);
        Ok(digest)
    }

    fn ensure_current(&self, session: &EpubDigestArchiveSession) -> Result<(), String> {
        if recover_lock(&self.active)
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, &session.state))
        {
            Ok(())
        } else {
            Err(RETIRED_DIGEST_ERROR.to_string())
        }
    }
}

fn hash_file(path: &Path) -> Result<CachedEpubDigest, String> {
    let file = File::open(path).map_err(|error| error.to_string())?;
    hash_reader(BufReader::with_capacity(DIGEST_BUFFER_BYTES, file))
}

fn hash_reader(mut reader: impl Read) -> Result<CachedEpubDigest, String> {
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; DIGEST_BUFFER_BYTES];
    loop {
        let read = reader
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(CachedEpubDigest {
        sha256: format!("{:x}", hasher.finalize()),
    })
}

fn recover_lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        io::{self, Cursor, Read},
        path::Path,
        sync::{Arc, Barrier, Mutex},
        thread,
        time::{Duration, SystemTime},
    };

    use super::{
        hash_reader, recover_lock, EpubDigestService, CHANGED_DIGEST_ERROR, DIGEST_BUFFER_BYTES,
        MAX_CONCURRENT_DIGESTS, RETIRED_DIGEST_ERROR,
    };
    use crate::commands::epub_analysis_cache::{self, EpubFileSignature};

    fn test_root(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-epub-digest-{label}-{nonce}"))
    }

    fn write_epub(root: &Path, relative_path: &str, contents: &[u8]) {
        let path = root.join(relative_path);
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, contents).unwrap();
    }

    #[test]
    fn complete_file_bytes_define_sha256_identity() {
        let first = hash_reader(Cursor::new(b"same complete EPUB bytes")).unwrap();
        let second = hash_reader(Cursor::new(b"same complete EPUB bytes")).unwrap();
        let different = hash_reader(Cursor::new(b"different complete EPUB bytes")).unwrap();

        assert_eq!(first, second);
        assert_ne!(first, different);
        assert_eq!(first.sha256.len(), 64);
        assert_eq!(
            hash_reader(Cursor::new(b"abc")).unwrap().sha256,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    struct BoundedReader {
        remaining: usize,
        largest_request: usize,
    }

    impl Read for BoundedReader {
        fn read(&mut self, buffer: &mut [u8]) -> io::Result<usize> {
            self.largest_request = self.largest_request.max(buffer.len());
            let read = self.remaining.min(buffer.len());
            buffer[..read].fill(b'x');
            self.remaining -= read;
            Ok(read)
        }
    }

    #[test]
    fn representative_large_input_is_hashed_through_a_bounded_buffer() {
        let mut reader = BoundedReader {
            remaining: 12 * 1024 * 1024,
            largest_request: 0,
        };
        let digest = hash_reader(&mut reader).unwrap();

        assert_eq!(digest.sha256.len(), 64);
        assert_eq!(reader.remaining, 0);
        assert_eq!(reader.largest_request, DIGEST_BUFFER_BYTES);
    }

    #[test]
    fn matching_signature_reuses_cache_and_changed_signature_recomputes() {
        let root = test_root("cache-reuse");
        fs::create_dir_all(&root).unwrap();
        write_epub(&root, "Novel.epub", b"first bytes");
        let service = EpubDigestService::default();
        let session = service.activate_archive(root.clone()).unwrap();
        let first = service.digest(&session, "Novel.epub").unwrap();
        let reused = service
            .digest_with(&session, "Novel.epub", |_| panic!("cache should be reused"))
            .unwrap();
        assert_eq!(reused, first);

        write_epub(&root, "Novel.epub", b"different bytes with another size");
        let recomputed = service.digest(&session, "Novel.epub").unwrap();
        assert_ne!(recomputed, first);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn mutation_during_hashing_is_not_published() {
        let root = test_root("mutation");
        fs::create_dir_all(&root).unwrap();
        write_epub(&root, "Novel.epub", b"original");
        let service = EpubDigestService::default();
        let session = service.activate_archive(root.clone()).unwrap();
        let result = service.digest_with(&session, "Novel.epub", |path| {
            let digest = hash_reader(Cursor::new(fs::read(path).unwrap())).unwrap();
            fs::write(path, b"replacement with changed size").unwrap();
            Ok(digest)
        });

        assert_eq!(result.unwrap_err(), CHANGED_DIGEST_ERROR);
        let signature = EpubFileSignature::from_path(&root.join("Novel.epub")).unwrap();
        assert!(epub_analysis_cache::load_at(&root)
            .unwrap()
            .cache
            .reusable_digest("Novel.epub", &signature)
            .unwrap()
            .is_none());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn archive_replacement_retires_pending_publication() {
        let first_root = test_root("archive-a");
        let second_root = test_root("archive-b");
        fs::create_dir_all(&first_root).unwrap();
        fs::create_dir_all(&second_root).unwrap();
        write_epub(&first_root, "Novel.epub", b"archive a");
        let service = EpubDigestService::default();
        let first_session = service.activate_archive(first_root.clone()).unwrap();
        let result = service.digest_with(&first_session, "Novel.epub", |path| {
            let digest = hash_reader(Cursor::new(fs::read(path).unwrap())).unwrap();
            service.activate_archive(second_root.clone()).unwrap();
            Ok(digest)
        });

        assert_eq!(result.unwrap_err(), RETIRED_DIGEST_ERROR);
        assert!(!first_root
            .join(".archeion/epub-analysis-cache.json")
            .exists());
        fs::remove_dir_all(first_root).unwrap();
        fs::remove_dir_all(second_root).unwrap();
    }

    #[test]
    fn concurrent_digest_work_never_exceeds_the_service_bound() {
        let root = test_root("concurrency");
        fs::create_dir_all(&root).unwrap();
        let service = Arc::new(EpubDigestService::default());
        let session = service.activate_archive(root.clone()).unwrap();
        let barrier = Arc::new(Barrier::new(MAX_CONCURRENT_DIGESTS));
        let active = Arc::new(Mutex::new(0_usize));
        let maximum = Arc::new(Mutex::new(0_usize));
        let mut workers = Vec::new();

        for index in 0..(MAX_CONCURRENT_DIGESTS + 2) {
            let relative_path = format!("Book-{index}.epub");
            write_epub(&root, &relative_path, relative_path.as_bytes());
            let service = service.clone();
            let session = session.clone();
            let barrier = barrier.clone();
            let active = active.clone();
            let maximum = maximum.clone();
            workers.push(thread::spawn(move || {
                service
                    .digest_with(&session, &relative_path, |path| {
                        {
                            let mut count = recover_lock(&active);
                            *count += 1;
                            let mut observed = recover_lock(&maximum);
                            *observed = (*observed).max(*count);
                        }
                        barrier.wait();
                        thread::sleep(Duration::from_millis(10));
                        let digest = hash_reader(Cursor::new(fs::read(path).unwrap()));
                        *recover_lock(&active) -= 1;
                        digest
                    })
                    .unwrap();
            }));
        }
        for worker in workers {
            worker.join().unwrap();
        }

        assert_eq!(*recover_lock(&maximum), MAX_CONCURRENT_DIGESTS);
        fs::remove_dir_all(root).unwrap();
    }
}
