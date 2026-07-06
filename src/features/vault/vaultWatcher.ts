import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type { LibraryStorage } from "../../storage/LibraryStorage";

export const VAULT_CHANGED_EVENT = "vault://changed";
export const VAULT_WATCHER_ERROR_EVENT = "vault://watcher-error";

export type VaultWatcherOptions = {
  debounceMs?: number;
  onError?: (error: unknown) => void;
  onRecovered?: () => void;
  storage: Pick<LibraryStorage, "rescan">;
};

type Timer = ReturnType<typeof setTimeout>;

function clearTimer(timer: Timer | null): null {
  if (timer) {
    clearTimeout(timer);
  }
  return null;
}

export class VaultWatcherController {
  private readonly debounceMs: number;
  private readonly onError?: (error: unknown) => void;
  private readonly onRecovered?: () => void;
  private readonly storage: Pick<LibraryStorage, "rescan">;
  private debounceTimer: Timer | null = null;
  private followUpScanQueued = false;
  private scanActive = false;
  private stopped = false;
  private watcherId: string | null = null;
  private unlistenCallbacks: UnlistenFn[] = [];

  constructor({
    debounceMs = 350,
    onError,
    onRecovered,
    storage,
  }: VaultWatcherOptions) {
    this.debounceMs = debounceMs;
    this.onError = onError;
    this.onRecovered = onRecovered;
    this.storage = storage;
  }

  async start(): Promise<void> {
    if (!isTauri()) {
      return;
    }

    this.stopped = false;

    try {
      const [stopChangeListener, stopErrorListener] = await Promise.all([
        listen(VAULT_CHANGED_EVENT, () => this.notifyChanged()),
        listen(VAULT_WATCHER_ERROR_EVENT, (event) => {
          this.reportError(event.payload);
        }),
      ]);
      this.unlistenCallbacks = [stopChangeListener, stopErrorListener];
      const watcherId = await invoke<string>("start_vault_watcher");

      if (this.stopped) {
        await this.stopStartedWatcher(watcherId);
        return;
      }

      this.watcherId = watcherId;
      this.onRecovered?.();
    } catch (error) {
      this.reportError(error);
      this.unlisten();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.debounceTimer = clearTimer(this.debounceTimer);
    this.followUpScanQueued = false;
    this.unlisten();

    const watcherId = this.watcherId;
    this.watcherId = null;

    if (watcherId) {
      await this.stopStartedWatcher(watcherId);
    }
  }

  notifyChanged(): void {
    if (this.stopped) {
      return;
    }

    this.debounceTimer = clearTimer(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flushChangedEvents();
    }, this.debounceMs);
  }

  private flushChangedEvents(): void {
    if (this.stopped) {
      return;
    }

    if (this.scanActive) {
      this.followUpScanQueued = true;
      return;
    }

    void this.runScanQueue();
  }

  private async runScanQueue(): Promise<void> {
    this.scanActive = true;

    try {
      do {
        this.followUpScanQueued = false;
        await this.storage.rescan({ followUpIfRunning: true });
      } while (!this.stopped && this.followUpScanQueued);
      this.onRecovered?.();
    } catch (error) {
      this.reportError(error);
    } finally {
      this.scanActive = false;
    }
  }


  private async stopStartedWatcher(watcherId: string): Promise<void> {
    if (!isTauri()) {
      return;
    }

    await invoke("stop_vault_watcher", { watcherId }).catch((error) => {
      this.reportError(error);
    });
  }

  private reportError(error: unknown): void {
    this.onError?.(error);
  }

  private unlisten(): void {
    for (const unlisten of this.unlistenCallbacks) {
      unlisten();
    }
    this.unlistenCallbacks = [];
  }
}
