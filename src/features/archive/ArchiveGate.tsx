import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";

import { useLibraryStorage } from "../../storage/useLibraryStorage";
import { createArchiveAppearanceSettingsSource } from "../../storage/archiveAppearanceSettingsSource";
import { archiveStore } from "../../stores/archiveStore";
import { useFilesAndMetadataPreferences } from "../../stores/appPreferencesStore";
import { ArchiveWatcherController } from "./archiveWatcher";
import { useArchive } from "./useArchive";
import { CoverUrlCacheScopeContext } from "../library/coverUrlCacheScope";
import { router } from "../../app/router";
import { appearanceRuntime } from "../../themes/appearanceRuntimeInstance";
import { startupTrace } from "../../app/startupTrace";

type ArchiveGateProps = {
  children: ReactNode;
  preparedArchiveAtMount?: { id: string; rootPath: string };
};

export function ArchiveGate({ children, preparedArchiveAtMount }: ArchiveGateProps) {
  const state = useArchive();
  const storage = useLibraryStorage();
  const appearanceSettingsSource = useMemo(
    () => createArchiveAppearanceSettingsSource(storage),
    [storage],
  );
  const { liveWatcherEnabled, scanOnStartup } = useFilesAndMetadataPreferences();
  const archivePath = state.status === "ready" ? state.path : null;
  const readyArchiveId = state.status === "ready" ? state.archive.id : null;
  const [renderedArchiveId, setRenderedArchiveId] = useState(readyArchiveId);
  const storageArchiveRef = useRef(preparedArchiveAtMount ?? null);
  const replacingReadyArchive = Boolean(
    readyArchiveId && renderedArchiveId && readyArchiveId !== renderedArchiveId,
  );

  useEffect(() => {
    if (!readyArchiveId) return;
    if (!renderedArchiveId) {
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) setRenderedArchiveId(readyArchiveId);
      });
      return () => {
        cancelled = true;
      };
    }
    if (readyArchiveId === renderedArchiveId) return;

    let cancelled = false;
    const leaveReader = router.state.location.pathname.startsWith("/reader/");
    const navigation = leaveReader
      ? router.navigate(
          {
            pathname: "/",
            search: new URLSearchParams({
              archiveId: readyArchiveId,
              view: "library",
            }).toString(),
          },
          { replace: true },
        )
      : Promise.resolve();
    void navigation.then(
      () => {
        if (!cancelled) setRenderedArchiveId(readyArchiveId);
      },
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [readyArchiveId, renderedArchiveId]);

  useEffect(() => {
    const alreadyPrepared = Boolean(
      archivePath &&
      readyArchiveId &&
      storageArchiveRef.current?.id === readyArchiveId &&
      storageArchiveRef.current.rootPath === archivePath,
    );
    if (!alreadyPrepared) {
      storage.reset(archivePath);
      storageArchiveRef.current =
        archivePath && readyArchiveId ? { id: readyArchiveId, rootPath: archivePath } : null;
      startupTrace.mark("storage");
    }
    if (!archivePath || !readyArchiveId) {
      appearanceRuntime.deactivateArchive();
      return;
    }

    const archive = { id: readyArchiveId, rootPath: archivePath };
    void appearanceRuntime.activateArchive(archive, appearanceSettingsSource);
    return () => appearanceRuntime.deactivateArchive(archive);
  }, [appearanceSettingsSource, archivePath, readyArchiveId, storage]);

  useEffect(() => {
    if (!archivePath) {
      return;
    }

    let watcher: ArchiveWatcherController | null = null;
    let cancelled = false;

    if (scanOnStartup) {
      startupTrace.mark("scan");
      void storage.rescan().catch(() => undefined);
    }

    if (liveWatcherEnabled) {
      watcher = new ArchiveWatcherController({
        archiveRootPath: archivePath,
        storage,
        onError: () => {
          archiveStore.setWatcherError("Live refresh paused. Use Rescan archive if files change.");
        },
        onRecovered: () => archiveStore.setWatcherError(null),
      });
      void watcher.start().catch(() => {
        if (!cancelled) {
          archiveStore.setWatcherError("Live refresh paused. Use Rescan archive if files change.");
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

  if (state.status !== "ready") return null;

  if (replacingReadyArchive) {
    return (
      <main className="archive-setup" aria-busy="true">
        <p className="archive-loading">Opening archive</p>
      </main>
    );
  }

  return <CoverUrlCacheScopeContext value={state.archive.id}>{children}</CoverUrlCacheScopeContext>;
}
