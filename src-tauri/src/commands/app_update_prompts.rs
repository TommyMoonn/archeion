use std::{
    fs,
    path::PathBuf,
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};

use crate::atomic_file::{
    recover_atomic_replace, transaction_path, BackupCleanup, PreparedAtomicFile,
    RealAtomicFileSystem,
};

const SNOOZE_MS: u64 = 24 * 60 * 60 * 1000;

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub(crate) struct UpdatePromptMetadata {
    pub snoozed_version: Option<String>,
    /// Absolute UTC milliseconds since the Unix epoch, never a process-relative timer.
    pub snoozed_until: Option<u64>,
    pub pending_transition: Option<UpdateTransition>,
    pub completed_version: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UpdateTransition {
    from_version: String,
    to_version: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdatePromptSnapshot {
    pub snoozed_version: Option<String>,
    pub snoozed_until: Option<u64>,
    pub restart_deferred: bool,
    pub completed_version: Option<String>,
}

pub(crate) trait UpdatePromptPersistence: Send + Sync {
    fn load(&self) -> Result<UpdatePromptMetadata, String>;
    fn save(&self, metadata: &UpdatePromptMetadata) -> Result<(), String>;
}

pub(crate) struct FileUpdatePromptPersistence(pub PathBuf);

impl UpdatePromptPersistence for FileUpdatePromptPersistence {
    fn load(&self) -> Result<UpdatePromptMetadata, String> {
        recover_atomic_replace(&self.0)
            .map_err(|error| format!("Update prompt recovery failed: {error}"))?;
        match fs::read(&self.0) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map_err(|error| format!("Update prompt metadata is invalid: {error}")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                Ok(UpdatePromptMetadata::default())
            }
            Err(error) => Err(format!("Update prompt metadata could not be read: {error}")),
        }
    }

    fn save(&self, metadata: &UpdatePromptMetadata) -> Result<(), String> {
        if let Some(parent) = self.0.parent() {
            fs::create_dir_all(parent).map_err(|error| {
                format!("Update prompt directory could not be created: {error}")
            })?;
        }
        let bytes = serde_json::to_vec_pretty(metadata).map_err(|error| error.to_string())?;
        let temporary = PreparedAtomicFile::write(transaction_path(&self.0, "tmp-write"), &bytes)
            .map_err(|error| {
            format!("Update prompt metadata could not be written: {error:?}")
        })?;
        temporary
            .replace(
                &self.0,
                &transaction_path(&self.0, "write-backup"),
                BackupCleanup::Required,
                &RealAtomicFileSystem,
            )
            .map_err(|error| format!("Update prompt metadata could not be replaced: {error:?}"))
    }
}

pub(crate) fn utc_now_ms() -> Result<u64, String> {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis()
        .try_into()
        .map_err(|_| "The update clock is out of range.".to_string())
}

/// Owned inside AppUpdateService's lock. Durable mutations publish only after a successful write.
pub(crate) struct UpdatePromptPolicy {
    metadata: UpdatePromptMetadata,
    restart_deferred: bool,
    persistence: Arc<dyn UpdatePromptPersistence>,
    clock: Arc<dyn Fn() -> Result<u64, String> + Send + Sync>,
}

struct UnavailablePromptPersistence;
impl UpdatePromptPersistence for UnavailablePromptPersistence {
    fn load(&self) -> Result<UpdatePromptMetadata, String> {
        Err("Update prompt storage is unavailable.".to_string())
    }
    fn save(&self, _: &UpdatePromptMetadata) -> Result<(), String> {
        Err("Update prompt storage is unavailable.".to_string())
    }
}

impl UpdatePromptPolicy {
    pub(crate) fn unavailable() -> Self {
        Self {
            metadata: UpdatePromptMetadata::default(),
            restart_deferred: false,
            persistence: Arc::new(UnavailablePromptPersistence),
            clock: Arc::new(utc_now_ms),
        }
    }
    pub(crate) fn load(
        current_version: &str,
        persistence: Arc<dyn UpdatePromptPersistence>,
        clock: impl Fn() -> Result<u64, String> + Send + Sync + 'static,
    ) -> Result<Self, String> {
        let mut metadata = persistence.load()?;
        // Consume the installation attempt at the next process startup. An unmatched
        // attempt cannot later turn a manual installation into an updater acknowledgement.
        if let Some(transition) = metadata.pending_transition.take() {
            metadata.completed_version = (transition.to_version == current_version
                && transition.from_version != current_version)
                .then_some(transition.to_version);
            persistence.save(&metadata)?;
        }
        if metadata
            .completed_version
            .as_deref()
            .is_some_and(|version| version != current_version)
        {
            metadata.completed_version = None;
            persistence.save(&metadata)?;
        }
        Ok(Self {
            metadata,
            restart_deferred: false,
            persistence,
            clock: Arc::new(clock),
        })
    }

    pub(crate) fn snapshot(&self) -> UpdatePromptSnapshot {
        UpdatePromptSnapshot {
            snoozed_version: self.metadata.snoozed_version.clone(),
            snoozed_until: self.metadata.snoozed_until,
            restart_deferred: self.restart_deferred,
            completed_version: self.metadata.completed_version.clone(),
        }
    }

    fn mutate(&mut self, change: impl FnOnce(&mut UpdatePromptMetadata)) -> Result<(), String> {
        let mut next = self.metadata.clone();
        change(&mut next);
        self.persistence.save(&next)?;
        self.metadata = next;
        Ok(())
    }

    pub(crate) fn snooze(&mut self, version: &str) -> Result<(), String> {
        let until = (self.clock)()?
            .checked_add(SNOOZE_MS)
            .ok_or("The update clock is out of range.")?;
        self.mutate(|metadata| {
            metadata.snoozed_version = Some(version.to_string());
            metadata.snoozed_until = Some(until);
        })
    }

    pub(crate) fn clear_snooze(&mut self, version: &str) -> Result<(), String> {
        if self.metadata.snoozed_version.as_deref() != Some(version) {
            return Ok(());
        }
        self.mutate(|metadata| {
            metadata.snoozed_version = None;
            metadata.snoozed_until = None;
        })
    }

    pub(crate) fn defer_restart(&mut self) {
        self.restart_deferred = true;
    }

    pub(crate) fn prepare_install(&mut self, from: &str, to: &str) -> Result<(), String> {
        self.mutate(|metadata| {
            metadata.pending_transition = Some(UpdateTransition {
                from_version: from.to_string(),
                to_version: to.to_string(),
            });
            metadata.completed_version = None;
        })
    }

    pub(crate) fn cancel_install(&mut self) -> Result<(), String> {
        self.mutate(|metadata| metadata.pending_transition = None)
    }

    pub(crate) fn acknowledge(&mut self, version: &str) -> Result<(), String> {
        if self.metadata.completed_version.as_deref() != Some(version) {
            return Err("The completed update changed. Refresh update status.".to_string());
        }
        self.mutate(|metadata| metadata.completed_version = None)
    }
}

#[cfg(test)]
#[path = "app_update_prompts_tests.rs"]
mod tests;
