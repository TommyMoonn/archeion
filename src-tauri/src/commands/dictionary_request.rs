use std::sync::{Arc, Mutex, MutexGuard};

use tokio::sync::watch;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DictionaryRequestError {
    Cancelled,
    RevisionExhausted,
    Superseded,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum RequestRetirement {
    Active,
    Cancelled,
    Superseded,
}

struct ActiveRequest {
    revision: u64,
    retirement: watch::Sender<RequestRetirement>,
}

#[derive(Default)]
struct RequestState {
    revision: u64,
    active: Option<ActiveRequest>,
}

#[derive(Clone, Default)]
pub(crate) struct DictionaryRequestOwner {
    state: Arc<Mutex<RequestState>>,
}

#[derive(Clone)]
pub(crate) struct DictionaryRequestTicket {
    revision: u64,
    retirement: watch::Receiver<RequestRetirement>,
}

impl DictionaryRequestTicket {
    pub(crate) fn current_error(&self) -> Option<DictionaryRequestError> {
        match *self.retirement.borrow() {
            RequestRetirement::Active => None,
            RequestRetirement::Cancelled => Some(DictionaryRequestError::Cancelled),
            RequestRetirement::Superseded => Some(DictionaryRequestError::Superseded),
        }
    }

    pub(crate) async fn wait_for_retirement(&self) -> DictionaryRequestError {
        let mut retirement = self.retirement.clone();
        loop {
            if let Some(error) = self.current_error() {
                return error;
            }
            if retirement.changed().await.is_err() {
                return DictionaryRequestError::Superseded;
            }
        }
    }
}

impl DictionaryRequestOwner {
    pub(crate) fn begin(&self) -> Result<DictionaryRequestTicket, DictionaryRequestError> {
        let mut state = recover_lock(&self.state);
        if let Some(active) = state.active.take() {
            active
                .retirement
                .send_replace(RequestRetirement::Superseded);
        }
        state.revision = state
            .revision
            .checked_add(1)
            .ok_or(DictionaryRequestError::RevisionExhausted)?;
        let revision = state.revision;
        let (retirement, receiver) = watch::channel(RequestRetirement::Active);
        state.active = Some(ActiveRequest {
            revision,
            retirement,
        });
        Ok(DictionaryRequestTicket {
            revision,
            retirement: receiver,
        })
    }

    pub(crate) fn cancel_current(&self) {
        let mut state = recover_lock(&self.state);
        if let Some(active) = state.active.take() {
            active.retirement.send_replace(RequestRetirement::Cancelled);
        }
    }

    pub(crate) fn settle_current<T>(
        &self,
        ticket: &DictionaryRequestTicket,
        settle: impl FnOnce() -> T,
    ) -> Result<T, DictionaryRequestError> {
        if let Some(error) = ticket.current_error() {
            return Err(error);
        }
        let mut state = recover_lock(&self.state);
        if state
            .active
            .as_ref()
            .is_some_and(|active| active.revision == ticket.revision)
        {
            let value = settle();
            state.active = None;
            Ok(value)
        } else {
            Err(DictionaryRequestError::Superseded)
        }
    }

    pub(crate) fn finish_failed(
        &self,
        ticket: &DictionaryRequestTicket,
    ) -> Option<DictionaryRequestError> {
        if let Some(error) = ticket.current_error() {
            return Some(error);
        }
        let mut state = recover_lock(&self.state);
        if state
            .active
            .as_ref()
            .is_some_and(|active| active.revision == ticket.revision)
        {
            state.active = None;
            None
        } else {
            Some(DictionaryRequestError::Superseded)
        }
    }
}

fn recover_lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
