import {
  AppUpdateClient,
  type AppUpdateBackend,
} from "../../../src/features/updates/appUpdateClient";
import type { AppUpdateSnapshot } from "../../../src/features/updates/appUpdateTypes";

type FixtureAction = "check" | "download" | "install" | "defer";
type UpdateFixture = ReturnType<typeof createUpdateToastFixture>;
declare global {
  interface Window {
    updateToastFixture?: UpdateFixture;
  }
}

/** Explicit injected provider, never the production updater or IPC backend. */
export function createUpdateToastFixture() {
  let state: AppUpdateSnapshot = {
    revision: 1,
    supported: true,
    currentVersion: "1.6.0",
    status: "idle",
    available: null,
    downloadedBytes: 0,
    totalBytes: null,
    error: null,
    prompt: {
      snoozedVersion: null,
      snoozedUntil: null,
      restartDeferred: false,
      completedVersion: null,
    },
  };
  const listeners = new Set<(update: AppUpdateSnapshot) => void>();
  const calls = { check: 0, download: 0, install: 0, defer: 0 };
  let failure: FixtureAction | null = null;
  const set = (patch: Partial<AppUpdateSnapshot>) => {
    state = { ...state, ...patch, revision: state.revision + 1 };
    listeners.forEach((listener) => listener(state));
    return state;
  };
  const perform = (action: FixtureAction, patch: Partial<AppUpdateSnapshot>) => {
    calls[action] += 1;
    if (failure === action) {
      failure = null;
      if (action === "download" || action === "install") {
        set({
          status: action === "download" ? "available" : "idle",
          available: action === "install" ? null : state.available,
          error: {
            operation: action,
            message: `The update could not be ${action === "download" ? "downloaded" : "installed"}. Try again.`,
          },
        });
      } else if (action === "check") {
        set({
          error: { operation: "check", message: "Updates could not be checked. Try again." },
        });
      }
      return Promise.reject(new Error("Injected updater failure"));
    }
    return Promise.resolve(set(patch));
  };
  const backend: AppUpdateBackend = {
    isDesktop: () => true,
    read: async () => state,
    subscribe: async (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    check: () =>
      perform("check", {
        status: "available",
        available: { version: "1.6.1", notes: null, publishedAt: null },
        error: null,
      }),
    download: () =>
      perform("download", {
        status: "downloading",
        downloadedBytes: 0,
        totalBytes: null,
        error: null,
        prompt: { ...state.prompt, snoozedVersion: null, snoozedUntil: null },
      }),
    install: () => perform("install", { status: "installing", error: null }),
    defer: () =>
      perform("defer", {
        prompt:
          state.status === "ready"
            ? { ...state.prompt, restartDeferred: true }
            : {
                ...state.prompt,
                snoozedVersion: state.available!.version,
                snoozedUntil: Date.now() + 86_400_000,
              },
      }),
    acknowledgeCompleted: async () => state,
  };
  return {
    client: new AppUpdateClient(backend),
    calls,
    set,
    failNext: (action: FixtureAction) => {
      failure = action;
    },
  };
}
