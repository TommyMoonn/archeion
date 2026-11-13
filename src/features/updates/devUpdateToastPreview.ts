import { appUpdateClient, AppUpdateClient, type AppUpdateBackend } from "./appUpdateClient";
import type { AppUpdateSnapshot } from "./appUpdateTypes";

const PREVIEW_PARAMETER = "dev-update-toast";
const PREVIEW_STORAGE_KEY = "archeion:dev-update-toast";
const PREVIEW_VERSION = "1.8.0";
const PREVIEW_CURRENT_VERSION = "1.7.0";
const PREVIEW_TOTAL_BYTES = 100_000_000;
const PREVIEW_DOWNLOAD_STEP_DELAY_MS = 220;
const PREVIEW_RESTART_DELAY_MS = 1200;
const PREVIEW_DOWNLOAD_PROGRESS = [12, 27, 43, 61, 78, 92, 100] as const;

export type UpdateToastPreviewMode =
  "available" | "downloading" | "ready" | "installing" | "error" | "completed" | "flow";

const previewClients = new Map<UpdateToastPreviewMode, AppUpdateClient>();

/**
 * Enables a local-only updater preview in Vite/Tauri development builds.
 * Use ?dev-update-toast=flow to start at available and simulate download/restart,
 * or select an individual state with the same query parameter or localStorage key.
 */
export function getUpdateToastClient(): AppUpdateClient {
  if (!import.meta.env.DEV || typeof window === "undefined") return appUpdateClient;

  const queryMode = new URLSearchParams(window.location.search).get(PREVIEW_PARAMETER);
  const storedMode = window.localStorage.getItem(PREVIEW_STORAGE_KEY);
  const mode = isPreviewMode(queryMode) ? queryMode : isPreviewMode(storedMode) ? storedMode : null;

  if (!mode) return appUpdateClient;

  let client = previewClients.get(mode);
  if (!client) {
    client = createPreviewClient(mode);
    previewClients.set(mode, client);
  }

  return client;
}

function createPreviewClient(mode: UpdateToastPreviewMode): AppUpdateClient {
  const simulateLifecycle = mode === "flow" || mode === "available" || mode === "ready";
  let snapshot = createPreviewSnapshot(mode);
  const listeners = new Set<(update: AppUpdateSnapshot) => void>();
  const publish = (changes: Partial<AppUpdateSnapshot>): AppUpdateSnapshot => {
    snapshot = Object.freeze({ ...snapshot, ...changes, revision: snapshot.revision + 1 });
    listeners.forEach((listener) => listener(snapshot));
    return snapshot;
  };

  const available = Object.freeze({
    version: PREVIEW_VERSION,
    notes: "Development preview only.",
    publishedAt: null,
  });
  const backend: AppUpdateBackend = {
    isDesktop: () => true,
    read: async () => snapshot,
    check: async () =>
      publish({
        status: "available",
        available,
        downloadedBytes: 0,
        totalBytes: null,
        error: null,
      }),
    download: async () => {
      publish({
        status: "downloading",
        available,
        downloadedBytes: 0,
        totalBytes: PREVIEW_TOTAL_BYTES,
        error: null,
      });

      if (!simulateLifecycle) {
        return publish({ downloadedBytes: 63_000_000 });
      }

      for (const percent of PREVIEW_DOWNLOAD_PROGRESS) {
        await wait(PREVIEW_DOWNLOAD_STEP_DELAY_MS);
        publish({ downloadedBytes: Math.round((PREVIEW_TOTAL_BYTES * percent) / 100) });
      }

      return publish({
        status: "ready",
        downloadedBytes: PREVIEW_TOTAL_BYTES,
        totalBytes: PREVIEW_TOTAL_BYTES,
      });
    },
    install: async () => {
      const installing = publish({ status: "installing", error: null });
      if (!simulateLifecycle) return installing;

      await wait(PREVIEW_RESTART_DELAY_MS);
      return publish({
        status: "idle",
        currentVersion: PREVIEW_VERSION,
        available: null,
        downloadedBytes: PREVIEW_TOTAL_BYTES,
        totalBytes: PREVIEW_TOTAL_BYTES,
        error: null,
        prompt: { ...snapshot.prompt, completedVersion: PREVIEW_VERSION },
      });
    },
    defer: async (version) =>
      publish({
        prompt: {
          ...snapshot.prompt,
          snoozedVersion: version,
          snoozedUntil: Date.now() + 86_400_000,
          restartDeferred: snapshot.status === "ready" || snapshot.prompt.restartDeferred,
        },
      }),
    acknowledgeCompleted: async () =>
      publish({
        prompt: { ...snapshot.prompt, completedVersion: null },
      }),
    subscribe: async (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return new AppUpdateClient(backend);
}

function createPreviewSnapshot(mode: UpdateToastPreviewMode): AppUpdateSnapshot {
  const completed = mode === "completed";
  const failed = mode === "error";
  const available = mode !== "completed" && !failed;
  const statuses: Record<UpdateToastPreviewMode, AppUpdateSnapshot["status"]> = {
    available: "available",
    downloading: "downloading",
    ready: "ready",
    installing: "installing",
    error: "idle",
    completed: "idle",
    flow: "available",
  };
  const status = statuses[mode];

  return Object.freeze({
    revision: 1,
    supported: true,
    currentVersion: completed ? PREVIEW_VERSION : PREVIEW_CURRENT_VERSION,
    status,
    available: available
      ? Object.freeze({
          version: PREVIEW_VERSION,
          notes: "Development preview only.",
          publishedAt: null,
        })
      : null,
    downloadedBytes: mode === "downloading" ? 63_000_000 : 0,
    totalBytes: mode === "downloading" ? PREVIEW_TOTAL_BYTES : null,
    error: failed
      ? Object.freeze({
          operation: "install",
          message: "The update could not be installed. Check for updates to try again.",
        })
      : null,
    prompt: Object.freeze({
      snoozedVersion: null,
      snoozedUntil: null,
      restartDeferred: false,
      completedVersion: completed ? PREVIEW_VERSION : null,
    }),
  });
}

function isPreviewMode(value: string | null): value is UpdateToastPreviewMode {
  return (
    value === "available" ||
    value === "downloading" ||
    value === "ready" ||
    value === "installing" ||
    value === "error" ||
    value === "completed" ||
    value === "flow"
  );
}

function wait(duration: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}
