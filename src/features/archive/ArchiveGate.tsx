import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";

import { useLibraryStorage } from "../../storage/useLibraryStorage";
import { useMetadataWriteLifecycle } from "../../storage/useMetadataWriteLifecycle";
import { archiveStore } from "../../stores/archiveStore";
import { useFilesAndMetadataPreferences } from "../../stores/appPreferencesStore";
import { ArchiveWatcherController } from "./archiveWatcher";
import { ArchivePresentationContext } from "../../app/archivePresentation";
import { Button } from "../../components/Button";
import { CoverUrlCacheScopeContext } from "../library/coverUrlCacheScope";
import { router } from "../../app/router";
import { startupTrace } from "../../app/startupTrace";
import { MAIN_CONTENT_ID } from "../../components/SkipLink";
import { useArchiveReconciliationRequests } from "./useArchiveReconciliationRequests";

type ArchiveGateProps = {
  children: ReactNode;
  preparedArchiveAtMount?: { id: string; rootPath: string };
};

export function ArchiveGate({ children, preparedArchiveAtMount }: ArchiveGateProps) {
  const state = useSyncExternalStore(
    archiveStore.subscribe,
    archiveStore.getSnapshot,
    archiveStore.getSnapshot,
  );
  const storage = useLibraryStorage();
  useMetadataWriteLifecycle(storage);
  const { liveWatcherEnabled, scanOnStartup } = useFilesAndMetadataPreferences();
  const archivePath = state.status === "ready" ? state.path : null;
  const readyArchiveId = state.status === "ready" ? state.archive.id : null;
  const [presentedArchive, setPresentedArchive] = useState(state.status === "ready" ? state : null);
  const [navigationFailure, setNavigationFailure] = useState<string | null>(null);
  const [retryRevision, setRetryRevision] = useState(0);
  const subscribe = useCallback(
    (notify: () => void) => storage.observeLibrarySnapshot({ next: notify }),
    [storage],
  );
  const snapshot = useSyncExternalStore(subscribe, storage.getLibrarySnapshot.bind(storage));
  const snapshotReady =
    state.status === "ready" &&
    snapshot.archiveRootPath === state.path &&
    snapshot.loadState === "ready";
  const snapshotFailed =
    state.status === "ready" &&
    snapshot.archiveRootPath === state.path &&
    snapshot.loadState === "error";
  const blocked =
    state.status !== "ready" ||
    state.archive.id !== presentedArchive?.archive.id ||
    state.path !== presentedArchive.path;
  const storageArchiveRef = useRef(preparedArchiveAtMount ?? null);
  const frameRef = useRef<HTMLDivElement>(null);
  const statusRef = useRef<HTMLElement>(null);
  if (!blocked && state.status === "ready" && presentedArchive !== state)
    setPresentedArchive(state);
  useArchiveReconciliationRequests(
    storage,
    archivePath && readyArchiveId ? { archiveId: readyArchiveId, rootPath: archivePath } : null,
  );

  useEffect(() => {
    if (state.status !== "ready") return;
    if (!blocked) return;
    if (!snapshotReady) return;

    let cancelled = false;
    const leaveReader = router.state.location.pathname.startsWith("/reader/");
    let navigationSettled = false;
    let stopObserving = () => {};
    const publishCommittedDestination = () => {
      if (cancelled) return;
      if (!leaveReader || router.state.location.pathname === "/") {
        stopObserving();
        setNavigationFailure(null);
        setPresentedArchive(state);
      } else if (
        navigationSettled &&
        router.state.navigation?.state === "idle" &&
        ![...(router.state.blockers?.values() ?? [])].some(
          (blocker) => blocker.state !== "unblocked",
        )
      ) {
        stopObserving();
        setNavigationFailure(state.archive.id);
      }
    };
    // A navigate() promise may resolve while a route guard still blocks the destination.
    // Only the committed location can release the archive presentation/input gate.
    if (leaveReader) stopObserving = router.subscribe(publishCommittedDestination);
    const navigation = leaveReader
      ? router.navigate(
          {
            pathname: "/",
            search: new URLSearchParams({
              archiveId: state.archive.id,
              view: "library",
            }).toString(),
          },
          { replace: true },
        )
      : Promise.resolve();
    void navigation.then(
      () => {
        navigationSettled = true;
        publishCommittedDestination();
      },
      () => {
        if (!cancelled) {
          stopObserving();
          setNavigationFailure(readyArchiveId);
        }
      },
    );
    return () => {
      cancelled = true;
      stopObserving();
    };
  }, [state, readyArchiveId, blocked, snapshotReady, retryRevision]);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const status = statusRef.current;
    if (!blocked || !frame || !status) return;
    const stage = frame.querySelector(".reader-content-stage, .page-shell");
    const toolbar = frame.querySelector(".library-toolbar");
    const measure = () => {
      const outer = frame.getBoundingClientRect();
      const bounds = stage?.getBoundingClientRect() ?? outer;
      const top = toolbar?.getBoundingClientRect().bottom ?? bounds.top;
      status.style.inset = `${top - outer.top}px ${outer.right - bounds.right}px 0 ${bounds.left - outer.left}px`;
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(frame);
    if (stage) observer?.observe(stage);
    if (toolbar) observer?.observe(toolbar);
    return () => observer?.disconnect();
  }, [blocked, presentedArchive]);

  useEffect(() => {
    const alreadyPrepared = Boolean(
      archivePath &&
      readyArchiveId &&
      storageArchiveRef.current?.id === readyArchiveId &&
      storageArchiveRef.current.rootPath === archivePath,
    );
    if (archivePath && !alreadyPrepared) {
      storage.reset(archivePath);
      storageArchiveRef.current =
        archivePath && readyArchiveId ? { id: readyArchiveId, rootPath: archivePath } : null;
      startupTrace.mark("storage");
    }
  }, [archivePath, readyArchiveId, storage]);

  useEffect(() => {
    if (!archivePath) {
      return;
    }

    let watcher: ArchiveWatcherController | null = null;
    let cancelled = false;

    if (scanOnStartup || storage.getLibrarySnapshot().loadState === "loading") {
      startupTrace.mark("scan");
      void storage.rescan().catch(() => undefined);
    }

    if (liveWatcherEnabled) {
      watcher = new ArchiveWatcherController({
        archiveRootPath: archivePath,
        storage,
        onError: () => {
          if (cancelled) return;
          archiveStore.setWatcherError("Live refresh paused. Use Rescan archive if files change.");
        },
        onRecovered: () => {
          if (!cancelled) archiveStore.setWatcherError(null);
        },
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

  if (!presentedArchive) {
    return (
      <main className="archive-setup" aria-busy="true" id={MAIN_CONTENT_ID} tabIndex={-1}>
        <p className="archive-loading">Opening archive</p>
      </main>
    );
  }

  const failed =
    snapshotFailed ||
    (navigationFailure !== null && navigationFailure === readyArchiveId) ||
    (state.status !== "loading" && state.status !== "ready");
  return (
    <ArchivePresentationContext value={{ archive: presentedArchive, blocked }}>
      <div ref={frameRef} className="archive-handoff" data-archive-blocked={blocked || undefined}>
        <div className="archive-handoff__workspace" inert={blocked}>
          <CoverUrlCacheScopeContext value={presentedArchive.archive.id}>
            {children}
          </CoverUrlCacheScopeContext>
        </div>
        {blocked ? (
          <section
            ref={statusRef}
            className="archive-handoff__status"
            role={failed ? "alert" : "status"}
          >
            <p>{failed ? "The archive could not be opened." : "Opening archive"}</p>
            {failed ? (
              <Button
                variant="secondary"
                onClick={() => {
                  if (navigationFailure !== null && navigationFailure === readyArchiveId)
                    setRetryRevision((value) => value + 1);
                  else if (snapshotFailed) void storage.rescan().catch(() => undefined);
                  else void archiveStore.refreshActiveArchive();
                }}
              >
                Try again
              </Button>
            ) : null}
            {failed ? (
              <Button
                variant="secondary"
                onClick={() => void archiveStore.openArchiveManagerWindow()}
              >
                Open Archive Manager
              </Button>
            ) : null}
          </section>
        ) : null}
      </div>
    </ArchivePresentationContext>
  );
}
