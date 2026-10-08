use std::{
    future::Future,
    pin::Pin,
    sync::{Arc, Mutex},
};

use serde::{Deserialize, Serialize};
use tokio::sync::watch;

pub(crate) type UpdateFuture<T> = Pin<Box<dyn Future<Output = Result<T, String>> + Send>>;
pub(crate) type DownloadProgress = Arc<dyn Fn(u64, Option<u64>) + Send + Sync>;
type Outcome = Result<AppUpdateSnapshot, String>;

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CheckIntent {
    Automatic,
    Manual,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateStatus {
    Idle,
    Checking,
    Available,
    Downloading,
    Ready,
    Installing,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateOperation {
    Check,
    Download,
    Install,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    pub version: String,
    pub notes: Option<String>,
    pub published_at: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateOperationError {
    pub operation: UpdateOperation,
    pub message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppUpdateSnapshot {
    pub revision: u64,
    pub supported: bool,
    pub current_version: String,
    pub status: UpdateStatus,
    pub available: Option<UpdateMetadata>,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub error: Option<UpdateOperationError>,
}

pub(crate) trait UpdateHandle: Send + Sync {
    fn download(&self, progress: DownloadProgress) -> UpdateFuture<Vec<u8>>;
    fn install(&self, bytes: Vec<u8>) -> UpdateFuture<()>;
}

#[derive(Clone)]
pub(crate) struct PendingUpdate {
    pub metadata: UpdateMetadata,
    pub handle: Arc<dyn UpdateHandle>,
}

pub(crate) trait UpdateBackend: Send + Sync {
    fn check(&self) -> UpdateFuture<Option<PendingUpdate>>;
}

struct ActiveOperation {
    id: u64,
    operation: UpdateOperation,
    manual_check: bool,
    result: watch::Receiver<Option<Outcome>>,
}

struct UpdateState {
    snapshot: AppUpdateSnapshot,
    pending: Option<PendingUpdate>,
    verified_bytes: Option<Vec<u8>>,
    active: Option<ActiveOperation>,
    next_operation: u64,
}

enum Work {
    Check,
    Download(PendingUpdate),
    Install(PendingUpdate, Vec<u8>),
}

enum Start {
    Complete(AppUpdateSnapshot),
    Join(watch::Receiver<Option<Outcome>>),
    Run {
        id: u64,
        work: Work,
        result: watch::Sender<Option<Outcome>>,
        snapshot: AppUpdateSnapshot,
    },
}

/// The native process owns resources. WebViews receive metadata snapshots only.
#[derive(Clone)]
pub struct AppUpdateService {
    state: Arc<Mutex<UpdateState>>,
    backend: Arc<dyn UpdateBackend>,
    publish: Arc<dyn Fn(AppUpdateSnapshot) + Send + Sync>,
}

impl AppUpdateService {
    pub(crate) fn new(
        current_version: String,
        supported: bool,
        backend: Arc<dyn UpdateBackend>,
        publish: impl Fn(AppUpdateSnapshot) + Send + Sync + 'static,
    ) -> Self {
        Self {
            state: Arc::new(Mutex::new(UpdateState {
                snapshot: AppUpdateSnapshot {
                    revision: 0,
                    supported,
                    current_version,
                    status: UpdateStatus::Idle,
                    available: None,
                    downloaded_bytes: 0,
                    total_bytes: None,
                    error: None,
                },
                pending: None,
                verified_bytes: None,
                active: None,
                next_operation: 0,
            })),
            backend,
            publish: Arc::new(publish),
        }
    }

    pub fn snapshot(&self) -> Outcome {
        self.with_state(|state| Ok(state.snapshot.clone()))
    }

    pub async fn check(&self, intent: CheckIntent) -> Outcome {
        self.run(UpdateOperation::Check, intent).await
    }

    pub async fn download(&self) -> Outcome {
        self.run(UpdateOperation::Download, CheckIntent::Manual)
            .await
    }

    pub async fn install(&self) -> Outcome {
        self.run(UpdateOperation::Install, CheckIntent::Manual)
            .await
    }

    fn with_state<T>(
        &self,
        action: impl FnOnce(&mut UpdateState) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut state = self
            .state
            .lock()
            .map_err(|_| "The update service is unavailable.".to_string())?;
        action(&mut state)
    }

    fn begin(&self, operation: UpdateOperation, intent: CheckIntent) -> Result<Start, String> {
        self.with_state(|state| {
            if !state.snapshot.supported {
                return Err("Updates are unavailable in this build.".to_string());
            }
            if let Some(active) = &mut state.active {
                if active.operation == operation {
                    active.manual_check |= intent == CheckIntent::Manual;
                    return Ok(Start::Join(active.result.clone()));
                }
                if operation == UpdateOperation::Check {
                    return Ok(Start::Complete(state.snapshot.clone()));
                }
                return Err("Another update operation is in progress.".to_string());
            }
            if state.snapshot.status == UpdateStatus::Installing
                || (state.snapshot.status == UpdateStatus::Ready
                    && operation != UpdateOperation::Install)
            {
                return Ok(Start::Complete(state.snapshot.clone()));
            }
            let id = state
                .next_operation
                .checked_add(1)
                .ok_or("Update operation revision is exhausted.")?;
            // Reserve the revision before moving any owned resources.
            let revision = state
                .snapshot
                .revision
                .checked_add(1)
                .ok_or("Update snapshot revision is exhausted.")?;
            let work = match operation {
                UpdateOperation::Check => Work::Check,
                UpdateOperation::Download => Work::Download(
                    state
                        .pending
                        .clone()
                        .ok_or("No update is available to download.")?,
                ),
                UpdateOperation::Install => {
                    if state.snapshot.status != UpdateStatus::Ready {
                        return Err("No verified update is ready to install.".to_string());
                    }
                    let pending = state
                        .pending
                        .clone()
                        .ok_or("No update is ready to install.")?;
                    let bytes = state
                        .verified_bytes
                        .take()
                        .ok_or("No verified update is ready to install.")?;
                    state.pending = None;
                    Work::Install(pending, bytes)
                }
            };
            let (result, receiver) = watch::channel(None);
            state.next_operation = id;
            state.active = Some(ActiveOperation {
                id,
                operation,
                manual_check: intent == CheckIntent::Manual,
                result: receiver,
            });
            state.snapshot.revision = revision;
            state.snapshot.error = None;
            state.snapshot.status = match operation {
                UpdateOperation::Check => UpdateStatus::Checking,
                UpdateOperation::Download => {
                    state.snapshot.downloaded_bytes = 0;
                    state.snapshot.total_bytes = None;
                    UpdateStatus::Downloading
                }
                UpdateOperation::Install => UpdateStatus::Installing,
            };
            Ok(Start::Run {
                id,
                work,
                result,
                snapshot: state.snapshot.clone(),
            })
        })
    }

    async fn run(&self, operation: UpdateOperation, intent: CheckIntent) -> Outcome {
        let mut receiver = match self.begin(operation, intent)? {
            Start::Complete(snapshot) => return Ok(snapshot),
            Start::Join(receiver) => receiver,
            Start::Run {
                id,
                work,
                result,
                snapshot,
            } => {
                (self.publish)(snapshot);
                let receiver = result.subscribe();
                let service = self.clone();
                // Caller/window teardown must not cancel the app-owned operation.
                tauri::async_runtime::spawn(async move {
                    let outcome = service.execute(id, work).await;
                    result.send_replace(Some(outcome));
                });
                receiver
            }
        };
        loop {
            if let Some(result) = receiver.borrow().clone() {
                return result;
            }
            receiver
                .changed()
                .await
                .map_err(|_| "The update operation stopped unexpectedly.".to_string())?;
        }
    }

    async fn execute(&self, id: u64, work: Work) -> Outcome {
        match work {
            Work::Check => {
                let result = self.backend.check().await;
                self.finish(id, result, |state, pending| {
                    state.pending = pending;
                    state.snapshot.available =
                        state.pending.as_ref().map(|update| update.metadata.clone());
                    state.snapshot.status = if state.pending.is_some() {
                        UpdateStatus::Available
                    } else {
                        UpdateStatus::Idle
                    };
                    state.snapshot.downloaded_bytes = 0;
                    state.snapshot.total_bytes = None;
                })
            }
            Work::Download(pending) => {
                let service = self.clone();
                let progress = Arc::new(move |chunk, total| service.progress(id, chunk, total));
                let result = pending.handle.download(progress).await;
                self.finish(id, result, |state, bytes| {
                    state.snapshot.downloaded_bytes = bytes.len() as u64;
                    state.verified_bytes = Some(bytes);
                    state.snapshot.status = UpdateStatus::Ready;
                })
            }
            Work::Install(pending, bytes) => {
                let result = pending.handle.install(bytes).await;
                self.finish(id, result, |state, ()| {
                    state.snapshot.status = UpdateStatus::Installing;
                    state.snapshot.available = None;
                    state.snapshot.downloaded_bytes = 0;
                    state.snapshot.total_bytes = None;
                })
            }
        }
    }

    fn progress(&self, id: u64, chunk: u64, total: Option<u64>) {
        let snapshot = self.with_state(|state| {
            if !state.active.as_ref().is_some_and(|active| {
                active.id == id && active.operation == UpdateOperation::Download
            }) {
                return Ok(None);
            }
            state.snapshot.revision = state
                .snapshot
                .revision
                .checked_add(1)
                .ok_or("Update snapshot revision is exhausted.")?;
            state.snapshot.downloaded_bytes = state.snapshot.downloaded_bytes.saturating_add(chunk);
            state.snapshot.total_bytes = total.filter(|bytes| *bytes > 0);
            Ok(Some(state.snapshot.clone()))
        });
        match snapshot {
            Ok(Some(snapshot)) => (self.publish)(snapshot),
            Ok(None) => (),
            Err(error) => eprintln!("Update progress could not be published: {error}"),
        }
    }

    fn finish<T>(
        &self,
        id: u64,
        result: Result<T, String>,
        apply: impl FnOnce(&mut UpdateState, T),
    ) -> Outcome {
        let mut failure = None;
        let snapshot = self.with_state(|state| {
            if !state.active.as_ref().is_some_and(|active| active.id == id) {
                return Err("The update operation was superseded.".to_string());
            }
            let revision = state
                .snapshot
                .revision
                .checked_add(1)
                .ok_or("Update snapshot revision is exhausted.")?;
            let active = state.active.take().expect("active operation was validated");
            match result {
                Ok(value) => apply(state, value),
                Err(detail) => {
                    eprintln!("Update {:?} failed: {detail}", active.operation);
                    state.snapshot.status = if state.pending.is_some() {
                        UpdateStatus::Available
                    } else {
                        UpdateStatus::Idle
                    };
                    state.snapshot.available =
                        state.pending.as_ref().map(|update| update.metadata.clone());
                    state.snapshot.downloaded_bytes = 0;
                    state.snapshot.total_bytes = None;
                    // Install failures require a fresh download, not a consumed-resource retry.
                    if active.operation != UpdateOperation::Check || active.manual_check {
                        let message = match active.operation {
                            UpdateOperation::Check => "Updates could not be checked. Try again.",
                            UpdateOperation::Download => {
                                "The update could not be downloaded. Try again."
                            }
                            UpdateOperation::Install => {
                                "The update could not be installed. Check for updates to try again."
                            }
                        }
                        .to_string();
                        state.snapshot.error = Some(UpdateOperationError {
                            operation: active.operation,
                            message: message.clone(),
                        });
                        failure = Some(message);
                    }
                }
            }
            state.snapshot.revision = revision;
            Ok(state.snapshot.clone())
        })?;
        (self.publish)(snapshot.clone());
        match failure {
            Some(error) => Err(error),
            None => Ok(snapshot),
        }
    }
}

#[cfg(test)]
#[path = "app_update_service_tests.rs"]
mod tests;
