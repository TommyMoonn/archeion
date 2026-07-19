use std::{
    collections::HashMap,
    io,
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex, MutexGuard, OnceLock},
};

const INTERRUPTED_COVER_LOAD: &str = "The cover load ended before completion.";
const CONSUMED_COVER_LOAD: &str = "The cover load result is no longer available.";

type CoverLoadResult = Result<Vec<u8>, Arc<str>>;

enum CoverRequestState {
    Loading {
        participants: usize,
    },
    Ready {
        result: CoverLoadResult,
        remaining: usize,
    },
    Materializing,
    Consumed,
}

struct InFlightCoverRequest {
    state: Mutex<CoverRequestState>,
    changed: Condvar,
}

impl InFlightCoverRequest {
    fn new() -> Self {
        Self {
            state: Mutex::new(CoverRequestState::Loading { participants: 1 }),
            changed: Condvar::new(),
        }
    }

    fn add_participant(&self) {
        let mut state = recover_lock(&self.state);
        let CoverRequestState::Loading { participants } = &mut *state else {
            unreachable!("completed cover requests are removed before accepting new callers");
        };
        *participants += 1;
        self.changed.notify_all();
    }

    fn publish(&self, result: CoverLoadResult, owner_receives: bool) {
        let mut state = recover_lock(&self.state);
        let CoverRequestState::Loading { participants } = &*state else {
            unreachable!("a cover request publishes exactly one result");
        };
        let remaining = participants - usize::from(!owner_receives);
        *state = if remaining == 0 {
            CoverRequestState::Consumed
        } else {
            CoverRequestState::Ready { result, remaining }
        };
        self.changed.notify_all();
    }

    fn receive(&self) -> Result<Vec<u8>, String> {
        self.receive_with(Vec::clone)
    }

    fn receive_with<F>(&self, copy: F) -> Result<Vec<u8>, String>
    where
        F: FnOnce(&Vec<u8>) -> Vec<u8>,
    {
        let mut copy = Some(copy);
        loop {
            let mut state = recover_lock(&self.state);
            match &mut *state {
                CoverRequestState::Loading { .. } | CoverRequestState::Materializing => {
                    drop(
                        self.changed
                            .wait(state)
                            .unwrap_or_else(|poisoned| poisoned.into_inner()),
                    );
                    continue;
                }
                CoverRequestState::Ready {
                    result: Err(error),
                    remaining,
                } => {
                    let response = Err(error.to_string());
                    if *remaining == 1 {
                        *state = CoverRequestState::Consumed;
                    } else {
                        *remaining -= 1;
                    }
                    return response;
                }
                CoverRequestState::Ready {
                    result: Ok(_),
                    remaining,
                } => {
                    let remaining = *remaining;
                    let previous = std::mem::replace(&mut *state, CoverRequestState::Materializing);
                    let CoverRequestState::Ready {
                        result: Ok(bytes), ..
                    } = previous
                    else {
                        unreachable!("the ready cover result was inspected before materializing");
                    };
                    drop(state);
                    return Ok(CoverMaterialization {
                        request: self,
                        bytes: Some(bytes),
                        remaining,
                    }
                    .into_response(
                        copy.take()
                            .expect("the cover result is copied at most once"),
                    ));
                }
                CoverRequestState::Consumed => return Err(CONSUMED_COVER_LOAD.to_string()),
            }
        }
    }

    fn finish_materialization(&self, bytes: Option<Vec<u8>>, remaining: usize) {
        let mut state = recover_lock(&self.state);
        debug_assert!(matches!(*state, CoverRequestState::Materializing));
        *state = match bytes {
            Some(bytes) => CoverRequestState::Ready {
                result: Ok(bytes),
                remaining,
            },
            None => CoverRequestState::Consumed,
        };
        self.changed.notify_all();
    }

    #[cfg(test)]
    fn wait_for_participants(&self, expected: usize) {
        let mut state = recover_lock(&self.state);
        loop {
            match &*state {
                CoverRequestState::Loading { participants } if *participants >= expected => return,
                CoverRequestState::Loading { .. } => {
                    state = self
                        .changed
                        .wait(state)
                        .unwrap_or_else(|poisoned| poisoned.into_inner());
                }
                _ => panic!("cover request completed before every test caller joined"),
            }
        }
    }

    #[cfg(test)]
    fn is_consumed(&self) -> bool {
        matches!(*recover_lock(&self.state), CoverRequestState::Consumed)
    }
}

struct CoverMaterialization<'a> {
    request: &'a InFlightCoverRequest,
    bytes: Option<Vec<u8>>,
    remaining: usize,
}

impl CoverMaterialization<'_> {
    fn into_response<F>(mut self, copy: F) -> Vec<u8>
    where
        F: FnOnce(&Vec<u8>) -> Vec<u8>,
    {
        if self.remaining == 1 {
            self.request.finish_materialization(None, 0);
            return self
                .bytes
                .take()
                .expect("the final response owns the completed cover bytes");
        }

        let response = copy(
            self.bytes
                .as_ref()
                .expect("the completed cover bytes remain available while copying"),
        );
        let bytes = self
            .bytes
            .take()
            .expect("the shared cover bytes are restored after copying");
        self.request
            .finish_materialization(Some(bytes), self.remaining - 1);
        response
    }
}

impl Drop for CoverMaterialization<'_> {
    fn drop(&mut self) {
        let Some(bytes) = self.bytes.take() else {
            return;
        };
        let remaining = self.remaining - 1;
        self.request
            .finish_materialization((remaining > 0).then_some(bytes), remaining);
    }
}

#[derive(Default)]
struct CoverRequestCoordinator {
    requests: Mutex<HashMap<PathBuf, Arc<InFlightCoverRequest>>>,
}

enum CoverRequestClaim<'a> {
    Owner(CoverRequestOwner<'a>),
    Waiter(Arc<InFlightCoverRequest>),
}

struct CoverRequestOwner<'a> {
    coordinator: &'a CoverRequestCoordinator,
    key: PathBuf,
    request: Arc<InFlightCoverRequest>,
    published: bool,
}

impl CoverRequestCoordinator {
    fn load<F>(&self, key: PathBuf, loader: F) -> Result<Vec<u8>, String>
    where
        F: FnOnce() -> Result<Vec<u8>, String>,
    {
        match self.claim(key) {
            CoverRequestClaim::Owner(owner) => owner.complete(loader),
            CoverRequestClaim::Waiter(request) => request.receive(),
        }
    }

    fn claim(&self, key: PathBuf) -> CoverRequestClaim<'_> {
        let mut requests = recover_lock(&self.requests);
        if let Some(request) = requests.get(&key) {
            request.add_participant();
            return CoverRequestClaim::Waiter(Arc::clone(request));
        }

        let request = Arc::new(InFlightCoverRequest::new());
        requests.insert(key.clone(), Arc::clone(&request));
        CoverRequestClaim::Owner(CoverRequestOwner {
            coordinator: self,
            key,
            request,
            published: false,
        })
    }

    fn publish(
        &self,
        key: &PathBuf,
        request: &Arc<InFlightCoverRequest>,
        result: CoverLoadResult,
        owner_receives: bool,
    ) {
        let mut requests = recover_lock(&self.requests);
        if requests
            .get(key)
            .is_some_and(|current| Arc::ptr_eq(current, request))
        {
            requests.remove(key);
        }
        request.publish(result, owner_receives);
    }

    #[cfg(test)]
    fn request(&self, key: &PathBuf) -> Arc<InFlightCoverRequest> {
        Arc::clone(
            recover_lock(&self.requests)
                .get(key)
                .expect("the test owner should keep its request registered"),
        )
    }

    #[cfg(test)]
    fn is_empty(&self) -> bool {
        recover_lock(&self.requests).is_empty()
    }
}

impl CoverRequestOwner<'_> {
    fn complete<F>(mut self, loader: F) -> Result<Vec<u8>, String>
    where
        F: FnOnce() -> Result<Vec<u8>, String>,
    {
        let result = loader().map_err(Arc::<str>::from);
        self.coordinator
            .publish(&self.key, &self.request, result, true);
        self.published = true;
        self.request.receive()
    }
}

impl Drop for CoverRequestOwner<'_> {
    fn drop(&mut self) {
        if !self.published {
            self.coordinator.publish(
                &self.key,
                &self.request,
                Err(Arc::from(INTERRUPTED_COVER_LOAD)),
                false,
            );
        }
    }
}

fn recover_lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn coordinator() -> &'static CoverRequestCoordinator {
    static COORDINATOR: OnceLock<CoverRequestCoordinator> = OnceLock::new();
    COORDINATOR.get_or_init(CoverRequestCoordinator::default)
}

pub(super) fn load_once<F>(key: PathBuf, loader: F) -> Result<Vec<u8>, String>
where
    F: FnOnce() -> Result<Vec<u8>, String>,
{
    coordinator().load(key, loader)
}

pub(super) fn remove_cache_file_if_inactive(
    request_key: &Path,
    candidate: &Path,
) -> io::Result<bool> {
    let requests = recover_lock(&coordinator().requests);
    if requests.contains_key(request_key) {
        return Ok(false);
    }

    match std::fs::remove_file(candidate) {
        Ok(()) => Ok(true),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error),
    }
}

#[cfg(test)]
pub(super) fn wait_for_participants(key: &PathBuf, expected: usize) {
    coordinator().request(key).wait_for_participants(expected);
}

#[cfg(test)]
pub(super) fn contains_request(key: &PathBuf) -> bool {
    recover_lock(&coordinator().requests).contains_key(key)
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashSet,
        panic::{catch_unwind, AssertUnwindSafe},
        sync::{
            atomic::{AtomicUsize, Ordering},
            mpsc, Barrier,
        },
        thread,
    };

    use super::*;

    fn key(name: &str) -> PathBuf {
        PathBuf::from(name)
    }

    #[test]
    fn concurrent_same_key_loads_run_once_and_return_only_response_buffers() {
        const CALLERS: usize = 8;
        let coordinator = Arc::new(CoverRequestCoordinator::default());
        let request_key = key("shared.cover");
        let start = Arc::new(Barrier::new(CALLERS + 1));
        let release_loader = Arc::new(Barrier::new(2));
        let load_count = Arc::new(AtomicUsize::new(0));
        let original_pointer = Arc::new(AtomicUsize::new(0));
        let (loader_started, loader_is_started) = mpsc::channel();
        let mut handles = Vec::new();

        for _ in 0..CALLERS {
            let coordinator = Arc::clone(&coordinator);
            let request_key = request_key.clone();
            let start = Arc::clone(&start);
            let release_loader = Arc::clone(&release_loader);
            let load_count = Arc::clone(&load_count);
            let original_pointer = Arc::clone(&original_pointer);
            let loader_started = loader_started.clone();
            handles.push(thread::spawn(move || {
                start.wait();
                coordinator.load(request_key, || {
                    load_count.fetch_add(1, Ordering::SeqCst);
                    let bytes = vec![0x5a; 16 * 1024];
                    original_pointer.store(bytes.as_ptr() as usize, Ordering::SeqCst);
                    loader_started
                        .send(())
                        .expect("the test should observe the owner loader");
                    release_loader.wait();
                    Ok(bytes)
                })
            }));
        }

        start.wait();
        loader_is_started
            .recv()
            .expect("one caller should enter the loader");
        let request = coordinator.request(&request_key);
        request.wait_for_participants(CALLERS);
        release_loader.wait();

        let responses = handles
            .into_iter()
            .map(|handle| {
                handle
                    .join()
                    .expect("each caller should finish")
                    .expect("each caller should receive cover bytes")
            })
            .collect::<Vec<_>>();
        let response_pointers = responses
            .iter()
            .map(|bytes| bytes.as_ptr() as usize)
            .collect::<HashSet<_>>();

        assert_eq!(load_count.load(Ordering::SeqCst), 1);
        assert!(responses
            .iter()
            .all(|bytes| bytes == &vec![0x5a; 16 * 1024]));
        assert_eq!(response_pointers.len(), CALLERS);
        assert_eq!(
            responses
                .iter()
                .filter(|bytes| {
                    bytes.as_ptr() as usize == original_pointer.load(Ordering::SeqCst)
                })
                .count(),
            1
        );
        assert!(request.is_consumed());
        assert!(coordinator.is_empty());
    }

    #[test]
    fn payload_copy_happens_outside_the_state_lock_and_the_final_response_consumes_the_original() {
        let request = InFlightCoverRequest::new();
        request.add_participant();
        let bytes = vec![0x2c; 4096];
        let original_pointer = bytes.as_ptr();
        request.publish(Ok(bytes), true);

        let first = request
            .receive_with(|bytes| {
                assert!(request.state.try_lock().is_ok());
                bytes.clone()
            })
            .expect("the first response should copy successfully");
        let second = request
            .receive()
            .expect("the final response should consume the publication bytes");

        assert_ne!(first.as_ptr(), original_pointer);
        assert_eq!(second.as_ptr(), original_pointer);
        assert!(request.is_consumed());
    }

    #[test]
    fn concurrent_failure_wakes_every_caller_and_a_later_call_retries() {
        const CALLERS: usize = 6;
        let coordinator = Arc::new(CoverRequestCoordinator::default());
        let request_key = key("retry.cover");
        let start = Arc::new(Barrier::new(CALLERS + 1));
        let release_loader = Arc::new(Barrier::new(2));
        let load_count = Arc::new(AtomicUsize::new(0));
        let (loader_started, loader_is_started) = mpsc::channel();
        let mut handles = Vec::new();

        for _ in 0..CALLERS {
            let coordinator = Arc::clone(&coordinator);
            let request_key = request_key.clone();
            let start = Arc::clone(&start);
            let release_loader = Arc::clone(&release_loader);
            let load_count = Arc::clone(&load_count);
            let loader_started = loader_started.clone();
            handles.push(thread::spawn(move || {
                start.wait();
                coordinator.load(request_key, || {
                    load_count.fetch_add(1, Ordering::SeqCst);
                    loader_started
                        .send(())
                        .expect("the test should observe the owner loader");
                    release_loader.wait();
                    Err("cover decode failed".to_string())
                })
            }));
        }

        start.wait();
        loader_is_started
            .recv()
            .expect("one caller should enter the loader");
        let request = coordinator.request(&request_key);
        request.wait_for_participants(CALLERS);
        release_loader.wait();

        for handle in handles {
            assert_eq!(
                handle.join().expect("each caller should finish"),
                Err("cover decode failed".to_string())
            );
        }
        assert_eq!(load_count.load(Ordering::SeqCst), 1);
        assert!(request.is_consumed());
        assert!(coordinator.is_empty());
        assert_eq!(
            coordinator.load(request_key, || Ok(vec![5, 6, 7])),
            Ok(vec![5, 6, 7])
        );
        assert!(coordinator.is_empty());
    }

    #[test]
    fn owner_panic_wakes_waiters_removes_the_request_and_allows_retry() {
        const CALLERS: usize = 5;
        let coordinator = Arc::new(CoverRequestCoordinator::default());
        let request_key = key("interrupted.cover");
        let start = Arc::new(Barrier::new(CALLERS + 1));
        let release_loader = Arc::new(Barrier::new(2));
        let (loader_started, loader_is_started) = mpsc::channel();
        let mut handles = Vec::new();

        for _ in 0..CALLERS {
            let coordinator = Arc::clone(&coordinator);
            let request_key = request_key.clone();
            let start = Arc::clone(&start);
            let release_loader = Arc::clone(&release_loader);
            let loader_started = loader_started.clone();
            handles.push(thread::spawn(move || {
                start.wait();
                coordinator.load(request_key, || -> Result<Vec<u8>, String> {
                    loader_started
                        .send(())
                        .expect("the test should observe the owner loader");
                    release_loader.wait();
                    panic!("simulated worker panic");
                })
            }));
        }

        start.wait();
        loader_is_started
            .recv()
            .expect("one caller should enter the loader");
        let request = coordinator.request(&request_key);
        request.wait_for_participants(CALLERS);
        release_loader.wait();

        let mut panic_count = 0;
        let mut interrupted_count = 0;
        for handle in handles {
            match handle.join() {
                Err(_) => panic_count += 1,
                Ok(Err(error)) if error == INTERRUPTED_COVER_LOAD => interrupted_count += 1,
                result => panic!("unexpected interrupted load result: {result:?}"),
            }
        }
        assert_eq!(panic_count, 1);
        assert_eq!(interrupted_count, CALLERS - 1);
        assert!(request.is_consumed());
        assert!(coordinator.is_empty());
        assert_eq!(coordinator.load(request_key, || Ok(vec![8])), Ok(vec![8]));
    }

    #[test]
    fn dropping_an_owner_releases_waiters_and_removes_the_request() {
        let coordinator = CoverRequestCoordinator::default();
        let request_key = key("cancelled.cover");
        let owner = match coordinator.claim(request_key.clone()) {
            CoverRequestClaim::Owner(owner) => owner,
            CoverRequestClaim::Waiter(_) => panic!("the first caller should own the request"),
        };
        let waiting = match coordinator.claim(request_key.clone()) {
            CoverRequestClaim::Owner(_) => panic!("the second caller should wait"),
            CoverRequestClaim::Waiter(waiting) => waiting,
        };

        drop(owner);

        assert_eq!(waiting.receive(), Err(INTERRUPTED_COVER_LOAD.to_string()));
        assert!(waiting.is_consumed());
        assert!(coordinator.is_empty());
        assert_eq!(coordinator.load(request_key, || Ok(vec![3])), Ok(vec![3]));
    }

    #[test]
    fn poisoned_request_state_recovers_through_the_normal_load_path() {
        const CALLERS: usize = 3;
        let coordinator = Arc::new(CoverRequestCoordinator::default());
        let request_key = key("poisoned.cover");
        let start = Arc::new(Barrier::new(CALLERS + 1));
        let release_loader = Arc::new(Barrier::new(2));
        let (loader_started, loader_is_started) = mpsc::channel();
        let mut handles = Vec::new();

        for _ in 0..CALLERS {
            let coordinator = Arc::clone(&coordinator);
            let request_key = request_key.clone();
            let start = Arc::clone(&start);
            let release_loader = Arc::clone(&release_loader);
            let loader_started = loader_started.clone();
            handles.push(thread::spawn(move || {
                start.wait();
                coordinator.load(request_key, || {
                    loader_started
                        .send(())
                        .expect("the test should observe the owner loader");
                    release_loader.wait();
                    Ok(vec![4, 2])
                })
            }));
        }

        start.wait();
        loader_is_started
            .recv()
            .expect("one caller should enter the loader");
        let request = coordinator.request(&request_key);
        request.wait_for_participants(CALLERS);
        let poisoning_request = Arc::clone(&request);
        assert!(thread::spawn(move || {
            let _state = poisoning_request
                .state
                .lock()
                .expect("state should lock before poisoning");
            panic!("poison request state");
        })
        .join()
        .is_err());
        release_loader.wait();

        for handle in handles {
            assert_eq!(
                handle.join().expect("each caller should finish"),
                Ok(vec![4, 2])
            );
        }
        assert!(request.is_consumed());
        assert!(coordinator.is_empty());
    }

    #[test]
    fn poisoned_registry_permits_later_normal_loads() {
        let coordinator = Arc::new(CoverRequestCoordinator::default());
        let poisoning_coordinator = Arc::clone(&coordinator);

        assert!(thread::spawn(move || {
            let _requests = poisoning_coordinator
                .requests
                .lock()
                .expect("registry should lock before poisoning");
            panic!("poison request registry");
        })
        .join()
        .is_err());

        assert_eq!(
            coordinator.load(key("after-poison.cover"), || Ok(vec![1, 7])),
            Ok(vec![1, 7])
        );
        assert!(coordinator.is_empty());
    }

    #[test]
    fn different_cache_keys_load_independently() {
        let coordinator = Arc::new(CoverRequestCoordinator::default());
        let loaders_entered = Arc::new(Barrier::new(3));
        let active_loaders = Arc::new(AtomicUsize::new(0));
        let maximum_active_loaders = Arc::new(AtomicUsize::new(0));
        let mut handles = Vec::new();

        for (request_key, expected) in [(key("first.cover"), 1), (key("second.cover"), 2)] {
            let coordinator = Arc::clone(&coordinator);
            let loaders_entered = Arc::clone(&loaders_entered);
            let active_loaders = Arc::clone(&active_loaders);
            let maximum_active_loaders = Arc::clone(&maximum_active_loaders);
            handles.push(thread::spawn(move || {
                coordinator.load(request_key, || {
                    let active = active_loaders.fetch_add(1, Ordering::SeqCst) + 1;
                    maximum_active_loaders.fetch_max(active, Ordering::SeqCst);
                    loaders_entered.wait();
                    active_loaders.fetch_sub(1, Ordering::SeqCst);
                    Ok(vec![expected])
                })
            }));
        }

        loaders_entered.wait();
        let results = handles
            .into_iter()
            .map(|handle| handle.join().expect("independent load should finish"))
            .collect::<Vec<_>>();

        assert!(results.contains(&Ok(vec![1])));
        assert!(results.contains(&Ok(vec![2])));
        assert_eq!(maximum_active_loaders.load(Ordering::SeqCst), 2);
        assert!(coordinator.is_empty());
    }

    #[test]
    fn a_panicking_payload_copy_does_not_retain_completed_bytes() {
        let request = InFlightCoverRequest::new();
        request.add_participant();
        request.publish(Ok(vec![9; 1024]), true);

        let panic = catch_unwind(AssertUnwindSafe(|| {
            let _ = request.receive_with(|_| panic!("simulated response allocation failure"));
        }));

        assert!(panic.is_err());
        assert_eq!(
            request
                .receive()
                .expect("the remaining participant should finish"),
            vec![9; 1024]
        );
        assert!(request.is_consumed());
    }
}
