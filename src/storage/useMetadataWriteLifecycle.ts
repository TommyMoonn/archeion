import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect } from "react";

import { archiveStore } from "../stores/archiveStore";
import { appPreferencesStore } from "../stores/appPreferencesStore";
import type { LibraryStorage } from "./LibraryStorage";

export async function flushMetadataWrites(
  storage: Pick<LibraryStorage, "flushPendingWrites">,
  preferences: Pick<typeof appPreferencesStore, "flushPendingWrites"> = appPreferencesStore,
): Promise<void> {
  await Promise.all([storage.flushPendingWrites(), preferences.flushPendingWrites()]);
}

export function useMetadataWriteLifecycle(storage: LibraryStorage): void {
  useEffect(
    () =>
      archiveStore.registerTransitionGuard(async () => {
        try {
          await flushMetadataWrites(storage);
          return true;
        } catch (error) {
          console.error("Pending metadata could not be flushed before changing archives", error);
          return false;
        }
      }),
    [storage],
  );

  useEffect(() => {
    if (!isTauri()) return;

    const appWindow = getCurrentWindow();
    let closing = false;
    let disposed = false;
    let unlisten: () => void = () => undefined;

    void appWindow
      .onCloseRequested(async (event) => {
        event.preventDefault();
        if (closing || disposed) return;

        closing = true;
        try {
          await flushMetadataWrites(storage);
          if (!disposed) {
            await appWindow.destroy();
          }
        } catch (error) {
          closing = false;
          console.error("Pending metadata could not be flushed before close", error);
        }
      })
      .then((stopListening) => {
        if (disposed) {
          stopListening();
          return;
        }
        unlisten = stopListening;
      });

    return () => {
      disposed = true;
      unlisten();
    };
  }, [storage]);
}
