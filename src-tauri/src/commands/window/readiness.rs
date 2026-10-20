use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use tokio::sync::watch;

type Completion = Option<Result<(), String>>;

struct Instance {
    generation: u64,
    completion: watch::Sender<Completion>,
}

#[derive(Default)]
pub(super) struct Readiness {
    next_generation: u64,
    instances: HashMap<String, Instance>,
    focus_target: Option<String>,
}

#[derive(Default)]
pub struct ManagedWindowState {
    // Creation stays off the Windows UI thread, but open/reveal operations have
    // one order. The short state lock is also used by native close callbacks.
    pub(super) operations: tokio::sync::Mutex<()>,
    pub(super) readiness: Arc<Mutex<Readiness>>,
}

impl ManagedWindowState {
    pub(super) async fn expire(
        &self,
        label: &'static str,
        generation: u64,
        schedule: impl FnOnce(Box<dyn FnOnce() + Send>) -> Result<(), String>,
        dispose: impl FnOnce() + Send + 'static,
    ) {
        let _operation = self.operations.lock().await;
        let readiness = self.readiness.clone();
        let (complete, completed) = tokio::sync::oneshot::channel();
        let scheduled = schedule(Box::new(move || {
            let retired = {
                let mut state = readiness.lock().unwrap();
                state.is_pending(label, generation)
                    && state.retire(
                        label,
                        generation,
                        "The window could not open in time. Open it again to retry.",
                    )
            };
            if retired {
                dispose();
            }
            let _ = complete.send(());
        }));
        if scheduled.is_ok() {
            // Disposal and a new open share one transaction through UI completion,
            // not merely through enqueueing the native action.
            let _ = completed.await;
        } else {
            self.readiness.lock().unwrap().retire(
                label,
                generation,
                "The window could not open. Open it again to retry.",
            );
        }
    }
}

impl Readiness {
    pub(super) fn request_focus(&mut self, label: &str) {
        self.focus_target = Some(label.to_string());
    }

    pub(super) fn user_focused_window(&mut self) {
        self.focus_target = None;
    }

    pub(super) fn reserve(&mut self, label: &str) -> (u64, watch::Receiver<Completion>) {
        self.next_generation += 1;
        let generation = self.next_generation;
        let (completion, receiver) = watch::channel(None);
        self.instances.insert(
            label.to_string(),
            Instance {
                generation,
                completion,
            },
        );
        (generation, receiver)
    }

    pub(super) fn current(&self, label: &str) -> Option<(u64, watch::Receiver<Completion>)> {
        self.instances
            .get(label)
            .map(|instance| (instance.generation, instance.completion.subscribe()))
    }

    pub(super) fn is_pending(&self, label: &str, generation: u64) -> bool {
        self.instances.get(label).is_some_and(|instance| {
            instance.generation == generation && instance.completion.borrow().is_none()
        })
    }

    pub(super) fn owns_focus(&self, label: &str) -> bool {
        self.focus_target.as_deref() == Some(label)
    }

    pub(super) fn complete(&mut self, label: &str, generation: u64) {
        if let Some(instance) = self
            .instances
            .get(label)
            .filter(|i| i.generation == generation)
        {
            instance.completion.send_replace(Some(Ok(())));
        }
    }

    pub(super) fn retire(&mut self, label: &str, generation: u64, message: &str) -> bool {
        if !self
            .instances
            .get(label)
            .is_some_and(|i| i.generation == generation)
        {
            return false;
        }
        let instance = self
            .instances
            .remove(label)
            .expect("current instance exists");
        if instance.completion.borrow().is_none() {
            instance
                .completion
                .send_replace(Some(Err(message.to_string())));
        }
        true
    }
}

pub(super) async fn wait_for_shell(
    mut receiver: watch::Receiver<Completion>,
) -> Result<(), String> {
    loop {
        if let Some(result) = receiver.borrow_and_update().clone() {
            return result;
        }
        receiver
            .changed()
            .await
            .map_err(|_| "The window was closed before it was ready.".to_string())?;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn queued_timeout_disposes_only_its_instance_before_a_new_open_can_reserve() {
        let owner = Arc::new(ManagedWindowState::default());
        let (old, waiter) = owner.readiness.lock().unwrap().reserve("settings");
        let (queued, queue) = tokio::sync::oneshot::channel();
        let disposed = Arc::new(Mutex::new(Vec::new()));
        let expire_owner = owner.clone();
        let disposals = disposed.clone();
        let expiry = tokio::spawn(async move {
            expire_owner
                .expire(
                    "settings",
                    old,
                    |action| {
                        assert!(queued.send(action).is_ok());
                        Ok(())
                    },
                    move || {
                        disposals.lock().unwrap().push(old);
                    },
                )
                .await;
        });
        let ui_action = queue.await.unwrap();
        assert!(
            owner.operations.try_lock().is_err(),
            "a queued timeout must still own serialization"
        );
        let open_owner = owner.clone();
        let open = tokio::spawn(async move {
            let _operation = open_owner.operations.lock().await;
            let generation = open_owner.readiness.lock().unwrap().reserve("settings").0;
            generation
        });
        assert!(!open.is_finished());
        ui_action();
        expiry.await.unwrap();
        let new = open.await.unwrap();
        assert!(wait_for_shell(waiter).await.is_err());
        assert_eq!(*disposed.lock().unwrap(), vec![old]);
        assert!(owner.readiness.lock().unwrap().is_pending("settings", new));
        owner
            .expire(
                "settings",
                old,
                |action| {
                    action();
                    Ok(())
                },
                || panic!("stale timeout disposed a replacement"),
            )
            .await;
        assert!(owner.readiness.lock().unwrap().is_pending("settings", new));
    }

    #[tokio::test]
    async fn failed_native_scheduling_releases_waiters_for_retry() {
        let owner = ManagedWindowState::default();
        let (generation, waiter) = owner.readiness.lock().unwrap().reserve("about");
        owner
            .expire(
                "about",
                generation,
                |_| Err("UI queue unavailable".to_string()),
                || panic!("a rejected dispatch must not dispose another window"),
            )
            .await;
        assert!(wait_for_shell(waiter).await.is_err());
        assert!(owner.readiness.lock().unwrap().current("about").is_none());
    }

    #[tokio::test]
    async fn duplicate_open_waiters_share_one_shell_completion() {
        let mut state = Readiness::default();
        let (generation, first) = state.reserve("settings");
        let (same, second) = state.current("settings").unwrap();
        assert_eq!(generation, same);
        assert!(state.is_pending("settings", generation));
        state.complete("settings", generation);
        assert!(!state.is_pending("settings", generation));
        assert!(wait_for_shell(first).await.is_ok());
        assert!(wait_for_shell(second).await.is_ok());
    }

    #[tokio::test]
    async fn close_and_timeout_fail_waiters_and_old_signals_cannot_reveal_replacements() {
        for message in ["closed", "timed out", "unhealthy"] {
            let mut state = Readiness::default();
            let (old, waiter) = state.reserve("about");
            assert!(state.retire("about", old, message));
            assert_eq!(wait_for_shell(waiter).await, Err(message.to_string()));
            let (new, _) = state.reserve("about");
            state.complete("about", old);
            assert!(!state.retire("about", old, "late close"));
            assert!(state.is_pending("about", new));
        }
    }

    #[test]
    fn later_request_and_user_focus_supersede_delayed_reveal_focus() {
        let mut state = Readiness::default();
        state.request_focus("settings");
        state.reserve("settings");
        state.request_focus("about");
        state.reserve("about");
        assert!(!state.owns_focus("settings"));
        assert!(state.owns_focus("about"));
        state.user_focused_window();
        assert!(!state.owns_focus("about"));
    }

    #[tokio::test]
    async fn timeout_after_success_does_not_change_completion() {
        let mut state = Readiness::default();
        let (generation, waiter) = state.reserve("theme-manager");
        state.complete("theme-manager", generation);
        assert!(!state.is_pending("theme-manager", generation));
        assert!(wait_for_shell(waiter).await.is_ok());
    }
}
