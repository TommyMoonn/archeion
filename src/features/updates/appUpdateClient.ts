import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { APPLICATION_VERSION_FALLBACK } from "../../app/appVersion";
import {
  APP_UPDATE_CHANGED_EVENT,
  type AppUpdateClientSnapshot,
  type AppUpdateSnapshot,
  type CheckIntent,
} from "./appUpdateTypes";

export type AppUpdateBackend = Readonly<{
  isDesktop: () => boolean;
  read: () => Promise<AppUpdateSnapshot>;
  check: (intent: CheckIntent) => Promise<AppUpdateSnapshot>;
  download: () => Promise<AppUpdateSnapshot>;
  install: () => Promise<AppUpdateSnapshot>;
  subscribe: (listener: (snapshot: AppUpdateSnapshot) => void) => Promise<() => void>;
}>;

const nativeBackend: AppUpdateBackend = {
  isDesktop: isTauri,
  read: () => invoke<AppUpdateSnapshot>("get_app_update_snapshot"),
  check: (intent) => invoke<AppUpdateSnapshot>("check_app_update", { intent }),
  download: () => invoke<AppUpdateSnapshot>("download_app_update"),
  install: () => invoke<AppUpdateSnapshot>("install_app_update"),
  subscribe: (listener) =>
    listen<AppUpdateSnapshot>(APP_UPDATE_CHANGED_EVENT, (event) => listener(event.payload)),
};

/** A per-window observation cache, never an updater resource or network owner. */
export class AppUpdateClient {
  private snapshot: AppUpdateClientSnapshot = Object.freeze({
    status: "loading",
    update: null,
    error: null,
  });
  private readonly listeners = new Set<() => void>();
  private initialization: Promise<void> | null = null;
  private unlisten: (() => void) | null = null;
  private generation = 0;

  constructor(private readonly backend: AppUpdateBackend = nativeBackend) {}

  getSnapshot = (): AppUpdateClientSnapshot => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  initialize(): Promise<void> {
    if (this.initialization) return this.initialization;
    const generation = this.generation;
    const initialization = this.initializeNow(generation);
    this.initialization = initialization;
    void initialization.catch(() => {
      if (this.initialization === initialization) this.initialization = null;
    });
    return initialization;
  }

  dispose(): void {
    this.generation += 1;
    this.unlisten?.();
    this.unlisten = null;
    this.initialization = null;
    this.publish({ status: "loading", update: null, error: null });
  }

  check = (intent: CheckIntent): Promise<AppUpdateSnapshot> =>
    this.action(() => this.backend.check(intent));

  download = (): Promise<AppUpdateSnapshot> => this.action(() => this.backend.download());

  install = (): Promise<AppUpdateSnapshot> => this.action(() => this.backend.install());

  private async initializeNow(generation: number): Promise<void> {
    if (!this.backend.isDesktop()) {
      this.apply({
        revision: 0,
        supported: false,
        currentVersion: APPLICATION_VERSION_FALLBACK,
        status: "idle",
        available: null,
        downloadedBytes: 0,
        totalBytes: null,
        error: null,
      });
      return;
    }
    this.publish({ ...this.snapshot, status: "loading", error: null });
    let unlisten: (() => void) | null = null;
    try {
      // Subscribe first. Revisions prevent the subsequent read from rolling back an event.
      unlisten = await this.backend.subscribe((snapshot) => {
        if (this.generation === generation) this.apply(snapshot);
      });
      if (this.generation !== generation) {
        unlisten();
        return;
      }
      this.unlisten = unlisten;
      const snapshot = await this.backend.read();
      if (this.generation === generation) this.apply(snapshot);
    } catch (error) {
      if (this.generation === generation) {
        unlisten?.();
        this.unlisten = null;
        this.publish({
          status: "error",
          update: null,
          error: "Update status could not be loaded. Try again.",
        });
      }
      throw error;
    }
  }

  private async action(run: () => Promise<AppUpdateSnapshot>): Promise<AppUpdateSnapshot> {
    const generation = this.generation;
    await this.initialize();
    if (this.generation !== generation) throw new Error("The update client stopped.");
    if (!this.snapshot.update?.supported) throw new Error("Updates are unavailable in this build.");
    const snapshot = await run();
    if (this.generation !== generation) throw new Error("The update client stopped.");
    this.apply(snapshot);
    return snapshot;
  }

  private apply(update: AppUpdateSnapshot): void {
    if (this.snapshot.update && update.revision <= this.snapshot.update.revision) return;
    this.publish({ status: update.supported ? "ready" : "unavailable", update, error: null });
  }

  private publish(snapshot: AppUpdateClientSnapshot): void {
    this.snapshot = Object.freeze(snapshot);
    this.listeners.forEach((listener) => listener());
  }
}

export const appUpdateClient = new AppUpdateClient();
