use std::{
    collections::HashSet,
    fmt,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, MutexGuard,
    },
    time::{SystemTime, UNIX_EPOCH},
};

use sha2::{Digest, Sha256};
use zip::ZipArchive;

use super::{
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

const INSTALL_STAGING_DIRECTORY: &str = "staging/installs";
const MAX_ARCHIVE_ENTRIES: usize = 16;
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
}

fn install_claimed_catalog(
    app_data_root: &Path,
    artifact: &VerifiedDownloadArtifact,
) -> Result<InstalledDictionary, DictionaryInstallError> {
    verify_catalog_archive(artifact)?;
    let staging = InstallStaging::create(app_data_root)?;
    let extracted = staging.path.join("source");
    let validated = extract_catalog_archive(&artifact.package_path, &extracted)?;
    let prepared = prepare_owned_package(&validated, &staging.path.join("prepared"))?;
    let registration = catalog_registration(&artifact.catalog_entry, &prepared);
    publish_install(app_data_root, &staging, registration, &prepared)
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

fn extract_catalog_archive(
    archive_path: &Path,
    destination: &Path,
) -> Result<ValidatedStarDictPackage, DictionaryInstallError> {
    fs::create_dir_all(destination).map_err(DictionaryInstallError::Filesystem)?;
    let file = File::open(archive_path).map_err(DictionaryInstallError::Filesystem)?;
    let mut archive = ZipArchive::new(file).map_err(zip_error)?;
    if archive.len() > MAX_ARCHIVE_ENTRIES {
        return Err(DictionaryInstallError::InvalidArchive(
            "The dictionary package contains too many archive entries.".to_string(),
        ));
    }
    let mut extracted_paths = HashSet::new();
    let mut extracted_files = Vec::new();
    let mut ifo_paths = Vec::new();
    let mut expanded_bytes = 0_u64;
    for index in 0..archive.len() {
        let mut entry = archive.by_index(index).map_err(zip_error)?;
        let enclosed = entry.enclosed_name().ok_or_else(|| {
            DictionaryInstallError::InvalidArchive(
                "The dictionary package contains an unsafe path.".to_string(),
            )
        })?;
        if !safe_archive_path(&enclosed) || archive_entry_is_symlink(entry.unix_mode()) {
            return Err(DictionaryInstallError::InvalidArchive(
                "The dictionary package contains an unsafe resource.".to_string(),
            ));
        }
        if entry.is_dir() {
            continue;
        }
        let limit =
            stardict_validation::supported_source_file_limit(&enclosed).ok_or_else(|| {
                DictionaryInstallError::InvalidArchive(
                    "The dictionary package contains an unsupported resource.".to_string(),
                )
            })?;
        if entry.size() > limit {
            return Err(DictionaryInstallError::InvalidArchive(
                "A dictionary package resource exceeds its size limit.".to_string(),
            ));
        }
        expanded_bytes = expanded_bytes
            .checked_add(entry.size())
            .filter(|bytes| *bytes <= stardict_validation::maximum_package_source_bytes())
            .ok_or_else(|| {
                DictionaryInstallError::InvalidArchive(
                    "The expanded dictionary package exceeds its size limit.".to_string(),
                )
            })?;
        let collision_key = enclosed.to_string_lossy().to_lowercase();
        if !extracted_paths.insert(collision_key) {
            return Err(DictionaryInstallError::InvalidArchive(
                "The dictionary package contains duplicate resource paths.".to_string(),
            ));
        }
        let output = destination.join(&enclosed);
        let parent = output.parent().ok_or_else(|| {
            DictionaryInstallError::InvalidArchive(
                "The dictionary package resource path is invalid.".to_string(),
            )
        })?;
        fs::create_dir_all(parent).map_err(DictionaryInstallError::Filesystem)?;
        let mut output_file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&output)
            .map_err(DictionaryInstallError::Filesystem)?;
        let copied = std::io::copy(&mut entry.by_ref().take(limit + 1), &mut output_file)
            .map_err(DictionaryInstallError::Filesystem)?;
        if copied != entry.size() || copied > limit {
            return Err(DictionaryInstallError::InvalidArchive(
                "A dictionary package resource has an invalid expanded size.".to_string(),
            ));
        }
        output_file
            .flush()
            .map_err(DictionaryInstallError::Filesystem)?;
        output_file
            .sync_all()
            .map_err(DictionaryInstallError::Filesystem)?;
        if output.extension().and_then(|extension| extension.to_str()) == Some("ifo") {
            ifo_paths.push(output.clone());
        }
        extracted_files.push(output);
    }
    if ifo_paths.len() != 1 {
        return Err(DictionaryInstallError::InvalidArchive(
            "The dictionary package must contain exactly one StarDict .ifo file.".to_string(),
        ));
    }
    let validated = stardict_validation::validate_package(&ifo_paths[0])?;
    if validated.source_files.len() != extracted_files.len() {
        return Err(DictionaryInstallError::InvalidArchive(
            "The dictionary package must contain one complete StarDict package.".to_string(),
        ));
    }
    Ok(validated)
}

fn safe_archive_path(path: &Path) -> bool {
    let components = path.components().collect::<Vec<_>>();
    !components.is_empty()
        && components.len() <= 2
        && components
            .iter()
            .all(|component| matches!(component, Component::Normal(_)))
}

fn archive_entry_is_symlink(mode: Option<u32>) -> bool {
    mode.is_some_and(|mode| mode & 0o170000 == 0o120000)
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
        language: entry.language.clone(),
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
        language: "und".to_string(),
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

fn zip_error(error: zip::result::ZipError) -> DictionaryInstallError {
    DictionaryInstallError::InvalidArchive(format!(
        "The dictionary package archive is invalid: {error}"
    ))
}

#[derive(Debug)]
pub(crate) enum DictionaryInstallError {
    Download(DictionaryDownloadError),
    Filesystem(std::io::Error),
    InvalidArchive(String),
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
            Self::Download(error) => write!(formatter, "{error}"),
            Self::Filesystem(error) => write!(formatter, "Dictionary installation failed: {error}"),
            Self::InvalidArchive(message) => formatter.write_str(message),
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
