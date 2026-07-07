import { useEffect } from "react";
import type { ReactNode } from "react";

import { useLibraryStorage } from "../../storage/useLibraryStorage";
import { archiveStore } from "../../stores/archiveStore";
import { useArchive } from "./useArchive";
import { ArchiveWatcherController } from "./archiveWatcher";
import { ArchiveLauncherPage } from "./ArchiveLauncherPage";

type ArchiveGateProps = {
  children: ReactNode;
};

export function ArchiveGate({ children }: ArchiveGateProps) {
  const state = useArchive();
  const storage = useLibraryStorage();
  const archivePath = state.status === "ready" ? state.path : null;

  useEffect(() => {
    void archiveStore.initialize();
  }, []);

  useEffect(() => {
    if (!archivePath) {
      return;
    }

    storage.reset(archivePath);
    void storage.rescan().catch(() => undefined);

    const watcher = new ArchiveWatcherController({
      storage,
      onError: () => {
        archiveStore.setWatcherError(
          "Live refresh paused. Use Rescan archive if files change.",
        );
      },
      onRecovered: () => archiveStore.setWatcherError(null),
    });
    void watcher.start().catch(() => undefined);

    return () => {
      void watcher.stop();
    };
  }, [archivePath, storage]);

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
