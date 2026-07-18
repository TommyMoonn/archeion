import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import type {
  ArchiveWatcherChange,
  ArchiveWatcherChangeKind,
  ArchiveWatcherChangeSet,
  LibraryStorage,
} from "../../storage/LibraryStorage";
import { shouldSuppressWritebackWatcherEvent } from "../../storage/writebackWatcherSuppression";

export const ARCHIVE_CHANGED_EVENT = "archive://changed";
export const ARCHIVE_WATCHER_ERROR_EVENT = "archive://watcher-error";

export type ArchiveChangedPayload = {
  kind?: ArchiveWatcherChangeKind | null;
  overflow?: boolean;
  relativePaths?: Array<string | null> | null;
};

export type ArchiveWatcherOptions = {
  archiveRootPath?: string | null;
  debounceMs?: number;
  onError?: (error: unknown) => void;
  onRecovered?: () => void;
  storage: Pick<LibraryStorage, "applyArchiveWatcherChanges">;
};

type Timer = ReturnType<typeof setTimeout>;

let nativeWatcherLifecycle: Promise<void> = Promise.resolve();

function runNativeWatcherLifecycle<T>(operation: () => Promise<T>): Promise<T> {
  const result = nativeWatcherLifecycle.catch(() => undefined).then(operation);
  nativeWatcherLifecycle = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

function clearTimer(timer: Timer | null): null {
  if (timer) {
    clearTimeout(timer);
  }
  return null;
}

function normalizeWatcherRelativePath(path: string | null | undefined): string | undefined {
  if (path === null || path === undefined) {
    return undefined;
  }

  const normalized = path.trim().replaceAll("\\", "/").replace(/\/+/g, "/");
  if (normalized === "") {
    return "";
  }
  if (normalized.startsWith("/") || /^[a-z]:\//i.test(normalized)) {
    return undefined;
  }

  const components = normalized.split("/");
  if (components.some((component) => !component || component === "." || component === "..")) {
    return undefined;
  }

  return components.join("/");
}

function normalizeChangeKind(
  kind: ArchiveWatcherChangeKind | null | undefined,
  relativePaths: readonly string[],
): ArchiveWatcherChangeKind {
  if (relativePaths.some((path) => path.toLocaleLowerCase().startsWith(".archeion/"))) {
    return "metadata";
  }
  return kind ?? "unknown";
}

export class ArchiveWatcherController {
  private readonly archiveRootPath?: string | null;
  private readonly debounceMs: number;
  private readonly onError?: (error: unknown) => void;
  private readonly onRecovered?: () => void;
  private readonly storage: Pick<LibraryStorage, "applyArchiveWatcherChanges">;
  private debounceTimer: Timer | null = null;
  private pendingChanges: ArchiveWatcherChange[] = [];
  private pendingOverflow = false;
  private updateActive = false;
  private stopped = false;
  private watcherId: string | null = null;
  private unlistenCallbacks: UnlistenFn[] = [];

  constructor({
    archiveRootPath,
    debounceMs = 350,
    onError,
    onRecovered,
    storage,
  }: ArchiveWatcherOptions) {
    this.archiveRootPath = archiveRootPath;
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
      await runNativeWatcherLifecycle(async () => {
        if (this.stopped) {
          return;
        }

        const [stopChangeListener, stopErrorListener] = await Promise.all([
          listen<ArchiveChangedPayload>(ARCHIVE_CHANGED_EVENT, (event) =>
            this.notifyChanged(event.payload),
          ),
          listen(ARCHIVE_WATCHER_ERROR_EVENT, (event) => {
            this.reportError(event.payload);
          }),
        ]);
        if (this.stopped) {
          stopChangeListener();
          stopErrorListener();
          return;
        }
        this.unlistenCallbacks = [stopChangeListener, stopErrorListener];

        const watcherId = await invoke<string>("start_archive_watcher");
        if (this.stopped) {
          this.unlisten();
          await this.stopStartedWatcherNow(watcherId);
          return;
        }

        this.watcherId = watcherId;
      });

      if (!this.stopped && this.watcherId) {
        this.onRecovered?.();
      }
    } catch (error) {
      this.reportError(error);
      this.unlisten();
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.debounceTimer = clearTimer(this.debounceTimer);
    this.pendingChanges = [];
    this.pendingOverflow = false;
    this.unlisten();

    const watcherId = this.watcherId;
    this.watcherId = null;

    if (watcherId) {
      await runNativeWatcherLifecycle(() => this.stopStartedWatcherNow(watcherId));
    }
  }

  notifyChanged(payload?: ArchiveChangedPayload | null): void {
    if (this.stopped) {
      return;
    }

    const rawPaths = payload?.relativePaths ?? [];
    let unresolvedPath = payload?.relativePaths === null || payload?.relativePaths === undefined;
    let resolvedPath = false;
    const relativePaths = rawPaths.flatMap((path) => {
      const relativePath = normalizeWatcherRelativePath(path);
      if (relativePath === undefined) {
        unresolvedPath = true;
        return [];
      }
      resolvedPath = true;
      if (shouldSuppressWritebackWatcherEvent(this.archiveRootPath, relativePath)) {
        return [];
      }
      return [relativePath];
    });

    if (unresolvedPath) {
      this.appendPendingChange({ kind: "unknown", relativePaths: [] });
    } else if (!relativePaths.length && !payload?.overflow) {
      if (resolvedPath) {
        return;
      }
      this.appendPendingChange({ kind: "unknown", relativePaths: [] });
    }

    if (relativePaths.length) {
      this.appendPendingChange({
        kind: normalizeChangeKind(payload?.kind, relativePaths),
        relativePaths,
      });
    }
    this.pendingOverflow ||= payload?.overflow === true;

    this.debounceTimer = clearTimer(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flushChangedEvents();
    }, this.debounceMs);
  }

  private appendPendingChange(change: ArchiveWatcherChange): void {
    const duplicate = this.pendingChanges.some(
      (pending) =>
        pending.kind === change.kind &&
        pending.relativePaths.length === change.relativePaths.length &&
        pending.relativePaths.every((path, index) => path === change.relativePaths[index]),
    );
    if (!duplicate) {
      this.pendingChanges.push(change);
    }
  }

  private flushChangedEvents(): void {
    if (this.stopped || this.updateActive) {
      return;
    }
    void this.runUpdateQueue();
  }

  private takePendingChangeSet(): ArchiveWatcherChangeSet | undefined {
    if (!this.pendingChanges.length && !this.pendingOverflow) {
      return undefined;
    }
    const changeSet = {
      changes: this.pendingChanges,
      overflow: this.pendingOverflow || undefined,
    } satisfies ArchiveWatcherChangeSet;
    this.pendingChanges = [];
    this.pendingOverflow = false;
    return changeSet;
  }

  private async runUpdateQueue(): Promise<void> {
    this.updateActive = true;

    try {
      let changeSet = this.takePendingChangeSet();
      while (!this.stopped && changeSet) {
        await this.storage.applyArchiveWatcherChanges(changeSet);
        changeSet = this.takePendingChangeSet();
      }
      if (!this.stopped) {
        this.onRecovered?.();
      }
    } catch (error) {
      this.reportError(error);
    } finally {
      this.updateActive = false;
      if (!this.stopped && (this.pendingChanges.length || this.pendingOverflow)) {
        this.flushChangedEvents();
      }
    }
  }

  private async stopStartedWatcherNow(watcherId: string): Promise<void> {
    if (!isTauri()) {
      return;
    }

    await invoke("stop_archive_watcher", { watcherId }).catch((error) => {
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
