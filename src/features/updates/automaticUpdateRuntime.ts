import { isTauri } from "@tauri-apps/api/core";

import { appPreferencesStore } from "../../stores/appPreferencesStore";
import { appUpdateClient } from "./appUpdateClient";

export const AUTOMATIC_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

type RuntimeOptions = {
  preferences: Pick<typeof appPreferencesStore, "initialize" | "getSnapshot"> & {
    subscribe: (listener: () => void) => () => void;
  };
  updates: Pick<typeof appUpdateClient, "initialize" | "subscribe" | "getSnapshot" | "check">;
  allowPolling: () => boolean;
};

/** Mount only after usable main-window startup. No timer survives teardown or a process exit. */
export class AutomaticUpdateRuntime {
  private stopCurrent: (() => void) | null = null;

  constructor(
    private readonly options: RuntimeOptions = {
      preferences: appPreferencesStore,
      updates: appUpdateClient,
      allowPolling: () => isTauri() && import.meta.env.PROD,
    },
  ) {}

  start(): () => void {
    if (this.stopCurrent) return this.stopCurrent;
    if (!this.options.allowPolling()) return () => undefined;
    const { preferences, updates } = this.options;
    let stopped = false;
    let initialized = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    const check = () => {
      void updates.check("automatic").catch((error: unknown) => {
        console.error("Automatic update check failed", error);
      });
    };
    const synchronize = () => {
      const enabled =
        initialized &&
        preferences.getSnapshot().automaticallyCheckForUpdates &&
        updates.getSnapshot().update?.supported;
      if (enabled && timer === null) {
        timer = setInterval(check, AUTOMATIC_UPDATE_INTERVAL_MS);
        check();
      } else if (!enabled && timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const stopPreferences = preferences.subscribe(synchronize);
    const stopUpdates = updates.subscribe(synchronize);
    const stop = () => {
      if (stopped) return;
      stopped = true;
      stopPreferences();
      stopUpdates();
      if (timer !== null) clearInterval(timer);
      this.stopCurrent = null;
    };
    this.stopCurrent = stop;
    void Promise.all([preferences.initialize(), updates.initialize()])
      .then(() => {
        if (stopped) return;
        initialized = true;
        synchronize();
      })
      .catch((error: unknown) =>
        console.error("Automatic update runtime could not initialize", error),
      );
    return stop;
  }
}
