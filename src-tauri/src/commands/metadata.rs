use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, Weak},
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tauri::Emitter;

use crate::atomic_file::{
    discard_staged_replacements, read_replacement_candidate, recover_atomic_replace,
    transaction_path, AtomicFileSystem, AtomicReplaceError, BackupCleanup, PreparedAtomicFile,
    RealAtomicFileSystem,
};
use crate::sha256::sha256_hex;

use super::{
    annotations_metadata::validate_annotations_metadata,
    archive,
    archive_backup::{ArchiveBackupLayout, MetadataDocument},
    archive_root, epub_metadata,
};

pub(crate) const METADATA_DIRECTORY: &str = ".archeion";
pub(crate) const SCANNER_CACHE_FILE: &str = "scanner-cache.json";

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ReaderPresentation {
    Archeion,
    Publisher,
}

fn deserialize_reader_presentation<'de, D>(
    deserializer: D,
) -> Result<Option<ReaderPresentation>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(match value.as_str() {
        Some("publisher") => Some(ReaderPresentation::Publisher),
        Some("archeion") => Some(ReaderPresentation::Archeion),
        _ => None,
    })
}

fn deserialize_added_at<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(value.as_str().map(str::to_owned))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryBookMetadata {
    pub relative_path: String,
    #[serde(default)]
    pub is_favorite: bool,
    #[serde(
        default,
        deserialize_with = "deserialize_reader_presentation",
        skip_serializing_if = "Option::is_none"
    )]
    pub reader_presentation: Option<ReaderPresentation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cover_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_metadata: Option<epub_metadata::EpubPackageMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_size: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_modified_at: Option<u64>,
    #[serde(
        default,
        deserialize_with = "deserialize_added_at",
        skip_serializing_if = "Option::is_none"
    )]
    pub added_at: Option<String>,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct LibraryMetadata {
    pub version: u8,
    pub books: BTreeMap<String, LibraryBookMetadata>,
}

impl Default for LibraryMetadata {
    fn default() -> Self {
        Self {
            version: 1,
            books: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingProgress {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cfi: Option<String>,
    #[serde(default)]
    pub percent: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub manually_marked_read: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_opened_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct ProgressMetadata {
    pub version: u8,
    pub progress: BTreeMap<String, ReadingProgress>,
}

impl Default for ProgressMetadata {
    fn default() -> Self {
        Self {
            version: 1,
            progress: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScannerCacheEntry {
    #[serde(default)]
    pub size: u64,
    #[serde(default)]
    pub modified_at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_metadata: Option<epub_metadata::EpubPackageMetadata>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata_error: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
pub struct ScannerCache {
    pub version: u8,
    pub entries: BTreeMap<String, ScannerCacheEntry>,
}

impl Default for ScannerCache {
    fn default() -> Self {
        Self {
            version: 1,
            entries: BTreeMap::new(),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataBundle {
    library: LibraryMetadata,
    progress: ProgressMetadata,
}

fn metadata_path(root: &Path) -> PathBuf {
    root.join(METADATA_DIRECTORY)
}

const MAX_METADATA_BACKUPS: usize = 5;

// Metadata replacement temporarily moves the active sidecar to a backup path.
static ARCHIVE_METADATA_IO: Mutex<BTreeMap<String, Weak<Mutex<()>>>> = Mutex::new(BTreeMap::new());

fn with_archive_metadata<T>(
    root: &Path,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let key = archive_root::display_archive_path(root);
    #[cfg(windows)]
    let key = key.to_lowercase();
    let access = {
        let mut archives = ARCHIVE_METADATA_IO
            .lock()
            .map_err(|_| "Archive metadata access is unavailable.".to_string())?;
        archives.retain(|_, weak| weak.strong_count() != 0);
        let entry = archives.entry(key).or_default();
        if let Some(access) = entry.upgrade() {
            access
        } else {
            let access = Arc::new(Mutex::new(()));
            *entry = Arc::downgrade(&access);
            access
        }
    };
    let _guard = access
        .lock()
        .map_err(|_| "Archive metadata access is unavailable.".to_string())?;
    operation()
}

fn timestamp_suffix() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default()
}

fn backup_existing_json(root: &Path, document: MetadataDocument) -> Result<(), String> {
    let layout = ArchiveBackupLayout::new(root);
    let path = layout.active_document_path(document);
    if !path.exists() {
        return Ok(());
    }

    let existing_contents = fs::read(&path).map_err(|error| error.to_string())?;
    if serde_json::from_slice::<serde_json::Value>(&existing_contents).is_err() {
        let corrupt_path =
            layout.timestamped_backup_path(document, "corrupt", timestamp_suffix())?;
        fs::rename(&path, corrupt_path).map_err(|error| error.to_string())?;
        layout.prune_timestamped_backups(document, "corrupt", MAX_METADATA_BACKUPS)?;
        return Ok(());
    }

    let stable_backup = layout.stable_backup_path(document)?;
    let stable_contents = stable_backup
        .exists()
        .then(|| fs::read(&stable_backup).map_err(|error| error.to_string()))
        .transpose()?;
    if let Some(stable_contents) = stable_contents.as_deref() {
        if stable_contents != existing_contents
            && !layout.timestamped_backup_contains(document, "backup", stable_contents)?
        {
            let migrated_history =
                layout.timestamped_backup_path(document, "backup", timestamp_suffix())?;
            fs::copy(&stable_backup, migrated_history).map_err(|error| error.to_string())?;
        }
    }
    let timestamped_backup =
        layout.timestamped_backup_path(document, "backup", timestamp_suffix())?;
    fs::copy(&path, stable_backup).map_err(|error| error.to_string())?;
    fs::copy(&path, timestamped_backup).map_err(|error| error.to_string())?;
    layout.prune_timestamped_backups(document, "backup", MAX_METADATA_BACKUPS)
}

fn metadata_replace_error(error: AtomicReplaceError) -> String {
    match error {
        AtomicReplaceError::DestinationNotFile => "Metadata path is not a file.".to_string(),
        AtomicReplaceError::MoveDestinationToBackup(error)
        | AtomicReplaceError::ReplaceMissingDestination(error)
        | AtomicReplaceError::RemoveBackup(error)
        | AtomicReplaceError::SyncDirectory(error) => error,
        AtomicReplaceError::ReplaceRestored { replace_error } => {
            format!("Metadata save failed and the previous file was restored: {replace_error}")
        }
        AtomicReplaceError::RestoreFailed { restore_error } => format!(
            "Metadata save failed and the previous file could not be restored: {restore_error}"
        ),
    }
}

fn write_json_with_fs<T: Serialize>(
    root: &Path,
    document: MetadataDocument,
    value: &T,
    backup: bool,
    fs_ops: &impl AtomicFileSystem,
) -> Result<(), String> {
    let layout = ArchiveBackupLayout::new(root);
    layout.migrate_metadata_document(document, MAX_METADATA_BACKUPS)?;
    let path = layout.active_document_path(document);
    let parent = path
        .parent()
        .ok_or_else(|| "Metadata directory is unavailable.".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let contents = serde_json::to_vec_pretty(value).map_err(|error| error.to_string())?;
    serde_json::from_slice::<serde_json::Value>(&contents)
        .map_err(|error| format!("Metadata JSON could not be validated: {error}"))?;

    let temporary = PreparedAtomicFile::write(transaction_path(&path, "tmp-write"), &contents)
        .map_err(|error| error.into_source().to_string())?;
    let temporary_contents = fs::read(temporary.path()).map_err(|error| error.to_string())?;
    serde_json::from_slice::<serde_json::Value>(&temporary_contents)
        .map_err(|error| format!("Metadata JSON could not be validated: {error}"))?;

    if backup {
        backup_existing_json(root, document)?;
    }

    let transaction_backup = transaction_path(&path, "write-backup");
    temporary
        .replace(&path, &transaction_backup, BackupCleanup::Required, fs_ops)
        .map_err(metadata_replace_error)
}

fn write_json<T: Serialize>(
    root: &Path,
    document: MetadataDocument,
    value: &T,
    backup: bool,
) -> Result<(), String> {
    write_json_with_fs(root, document, value, backup, &RealAtomicFileSystem)
}

fn recover_json_from_backup<T>(root: &Path, document: MetadataDocument) -> Result<Option<T>, String>
where
    T: DeserializeOwned,
{
    let candidates = ArchiveBackupLayout::new(root).metadata_backup_candidates(document)?;
    Ok(candidates.into_iter().find_map(|backup_path| {
        fs::read(&backup_path)
            .ok()
            .and_then(|contents| serde_json::from_slice(&contents).ok())
    }))
}

struct JsonReadResult<T> {
    value: T,
    recovered: bool,
}

fn read_json_with_recovery<T>(
    root: &Path,
    document: MetadataDocument,
) -> Result<JsonReadResult<T>, String>
where
    T: Default + DeserializeOwned + Serialize,
{
    let layout = ArchiveBackupLayout::new(root);
    let path = layout.checked_active_document_path(document)?;
    recover_atomic_replace(&path).map_err(|error| error.to_string())?;
    if !path.exists() {
        layout.migrate_metadata_document(document, MAX_METADATA_BACKUPS)?;
        let value = T::default();
        write_json(root, document, &value, false)?;
        return Ok(JsonReadResult {
            value,
            recovered: false,
        });
    }

    let contents = fs::read(&path).map_err(|error| error.to_string())?;
    match serde_json::from_slice(&contents) {
        Ok(value) => {
            layout.migrate_metadata_document(document, MAX_METADATA_BACKUPS)?;
            Ok(JsonReadResult {
                value,
                recovered: false,
            })
        }
        Err(_) => {
            let corrupt_path =
                layout.timestamped_backup_path(document, "corrupt", timestamp_suffix())?;
            fs::rename(&path, corrupt_path).map_err(|error| error.to_string())?;
            layout.prune_timestamped_backups(document, "corrupt", MAX_METADATA_BACKUPS)?;
            let value = recover_json_from_backup(root, document)?.unwrap_or_default();
            layout.migrate_metadata_document(document, MAX_METADATA_BACKUPS)?;
            write_json(root, document, &value, false)?;
            Ok(JsonReadResult {
                value,
                recovered: true,
            })
        }
    }
}

fn read_json<T>(root: &Path, document: MetadataDocument) -> Result<T, String>
where
    T: Default + DeserializeOwned + Serialize,
{
    read_json_with_recovery(root, document).map(|result| result.value)
}

fn read_optional_json_with_recovery<T>(
    root: &Path,
    document: MetadataDocument,
    default_value: T,
) -> Result<T, String>
where
    T: Clone + DeserializeOwned + Serialize,
{
    let layout = ArchiveBackupLayout::new(root);
    let path = layout.checked_active_document_path(document)?;
    recover_atomic_replace(&path).map_err(|error| error.to_string())?;
    if !path.exists() {
        layout.migrate_metadata_document(document, MAX_METADATA_BACKUPS)?;
        return Ok(default_value);
    }

    let contents = fs::read(&path).map_err(|error| error.to_string())?;
    match serde_json::from_slice(&contents) {
        Ok(value) => {
            layout.migrate_metadata_document(document, MAX_METADATA_BACKUPS)?;
            Ok(value)
        }
        Err(_) => {
            let corrupt_path =
                layout.timestamped_backup_path(document, "corrupt", timestamp_suffix())?;
            fs::rename(&path, corrupt_path).map_err(|error| error.to_string())?;
            layout.prune_timestamped_backups(document, "corrupt", MAX_METADATA_BACKUPS)?;
            let value = recover_json_from_backup(root, document)?.unwrap_or(default_value);
            layout.migrate_metadata_document(document, MAX_METADATA_BACKUPS)?;
            write_json(root, document, &value, false)?;
            Ok(value)
        }
    }
}

fn default_annotations_metadata() -> serde_json::Value {
    serde_json::json!({
        "version": 1,
        "books": {}
    })
}

fn load_annotations_locked(root: &Path) -> Result<Value, String> {
    let path = ArchiveBackupLayout::new(root)
        .checked_active_document_path(MetadataDocument::Annotations)?;
    discard_staged_replacements(&path, ANNOTATION_IMPORT_STAGE)
        .map_err(|error| error.to_string())?;
    read_optional_json_with_recovery(
        root,
        MetadataDocument::Annotations,
        default_annotations_metadata(),
    )
}

fn load_annotations_at(root: &Path) -> Result<Value, String> {
    if !root.is_dir() {
        return Err("The selected archive folder is unavailable.".to_string());
    }

    with_archive_metadata(root, || load_annotations_locked(root))
}

#[cfg(test)]
fn save_annotations_at(root: &Path, metadata: &Value) -> Result<(), String> {
    with_archive_metadata(root, || {
        write_json(root, MetadataDocument::Annotations, metadata, true)
    })
}

pub(crate) fn initialize_at(root: &Path) -> Result<(), String> {
    with_archive_metadata(root, || initialize_locked(root))
}

fn initialize_locked(root: &Path) -> Result<(), String> {
    if !root.is_dir() {
        return Err("The selected archive folder is unavailable.".to_string());
    }

    let layout = ArchiveBackupLayout::new(root);
    for document in MetadataDocument::ALL {
        layout.migrate_metadata_document(document, MAX_METADATA_BACKUPS)?;
    }
    let directory = metadata_path(root);
    fs::create_dir_all(directory.join("covers")).map_err(|error| error.to_string())?;
    read_json::<LibraryMetadata>(root, MetadataDocument::Library)?;
    read_json::<ProgressMetadata>(root, MetadataDocument::Progress)?;
    layout.retire_legacy_settings_artifacts();
    Ok(())
}

#[cfg(test)]
pub(crate) fn load_scanner_cache_at(root: &Path) -> Result<ScannerCache, String> {
    read_json(root, MetadataDocument::ScannerCache)
}

pub(crate) fn load_scanner_cache_with_recovery_at(
    root: &Path,
) -> Result<(ScannerCache, bool), String> {
    let result = read_json_with_recovery(root, MetadataDocument::ScannerCache)?;
    Ok((result.value, result.recovered))
}

pub(crate) fn save_scanner_cache_at(root: &Path, cache: &ScannerCache) -> Result<(), String> {
    write_json(root, MetadataDocument::ScannerCache, cache, false)
}

pub(crate) fn clear_scanner_cache_at(root: &Path) -> Result<(), String> {
    ArchiveBackupLayout::new(root)
        .migrate_metadata_document(MetadataDocument::ScannerCache, MAX_METADATA_BACKUPS)?;
    let path = metadata_path(root).join(SCANNER_CACHE_FILE);
    if path.exists() {
        fs::remove_file(path).map_err(|error| error.to_string())?;
    }
    Ok(())
}

fn resolve_command_archive_root(
    app: &tauri::AppHandle,
    root_path: Option<String>,
) -> Result<PathBuf, String> {
    archive_root::resolve_archive_root(app, root_path)
}

async fn run_metadata_command<T: Send + 'static>(
    app: tauri::AppHandle,
    root_path: Option<String>,
    operation: impl FnOnce(&Path) -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = resolve_command_archive_root(&app, root_path)?;
        operation(&root)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn initialize_archive_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
) -> Result<(), String> {
    run_metadata_command(app, root_path, initialize_at).await
}

#[tauri::command]
pub async fn load_archive_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
) -> Result<MetadataBundle, String> {
    run_metadata_command(app, root_path, |root| {
        with_archive_metadata(root, || {
            initialize_locked(root)?;
            Ok(MetadataBundle {
                library: read_json(root, MetadataDocument::Library)?,
                progress: read_json(root, MetadataDocument::Progress)?,
            })
        })
    })
    .await
}

#[tauri::command]
pub async fn save_library_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
    metadata: LibraryMetadata,
) -> Result<(), String> {
    run_metadata_command(app, root_path, move |root| {
        with_archive_metadata(root, || {
            write_json(root, MetadataDocument::Library, &metadata, true)
        })
    })
    .await
}

#[tauri::command]
pub async fn save_progress_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
    metadata: ProgressMetadata,
) -> Result<(), String> {
    run_metadata_command(app, root_path, move |root| {
        with_archive_metadata(root, || {
            write_json(root, MetadataDocument::Progress, &metadata, true)
        })
    })
    .await
}

#[tauri::command]
pub async fn load_annotations_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
) -> Result<AnnotationMetadataSnapshot, String> {
    run_metadata_command(app, root_path, |root| {
        let metadata = load_annotations_at(root)?;
        let revision = annotation_revision(&metadata)?;
        Ok(AnnotationMetadataSnapshot { metadata, revision })
    })
    .await
}

fn annotation_revision(metadata: &Value) -> Result<String, String> {
    let contents = serde_json::to_vec(metadata).map_err(|error| error.to_string())?;
    Ok(sha256_hex(Sha256::digest(contents)))
}

#[derive(Serialize)]
pub struct AnnotationMetadataSnapshot {
    metadata: Value,
    revision: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ArchiveAnnotationSnapshot {
    activation_revision: u64,
    library: LibraryMetadata,
    annotations: Value,
    annotation_revision: String,
}

fn read_metadata_snapshot_bytes(
    root: &Path,
    document: MetadataDocument,
) -> Result<Option<Vec<u8>>, String> {
    let path = ArchiveBackupLayout::new(root).checked_active_document_path(document)?;
    let file_name = document.file_name();
    let read_error = |error| format!("Cannot read {file_name}: {error}");
    match fs::symlink_metadata(&path) {
        Ok(info) if info.file_type().is_file() => fs::read(&path).map(Some).map_err(read_error),
        Ok(_) => Err(format!("{file_name} must be a regular file.")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            read_replacement_candidate(&path).map_err(read_error)
        }
        Err(error) => Err(read_error(error)),
    }
}

fn decode_metadata_snapshot<T: DeserializeOwned>(
    bytes: Option<Vec<u8>>,
    document: MetadataDocument,
    default: T,
) -> Result<T, String> {
    let Some(bytes) = bytes else {
        return Ok(default);
    };
    serde_json::from_slice(&bytes)
        .map_err(|error| format!("Cannot read {}: {error}", document.file_name()))
}

#[tauri::command]
pub async fn load_archive_annotation_snapshot(
    app: tauri::AppHandle,
    archive_id: String,
    root_path: String,
) -> Result<ArchiveAnnotationSnapshot, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let revision = archive::with_active_archive(&app, &archive_id, &root_path, None, Ok)?;
        let root = resolve_command_archive_root(&app, Some(root_path.clone()))?;
        let (library, annotations) = with_archive_metadata(&root, || {
            Ok((
                read_metadata_snapshot_bytes(&root, MetadataDocument::Library)?,
                read_metadata_snapshot_bytes(&root, MetadataDocument::Annotations)?,
            ))
        })?;
        let annotations = decode_metadata_snapshot(
            annotations,
            MetadataDocument::Annotations,
            default_annotations_metadata(),
        )?;
        let snapshot = ArchiveAnnotationSnapshot {
            activation_revision: revision,
            library: decode_metadata_snapshot(
                library,
                MetadataDocument::Library,
                LibraryMetadata::default(),
            )?,
            annotation_revision: annotation_revision(&annotations)?,
            annotations,
        };
        archive::with_active_archive(&app, &archive_id, &root_path, Some(revision), |_| {
            Ok(snapshot)
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn save_annotations_metadata(
    app: tauri::AppHandle,
    root_path: Option<String>,
    metadata: Value,
    expected_revision: String,
) -> Result<Option<String>, String> {
    run_metadata_command(app, root_path, move |root| {
        with_archive_metadata(root, || {
            if annotation_revision(&load_annotations_locked(root)?)? != expected_revision {
                return Ok(None);
            }
            let revision = annotation_revision(&metadata)?;
            write_json(root, MetadataDocument::Annotations, &metadata, true)?;
            Ok(Some(revision))
        })
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotationImportBatch {
    activation_revision: u64,
    annotation_revision: String,
    book_matches: BTreeMap<String, bool>,
    additions: BTreeMap<String, Vec<Value>>,
}

const STALE_ANNOTATION_IMPORT: &str =
    "The archive changed after the preview. Open the annotation export again to review the latest counts.";
const ANNOTATION_IMPORT_STAGE: &str = "annotation-import";

fn append_imported_annotations(
    metadata: &mut Value,
    library: &LibraryMetadata,
    batch: AnnotationImportBatch,
) -> Result<(), String> {
    if annotation_revision(metadata)? != batch.annotation_revision
        || batch
            .book_matches
            .iter()
            .any(|(id, matched)| library.books.contains_key(id) != *matched)
    {
        return Err(STALE_ANNOTATION_IMPORT.to_string());
    }
    let books = metadata
        .get_mut("books")
        .and_then(Value::as_object_mut)
        .ok_or_else(|| "The archive annotation metadata is invalid.".to_string())?;
    for (book_id, entries) in batch.additions {
        if batch.book_matches.get(&book_id) != Some(&true) || entries.is_empty() {
            return Err("The annotation import contains an invalid book batch.".to_string());
        }
        let book = books
            .entry(book_id)
            .or_insert_with(|| serde_json::json!({ "annotations": [] }));
        let annotations = book
            .get_mut("annotations")
            .and_then(Value::as_array_mut)
            .ok_or_else(|| "The archive annotation metadata is invalid.".to_string())?;
        annotations.extend(entries);
    }
    validate_annotations_metadata(metadata)
}

fn write_import_backup(root: &Path, contents: &[u8]) -> Result<(), String> {
    let layout = ArchiveBackupLayout::new(root);
    let document = MetadataDocument::Annotations;
    let stable = layout.stable_backup_path(document)?;
    if stable.exists() {
        let older = fs::read(&stable).map_err(|error| error.to_string())?;
        if older != contents && !layout.timestamped_backup_contains(document, "backup", &older)? {
            let history = layout.timestamped_backup_path(document, "backup", timestamp_suffix())?;
            write_import_backup_file(&history, &older)?;
        }
    }
    let timestamped = layout.timestamped_backup_path(document, "backup", timestamp_suffix())?;
    write_import_backup_file(&timestamped, contents)?;
    write_import_backup_file(&stable, contents)
}

fn write_import_backup_file(destination: &Path, contents: &[u8]) -> Result<(), String> {
    let temporary = PreparedAtomicFile::write(transaction_path(destination, "tmp-write"), contents)
        .map_err(|error| error.into_source().to_string())?;
    temporary
        .replace(
            destination,
            &transaction_path(destination, "write-backup"),
            BackupCleanup::BestEffort,
            &RealAtomicFileSystem,
        )
        .map_err(metadata_replace_error)
}

fn import_annotations_at(
    root: &Path,
    batch: AnnotationImportBatch,
    commit: impl FnOnce(&mut dyn FnMut() -> Result<(), String>) -> Result<(), String>,
    fs_ops: &impl AtomicFileSystem,
) -> Result<(), String> {
    if batch.additions.is_empty() {
        return Err("There are no annotations to import.".to_string());
    }
    with_archive_metadata(root, || {
        let document = MetadataDocument::Annotations;
        let library = decode_metadata_snapshot(
            read_metadata_snapshot_bytes(root, MetadataDocument::Library)?,
            MetadataDocument::Library,
            LibraryMetadata::default(),
        )?;
        let previous = match read_metadata_snapshot_bytes(root, document)? {
            Some(bytes) => bytes,
            None => serde_json::to_vec_pretty(&default_annotations_metadata())
                .map_err(|error| error.to_string())?,
        };
        let mut metadata = serde_json::from_slice(&previous)
            .map_err(|error| format!("Cannot read {}: {error}", document.file_name()))?;
        append_imported_annotations(&mut metadata, &library, batch)?;

        let layout = ArchiveBackupLayout::new(root);
        let destination = layout.checked_active_document_path(document)?;
        let contents = serde_json::to_vec_pretty(&metadata).map_err(|error| error.to_string())?;
        discard_staged_replacements(&destination, ANNOTATION_IMPORT_STAGE)
            .map_err(|error| error.to_string())?;
        let temporary = PreparedAtomicFile::write(
            transaction_path(&destination, ANNOTATION_IMPORT_STAGE),
            &contents,
        )
        .map_err(|error| error.into_source().to_string())?;
        let mut temporary = Some(temporary);
        commit(&mut || {
            write_import_backup(root, &previous)?;
            temporary
                .take()
                .ok_or("The annotation import was already committed.")?
                .replace(
                    &destination,
                    &transaction_path(&destination, "write-backup"),
                    BackupCleanup::BestEffort,
                    fs_ops,
                )
                .map_err(metadata_replace_error)
        })?;
        let _ = layout.prune_timestamped_backups(document, "backup", MAX_METADATA_BACKUPS);
        Ok(())
    })
}

#[tauri::command]
pub async fn import_archive_annotations(
    app: tauri::AppHandle,
    archive_id: String,
    root_path: String,
    batch: AnnotationImportBatch,
) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let revision = Some(batch.activation_revision);
        archive::with_active_archive(&app, &archive_id, &root_path, revision, |_| Ok(()))?;
        let root = resolve_command_archive_root(&app, Some(root_path.clone()))?;
        import_annotations_at(
            &root,
            batch,
            |replace| {
                archive::with_active_archive(&app, &archive_id, &root_path, revision, |_| replace())
            },
            &RealAtomicFileSystem,
        )?;
        let _ = app.emit_to("main", "archive-annotations-imported", &archive_id);
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::{
        annotation_revision, decode_metadata_snapshot, import_annotations_at, initialize_at,
        load_annotations_at, load_scanner_cache_with_recovery_at, metadata_path, read_json,
        read_metadata_snapshot_bytes, save_annotations_at, with_archive_metadata, write_json,
        write_json_with_fs, AnnotationImportBatch, LibraryBookMetadata, LibraryMetadata,
        ProgressMetadata, ReadingProgress, ANNOTATION_IMPORT_STAGE, MAX_METADATA_BACKUPS,
        SCANNER_CACHE_FILE,
    };
    use crate::{
        atomic_file::{transaction_path, RealAtomicFileSystem},
        commands::archive_backup::{ArchiveBackupLayout, MetadataDocument},
    };

    fn test_root(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!("archeion-metadata-{label}-{nonce}"))
    }

    fn read_metadata_snapshot<T: serde::de::DeserializeOwned>(
        root: &std::path::Path,
        document: MetadataDocument,
        default: T,
    ) -> Result<T, String> {
        decode_metadata_snapshot(
            read_metadata_snapshot_bytes(root, document)?,
            document,
            default,
        )
    }

    #[test]
    fn metadata_access_to_one_archive_does_not_hold_another_archives_lock() {
        let first = test_root("slow-first-archive");
        let second = test_root("independent-second-archive");
        let (entered, did_enter) = std::sync::mpsc::channel();
        let second = with_archive_metadata(&first, || {
            let second = std::thread::spawn(move || {
                with_archive_metadata(&second, || {
                    entered.send(()).unwrap();
                    Ok(())
                })
                .unwrap();
            });
            let result = did_enter.recv_timeout(std::time::Duration::from_secs(3));
            Ok((second, result))
        })
        .unwrap();
        second.0.join().unwrap();
        assert!(second.1.is_ok());
    }

    #[test]
    fn archive_annotation_snapshot_never_creates_or_repairs_source_files() {
        let root = test_root("annotation-export");
        fs::create_dir_all(&root).expect("archive root should be created");
        let metadata = metadata_path(&root);
        let value: LibraryMetadata =
            read_metadata_snapshot(&root, MetadataDocument::Library, LibraryMetadata::default())
                .expect("missing metadata should return the default");
        assert!(value.books.is_empty());
        assert!(!metadata.exists());

        fs::create_dir(&metadata).expect("metadata directory should be created");
        let path = metadata.join(MetadataDocument::Annotations.file_name());
        fs::write(&path, "incomplete").expect("invalid source should be written");
        assert!(read_metadata_snapshot(
            &root,
            MetadataDocument::Annotations,
            serde_json::Value::Null
        )
        .is_err());
        assert_eq!(
            fs::read_to_string(&path).expect("source should remain"),
            "incomplete"
        );
        assert_eq!(
            fs::read_dir(&metadata)
                .expect("metadata should be readable")
                .count(),
            1
        );
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn archive_annotation_snapshot_reads_interrupted_replacement_without_repairing_it() {
        let root = test_root("interrupted-annotation-export");
        let document = MetadataDocument::Annotations;
        let previous = serde_json::json!({ "version": 1, "books": { "old": {} } });
        let next = serde_json::json!({ "version": 1, "books": { "new": {} } });
        let backup = write_transaction_artifact(&root, document, "write-backup", &previous);
        let temporary = write_transaction_artifact(&root, document, "tmp-write", &next);
        let path = metadata_path(&root).join(document.file_name());
        assert_eq!(
            read_metadata_snapshot(&root, document, serde_json::Value::Null)
                .expect("last committed annotations should read"),
            previous,
        );
        assert!(!path.exists());
        assert!(backup.exists() && temporary.exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn archive_annotation_snapshot_reads_an_interrupted_first_save() {
        let root = test_root("first-annotation-save");
        let document = MetadataDocument::Annotations;
        let value = serde_json::json!({ "version": 1, "books": { "first": {} } });
        let temporary = write_transaction_artifact(&root, document, "tmp-write", &value);
        let path = metadata_path(&root).join(document.file_name());
        assert_eq!(
            read_metadata_snapshot(&root, document, serde_json::Value::Null)
                .expect("first annotation save should read"),
            value,
        );
        assert!(!path.exists() && temporary.exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    fn write_transaction_artifact<T: serde::Serialize>(
        root: &std::path::Path,
        document: MetadataDocument,
        marker: &str,
        value: &T,
    ) -> std::path::PathBuf {
        let destination = metadata_path(root).join(document.file_name());
        fs::create_dir_all(
            destination
                .parent()
                .expect("metadata document should have a parent"),
        )
        .expect("metadata directory should be created");
        let artifact = transaction_path(&destination, marker);
        fs::write(
            &artifact,
            serde_json::to_vec_pretty(value).expect("transaction value should serialize"),
        )
        .expect("transaction artifact should be written");
        artifact
    }

    struct FailingMetadataRenameFileSystem;

    impl crate::atomic_file::AtomicFileSystem for FailingMetadataRenameFileSystem {
        fn rename(
            &self,
            source: &std::path::Path,
            destination: &std::path::Path,
        ) -> Result<(), String> {
            let source_name = source
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();
            let destination_name = destination
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default();

            if (source_name.contains("tmp-write") || source_name.contains(ANNOTATION_IMPORT_STAGE))
                && !destination_name.contains("write-backup")
            {
                return Err("simulated final rename failure".to_string());
            }

            fs::rename(source, destination).map_err(|error| error.to_string())
        }

        fn remove_file(&self, path: &std::path::Path) -> Result<(), String> {
            fs::remove_file(path).map_err(|error| error.to_string())
        }
    }

    fn import_test_archive(label: &str) -> std::path::PathBuf {
        let root = test_root(label);
        fs::create_dir_all(&root).unwrap();
        initialize_at(&root).unwrap();
        fs::write(
            metadata_path(&root).join("library.json"),
            br#"{"version":1,"books":{"matched":{"relativePath":"missing.epub","updatedAt":"now"}}}"#,
        ).unwrap();
        root
    }

    fn import_batch(previous: &serde_json::Value) -> AnnotationImportBatch {
        AnnotationImportBatch {
            activation_revision: 0,
            annotation_revision: annotation_revision(previous).unwrap(),
            book_matches: [
                ("matched".to_string(), true),
                ("unmatched".to_string(), false),
            ]
            .into(),
            additions: [(
                "matched".to_string(),
                vec![serde_json::json!({
                    "id": "imported", "type": "bookmark", "createdAt": "2026-01-01T00:00:00Z",
                    "updatedAt": "2026-01-01T00:00:00Z", "label": "From an export"
                })],
            )]
            .into(),
        }
    }

    #[test]
    fn annotation_import_appends_once_to_current_metadata_and_backs_up_the_previous_bytes() {
        let root = import_test_archive("import-success");
        let path = metadata_path(&root).join("annotations.json");
        let progress = metadata_path(&root).join("progress.json");
        let progress_before = fs::read(&progress).unwrap();
        let previous = br#"{"version":1,"futureRoot":true,"books":{"matched":{"futureBook":true,"annotations":[{"id":"reader","type":"bookmark","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}]},"another":{"annotations":[{"id":"keep","type":"bookmark","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}]}}}"#;
        fs::write(&path, previous).unwrap();
        let base = serde_json::from_slice(previous).unwrap();
        import_annotations_at(
            &root,
            import_batch(&base),
            |replace| replace(),
            &RealAtomicFileSystem,
        )
        .unwrap();
        let saved = load_annotations_at(&root).unwrap();
        assert_eq!(saved["futureRoot"], true);
        assert_eq!(saved["books"]["matched"]["futureBook"], true);
        assert_eq!(saved["books"]["matched"]["annotations"][0]["id"], "reader");
        assert_eq!(
            saved["books"]["matched"]["annotations"][1]["id"],
            "imported"
        );
        assert_eq!(saved["books"]["another"], base["books"]["another"]);
        assert_eq!(fs::read(&progress).unwrap(), progress_before);
        let layout = ArchiveBackupLayout::new(&root);
        assert_eq!(
            fs::read(
                layout
                    .stable_backup_path(MetadataDocument::Annotations)
                    .unwrap()
            )
            .unwrap(),
            previous
        );
        assert!(import_annotations_at(
            &root,
            import_batch(&base),
            |replace| replace(),
            &RealAtomicFileSystem
        )
        .unwrap_err()
        .contains("changed after the preview"));
        assert_eq!(load_annotations_at(&root).unwrap(), saved);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn annotation_import_first_write_has_a_valid_empty_backup() {
        let root = import_test_archive("import-first");
        let previous = load_annotations_at(&root).unwrap();
        import_annotations_at(
            &root,
            import_batch(&previous),
            |replace| replace(),
            &RealAtomicFileSystem,
        )
        .unwrap();
        let backup = ArchiveBackupLayout::new(&root)
            .stable_backup_path(MetadataDocument::Annotations)
            .unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&fs::read(backup).unwrap()).unwrap(),
            previous
        );
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn annotation_import_rejects_malformed_candidates_before_staging_or_backing_up() {
        let root = import_test_archive("import-invalid");
        let path = metadata_path(&root).join("annotations.json");
        let previous = br#"{"version":1,"books":{"matched":{"annotations":[{"id":"reader","type":"bookmark","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}]}}}"#;
        fs::write(&path, previous).unwrap();
        let base = serde_json::from_slice(previous).unwrap();
        let malformed = [
            serde_json::json!({ "id": "incomplete" }),
            serde_json::json!({
                "id": "bad-time", "type": "bookmark",
                "createdAt": "2025-02-29T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z"
            }),
            serde_json::json!({
                "id": "bad-type-field", "type": "bookmark", "color": null,
                "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z"
            }),
            serde_json::json!({
                "id": " reader ", "type": "bookmark",
                "createdAt": "2026-01-01T00:00:00Z", "updatedAt": "2026-01-01T00:00:00Z"
            }),
        ];
        for annotation in malformed {
            let mut batch = import_batch(&base);
            batch.additions.get_mut("matched").unwrap().push(annotation);
            let error = import_annotations_at(
                &root,
                batch,
                |_| panic!("invalid import should not reach the commit boundary"),
                &RealAtomicFileSystem,
            )
            .unwrap_err();
            assert!(error.contains("invalid archive annotation metadata"));
            assert_eq!(fs::read(&path).unwrap(), previous);
            assert!(!metadata_path(&root).join("backups").exists());
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn annotation_import_preserves_existing_data_after_scope_or_replace_failure() {
        let root = import_test_archive("import-failure");
        let previous = br#"{"version":1,"books":{"matched":{"annotations":[{"id":"existing","type":"bookmark","createdAt":"2026-01-01T00:00:00Z","updatedAt":"2026-01-01T00:00:00Z"}]}}}"#;
        let path = metadata_path(&root).join("annotations.json");
        fs::write(&path, previous).unwrap();
        let base = serde_json::from_slice(previous).unwrap();
        let stale = import_annotations_at(
            &root,
            import_batch(&base),
            |_| Err("stale archive revision".to_string()),
            &RealAtomicFileSystem,
        );
        assert_eq!(stale.unwrap_err(), "stale archive revision");
        assert!(!metadata_path(&root).join("backups").exists());
        let failed = import_annotations_at(
            &root,
            import_batch(&base),
            |replace| replace(),
            &FailingMetadataRenameFileSystem,
        );
        assert!(failed.unwrap_err().contains("previous file was restored"));
        assert_eq!(fs::read(&path).unwrap(), previous);
        let backup = ArchiveBackupLayout::new(&root)
            .stable_backup_path(MetadataDocument::Annotations)
            .unwrap();
        assert_eq!(fs::read(backup).unwrap(), previous);
        assert_eq!(fs::read_dir(metadata_path(&root)).unwrap().count(), 5);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn initializes_current_metadata_layout() {
        let root = test_root("layout");
        fs::create_dir_all(&root).expect("test archive should be created");

        initialize_at(&root).expect("metadata should initialize");

        let metadata = metadata_path(&root);
        assert!(metadata.join("library.json").is_file());
        assert!(metadata.join("progress.json").is_file());
        assert!(!metadata.join("scanner-cache.json").exists());
        assert!(metadata.join("covers").is_dir());
        assert!(!metadata.join("backups").exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn initialization_retires_legacy_settings_without_touching_archive_data() {
        let root = test_root("retire-legacy-settings");
        fs::create_dir_all(&root).expect("test archive should be created");
        initialize_at(&root).expect("metadata should initialize");

        let metadata = metadata_path(&root);
        let library_path = metadata.join("library.json");
        let progress_path = metadata.join("progress.json");
        let library_before = fs::read(&library_path).expect("library metadata should be readable");
        let progress_before =
            fs::read(&progress_path).expect("progress metadata should be readable");

        let epub_path = root.join("Keep.epub");
        let annotations_path = metadata.join("annotations.json");
        let scanner_cache_path = metadata.join(SCANNER_CACHE_FILE);
        let cover_path = metadata.join("covers/keep.webp");
        fs::write(&epub_path, b"epub-bytes").expect("epub should be written");
        fs::write(&annotations_path, b"annotations-bytes").expect("annotations should be written");
        fs::write(&scanner_cache_path, b"scanner-bytes").expect("scanner cache should be written");
        fs::write(&cover_path, b"cover-bytes").expect("cover should be written");

        fs::write(metadata.join("settings.json"), b"legacy-settings")
            .expect("legacy settings should be written");
        fs::write(metadata.join("settings.json.bak"), b"legacy-stable")
            .expect("legacy root backup should be written");
        fs::write(
            metadata.join("settings.json.backup-123.bak"),
            b"legacy-timestamped",
        )
        .expect("legacy timestamped backup should be written");
        fs::write(
            metadata.join("settings.json.corrupt-124.bak"),
            b"legacy-corrupt",
        )
        .expect("legacy corruption backup should be written");
        fs::write(
            metadata.join("settings.json.tmp-write-1-2-3"),
            b"legacy-transaction-temp",
        )
        .expect("legacy transaction temp should be written");
        fs::write(
            metadata.join("settings.json.write-backup-1-2-4"),
            b"legacy-transaction-backup",
        )
        .expect("legacy transaction backup should be written");

        let settings_backup_directory = metadata.join("backups/settings");
        fs::create_dir_all(&settings_backup_directory)
            .expect("legacy settings backup directory should be created");
        fs::write(
            settings_backup_directory.join("settings.json.bak"),
            b"category-stable",
        )
        .expect("category stable backup should be written");
        fs::write(
            settings_backup_directory.join("settings.json.backup-125.collision-1.bak"),
            b"category-timestamped",
        )
        .expect("category timestamped backup should be written");
        fs::write(
            settings_backup_directory.join("settings.json.corrupt-126.bak"),
            b"category-corrupt",
        )
        .expect("category corruption backup should be written");

        let library_backup_directory = metadata.join("backups/library");
        fs::create_dir_all(&library_backup_directory)
            .expect("library backup directory should be created");
        let library_backup_path = library_backup_directory.join("library.json.bak");
        fs::write(&library_backup_path, b"library-backup")
            .expect("unrelated backup should be written");

        initialize_at(&root).expect("legacy settings cleanup must not block initialization");

        assert_eq!(fs::read(&library_path).unwrap(), library_before);
        assert_eq!(fs::read(&progress_path).unwrap(), progress_before);
        assert_eq!(fs::read(&epub_path).unwrap(), b"epub-bytes");
        assert_eq!(fs::read(&annotations_path).unwrap(), b"annotations-bytes");
        assert_eq!(fs::read(&scanner_cache_path).unwrap(), b"scanner-bytes");
        assert_eq!(fs::read(&cover_path).unwrap(), b"cover-bytes");
        assert_eq!(fs::read(&library_backup_path).unwrap(), b"library-backup");

        assert!(!metadata.join("settings.json").exists());
        assert!(!metadata.join("settings.json.bak").exists());
        assert!(!metadata.join("settings.json.backup-123.bak").exists());
        assert!(!metadata.join("settings.json.corrupt-124.bak").exists());
        assert!(!metadata.join("settings.json.tmp-write-1-2-3").exists());
        assert!(!metadata.join("settings.json.write-backup-1-2-4").exists());
        assert!(!settings_backup_directory.exists());

        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn legacy_settings_cleanup_failure_does_not_block_archive_opening() {
        let root = test_root("retire-legacy-settings-nonempty-backup");
        fs::create_dir_all(&root).expect("test archive should be created");
        initialize_at(&root).expect("metadata should initialize");

        let settings_backup_directory = metadata_path(&root).join("backups/settings");
        fs::create_dir_all(&settings_backup_directory)
            .expect("legacy settings backup directory should be created");
        let known_backup = settings_backup_directory.join("settings.json.bak");
        let unrelated_file = settings_backup_directory.join("keep.txt");
        fs::write(&known_backup, b"legacy-settings")
            .expect("known legacy settings backup should be written");
        fs::write(&unrelated_file, b"unrelated").expect("unrelated file should be written");

        initialize_at(&root).expect("non-empty cleanup directory must not block archive opening");

        assert!(!known_backup.exists());
        assert_eq!(fs::read(&unrelated_file).unwrap(), b"unrelated");
        assert!(settings_backup_directory.is_dir());
        assert!(metadata_path(&root).join("library.json").is_file());
        assert!(metadata_path(&root).join("progress.json").is_file());

        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[cfg(unix)]
    #[test]
    fn legacy_settings_retirement_does_not_follow_symlinks() {
        use std::os::unix::fs::symlink;

        let root = test_root("retire-legacy-settings-symlink");
        let outside = test_root("retire-legacy-settings-outside");
        fs::create_dir_all(&root).expect("test archive should be created");
        fs::create_dir_all(&outside).expect("outside directory should be created");
        initialize_at(&root).expect("metadata should initialize");

        let metadata = metadata_path(&root);
        let outside_settings = outside.join("settings.json");
        fs::write(&outside_settings, b"outside-settings")
            .expect("outside settings should be written");
        symlink(&outside_settings, metadata.join("settings.json"))
            .expect("legacy settings symlink should be created");

        let outside_backups = outside.join("settings-backups");
        fs::create_dir_all(&outside_backups).expect("outside backup directory should be created");
        let outside_backup = outside_backups.join("settings.json.bak");
        fs::write(&outside_backup, b"outside-backup").expect("outside backup should be written");
        let backup_root = metadata.join("backups");
        fs::create_dir_all(&backup_root).expect("backup root should be created");
        symlink(&outside_backups, backup_root.join("settings"))
            .expect("settings backup symlink should be created");

        fs::write(metadata.join("settings.json.bak"), b"owned-backup")
            .expect("owned legacy backup should be written");

        initialize_at(&root).expect("symlinked legacy settings must not block archive opening");

        assert_eq!(fs::read(&outside_settings).unwrap(), b"outside-settings");
        assert_eq!(fs::read(&outside_backup).unwrap(), b"outside-backup");
        assert!(!metadata.join("settings.json.bak").exists());

        fs::remove_dir_all(root).expect("test archive should be removed");
        fs::remove_dir_all(outside).expect("outside directory should be removed");
    }

    #[test]
    fn initialization_recovers_interrupted_current_metadata_before_defaults() {
        let root = test_root("transaction-recovery-before-defaults");
        fs::create_dir_all(&root).expect("test archive should be created");

        let mut library = LibraryMetadata::default();
        library.books.insert(
            "recovered-book".to_string(),
            LibraryBookMetadata {
                relative_path: "Recovered.epub".to_string(),
                is_favorite: true,
                reader_presentation: None,
                cover_path: None,
                source_metadata: None,
                file_size: None,
                file_modified_at: None,
                added_at: Some("added".to_string()),
                updated_at: "updated".to_string(),
            },
        );
        let mut progress = ProgressMetadata::default();
        progress.progress.insert(
            "recovered-book".to_string(),
            ReadingProgress {
                cfi: Some("epubcfi(/6/2!/4/2)".to_string()),
                percent: 0.42,
                manually_marked_read: Some(true),
                last_opened_at: Some("now".to_string()),
            },
        );
        let retired_settings_path = metadata_path(&root).join("settings.json");
        fs::create_dir_all(&retired_settings_path)
            .expect("retired settings artifact should be left outside current metadata ownership");

        let library_backup =
            write_transaction_artifact(&root, MetadataDocument::Library, "write-backup", &library);
        let progress_temp =
            write_transaction_artifact(&root, MetadataDocument::Progress, "tmp-write", &progress);

        initialize_at(&root).expect("interrupted metadata should recover before initialization");

        let recovered_library: LibraryMetadata = serde_json::from_slice(
            &fs::read(metadata_path(&root).join("library.json"))
                .expect("library metadata should be readable"),
        )
        .expect("library metadata should remain valid");
        let recovered_progress: ProgressMetadata = serde_json::from_slice(
            &fs::read(metadata_path(&root).join("progress.json"))
                .expect("progress metadata should be readable"),
        )
        .expect("progress metadata should remain valid");
        assert!(recovered_library.books.contains_key("recovered-book"));
        let recovered = recovered_progress
            .progress
            .get("recovered-book")
            .expect("the interrupted progress entry should be restored");
        assert_eq!(recovered.manually_marked_read, Some(true));
        assert_eq!(recovered.cfi.as_deref(), Some("epubcfi(/6/2!/4/2)"));
        assert_eq!(recovered.percent, 0.42);
        assert_eq!(recovered.last_opened_at.as_deref(), Some("now"));
        assert!(retired_settings_path.is_dir());
        assert!(!library_backup.exists());
        assert!(!progress_temp.exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn manual_completion_round_trips_in_version_one_sidecar_without_touching_epub() {
        let root = test_root("manual-completion");
        fs::create_dir_all(&root).expect("test archive folder should exist");
        initialize_at(&root).expect("test archive should initialize");
        let epub = root.join("Book.epub");
        let epub_bytes = b"unchanged book bytes";
        fs::write(&epub, epub_bytes).expect("the book fixture should be written");
        let path = metadata_path(&root).join("progress.json");
        fs::write(
            &path,
            br#"{"version":1,"progress":{"book":{"cfi":"position","percent":42,"lastOpenedAt":"opened"}}}"#,
        )
        .expect("legacy progress should be written");

        let mut metadata: ProgressMetadata =
            read_json(&root, MetadataDocument::Progress).expect("legacy progress should load");
        let progress = metadata
            .progress
            .get_mut("book")
            .expect("legacy book exists");
        assert_eq!(progress.manually_marked_read, None);
        progress.manually_marked_read = Some(true);
        write_json(&root, MetadataDocument::Progress, &metadata, true)
            .expect("completion should persist");

        let mut reopened: ProgressMetadata =
            read_json(&root, MetadataDocument::Progress).expect("progress should reopen");
        assert_eq!(reopened.version, 1);
        let progress = reopened.progress.get_mut("book").expect("book exists");
        assert_eq!(progress.manually_marked_read, Some(true));
        assert_eq!(progress.cfi.as_deref(), Some("position"));
        assert_eq!(progress.percent, 42.0);
        assert_eq!(progress.last_opened_at.as_deref(), Some("opened"));
        progress.manually_marked_read = None;
        write_json(&root, MetadataDocument::Progress, &reopened, true)
            .expect("undo should persist");

        let document: serde_json::Value =
            serde_json::from_slice(&fs::read(path).expect("progress file should exist"))
                .expect("progress file should be JSON");
        assert_eq!(
            document["progress"]["book"],
            serde_json::json!({"cfi": "position", "percent": 42.0, "lastOpenedAt": "opened"})
        );
        assert_eq!(
            fs::read(epub).expect("the EPUB should still exist"),
            epub_bytes
        );
        fs::remove_dir_all(root).expect("the test archive should be removed");
    }

    #[test]
    fn malformed_active_metadata_reconciles_transaction_then_uses_stable_backup() {
        let root = test_root("transaction-before-corruption-backup");
        fs::create_dir_all(&root).expect("test archive should be created");
        let layout = ArchiveBackupLayout::new(&root);
        let path = metadata_path(&root).join("library.json");
        fs::create_dir_all(path.parent().expect("metadata should have a parent"))
            .expect("metadata directory should be created");
        fs::write(&path, b"{not-json").expect("malformed active metadata should be written");

        let mut stable = LibraryMetadata::default();
        stable.books.insert(
            "stable".to_string(),
            LibraryBookMetadata {
                relative_path: "Stable.epub".to_string(),
                is_favorite: false,
                reader_presentation: None,
                cover_path: None,
                source_metadata: None,
                file_size: None,
                file_modified_at: None,
                added_at: Some("added".to_string()),
                updated_at: "updated".to_string(),
            },
        );
        let stable_backup = layout
            .stable_backup_path(MetadataDocument::Library)
            .expect("stable backup path should resolve");
        fs::write(
            &stable_backup,
            serde_json::to_vec_pretty(&stable).expect("stable backup should serialize"),
        )
        .expect("stable backup should be written");
        let stale_temp = write_transaction_artifact(
            &root,
            MetadataDocument::Library,
            "tmp-write",
            &LibraryMetadata::default(),
        );

        let recovered: LibraryMetadata =
            read_json(&root, MetadataDocument::Library).expect("stable backup should recover");

        assert!(recovered.books.contains_key("stable"));
        assert!(!stale_temp.exists());
        assert!(stable_backup.exists());
        assert!(metadata_path(&root)
            .join("backups/library")
            .read_dir()
            .expect("backup directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with("library.json.corrupt-")));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn recovering_one_document_does_not_rewrite_unrelated_metadata() {
        let root = test_root("transaction-document-isolation");
        fs::create_dir_all(&root).expect("test archive should be created");
        let progress_path = metadata_path(&root).join("progress.json");
        fs::create_dir_all(
            progress_path
                .parent()
                .expect("metadata should have a parent"),
        )
        .expect("metadata directory should be created");
        let progress_bytes = br#"{
  "version": 1,
  "progress": {}
}"#;
        fs::write(&progress_path, progress_bytes).expect("progress metadata should be written");

        let mut library = LibraryMetadata::default();
        library.books.insert(
            "recovered".to_string(),
            LibraryBookMetadata {
                relative_path: "Recovered.epub".to_string(),
                is_favorite: false,
                reader_presentation: None,
                cover_path: None,
                source_metadata: None,
                file_size: None,
                file_modified_at: None,
                added_at: Some("added".to_string()),
                updated_at: "updated".to_string(),
            },
        );
        write_transaction_artifact(&root, MetadataDocument::Library, "write-backup", &library);

        let recovered: LibraryMetadata =
            read_json(&root, MetadataDocument::Library).expect("library should recover");

        assert!(recovered.books.contains_key("recovered"));
        assert_eq!(
            fs::read(&progress_path).expect("progress metadata should remain readable"),
            progress_bytes
        );
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn unrecoverable_interrupted_metadata_is_not_silently_defaulted() {
        let root = test_root("transaction-recovery-error");
        fs::create_dir_all(&root).expect("test archive should be created");
        let destination = metadata_path(&root).join("library.json");
        fs::create_dir_all(destination.parent().expect("metadata should have a parent"))
            .expect("metadata directory should be created");
        let invalid_artifact = transaction_path(&destination, "write-backup");
        fs::create_dir(&invalid_artifact).expect("invalid transaction artifact should be created");

        let error = read_json::<LibraryMetadata>(&root, MetadataDocument::Library)
            .expect_err("unrecoverable transaction state should surface an error");

        assert!(error.contains("Transaction artifact is not a regular file"));
        assert!(!destination.exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn missing_annotations_recover_before_optional_default() {
        let root = test_root("annotations-transaction-recovery");
        fs::create_dir_all(&root).expect("test archive should be created");
        let annotations = serde_json::json!({
            "version": 1,
            "books": { "recovered": { "annotations": [] } }
        });
        let backup = write_transaction_artifact(
            &root,
            MetadataDocument::Annotations,
            "write-backup",
            &annotations,
        );

        let recovered = load_annotations_at(&root).expect("annotations should recover");

        assert_eq!(recovered, annotations);
        assert!(!backup.exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn historical_backup_enumeration_ignores_transaction_artifacts() {
        let root = test_root("transaction-not-history");
        fs::create_dir_all(&root).expect("test archive should be created");
        let layout = ArchiveBackupLayout::new(&root);
        let stable = layout
            .stable_backup_path(MetadataDocument::Library)
            .expect("stable backup path should resolve");
        fs::write(&stable, br#"{"version":1,"books":{}}"#)
            .expect("stable backup should be written");
        let transaction = write_transaction_artifact(
            &root,
            MetadataDocument::Library,
            "write-backup",
            &LibraryMetadata::default(),
        );

        let candidates = layout
            .metadata_backup_candidates(MetadataDocument::Library)
            .expect("backup candidates should enumerate");

        assert_eq!(candidates, vec![stable]);
        assert!(transaction.exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn retained_metadata_documents_use_independent_backup_categories() {
        let root = test_root("document-categories");
        fs::create_dir_all(&root).expect("test archive should be created");

        for (document, category) in [
            (MetadataDocument::Library, "library"),
            (MetadataDocument::Progress, "progress"),
            (MetadataDocument::Annotations, "annotations"),
        ] {
            write_json(&root, document, &serde_json::json!({ "version": 1 }), false)
                .expect("initial metadata should save");
            write_json(&root, document, &serde_json::json!({ "version": 2 }), true)
                .expect("updated metadata should save");

            let category_directory = metadata_path(&root).join("backups").join(category);
            assert!(category_directory
                .join(format!("{}.bak", document.file_name()))
                .is_file());
            assert!(category_directory
                .read_dir()
                .expect("backup category should be readable")
                .filter_map(Result::ok)
                .any(|entry| entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(&format!("{}.backup-", document.file_name()))));
        }

        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn metadata_backup_retention_is_bounded_per_document() {
        let root = test_root("independent-retention");
        fs::create_dir_all(&root).expect("test archive should be created");

        for document in [MetadataDocument::Library, MetadataDocument::Progress] {
            write_json(&root, document, &serde_json::json!({ "version": 1 }), false)
                .expect("initial metadata should save");
        }
        for revision in 0..8 {
            write_json(
                &root,
                MetadataDocument::Library,
                &serde_json::json!({ "version": revision }),
                true,
            )
            .expect("library metadata should save");
        }
        for revision in 0..3 {
            write_json(
                &root,
                MetadataDocument::Progress,
                &serde_json::json!({ "version": revision }),
                true,
            )
            .expect("progress metadata should save");
        }

        let count_history = |category: &str, prefix: &str| {
            metadata_path(&root)
                .join("backups")
                .join(category)
                .read_dir()
                .expect("backup category should be readable")
                .filter_map(Result::ok)
                .filter(|entry| entry.file_name().to_string_lossy().starts_with(prefix))
                .count()
        };
        assert_eq!(count_history("library", "library.json.backup-"), 5);
        assert_eq!(count_history("progress", "progress.json.backup-"), 3);

        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn missing_annotations_load_as_empty_without_creating_a_file() {
        let root = test_root("annotations-missing");
        fs::create_dir_all(&root).expect("test archive should be created");

        let annotations = load_annotations_at(&root).expect("annotations should load");

        assert_eq!(
            annotations,
            serde_json::json!({ "version": 1, "books": {} })
        );
        assert!(!metadata_path(&root).join("annotations.json").exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn annotations_preserve_unknown_fields_and_create_recovery_backups() {
        let root = test_root("annotations-save");
        fs::create_dir_all(&root).expect("test archive should be created");
        let first = serde_json::json!({
            "version": 1,
            "books": {},
            "futureField": { "preserved": true }
        });
        let second = serde_json::json!({
            "version": 1,
            "books": {
                "book-1": {
                    "annotations": [],
                    "futureBookField": "kept"
                }
            },
            "futureField": { "preserved": true }
        });

        save_annotations_at(&root, &first).expect("initial annotations should save");
        save_annotations_at(&root, &second).expect("updated annotations should save");

        assert_eq!(
            load_annotations_at(&root).expect("annotations should reload"),
            second
        );
        assert!(metadata_path(&root)
            .join("backups/annotations/annotations.json.bak")
            .is_file());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn corrupted_annotations_are_preserved_and_recovered_from_backup() {
        let root = test_root("annotations-recovery");
        fs::create_dir_all(&root).expect("test archive should be created");
        let annotations = serde_json::json!({
            "version": 1,
            "books": { "book-1": { "annotations": [] } }
        });
        save_annotations_at(&root, &annotations).expect("annotations should save");
        save_annotations_at(&root, &annotations).expect("annotations backup should save");
        let path = metadata_path(&root).join("annotations.json");
        fs::write(&path, b"{invalid").expect("annotations should be corrupted");

        let recovered = load_annotations_at(&root).expect("annotations should recover");

        assert_eq!(recovered, annotations);
        assert!(
            fs::read_dir(metadata_path(&root).join("backups/annotations"))
                .expect("metadata directory should be readable")
                .filter_map(Result::ok)
                .any(|entry| entry
                    .file_name()
                    .to_string_lossy()
                    .contains("annotations.json.corrupt-"))
        );
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn annotation_loading_migrates_and_recovers_independently() {
        let root = test_root("annotations-legacy-recovery");
        let directory = metadata_path(&root);
        fs::create_dir_all(&directory).expect("metadata directory should be created");
        let recovered = serde_json::json!({
            "version": 1,
            "books": { "book-1": { "annotations": [] } }
        });
        fs::write(directory.join("annotations.json"), b"{invalid")
            .expect("active annotations should be written");
        fs::write(
            directory.join("annotations.json.bak"),
            serde_json::to_vec(&recovered).expect("annotations should serialize"),
        )
        .expect("legacy annotations backup should be written");

        let annotations = load_annotations_at(&root).expect("annotations should recover");

        assert_eq!(annotations, recovered);
        assert!(directory
            .join("backups/annotations/annotations.json.bak")
            .is_file());
        assert!(!directory.join("annotations.json.bak").exists());
        assert!(!directory.join("library.json").exists());
        assert!(!directory.join("progress.json").exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn backs_up_existing_metadata_before_writing() {
        let root = test_root("backup");
        fs::create_dir_all(&root).expect("test archive should be created");
        write_json(
            &root,
            MetadataDocument::Library,
            &LibraryMetadata::default(),
            false,
        )
        .expect("initial write should work");

        write_json(
            &root,
            MetadataDocument::Library,
            &LibraryMetadata::default(),
            true,
        )
        .expect("second write should work");

        assert!(metadata_path(&root)
            .join("backups/library/library.json.bak")
            .is_file());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn removes_temporary_file_when_metadata_write_fails() {
        let root = test_root("failed-write-cleanup");
        fs::create_dir_all(&root).expect("test archive should be created");
        let path = metadata_path(&root).join("library.json");
        fs::create_dir_all(metadata_path(&root)).expect("metadata directory should be created");
        fs::create_dir_all(&path).expect("conflicting directory should be created");

        let result = write_json(
            &root,
            MetadataDocument::Library,
            &LibraryMetadata::default(),
            false,
        );

        assert!(result.is_err());
        assert!(!metadata_path(&root)
            .read_dir()
            .expect("metadata directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains("tmp-write")));
        assert!(path.is_dir());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn metadata_replace_restores_active_file_when_final_rename_fails() {
        let root = test_root("transaction-restore");
        fs::create_dir_all(&root).expect("test archive should be created");
        let path = metadata_path(&root).join("library.json");
        fs::create_dir_all(metadata_path(&root)).expect("metadata directory should be created");
        fs::write(&path, br#"{"version":1,"books":{}}"#)
            .expect("active metadata should be written");
        let mut replacement = LibraryMetadata::default();
        replacement.books.insert(
            "new".to_string(),
            LibraryBookMetadata {
                relative_path: "new.epub".to_string(),
                is_favorite: false,
                reader_presentation: None,
                cover_path: None,
                source_metadata: None,
                file_size: None,
                file_modified_at: None,
                added_at: Some("now".to_string()),
                updated_at: "now".to_string(),
            },
        );
        let result = write_json_with_fs(
            &root,
            MetadataDocument::Library,
            &replacement,
            false,
            &FailingMetadataRenameFileSystem,
        );

        assert!(result.is_err());
        assert_eq!(
            fs::read_to_string(&path).expect("active metadata should remain readable"),
            r#"{"version":1,"books":{}}"#
        );
        assert!(!metadata_path(&root)
            .read_dir()
            .expect("metadata directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains("write-backup")));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn successful_metadata_write_removes_transaction_backup() {
        let root = test_root("transaction-cleanup");
        fs::create_dir_all(&root).expect("test archive should be created");
        write_json(
            &root,
            MetadataDocument::Library,
            &LibraryMetadata::default(),
            false,
        )
        .expect("initial write should work");
        write_json(
            &root,
            MetadataDocument::Library,
            &LibraryMetadata::default(),
            true,
        )
        .expect("second write should work");

        assert!(!metadata_path(&root)
            .read_dir()
            .expect("metadata directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains("write-backup")));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn loads_library_with_missing_or_malformed_added_dates_without_recovery() {
        let root = test_root("legacy-added-at");
        let path = metadata_path(&root).join("library.json");
        fs::create_dir_all(metadata_path(&root)).expect("metadata directory should be created");
        let contents = br#"{
            "version": 1,
            "books": {
                "missing": {"relativePath":"Missing.epub","isFavorite":true,"updatedAt":"updated"},
                "numeric": {"relativePath":"Numeric.epub","addedAt":42,"updatedAt":"updated"},
                "null": {"relativePath":"Null.epub","addedAt":null,"updatedAt":"updated"},
                "malformed": {"relativePath":"Malformed.epub","addedAt":"legacy","updatedAt":"updated"},
                "dated": {"relativePath":"Dated.epub","addedAt":"2026-07-01T00:00:00.000Z","updatedAt":"updated"}
            }
        }"#;
        fs::write(&path, contents).expect("legacy metadata should be written");

        initialize_at(&root).expect("legacy archive should initialize");
        let library: LibraryMetadata =
            read_json(&root, MetadataDocument::Library).expect("legacy metadata should load");

        assert_eq!(library.books.len(), 5);
        assert!(library.books["missing"].is_favorite);
        for id in ["missing", "numeric", "null"] {
            assert_eq!(library.books[id].added_at, None);
        }
        assert_eq!(
            library.books["malformed"].added_at.as_deref(),
            Some("legacy")
        );
        assert_eq!(
            library.books["dated"].added_at.as_deref(),
            Some("2026-07-01T00:00:00.000Z")
        );
        assert_eq!(
            fs::read(&path).expect("metadata should be readable"),
            contents
        );
        let wire = serde_json::to_value(&library).expect("library metadata should serialize");
        assert!(wire["books"]["missing"].get("addedAt").is_none());
        assert_eq!(
            wire["books"]["dated"]["addedAt"],
            "2026-07-01T00:00:00.000Z"
        );

        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn preserves_corrupted_json_and_recovers_defaults() {
        let root = test_root("corrupt");
        fs::create_dir_all(&root).expect("test archive should be created");
        let path = metadata_path(&root).join("library.json");
        fs::create_dir_all(metadata_path(&root)).expect("metadata directory should be created");
        fs::write(&path, b"{not-json").expect("corrupt file should be written");

        let recovered: LibraryMetadata =
            read_json(&root, MetadataDocument::Library).expect("metadata should recover");

        assert_eq!(recovered.version, 1);
        assert!(metadata_path(&root)
            .join("backups/library")
            .read_dir()
            .expect("directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-")));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn recovers_corrupted_json_from_valid_backup() {
        let root = test_root("backup-recovery");
        fs::create_dir_all(&root).expect("test archive should be created");
        let path = metadata_path(&root).join("library.json");
        let mut library = LibraryMetadata::default();
        library.books.insert(
            "book-1".to_string(),
            LibraryBookMetadata {
                relative_path: "Books/Recovered.epub".to_string(),
                is_favorite: true,
                reader_presentation: Some(super::ReaderPresentation::Publisher),
                cover_path: None,
                source_metadata: None,
                file_size: Some(100),
                file_modified_at: Some(200),
                added_at: Some("2026-07-01T00:00:00.000Z".to_string()),
                updated_at: "2026-07-01T00:00:00.000Z".to_string(),
            },
        );
        write_json(&root, MetadataDocument::Library, &library, false)
            .expect("initial write should work");
        write_json(&root, MetadataDocument::Library, &library, true)
            .expect("backup write should work");
        fs::write(&path, b"{not-json").expect("corrupt file should be written");

        let recovered: LibraryMetadata =
            read_json(&root, MetadataDocument::Library).expect("metadata should recover");

        let book = recovered
            .books
            .get("book-1")
            .expect("book should be restored from backup");
        assert_eq!(book.relative_path, "Books/Recovered.epub");
        assert_eq!(
            book.reader_presentation,
            Some(super::ReaderPresentation::Publisher)
        );
        assert!(book.is_favorite);
        assert!(metadata_path(&root)
            .join("backups/library/library.json.bak")
            .is_file());
        assert!(metadata_path(&root)
            .join("backups/library")
            .read_dir()
            .expect("directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-")));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn recovery_skips_malformed_candidates_in_documented_layout_order() {
        let root = test_root("recovery-order");
        let directory = metadata_path(&root);
        let backup_directory = directory.join("backups/library");
        fs::create_dir_all(&backup_directory).expect("backup category should be created");
        fs::write(directory.join("library.json"), b"{invalid")
            .expect("active metadata should be corrupted");
        fs::write(
            backup_directory.join("library.json.bak"),
            b"{invalid-stable",
        )
        .expect("new stable backup should be malformed");
        fs::write(
            backup_directory.join("library.json.backup-200.bak"),
            b"{invalid-newest",
        )
        .expect("newest history should be malformed");
        fs::write(
            backup_directory.join("library.json.backup-100.bak"),
            br#"{"version":1,"books":{"new-layout":{"relativePath":"New.epub","isFavorite":false,"addedAt":"now","updatedAt":"now"}}}"#,
        )
        .expect("older new-layout backup should be valid");
        fs::write(
            directory.join("library.json.bak"),
            br#"{"version":1,"books":{"legacy":{"relativePath":"Legacy.epub","isFavorite":false,"addedAt":"now","updatedAt":"now"}}}"#,
        )
        .expect("legacy stable backup should be valid");

        let recovered: LibraryMetadata = read_json(&root, MetadataDocument::Library)
            .expect("metadata should recover from the next valid candidate");

        assert!(recovered.books.contains_key("new-layout"));
        assert!(!recovered.books.contains_key("legacy"));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn legacy_metadata_migration_is_collision_safe_idempotent_and_complete() {
        let root = test_root("legacy-collisions");
        let directory = metadata_path(&root);
        let backup_directory = directory.join("backups/library");
        fs::create_dir_all(&backup_directory).expect("backup category should be created");
        fs::write(backup_directory.join("library.json.bak"), b"new-stable")
            .expect("new stable backup should be written");
        fs::write(directory.join("library.json.bak"), b"legacy-stable")
            .expect("legacy stable backup should be written");
        fs::write(
            backup_directory.join("library.json.backup-100.bak"),
            b"new-history",
        )
        .expect("new history backup should be written");
        fs::write(
            directory.join("library.json.backup-100.bak"),
            b"legacy-history",
        )
        .expect("legacy history backup should be written");
        fs::write(
            directory.join("library.json.corrupt-100.bak"),
            b"legacy-corrupt",
        )
        .expect("legacy corruption backup should be written");

        ArchiveBackupLayout::new(&root)
            .migrate_metadata_document(MetadataDocument::Library, MAX_METADATA_BACKUPS)
            .expect("legacy backups should migrate");
        let first_entries = backup_directory
            .read_dir()
            .expect("backup category should be readable")
            .filter_map(Result::ok)
            .map(|entry| entry.file_name())
            .collect::<Vec<_>>();
        ArchiveBackupLayout::new(&root)
            .migrate_metadata_document(MetadataDocument::Library, MAX_METADATA_BACKUPS)
            .expect("repeated migration should be safe");
        let second_entries = backup_directory
            .read_dir()
            .expect("backup category should be readable")
            .filter_map(Result::ok)
            .map(|entry| entry.file_name())
            .collect::<Vec<_>>();

        assert_eq!(first_entries.len(), second_entries.len());
        let migrated_contents = backup_directory
            .read_dir()
            .expect("backup category should be readable")
            .filter_map(Result::ok)
            .map(|entry| fs::read(entry.path()).expect("backup should be readable"))
            .collect::<Vec<_>>();
        for expected in [
            b"new-stable".as_slice(),
            b"legacy-stable".as_slice(),
            b"new-history".as_slice(),
            b"legacy-history".as_slice(),
            b"legacy-corrupt".as_slice(),
        ] {
            assert!(migrated_contents
                .iter()
                .any(|contents| contents == expected));
        }
        assert!(!directory
            .read_dir()
            .expect("metadata directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| {
                let name = entry.file_name().to_string_lossy().to_string();
                name.starts_with("library.json.backup-")
                    || name.starts_with("library.json.corrupt-")
                    || name == "library.json.bak"
            }));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn saving_after_migration_preserves_a_different_legacy_stable_backup_as_history() {
        let root = test_root("legacy-stable-save");
        let directory = metadata_path(&root);
        fs::create_dir_all(&directory).expect("metadata directory should be created");
        fs::write(
            directory.join("library.json"),
            br#"{"version":1,"books":{}}"#,
        )
        .expect("active library should be written");
        let legacy_backup = br#"{"version":1,"books":{"legacy":{"relativePath":"Legacy.epub","isFavorite":false,"addedAt":"now","updatedAt":"now"}}}"#;
        fs::write(directory.join("library.json.bak"), legacy_backup)
            .expect("legacy stable backup should be written");

        write_json(
            &root,
            MetadataDocument::Library,
            &LibraryMetadata::default(),
            true,
        )
        .expect("library metadata should save");

        let backup_directory = directory.join("backups/library");
        assert!(backup_directory
            .read_dir()
            .expect("backup category should be readable")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("library.json.backup-")
            })
            .any(|entry| fs::read(entry.path()).is_ok_and(|contents| contents == legacy_backup)));
        assert!(!directory.join("library.json.bak").exists());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn archive_initialization_migrates_current_legacy_backup_names_from_metadata_root() {
        let root = test_root("complete-legacy-migration");
        let directory = metadata_path(&root);
        fs::create_dir_all(&directory).expect("metadata directory should be created");
        for file_name in [
            "library.json.bak",
            "library.json.backup-1.bak",
            "library.json.corrupt-1.bak",
            "progress.json.bak",
            "progress.json.backup-1.bak",
            "progress.json.corrupt-1.bak",
            "annotations.json.bak",
            "annotations.json.backup-1.bak",
            "annotations.json.corrupt-1.bak",
            "scanner-cache.json.corrupt-1.bak",
        ] {
            fs::write(directory.join(file_name), file_name.as_bytes())
                .expect("legacy backup should be written");
        }

        initialize_at(&root).expect("archive metadata should initialize and migrate");

        let root_file_names = directory
            .read_dir()
            .expect("metadata directory should be readable")
            .filter_map(Result::ok)
            .filter(|entry| entry.file_type().is_ok_and(|file_type| file_type.is_file()))
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect::<Vec<_>>();
        assert!(!root_file_names.iter().any(|name| name.ends_with(".bak")));
        for category in ["library", "progress", "annotations", "scanner-cache"] {
            assert!(directory.join("backups").join(category).is_dir());
        }
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[cfg(unix)]
    #[test]
    fn metadata_backup_category_symlink_outside_archive_is_rejected() {
        let root = test_root("category-symlink");
        let outside = test_root("category-symlink-outside");
        let backup_root = metadata_path(&root).join("backups");
        fs::create_dir_all(&backup_root).expect("backup root should be created");
        fs::create_dir_all(&outside).expect("outside directory should be created");
        fs::write(
            metadata_path(&root).join("library.json"),
            br#"{"version":1,"books":{}}"#,
        )
        .expect("active metadata should be written");
        std::os::unix::fs::symlink(&outside, backup_root.join("library"))
            .expect("backup category symlink should be created");

        let error = write_json(
            &root,
            MetadataDocument::Library,
            &LibraryMetadata::default(),
            true,
        )
        .expect_err("symlinked backup category should be rejected");

        assert!(error.contains("symbolic link"));
        fs::remove_dir_all(root).expect("test archive should be removed");
        fs::remove_dir_all(outside).expect("outside directory should be removed");
    }

    #[test]
    fn scanner_cache_corruption_is_preserved_only_in_its_backup_category() {
        let root = test_root("scanner-corruption");
        let directory = metadata_path(&root);
        fs::create_dir_all(&directory).expect("metadata directory should be created");
        fs::write(directory.join(SCANNER_CACHE_FILE), b"{invalid")
            .expect("scanner cache should be corrupted");

        let (_, recovered) =
            load_scanner_cache_with_recovery_at(&root).expect("scanner cache should recover");

        assert!(recovered);
        assert!(directory
            .join("backups/scanner-cache")
            .read_dir()
            .expect("scanner backup category should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with("scanner-cache.json.corrupt-")));
        assert!(!directory
            .read_dir()
            .expect("metadata directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .starts_with("scanner-cache.json.corrupt-")));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn keeps_metadata_backup_history_bounded() {
        let root = test_root("bounded-backups");
        fs::create_dir_all(&root).expect("test archive should be created");

        write_json(
            &root,
            MetadataDocument::Library,
            &LibraryMetadata::default(),
            false,
        )
        .expect("initial write should work");
        for _ in 0..8 {
            write_json(
                &root,
                MetadataDocument::Library,
                &LibraryMetadata::default(),
                true,
            )
            .expect("backup write should work");
        }

        let backup_directory = metadata_path(&root).join("backups/library");
        let timestamped_backups = backup_directory
            .read_dir()
            .expect("directory should be readable")
            .filter_map(Result::ok)
            .filter(|entry| {
                let file_name = entry.file_name().to_string_lossy().to_string();
                file_name.starts_with("library.json.backup-") && file_name.ends_with(".bak")
            })
            .count();
        assert!(timestamped_backups <= 5);
        assert!(backup_directory.join("library.json.bak").is_file());
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn write_backup_does_not_replace_valid_backup_with_corrupted_active_file() {
        let root = test_root("corrupt-active-backup");
        fs::create_dir_all(&root).expect("test archive should be created");
        let path = metadata_path(&root).join("library.json");
        let mut library = LibraryMetadata::default();
        library.books.insert(
            "book-1".to_string(),
            LibraryBookMetadata {
                relative_path: "Books/Backup.epub".to_string(),
                is_favorite: true,
                reader_presentation: Some(super::ReaderPresentation::Publisher),
                cover_path: None,
                source_metadata: None,
                file_size: None,
                file_modified_at: None,
                added_at: Some("2026-07-01T00:00:00.000Z".to_string()),
                updated_at: "2026-07-01T00:00:00.000Z".to_string(),
            },
        );
        write_json(&root, MetadataDocument::Library, &library, false)
            .expect("initial write should work");
        write_json(&root, MetadataDocument::Library, &library, true)
            .expect("valid backup should be created");
        fs::write(&path, b"{not-json").expect("corrupt active file should be written");

        write_json(
            &root,
            MetadataDocument::Library,
            &LibraryMetadata::default(),
            true,
        )
        .expect("write should recover safely");

        let backup_directory = metadata_path(&root).join("backups/library");
        let backup_contents = fs::read(backup_directory.join("library.json.bak"))
            .expect("stable backup should still be readable");
        let backup: LibraryMetadata = serde_json::from_slice(&backup_contents)
            .expect("stable backup should remain valid JSON");
        assert!(backup.books.contains_key("book-1"));
        assert_eq!(
            backup.books["book-1"].reader_presentation,
            Some(super::ReaderPresentation::Publisher)
        );
        assert!(backup_directory
            .read_dir()
            .expect("directory should be readable")
            .filter_map(Result::ok)
            .any(|entry| entry.file_name().to_string_lossy().contains(".corrupt-")));
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn reader_presentation_v1_cross_language_contract() {
        let corpus: serde_json::Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/library-presentation/v1.json"
        ))
        .expect("shared presentation corpus should parse");
        for case in corpus["cases"]
            .as_array()
            .expect("cases should be an array")
        {
            let mut entry = serde_json::json!({
                "relativePath": "Book.epub", "isFavorite": true,
                "addedAt": "added", "updatedAt": "updated"
            });
            for (key, value) in case["entry"]
                .as_object()
                .expect("entry should be an object")
            {
                entry[key] = value.clone();
            }
            let library: LibraryMetadata = serde_json::from_value(serde_json::json!({
                "version": 1, "books": { "stable": entry }
            }))
            .expect("invalid presentation must not invalidate the library");
            let book = &library.books["stable"];
            let effective = match book.reader_presentation {
                Some(super::ReaderPresentation::Publisher) => "publisher",
                _ => "archeion",
            };
            assert_eq!(
                effective,
                case["expected"].as_str().unwrap(),
                "{}",
                case["name"]
            );
            let serialized = serde_json::to_value(&library).expect("library should serialize");
            assert_eq!(serialized["version"], 1);
            assert_eq!(serialized["books"]["stable"]["isFavorite"], true);
            assert_eq!(serialized["books"]["stable"]["addedAt"], "added");
            assert_eq!(serialized["books"]["stable"]["updatedAt"], "updated");
        }
    }

    #[test]
    fn reader_presentation_survives_failed_atomic_replace_and_restart() {
        let root = test_root("presentation-atomic-failure");
        fs::create_dir_all(&root).expect("test archive should be created");
        initialize_at(&root).expect("archive should initialize");
        let library: LibraryMetadata = serde_json::from_value(serde_json::json!({
            "version": 1, "books": { "stable": {
                "relativePath": "Book.epub", "isFavorite": true,
                "readerPresentation": "publisher", "addedAt": "added", "updatedAt": "updated"
            }}
        }))
        .expect("metadata should parse");
        write_json(&root, MetadataDocument::Library, &library, false)
            .expect("initial write should work");
        let before = fs::read(metadata_path(&root).join("library.json")).unwrap();
        let result = write_json_with_fs(
            &root,
            MetadataDocument::Library,
            &LibraryMetadata::default(),
            false,
            &FailingMetadataRenameFileSystem,
        );
        assert!(result.is_err());
        assert_eq!(
            fs::read(metadata_path(&root).join("library.json")).unwrap(),
            before
        );
        let reopened: LibraryMetadata =
            read_json(&root, MetadataDocument::Library).expect("metadata should reopen");
        assert_eq!(
            reopened.books["stable"].reader_presentation,
            Some(super::ReaderPresentation::Publisher)
        );
        fs::remove_dir_all(root).expect("test archive should be removed");
    }

    #[test]
    fn old_display_override_fields_are_ignored_when_serializing_library_metadata() {
        let value = serde_json::json!({
            "version": 1,
            "books": {
                "book-1": {
                    "relativePath": "Books/Example.epub",
                    "displayTitle": "Old app title",
                    "displayAuthor": "Old app author",
                    "isFavorite": true,
                    "addedAt": "2026-07-01T00:00:00.000Z",
                    "updatedAt": "2026-07-01T00:00:00.000Z"
                }
            }
        });

        let parsed: LibraryMetadata =
            serde_json::from_value(value).expect("old metadata should deserialize");
        let serialized = serde_json::to_value(parsed).expect("metadata should serialize");
        let book = &serialized["books"]["book-1"];

        assert_eq!(book["relativePath"], "Books/Example.epub");
        assert_eq!(book["isFavorite"], true);
        assert!(book.get("displayTitle").is_none());
        assert!(book.get("displayAuthor").is_none());
    }
}
