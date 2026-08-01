use std::{
    fs,
    path::{Path, PathBuf},
};

use super::metadata::METADATA_DIRECTORY;

const BACKUP_DIRECTORY: &str = "backups";
const EPUB_WRITEBACK_DIRECTORY: &str = "epub-writeback";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum MetadataDocument {
    Library,
    Progress,
    Settings,
    Annotations,
    ScannerCache,
}

impl MetadataDocument {
    pub(crate) const ALL: [Self; 5] = [
        Self::Library,
        Self::Progress,
        Self::Settings,
        Self::Annotations,
        Self::ScannerCache,
    ];

    pub(crate) fn file_name(self) -> &'static str {
        match self {
            Self::Library => "library.json",
            Self::Progress => "progress.json",
            Self::Settings => "settings.json",
            Self::Annotations => "annotations.json",
            Self::ScannerCache => "scanner-cache.json",
        }
    }

    fn category(self) -> &'static str {
        match self {
            Self::Library => "library",
            Self::Progress => "progress",
            Self::Settings => "settings",
            Self::Annotations => "annotations",
            Self::ScannerCache => "scanner-cache",
        }
    }

    pub(crate) fn retains_valid_history(self) -> bool {
        self != Self::ScannerCache
    }
}

pub(crate) struct ArchiveBackupLayout<'a> {
    archive_root: &'a Path,
}

impl<'a> ArchiveBackupLayout<'a> {
    pub(crate) fn new(archive_root: &'a Path) -> Self {
        Self { archive_root }
    }

    pub(crate) fn metadata_directory(&self) -> PathBuf {
        self.archive_root.join(METADATA_DIRECTORY)
    }

    pub(crate) fn active_document_path(&self, document: MetadataDocument) -> PathBuf {
        self.metadata_directory().join(document.file_name())
    }

    pub(crate) fn checked_active_document_path(
        &self,
        document: MetadataDocument,
    ) -> Result<PathBuf, String> {
        if let Some(metadata_directory) = self.existing_metadata_directory()? {
            return Ok(metadata_directory.join(document.file_name()));
        }
        let canonical_root =
            fs::canonicalize(self.archive_root).map_err(|error| error.to_string())?;
        Ok(canonical_root
            .join(METADATA_DIRECTORY)
            .join(document.file_name()))
    }

    pub(crate) fn stable_backup_path(&self, document: MetadataDocument) -> Result<PathBuf, String> {
        let path = self
            .ensure_category(document.category())?
            .join(format!("{}.bak", document.file_name()));
        if let Some(metadata) = existing_entry(&path)? {
            if metadata.file_type().is_symlink() {
                return Err("Archive backup files must not be symbolic links.".to_string());
            }
            if !metadata.is_file() {
                return Err("Archive backup path is not a file.".to_string());
            }
        }
        Ok(path)
    }

    pub(crate) fn timestamped_backup_path(
        &self,
        document: MetadataDocument,
        marker: &str,
        suffix: u128,
    ) -> Result<PathBuf, String> {
        let directory = self.ensure_category(document.category())?;
        let file_name = format!("{}.{marker}-{suffix}.bak", document.file_name());
        unique_destination(&directory, &file_name)
    }

    pub(crate) fn metadata_backup_candidates(
        &self,
        document: MetadataDocument,
    ) -> Result<Vec<PathBuf>, String> {
        let mut candidates = Vec::new();

        if let Some(directory) = self.existing_category(document.category())? {
            let stable = directory.join(format!("{}.bak", document.file_name()));
            if is_regular_file(&stable)? {
                candidates.push(stable);
            }
            candidates.extend(timestamped_files(&directory, document, "backup", true)?);
        }

        if let Some(legacy_directory) = self.existing_metadata_directory()? {
            let legacy_stable = legacy_directory.join(format!("{}.bak", document.file_name()));
            if is_regular_file(&legacy_stable)? {
                candidates.push(legacy_stable);
            }
            candidates.extend(timestamped_files(
                &legacy_directory,
                document,
                "backup",
                true,
            )?);
        }

        Ok(candidates)
    }

    pub(crate) fn prune_timestamped_backups(
        &self,
        document: MetadataDocument,
        marker: &str,
        max_backups: usize,
    ) -> Result<(), String> {
        let Some(directory) = self.existing_category(document.category())? else {
            return Ok(());
        };
        let backups = timestamped_files(&directory, document, marker, false)?;
        let stale_count = backups.len().saturating_sub(max_backups);
        for backup_path in backups.into_iter().take(stale_count) {
            fs::remove_file(backup_path).map_err(|error| error.to_string())?;
        }
        Ok(())
    }

    pub(crate) fn timestamped_backup_contains(
        &self,
        document: MetadataDocument,
        marker: &str,
        expected_contents: &[u8],
    ) -> Result<bool, String> {
        let Some(directory) = self.existing_category(document.category())? else {
            return Ok(false);
        };
        for path in timestamped_files(&directory, document, marker, false)? {
            if fs::read(path).map_err(|error| error.to_string())? == expected_contents {
                return Ok(true);
            }
        }
        Ok(false)
    }

    pub(crate) fn migrate_metadata_document(
        &self,
        document: MetadataDocument,
        max_backups: usize,
    ) -> Result<(), String> {
        let Some(legacy_directory) = self.existing_metadata_directory()? else {
            return Ok(());
        };

        let stable_name = format!("{}.bak", document.file_name());
        let backup_prefix = timestamped_prefix(document, "backup");
        let corruption_prefix = timestamped_prefix(document, "corrupt");
        let mut legacy_files = Vec::new();

        for entry in fs::read_dir(&legacy_directory).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            if !entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_file()
            {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().to_string();
            let recognized = if document.retains_valid_history() {
                file_name == stable_name
                    || is_timestamped_name(&file_name, &backup_prefix)
                    || is_timestamped_name(&file_name, &corruption_prefix)
            } else {
                is_timestamped_name(&file_name, &corruption_prefix)
            };
            if recognized {
                legacy_files.push((file_name, entry.path()));
            }
        }

        if legacy_files.is_empty() {
            return Ok(());
        }

        legacy_files.sort_by(|left, right| left.0.cmp(&right.0));
        let destination_directory = self.ensure_category(document.category())?;
        for (file_name, source) in legacy_files {
            let collision_stem = if file_name == stable_name {
                format!("{}.backup-legacy", document.file_name())
            } else {
                file_name
                    .strip_suffix(".bak")
                    .unwrap_or(&file_name)
                    .to_string()
            };
            migrate_without_overwrite(
                &source,
                &destination_directory,
                &file_name,
                &collision_stem,
                ".bak",
            )?;
        }

        if document.retains_valid_history() {
            self.prune_timestamped_backups(document, "backup", max_backups)?;
        }
        self.prune_timestamped_backups(document, "corrupt", max_backups)
    }

    pub(crate) fn ensure_epub_writeback_directory(&self) -> Result<PathBuf, String> {
        self.ensure_category(EPUB_WRITEBACK_DIRECTORY)
    }

    pub(crate) fn existing_epub_writeback_directory(&self) -> Result<Option<PathBuf>, String> {
        self.existing_category(EPUB_WRITEBACK_DIRECTORY)
    }

    pub(crate) fn migrate_epub_writeback_files(
        &self,
        is_recognized: impl Fn(&str) -> bool,
    ) -> Result<(), String> {
        let Some(legacy_root) = self.existing_backup_root()? else {
            return Ok(());
        };
        let mut legacy_files = Vec::new();
        for entry in fs::read_dir(&legacy_root).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            if !entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_file()
            {
                continue;
            }
            let file_name = entry.file_name().to_string_lossy().to_string();
            if is_recognized(&file_name) {
                legacy_files.push((file_name, entry.path()));
            }
        }
        if legacy_files.is_empty() {
            return Ok(());
        }

        legacy_files.sort_by(|left, right| left.0.cmp(&right.0));
        let destination = self.ensure_epub_writeback_directory()?;
        for (file_name, source) in legacy_files {
            let collision_stem = file_name.strip_suffix(".epub.bak").unwrap_or(&file_name);
            migrate_without_overwrite(
                &source,
                &destination,
                &file_name,
                collision_stem,
                ".epub.bak",
            )?;
        }
        Ok(())
    }

    pub(crate) fn existing_backup_root(&self) -> Result<Option<PathBuf>, String> {
        let metadata_directory = self.existing_metadata_directory()?;
        let Some(metadata_directory) = metadata_directory else {
            return Ok(None);
        };
        checked_existing_directory(
            &metadata_directory.join(BACKUP_DIRECTORY),
            &metadata_directory.join(BACKUP_DIRECTORY),
            "Archive backup folder",
        )
    }

    fn ensure_category(&self, category: &str) -> Result<PathBuf, String> {
        let backup_root = self.ensure_backup_root()?;
        let category_path = backup_root.join(category);
        ensure_direct_child_directory(&backup_root, &category_path, "Archive backup category")
    }

    fn existing_category(&self, category: &str) -> Result<Option<PathBuf>, String> {
        let Some(backup_root) = self.existing_backup_root()? else {
            return Ok(None);
        };
        checked_existing_directory(
            &backup_root.join(category),
            &backup_root.join(category),
            "Archive backup category",
        )
    }

    fn ensure_backup_root(&self) -> Result<PathBuf, String> {
        let metadata_directory = self.ensure_metadata_directory()?;
        let backup_root = metadata_directory.join(BACKUP_DIRECTORY);
        ensure_direct_child_directory(&metadata_directory, &backup_root, "Archive backup folder")
    }

    fn ensure_metadata_directory(&self) -> Result<PathBuf, String> {
        let canonical_root =
            fs::canonicalize(self.archive_root).map_err(|error| error.to_string())?;
        let metadata_directory = canonical_root.join(METADATA_DIRECTORY);
        ensure_direct_child_directory(
            &canonical_root,
            &metadata_directory,
            "Archive metadata folder",
        )
    }

    fn existing_metadata_directory(&self) -> Result<Option<PathBuf>, String> {
        let canonical_root =
            fs::canonicalize(self.archive_root).map_err(|error| error.to_string())?;
        checked_existing_directory(
            &canonical_root.join(METADATA_DIRECTORY),
            &canonical_root.join(METADATA_DIRECTORY),
            "Archive metadata folder",
        )
    }
}

fn ensure_direct_child_directory(
    canonical_parent: &Path,
    path: &Path,
    label: &str,
) -> Result<PathBuf, String> {
    if path.exists() {
        return checked_existing_directory(path, path, label)?
            .ok_or_else(|| format!("{label} is unavailable."));
    }

    fs::create_dir(path).map_err(|error| error.to_string())?;
    let canonical_path = fs::canonicalize(path).map_err(|error| error.to_string())?;
    if canonical_path.parent() != Some(canonical_parent) || canonical_path != path {
        return Err(format!("{label} is outside the active archive."));
    }
    Ok(canonical_path)
}

fn checked_existing_directory(
    path: &Path,
    expected_path: &Path,
    label: &str,
) -> Result<Option<PathBuf>, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if metadata.file_type().is_symlink() {
        return Err(format!("{label} must not be a symbolic link."));
    }
    if !metadata.is_dir() {
        return Err(format!("{label} is not a directory."));
    }
    let canonical_path = fs::canonicalize(path).map_err(|error| error.to_string())?;
    if canonical_path != expected_path {
        return Err(format!("{label} is outside the active archive."));
    }
    Ok(Some(canonical_path))
}

fn timestamped_prefix(document: MetadataDocument, marker: &str) -> String {
    format!("{}.{marker}-", document.file_name())
}

fn is_timestamped_name(file_name: &str, prefix: &str) -> bool {
    file_name.starts_with(prefix) && file_name.ends_with(".bak")
}

fn timestamped_files(
    directory: &Path,
    document: MetadataDocument,
    marker: &str,
    newest_first: bool,
) -> Result<Vec<PathBuf>, String> {
    if !directory.is_dir() {
        return Ok(Vec::new());
    }
    let prefix = timestamped_prefix(document, marker);
    let mut backups = Vec::new();
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();
        if is_timestamped_name(&file_name, &prefix)
            && entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_file()
        {
            backups.push((file_name, entry.path()));
        }
    }
    backups.sort_by(|left, right| {
        if newest_first {
            right.0.cmp(&left.0)
        } else {
            left.0.cmp(&right.0)
        }
    });
    Ok(backups.into_iter().map(|(_, path)| path).collect())
}

fn is_regular_file(path: &Path) -> Result<bool, String> {
    match existing_entry(path)? {
        Some(metadata) if metadata.file_type().is_symlink() => {
            Err("Archive backup files must not be symbolic links.".to_string())
        }
        Some(metadata) => Ok(metadata.is_file()),
        None => Ok(false),
    }
}

fn unique_destination(directory: &Path, file_name: &str) -> Result<PathBuf, String> {
    let desired = directory.join(file_name);
    let Some(desired_metadata) = existing_entry(&desired)? else {
        return Ok(desired);
    };
    if desired_metadata.file_type().is_symlink() {
        return Err("Archive backup files must not be symbolic links.".to_string());
    }
    let stem = file_name.strip_suffix(".bak").unwrap_or(file_name);
    for collision in 1_u32.. {
        let candidate = directory.join(format!("{stem}.collision-{collision}.bak"));
        let Some(candidate_metadata) = existing_entry(&candidate)? else {
            return Ok(candidate);
        };
        if candidate_metadata.file_type().is_symlink() {
            return Err("Archive backup files must not be symbolic links.".to_string());
        }
    }
    unreachable!()
}

fn migrate_without_overwrite(
    source: &Path,
    destination_directory: &Path,
    file_name: &str,
    collision_stem: &str,
    collision_extension: &str,
) -> Result<(), String> {
    let desired = destination_directory.join(file_name);
    if existing_entry(&desired)?.is_none() {
        return fs::rename(source, desired).map_err(|error| error.to_string());
    }
    if files_equal(source, &desired)? {
        return fs::remove_file(source).map_err(|error| error.to_string());
    }

    for collision in 1_u32.. {
        let candidate = destination_directory.join(format!(
            "{collision_stem}.collision-{collision}{collision_extension}"
        ));
        if existing_entry(&candidate)?.is_some() {
            if files_equal(source, &candidate)? {
                return fs::remove_file(source).map_err(|error| error.to_string());
            }
            continue;
        }
        return fs::rename(source, candidate).map_err(|error| error.to_string());
    }
    unreachable!()
}

fn files_equal(left: &Path, right: &Path) -> Result<bool, String> {
    if !is_regular_file(right)? {
        return Ok(false);
    }
    let left_contents = fs::read(left).map_err(|error| error.to_string())?;
    let right_contents = fs::read(right).map_err(|error| error.to_string())?;
    Ok(left_contents == right_contents)
}

fn existing_entry(path: &Path) -> Result<Option<fs::Metadata>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => Ok(Some(metadata)),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}
