import { useEffect } from "react";
import type { ReactNode } from "react";

import { useLibraryStorage } from "../../storage/useLibraryStorage";
import { archiveStore } from "../../stores/archiveStore";
import { useAppPreferences } from "../../stores/appPreferencesStore";
import { ArchiveWatcherController } from "./archiveWatcher";
import { ArchiveLauncherPage } from "./ArchiveLauncherPage";
import { useArchive } from "./useArchive";

type ArchiveGateProps = {
  children: ReactNode;
};

export function ArchiveGate({ children }: ArchiveGateProps) {
  const state = useArchive();
  const storage = useLibraryStorage();
  const preferences = useAppPreferences();
  const archivePath = state.status === "ready" ? state.path : null;
  const { liveWatcherEnabled, scanOnStartup } = preferences.filesAndMetadata;

  useEffect(() => {
    void archiveStore.initialize();
  }, []);

  useEffect(() => {
    storage.reset(archivePath);
  }, [archivePath, storage]);

  useEffect(() => {
    if (!archivePath) {
      return;
    }

    let watcher: ArchiveWatcherController | null = null;
    let cancelled = false;

    if (scanOnStartup) {
      void storage.rescan().catch(() => undefined);
    }

    if (liveWatcherEnabled) {
      watcher = new ArchiveWatcherController({
        storage,
        onError: () => {
          archiveStore.setWatcherError(
            "Live refresh paused. Use Rescan archive if files change.",
          );
        },
        onRecovered: () => archiveStore.setWatcherError(null),
      });
      void watcher.start().catch(() => {
        if (!cancelled) {
          archiveStore.setWatcherError(
            "Live refresh paused. Use Rescan archive if files change.",
          );
        }
      });
    }

    return () => {
      cancelled = true;
      void watcher?.stop();
    };
  }, [archivePath, liveWatcherEnabled, scanOnStartup, storage]);

  if (state.status === "loading") {
    return (
      <main className="archive-setup" aria-busy="true">
        <p className="archive-loading">Opening archive</p>
      </main>
    );
  }

  if (state.status !== "ready") {
    return <ArchiveLauncherPage state={state} />;
  }

  return children;
}
