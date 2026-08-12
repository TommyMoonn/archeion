use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};

use crate::atomic_file::{
    transaction_path, AtomicFileSystem, AtomicReplaceError, BackupCleanup, PreparedAtomicFile,
    RealAtomicFileSystem,
};

use super::epub_diagnostics::EpubDiagnostics;
use super::{filesystem, metadata};

const CACHE_FILE: &str = "epub-analysis-cache.json";
const CACHE_VERSION: u8 = 1;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EpubFileSignature {
    pub(crate) size_bytes: u64,
    pub(crate) modified_at_millis: u64,
}

impl EpubFileSignature {
    pub(crate) fn from_path(path: &Path) -> Result<Self, String> {
        let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
        if !metadata.is_file() {
            return Err("The EPUB signature source is not a file.".to_string());
        }
        let modified_at_millis = metadata
            .modified()
            .map_err(|error| error.to_string())?
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_millis()
            .min(u128::from(u64::MAX)) as u64;
        Ok(Self {
            size_bytes: metadata.len(),
            modified_at_millis,
        })
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CachedEpubDigest {
    pub(crate) sha256: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct EpubAnalysisCacheEntry {
    pub(crate) signature: EpubFileSignature,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) digest: Option<CachedEpubDigest>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) diagnostics: Option<EpubDiagnostics>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub(crate) struct EpubAnalysisCache {
    version: u8,
    entries: BTreeMap<String, EpubAnalysisCacheEntry>,
}

impl Default for EpubAnalysisCache {
    fn default() -> Self {
        Self {
            version: CACHE_VERSION,
            entries: BTreeMap::new(),
        }
    }
}

impl EpubAnalysisCache {
    pub(crate) fn insert(
        &mut self,
        relative_path: &str,
        entry: EpubAnalysisCacheEntry,
    ) -> Result<(), String> {
        let normalized = normalize_epub_path(relative_path)?;
        self.entries.insert(normalized, entry);
        Ok(())
    }

    pub(crate) fn reusable_entry(
        &self,
        relative_path: &str,
        signature: &EpubFileSignature,
    ) -> Result<Option<&EpubAnalysisCacheEntry>, String> {
        let normalized = normalize_epub_path(relative_path)?;
        Ok(self
            .entries
            .get(&normalized)
            .filter(|entry| entry.signature == *signature))
    }

    pub(crate) fn reusable_digest(
        &self,
        relative_path: &str,
        signature: &EpubFileSignature,
    ) -> Result<Option<&CachedEpubDigest>, String> {
        Ok(self
            .reusable_entry(relative_path, signature)?
            .and_then(|entry| entry.digest.as_ref()))
    }

    pub(crate) fn reusable_diagnostics(
        &self,
        relative_path: &str,
        signature: &EpubFileSignature,
    ) -> Result<Option<&EpubDiagnostics>, String> {
        Ok(self
            .reusable_entry(relative_path, signature)?
            .and_then(|entry| entry.diagnostics.as_ref()))
    }

    pub(crate) fn update_digest(
        &mut self,
        relative_path: &str,
        signature: EpubFileSignature,
        digest: CachedEpubDigest,
    ) -> Result<(), String> {
        let normalized = normalize_epub_path(relative_path)?;
        match self.entries.get_mut(&normalized) {
            Some(entry) if entry.signature == signature => entry.digest = Some(digest),
            _ => {
                self.entries.insert(
                    normalized,
                    EpubAnalysisCacheEntry {
                        signature,
                        digest: Some(digest),
                        diagnostics: None,
                    },
                );
            }
        }
        Ok(())
    }

    pub(crate) fn update_diagnostics(
        &mut self,
        relative_path: &str,
        signature: EpubFileSignature,
        diagnostics: EpubDiagnostics,
    ) -> Result<(), String> {
        let normalized = normalize_epub_path(relative_path)?;
        match self.entries.get_mut(&normalized) {
            Some(entry) if entry.signature == signature => entry.diagnostics = Some(diagnostics),
            _ => {
                self.entries.insert(
                    normalized,
                    EpubAnalysisCacheEntry {
                        signature,
                        digest: None,
                        diagnostics: Some(diagnostics),
                    },
                );
            }
        }
        Ok(())
    }

    pub(crate) fn invalidate(&mut self, relative_path: &str) -> Result<bool, String> {
        let normalized = normalize_epub_path(relative_path)?;
        let previous_len = self.entries.len();
        self.entries
            .retain(|path, _| !path.eq_ignore_ascii_case(&normalized));
        Ok(self.entries.len() != previous_len)
    }

    pub(crate) fn invalidate_prefix(&mut self, relative_prefix: &str) -> Result<bool, String> {
        let normalized = filesystem::normalize_archive_relative_path(relative_prefix)?;
        let prefix = format!("{normalized}/");
        let previous_len = self.entries.len();
        self.entries.retain(|path, _| {
            !path.eq_ignore_ascii_case(&normalized)
                && !path
                    .get(..prefix.len())
                    .is_some_and(|candidate| candidate.eq_ignore_ascii_case(&prefix))
        });
        Ok(self.entries.len() != previous_len)
    }

    pub(crate) fn clear(&mut self) -> bool {
        let changed = !self.entries.is_empty();
        self.entries.clear();
        changed
    }

    fn is_valid(&self) -> bool {
        self.version == CACHE_VERSION
            && self.entries.iter().all(|(relative_path, entry)| {
                normalize_epub_path(relative_path).as_deref() == Ok(relative_path.as_str())
                    && entry
                        .digest
                        .as_ref()
                        .is_none_or(|digest| valid_sha256(&digest.sha256))
                    && entry
                        .diagnostics
                        .as_ref()
                        .is_none_or(EpubDiagnostics::has_current_format)
            })
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum EpubAnalysisCacheLoadStatus {
    Current,
    Rebuildable,
}

pub(crate) struct EpubAnalysisCacheLoad {
    pub(crate) cache: EpubAnalysisCache,
    pub(crate) status: EpubAnalysisCacheLoadStatus,
}

fn normalize_epub_path(relative_path: &str) -> Result<String, String> {
    let normalized = filesystem::normalize_archive_relative_path(relative_path)?;
    if !normalized.to_ascii_lowercase().ends_with(".epub") {
        return Err("EPUB analysis cache paths must identify an EPUB file.".to_string());
    }
    Ok(normalized)
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn cache_path(root: &Path) -> PathBuf {
    root.join(metadata::METADATA_DIRECTORY).join(CACHE_FILE)
}

pub(crate) fn load_at(root: &Path) -> Result<EpubAnalysisCacheLoad, String> {
    let path = cache_path(root);
    match fs::read(path) {
        Ok(contents) => match serde_json::from_slice::<EpubAnalysisCache>(&contents) {
            Ok(cache) if cache.is_valid() => Ok(EpubAnalysisCacheLoad {
                cache,
                status: EpubAnalysisCacheLoadStatus::Current,
            }),
            _ => Ok(EpubAnalysisCacheLoad {
                cache: EpubAnalysisCache::default(),
                status: EpubAnalysisCacheLoadStatus::Rebuildable,
            }),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(EpubAnalysisCacheLoad {
            cache: EpubAnalysisCache::default(),
            status: EpubAnalysisCacheLoadStatus::Rebuildable,
        }),
        Err(error) => Err(error.to_string()),
    }
}

fn replace_error(error: AtomicReplaceError) -> String {
    match error {
        AtomicReplaceError::DestinationNotFile => {
            "The EPUB analysis cache path is not a file.".to_string()
        }
        AtomicReplaceError::MoveDestinationToBackup(error)
        | AtomicReplaceError::ReplaceMissingDestination(error)
        | AtomicReplaceError::RemoveBackup(error) => error,
        AtomicReplaceError::ReplaceRestored { replace_error } => format!(
            "EPUB analysis cache save failed and the previous cache was restored: {replace_error}"
        ),
        AtomicReplaceError::RestoreFailed { restore_error } => format!(
            "EPUB analysis cache save failed and the previous cache could not be restored: {restore_error}"
        ),
    }
}

fn serialized_cache(cache: &EpubAnalysisCache) -> Result<Vec<u8>, String> {
    if !cache.is_valid() {
        return Err("The EPUB analysis cache contains invalid derived state.".to_string());
    }
    let mut contents = serde_json::to_vec_pretty(cache).map_err(|error| error.to_string())?;
    contents.push(b'\n');
    Ok(contents)
}

fn save_with_file_system(
    root: &Path,
    cache: &EpubAnalysisCache,
    fs_ops: &impl AtomicFileSystem,
) -> Result<(), String> {
    let path = cache_path(root);
    let parent = path
        .parent()
        .ok_or_else(|| "The EPUB analysis cache folder is unavailable.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let contents = serialized_cache(cache)?;
    let temporary = PreparedAtomicFile::write(transaction_path(&path, "tmp-write"), &contents)
        .map_err(|error| error.into_source().to_string())?;
    let backup = transaction_path(&path, "write-backup");
    temporary
        .replace(&path, &backup, BackupCleanup::BestEffort, fs_ops)
        .map_err(replace_error)
}

pub(crate) fn save_at(root: &Path, cache: &EpubAnalysisCache) -> Result<(), String> {
    save_with_file_system(root, cache, &RealAtomicFileSystem)
}

pub(crate) fn save_after_invalidation_at(
    root: &Path,
    cache: &EpubAnalysisCache,
) -> Result<(), String> {
    if let Err(error) = save_at(root, cache) {
        let removal_error = fs::remove_file(cache_path(root))
            .err()
            .filter(|removal_error| removal_error.kind() != std::io::ErrorKind::NotFound);
        return Err(match removal_error {
            Some(removal_error) => format!(
                "{error}; the stale EPUB analysis cache could not be removed: {removal_error}"
            ),
            None => error,
        });
    }
    Ok(())
}

fn update_at(
    root: &Path,
    update: impl FnOnce(&mut EpubAnalysisCache) -> Result<bool, String>,
) -> Result<bool, String> {
    let mut cache = load_at(root)?.cache;
    let changed = update(&mut cache)?;
    if changed {
        save_after_invalidation_at(root, &cache)?;
    }
    Ok(changed)
}

pub(crate) fn invalidate_paths_at(root: &Path, relative_paths: &[String]) -> Result<bool, String> {
    update_at(root, |cache| {
        relative_paths.iter().try_fold(
            false,
            |changed, path| Ok(cache.invalidate(path)? || changed),
        )
    })
}

pub(crate) fn invalidate_prefixes_at(
    root: &Path,
    relative_prefixes: &[String],
) -> Result<bool, String> {
    update_at(root, |cache| {
        relative_prefixes.iter().try_fold(false, |changed, prefix| {
            Ok(cache.invalidate_prefix(prefix)? || changed)
        })
    })
}

pub(crate) fn clear_at(root: &Path) -> Result<bool, String> {
    update_at(root, |cache| Ok(cache.clear()))
}

#[cfg(test)]
pub(crate) fn seed_test_entries(root: &Path, relative_paths: &[&str]) {
    let mut cache = EpubAnalysisCache::default();
    for (index, relative_path) in relative_paths.iter().enumerate() {
        cache
            .insert(
                relative_path,
                EpubAnalysisCacheEntry {
                    signature: EpubFileSignature {
                        size_bytes: index as u64 + 1,
                        modified_at_millis: index as u64 + 1,
                    },
                    digest: Some(CachedEpubDigest {
                        sha256: char::from(b'a' + index as u8).to_string().repeat(64),
                    }),
                    diagnostics: None,
                },
            )
            .unwrap();
    }
    save_at(root, &cache).unwrap();
}

#[cfg(test)]
pub(crate) fn contains_test_entry(root: &Path, relative_path: &str, index: usize) -> bool {
    load_at(root)
        .unwrap()
        .cache
        .reusable_entry(
            relative_path,
            &EpubFileSignature {
                size_bytes: index as u64 + 1,
                modified_at_millis: index as u64 + 1,
            },
        )
        .unwrap()
        .is_some()
}

#[cfg(test)]
mod tests {
    use std::{collections::BTreeMap, fs, path::Path, time::SystemTime};

    use crate::atomic_file::AtomicFileSystem;

    use super::{
        cache_path, load_at, save_at, save_with_file_system, CachedEpubDigest, EpubAnalysisCache,
        EpubAnalysisCacheEntry, EpubAnalysisCacheLoadStatus, EpubFileSignature,
    };
    use crate::commands::epub_diagnostics::{
        EpubDiagnosticCode, EpubDiagnosticIssue, EpubDiagnosticSeverity, EpubDiagnostics,
    };

    fn test_root(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-epub-analysis-cache-{label}-{nonce}"))
    }

    fn signature(size_bytes: u64, modified_at_millis: u64) -> EpubFileSignature {
        EpubFileSignature {
            size_bytes,
            modified_at_millis,
        }
    }

    fn entry(signature: EpubFileSignature, marker: char) -> EpubAnalysisCacheEntry {
        EpubAnalysisCacheEntry {
            signature,
            digest: Some(CachedEpubDigest {
                sha256: marker.to_string().repeat(64),
            }),
            diagnostics: Some(EpubDiagnostics::new(vec![EpubDiagnosticIssue {
                code: EpubDiagnosticCode::ReadingResourceMissing,
                severity: EpubDiagnosticSeverity::Error,
                message_inputs: BTreeMap::from([(
                    "manifestId".to_string(),
                    "chapter-1".to_string(),
                )]),
                resource_path: Some("Text/chapter.xhtml".to_string()),
            }])),
        }
    }

    #[test]
    fn current_cache_round_trips_deterministically() {
        let root = test_root("round-trip");
        fs::create_dir_all(&root).unwrap();
        let mut cache = EpubAnalysisCache::default();
        cache
            .insert("Series\\Second.epub", entry(signature(22, 2), 'b'))
            .unwrap();
        cache
            .insert("First.epub", entry(signature(11, 1), 'a'))
            .unwrap();

        save_at(&root, &cache).unwrap();
        let first_contents = fs::read(cache_path(&root)).unwrap();
        let loaded = load_at(&root).unwrap();
        assert_eq!(loaded.status, EpubAnalysisCacheLoadStatus::Current);
        assert_eq!(loaded.cache, cache);
        save_at(&root, &loaded.cache).unwrap();
        assert_eq!(fs::read(cache_path(&root)).unwrap(), first_contents);
        assert!(!root.join(".archeion/backups").exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn reuses_only_an_exact_matching_signature() {
        let mut cache = EpubAnalysisCache::default();
        let current = signature(11, 7);
        cache
            .insert("Books/Novel.epub", entry(current.clone(), 'a'))
            .unwrap();

        assert!(cache
            .reusable_entry("Books\\Novel.epub", &current)
            .unwrap()
            .is_some());
        assert!(cache
            .reusable_entry("Books/Novel.epub", &signature(12, 7))
            .unwrap()
            .is_none());
        assert!(cache
            .reusable_entry("Books/Novel.epub", &signature(11, 8))
            .unwrap()
            .is_none());
    }

    #[test]
    fn missing_malformed_unsupported_and_invalid_paths_are_rebuildable() {
        let root = test_root("rebuildable");
        fs::create_dir_all(root.join(".archeion")).unwrap();
        assert_eq!(
            load_at(&root).unwrap().status,
            EpubAnalysisCacheLoadStatus::Rebuildable
        );

        fs::write(cache_path(&root), b"{not-json").unwrap();
        assert_eq!(
            load_at(&root).unwrap().status,
            EpubAnalysisCacheLoadStatus::Rebuildable
        );

        fs::write(cache_path(&root), br#"{"version":2,"entries":{}}"#).unwrap();
        assert_eq!(
            load_at(&root).unwrap().status,
            EpubAnalysisCacheLoadStatus::Rebuildable
        );

        fs::write(
            cache_path(&root),
            br#"{"version":1,"entries":{"../outside.epub":{"signature":{"sizeBytes":1,"modifiedAtMillis":1}}}}"#,
        )
        .unwrap();
        assert_eq!(
            load_at(&root).unwrap().status,
            EpubAnalysisCacheLoadStatus::Rebuildable
        );
        assert!(EpubAnalysisCache::default()
            .insert("../outside.epub", entry(signature(1, 1), 'a'))
            .is_err());
        assert!(EpubAnalysisCache::default()
            .insert("notes.txt", entry(signature(1, 1), 'a'))
            .is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn targeted_invalidation_preserves_unrelated_entries() {
        let mut cache = EpubAnalysisCache::default();
        let first_signature = signature(10, 1);
        let second_signature = signature(20, 2);
        cache
            .insert("First.epub", entry(first_signature.clone(), 'a'))
            .unwrap();
        cache
            .insert("Shelf/Second.epub", entry(second_signature.clone(), 'b'))
            .unwrap();

        assert!(cache.invalidate("First.epub").unwrap());
        assert!(cache
            .reusable_entry("First.epub", &first_signature)
            .unwrap()
            .is_none());
        assert!(cache
            .reusable_entry("Shelf/Second.epub", &second_signature)
            .unwrap()
            .is_some());
    }

    #[test]
    fn prefix_invalidation_retires_only_nested_analysis_entries() {
        let mut cache = EpubAnalysisCache::default();
        let nested_signature = signature(10, 1);
        let unrelated_signature = signature(20, 2);
        cache
            .insert(
                "Series/Nested/Book.epub",
                entry(nested_signature.clone(), 'a'),
            )
            .unwrap();
        cache
            .insert("Other/Book.epub", entry(unrelated_signature.clone(), 'b'))
            .unwrap();

        assert!(cache.invalidate_prefix("series").unwrap());
        assert!(cache
            .reusable_entry("Series/Nested/Book.epub", &nested_signature)
            .unwrap()
            .is_none());
        assert!(cache
            .reusable_entry("Other/Book.epub", &unrelated_signature)
            .unwrap()
            .is_some());
    }

    struct FailFinalRename;

    impl AtomicFileSystem for FailFinalRename {
        fn rename(&self, source: &Path, destination: &Path) -> Result<(), String> {
            let source_name = source
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            if source_name.contains("tmp-write")
                && destination.file_name().and_then(|name| name.to_str()) == Some(super::CACHE_FILE)
            {
                return Err("replacement blocked".to_string());
            }
            fs::rename(source, destination).map_err(|error| error.to_string())
        }

        fn remove_file(&self, path: &Path) -> Result<(), String> {
            fs::remove_file(path).map_err(|error| error.to_string())
        }
    }

    #[test]
    fn failed_atomic_replacement_preserves_previous_valid_cache() {
        let root = test_root("atomic-failure");
        fs::create_dir_all(&root).unwrap();
        let mut previous = EpubAnalysisCache::default();
        previous
            .insert("Novel.epub", entry(signature(10, 1), 'a'))
            .unwrap();
        save_at(&root, &previous).unwrap();

        let mut replacement = EpubAnalysisCache::default();
        replacement
            .insert("Novel.epub", entry(signature(20, 2), 'b'))
            .unwrap();
        assert!(save_with_file_system(&root, &replacement, &FailFinalRename).is_err());

        let loaded = load_at(&root).unwrap();
        assert_eq!(loaded.status, EpubAnalysisCacheLoadStatus::Current);
        assert_eq!(loaded.cache, previous);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn file_signature_reads_size_and_modified_time() {
        let root = test_root("signature");
        fs::create_dir_all(&root).unwrap();
        let path = root.join("Novel.epub");
        fs::write(&path, b"epub bytes").unwrap();

        let actual = EpubFileSignature::from_path(&path).unwrap();
        assert_eq!(actual.size_bytes, 10);
        assert!(actual.modified_at_millis > 0);
        fs::remove_dir_all(root).unwrap();
    }
}
