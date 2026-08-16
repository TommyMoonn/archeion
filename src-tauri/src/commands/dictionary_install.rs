use std::{
    fmt,
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, MutexGuard,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use super::{
    dictionary_archive::{self, DictionaryArchiveError},
    dictionary_catalog::DictionaryCatalogEntry,
    dictionary_download::{
        claim_verified_download, DictionaryDownloadError, VerifiedDownloadArtifact,
    },
    dictionary_store::{
        open_current_store, DictionaryIndexState, DictionaryRegistration, DictionarySourceKind,
        DictionaryStoragePaths, DictionaryStoreError, InstalledDictionary,
    },
    stardict_validation::{
        self, StarDictDefinitionCompression, StarDictSourceFileKind, ValidatedStarDictPackage,
    },
};
use sha2::{Digest, Sha256};

const INSTALL_STAGING_DIRECTORY: &str = "staging/installs";
static INSTALL_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Default)]
pub(crate) struct DictionaryInstallService {
    operation: Arc<Mutex<()>>,
}

impl DictionaryInstallService {
    pub(crate) fn install_catalog(
        &self,
        app_data_root: &Path,
        staging_token: &str,
    ) -> Result<InstalledDictionary, DictionaryInstallError> {
        self.install_catalog_with_cleanup(app_data_root, staging_token, |path| {
            fs::remove_dir_all(path)
        })
    }

    fn install_catalog_with_cleanup<Cleanup>(
        &self,
        app_data_root: &Path,
        staging_token: &str,
        cleanup_retired: Cleanup,
    ) -> Result<InstalledDictionary, DictionaryInstallError>
    where
        Cleanup: FnOnce(&Path) -> Result<(), std::io::Error>,
    {
        let _operation = recover_lock(&self.operation);
        let claimed = claim_verified_download(app_data_root, staging_token)?;
        let result = install_claimed_catalog(app_data_root, claimed.artifact());
        match result {
            Ok(installed) => {
                claimed.retire_with(cleanup_retired);
                Ok(installed)
            }
            Err(installation) => match claimed.restore() {
                Ok(()) => Err(installation),
                Err(restoration) => Err(DictionaryInstallError::VerifiedPackagePreservation {
                    installation: Box::new(installation),
                    restoration,
                }),
            },
        }
    }

    pub(crate) fn install_manual(
        &self,
        app_data_root: &Path,
        ifo_path: &Path,
    ) -> Result<InstalledDictionary, DictionaryInstallError> {
        let _operation = recover_lock(&self.operation);
        let source = stardict_validation::validate_package(ifo_path)?;
        let staging = InstallStaging::create(app_data_root)?;
        let prepared = prepare_owned_package(&source, &staging.path.join("prepared"))?;
        let registration = manual_registration(&prepared);
        publish_install(app_data_root, &staging, registration, &prepared)
    }

    pub(crate) fn with_maintenance<T>(
        &self,
        app_data_root: &Path,
        maintain: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        let _operation = recover_lock(&self.operation);
        cleanup_stale_install_staging(app_data_root).map_err(|error| error.to_string())?;
        maintain()
    }
}

fn install_claimed_catalog(
    app_data_root: &Path,
    artifact: &VerifiedDownloadArtifact,
) -> Result<InstalledDictionary, DictionaryInstallError> {
    verify_catalog_archive(artifact)?;
    let staging = InstallStaging::create(app_data_root)?;
    let extracted = staging.path.join("source");
    let validated = dictionary_archive::extract_catalog_package(
        artifact.catalog_entry.package_format,
        &artifact.package_path,
        &extracted,
    )?;
    let prepared = prepare_owned_package(&validated, &staging.path.join("prepared"))?;
    let registration = catalog_registration(&artifact.catalog_entry, &prepared);
    publish_catalog_install(app_data_root, &staging, registration, &prepared)
}

fn publish_catalog_install(
    app_data_root: &Path,
    staging: &InstallStaging,
    registration: DictionaryRegistration,
    package: &ValidatedStarDictPackage,
) -> Result<InstalledDictionary, DictionaryInstallError> {
    let mut store = open_current_store(app_data_root)?;
    let recovery_target = registration
        .catalog_id
        .as_deref()
        .map(|catalog_id| store.unavailable_catalog_dictionary(catalog_id))
        .transpose()?
        .flatten();
    let Some(target) = recovery_target else {
        drop(store);
        return publish_install(app_data_root, staging, registration, package);
    };

    let prepared_path = staging.path.join("prepared");
    let retired_path = staging.path.join("replaced");
    let installed = store
        .replace_unavailable_dictionary(
            &target.id,
            registration,
            package,
            package.definition_data.expanded_bytes,
            |_dictionary_id, installed_path| {
                activate_replacement(&prepared_path, installed_path, &retired_path)
            },
            |installed_path| rollback_replacement(installed_path, &retired_path),
        )
        .map_err(DictionaryInstallError::Store)?;
    if retired_path.exists() {
        if let Err(error) = fs::remove_dir_all(&retired_path) {
            eprintln!(
                "Dictionary replacement committed but retired-file cleanup failed at {}: {error}",
                retired_path.display()
            );
        }
    }
    Ok(installed)
}

fn activate_replacement(
    prepared_path: &Path,
    installed_path: &Path,
    retired_path: &Path,
) -> Result<(), String> {
    match fs::symlink_metadata(installed_path) {
        Ok(metadata) if metadata.file_type().is_dir() => {
            fs::rename(installed_path, retired_path).map_err(|error| {
                format!("Existing dictionary files could not be retired: {error}")
            })?;
        }
        Ok(_) => return Err("Installed dictionary storage is not a regular directory.".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Installed dictionary storage is unavailable: {error}"
            ))
        }
    }
    if let Err(error) = fs::rename(prepared_path, installed_path) {
        if retired_path.exists() {
            let _ = fs::rename(retired_path, installed_path);
        }
        return Err(format!(
            "Replacement dictionary files could not be activated: {error}"
        ));
    }
    Ok(())
}

fn rollback_replacement(installed_path: &Path, retired_path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(installed_path) {
        Ok(metadata) if metadata.file_type().is_dir() => fs::remove_dir_all(installed_path)
            .map_err(|error| format!("Replacement dictionary cleanup failed: {error}"))?,
        Ok(_) => {
            return Err("Replacement dictionary storage is not a regular directory.".to_string())
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Replacement dictionary storage is unavailable: {error}"
            ))
        }
    }
    if retired_path.exists() {
        fs::rename(retired_path, installed_path)
            .map_err(|error| format!("Original dictionary files could not be restored: {error}"))?;
    }
    Ok(())
}

fn publish_install(
    app_data_root: &Path,
    staging: &InstallStaging,
    registration: DictionaryRegistration,
    package: &ValidatedStarDictPackage,
) -> Result<InstalledDictionary, DictionaryInstallError> {
    publish_install_with(
        app_data_root,
        staging,
        registration,
        package,
        |prepared_path, installed_path| {
            fs::rename(prepared_path, installed_path)
                .map_err(|error| format!("Dictionary file activation failed: {error}"))
        },
        |installed_path| fs::remove_dir_all(installed_path).map_err(|error| error.to_string()),
    )
}

fn publish_install_with<Activate, Rollback>(
    app_data_root: &Path,
    staging: &InstallStaging,
    registration: DictionaryRegistration,
    package: &ValidatedStarDictPackage,
    activate: Activate,
    rollback_activation: Rollback,
) -> Result<InstalledDictionary, DictionaryInstallError>
where
    Activate: FnOnce(&Path, &Path) -> Result<(), String>,
    Rollback: FnOnce(&Path) -> Result<(), String>,
{
    let prepared_path = staging.path.join("prepared");
    let installed_parent = DictionaryStoragePaths::from_app_data_root(app_data_root)
        .root()
        .join("installed");
    fs::create_dir_all(&installed_parent).map_err(DictionaryInstallError::Filesystem)?;
    let mut store = open_current_store(app_data_root)?;
    store
        .install_dictionary(
            registration,
            package,
            package.definition_data.expanded_bytes,
            |_dictionary_id, installed_path| activate(&prepared_path, installed_path),
            rollback_activation,
        )
        .map_err(DictionaryInstallError::Store)
}

fn verify_catalog_archive(
    artifact: &VerifiedDownloadArtifact,
) -> Result<(), DictionaryInstallError> {
    let metadata =
        fs::symlink_metadata(&artifact.package_path).map_err(DictionaryInstallError::Filesystem)?;
    if !metadata.file_type().is_file() || metadata.len() != artifact.verified_size_bytes {
        return Err(DictionaryInstallError::VerifiedPackageChanged);
    }
    let mut file =
        File::open(&artifact.package_path).map_err(DictionaryInstallError::Filesystem)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    let mut bytes = 0_u64;
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(DictionaryInstallError::Filesystem)?;
        if read == 0 {
            break;
        }
        bytes = bytes
            .checked_add(read as u64)
            .ok_or(DictionaryInstallError::VerifiedPackageChanged)?;
        if bytes > artifact.verified_size_bytes {
            return Err(DictionaryInstallError::VerifiedPackageChanged);
        }
        hasher.update(&buffer[..read]);
    }
    if bytes != artifact.verified_size_bytes
        || format!("{:x}", hasher.finalize()) != artifact.verified_sha256
    {
        return Err(DictionaryInstallError::VerifiedPackageChanged);
    }
    Ok(())
}

fn prepare_owned_package(
    package: &ValidatedStarDictPackage,
    destination: &Path,
) -> Result<ValidatedStarDictPackage, DictionaryInstallError> {
    fs::create_dir_all(destination).map_err(DictionaryInstallError::Filesystem)?;
    for source in &package.source_files {
        let name = match source.kind {
            StarDictSourceFileKind::Metadata => "dictionary.ifo",
            StarDictSourceFileKind::Index => "dictionary.idx",
            StarDictSourceFileKind::Definitions => match package.definition_data.compression {
                StarDictDefinitionCompression::None => "dictionary.dict",
                StarDictDefinitionCompression::Dictzip => "dictionary.dict.dz",
            },
            StarDictSourceFileKind::Synonyms => "dictionary.syn",
        };
        let destination = destination.join(name);
        let copied =
            fs::copy(&source.path, &destination).map_err(DictionaryInstallError::Filesystem)?;
        if copied != source.byte_length {
            return Err(DictionaryInstallError::SourceChanged);
        }
    }
    stardict_validation::validate_package(&destination.join("dictionary.ifo"))
        .map_err(DictionaryInstallError::Validation)
}

fn catalog_registration(
    entry: &DictionaryCatalogEntry,
    package: &ValidatedStarDictPackage,
) -> DictionaryRegistration {
    DictionaryRegistration {
        display_name: entry.name.clone(),
        source_language: entry.source_language.clone(),
        target_language: entry.target_language.clone(),
        enabled: true,
        entry_count: 0,
        installed_size_bytes: installed_source_bytes(package),
        source_kind: DictionarySourceKind::Catalog,
        catalog_id: Some(entry.id.clone()),
        source_attribution: entry.source_attribution.clone(),
        license_name: entry.license_name.clone(),
        license_url: Some(entry.license_url.clone()),
        package_version: entry.package_version.clone(),
        index_state: DictionaryIndexState::Pending,
    }
}

fn manual_registration(package: &ValidatedStarDictPackage) -> DictionaryRegistration {
    DictionaryRegistration {
        display_name: package.metadata.book_name.clone(),
        source_language: "und".to_string(),
        target_language: "und".to_string(),
        enabled: true,
        entry_count: 0,
        installed_size_bytes: installed_source_bytes(package),
        source_kind: DictionarySourceKind::ManualImport,
        catalog_id: None,
        source_attribution: "Manual import".to_string(),
        license_name: "User-provided dictionary".to_string(),
        license_url: None,
        package_version: package.metadata.version.clone(),
        index_state: DictionaryIndexState::Pending,
    }
}

fn installed_source_bytes(package: &ValidatedStarDictPackage) -> u64 {
    package
        .source_files
        .iter()
        .map(|source| source.byte_length)
        .sum()
}

fn install_staging_root(app_data_root: &Path) -> PathBuf {
    DictionaryStoragePaths::from_app_data_root(app_data_root)
        .root()
        .join(INSTALL_STAGING_DIRECTORY)
}

fn cleanup_stale_install_staging(app_data_root: &Path) -> Result<usize, DictionaryInstallError> {
    let staging = install_staging_root(app_data_root);
    let entries = match fs::read_dir(&staging) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(error) => return Err(DictionaryInstallError::Filesystem(error)),
    };
    let mut removed = 0;
    for entry in entries {
        let entry = entry.map_err(DictionaryInstallError::Filesystem)?;
        let name = entry.file_name();
        let Some(stem) = name.to_str().and_then(|name| name.strip_prefix("install-")) else {
            continue;
        };
        let segments = stem.split('-').collect::<Vec<_>>();
        if segments.len() != 3
            || segments.iter().any(|segment| {
                segment.is_empty() || !segment.bytes().all(|byte| byte.is_ascii_digit())
            })
        {
            continue;
        }
        let metadata =
            fs::symlink_metadata(entry.path()).map_err(DictionaryInstallError::Filesystem)?;
        if !metadata.file_type().is_dir() {
            continue;
        }
        fs::remove_dir_all(entry.path()).map_err(DictionaryInstallError::Filesystem)?;
        removed += 1;
    }
    Ok(removed)
}

struct InstallStaging {
    path: PathBuf,
}

impl InstallStaging {
    fn create(app_data_root: &Path) -> Result<Self, DictionaryInstallError> {
        let parent = install_staging_root(app_data_root);
        fs::create_dir_all(&parent).map_err(DictionaryInstallError::Filesystem)?;
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let sequence = INSTALL_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let path = parent.join(format!(
            "install-{}-{timestamp}-{sequence}",
            std::process::id()
        ));
        fs::create_dir(&path).map_err(DictionaryInstallError::Filesystem)?;
        Ok(Self { path })
    }
}

impl Drop for InstallStaging {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn recover_lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

#[derive(Debug)]
pub(crate) enum DictionaryInstallError {
    Download(DictionaryDownloadError),
    Archive(DictionaryArchiveError),
    Filesystem(std::io::Error),
    SourceChanged,
    Store(DictionaryStoreError),
    Validation(stardict_validation::StarDictValidationError),
    VerifiedPackageChanged,
    VerifiedPackagePreservation {
        installation: Box<DictionaryInstallError>,
        restoration: DictionaryDownloadError,
    },
}

impl fmt::Display for DictionaryInstallError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Archive(error) => write!(formatter, "{error}"),
            Self::Download(error) => write!(formatter, "{error}"),
            Self::Filesystem(error) => write!(formatter, "Dictionary installation failed: {error}"),
            Self::SourceChanged => formatter.write_str(
                "The StarDict source changed while it was being copied for installation.",
            ),
            Self::Store(error) => write!(formatter, "{error}"),
            Self::Validation(error) => write!(formatter, "{error}"),
            Self::VerifiedPackageChanged => {
                formatter.write_str("The verified dictionary package changed before installation.")
            }
            Self::VerifiedPackagePreservation {
                installation,
                restoration,
            } => write!(
                formatter,
                "{installation} The verified package could not be restored for retry: {restoration}"
            ),
        }
    }
}

impl From<DictionaryArchiveError> for DictionaryInstallError {
    fn from(value: DictionaryArchiveError) -> Self {
        match value {
            DictionaryArchiveError::Filesystem(error) => Self::Filesystem(error),
            DictionaryArchiveError::InvalidArchive(message) => {
                Self::Archive(DictionaryArchiveError::InvalidArchive(message))
            }
            DictionaryArchiveError::Validation(error) => Self::Validation(error),
        }
    }
}

impl From<DictionaryDownloadError> for DictionaryInstallError {
    fn from(value: DictionaryDownloadError) -> Self {
        Self::Download(value)
    }
}

impl From<DictionaryStoreError> for DictionaryInstallError {
    fn from(value: DictionaryStoreError) -> Self {
        Self::Store(value)
    }
}

impl From<stardict_validation::StarDictValidationError> for DictionaryInstallError {
    fn from(value: stardict_validation::StarDictValidationError) -> Self {
        Self::Validation(value)
    }
}

#[cfg(test)]
#[path = "dictionary_install_tests.rs"]
mod tests;
