use std::{
    path::Path,
    sync::{Arc, Mutex, MutexGuard},
};

use super::{
    dictionary_download::DictionaryDownloadService,
    dictionary_install::DictionaryInstallService,
    dictionary_store::{DictionaryRegistrySnapshot, DictionaryStore},
};

#[derive(Clone, Default)]
pub(crate) struct DictionaryMaintenanceService {
    operation: Arc<Mutex<()>>,
}

impl DictionaryMaintenanceService {
    pub(crate) fn maintain(
        &self,
        app_data_root: &Path,
        download_service: &DictionaryDownloadService,
        install_service: &DictionaryInstallService,
    ) -> Result<DictionaryRegistrySnapshot, String> {
        let _operation = recover_lock(&self.operation);
        install_service.with_maintenance(app_data_root, || {
            download_service
                .cleanup_stale(app_data_root)
                .map_err(|error| error.to_string())?;
            DictionaryStore::snapshot(app_data_root).map_err(|error| error.to_string())
        })
    }
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
        path::PathBuf,
        sync::atomic::{AtomicU64, Ordering},
    };

    use super::DictionaryMaintenanceService;
    use crate::commands::{
        dictionary_download::DictionaryDownloadService,
        dictionary_install::DictionaryInstallService,
        dictionary_store::{DictionaryRegistryStatus, DictionaryStoragePaths},
    };

    static TEST_SEQUENCE: AtomicU64 = AtomicU64::new(0);

    fn test_root() -> PathBuf {
        let sequence = TEST_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "archeion-dictionary-maintenance-{}-{sequence}",
            std::process::id()
        ))
    }

    #[test]
    fn removes_only_recognized_stale_download_and_install_staging() {
        let root = test_root();
        let dictionary_root = DictionaryStoragePaths::from_app_data_root(&root)
            .root()
            .to_path_buf();
        let downloads = dictionary_root.join("staging/downloads");
        let installs = dictionary_root.join("staging/installs");
        for path in [
            downloads.join("partial-1-2-3.download"),
            downloads.join("retired-install-4-5-6.stardict.zip"),
            downloads.join("verified-7-8-9.stardict.zip"),
            downloads.join("unrelated"),
            installs.join("install-1-2-3"),
            installs.join("unrelated"),
        ] {
            fs::create_dir_all(&path).unwrap();
            fs::write(path.join("preserve-or-clean"), b"data").unwrap();
        }

        let snapshot = DictionaryMaintenanceService::default()
            .maintain(
                &root,
                &DictionaryDownloadService::default(),
                &DictionaryInstallService::default(),
            )
            .unwrap();

        assert_eq!(snapshot.status, DictionaryRegistryStatus::Ready);
        assert!(!downloads.join("partial-1-2-3.download").exists());
        assert!(!downloads
            .join("retired-install-4-5-6.stardict.zip")
            .exists());
        assert!(!installs.join("install-1-2-3").exists());
        assert!(downloads.join("verified-7-8-9.stardict.zip").is_dir());
        assert!(downloads.join("unrelated").is_dir());
        assert!(installs.join("unrelated").is_dir());
        fs::remove_dir_all(root).unwrap();
    }
}
