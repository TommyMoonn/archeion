import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { RouterProvider } from "react-router-dom";

import { AppErrorBoundary } from "../components/AppErrorBoundary";
import { Button } from "../components/Button";
import {
  ARCHIVE_MANAGER_MAIN_CONTENT_ID,
  MAIN_CONTENT_ID,
  SETTINGS_MAIN_CONTENT_ID,
  THEME_MANAGER_MAIN_CONTENT_ID,
  SkipLink,
} from "../components/SkipLink";
import { TooltipProvider } from "../components/Tooltip";
import { WindowTitlebar } from "../components/WindowTitlebar";
import { ArchiveGate } from "../features/archive/ArchiveGate";
import { ArchiveManagerWindowLoading } from "../features/archive/ArchiveManagerWindowLoading";
import {
  hideMainWindowForStartup,
  listenForArchiveManagerClosed,
  quitFromStartup,
} from "../features/archive/archiveManagerLifecycle";
import { LibraryStorageProvider } from "../storage/LibraryStorageContext";
import { QuickActionsProvider } from "../features/quick-actions/QuickActionsProvider";
import { getLibraryStorage } from "../storage/defaultLibraryStorage";
import { archiveStore } from "../stores/archiveStore";
import { startNavigationStateTracking } from "./navigationState";
import { router } from "./router";
import {
  initializeMainStartup,
  resumeInitialStartupAfterArchiveManagerClose,
  restoreRememberedReaderRoute,
  StartupArchiveManagerOpenError,
} from "./startupController";
import { MainWindowStateController } from "./windowState";
import { resolveWindowMode } from "./windowMode";
import { appearanceRuntime } from "../themes/appearanceRuntimeInstance";
import { startupTrace } from "./startupTrace";
import { focusPresentationRuntime } from "./inputModality";

const ArchiveManagerWindow = lazy(() =>
  import("../features/archive/ArchiveManagerWindow").then((module) => ({
    default: module.ArchiveManagerWindow,
  })),
);
const SettingsWindow = lazy(() =>
  import("../features/settings/StandaloneSettingsWindow").then((module) => ({
    default: module.SettingsWindow,
  })),
);
const ThemeManagerWindow = lazy(() =>
  import("../features/themes/ThemeManagerWindow").then((module) => ({
    default: module.ThemeManagerWindow,
  })),
);

function subscribeToRouteChanges(listener: () => void): () => void {
  return router.subscribe(listener);
}

export function App() {
  const windowMode = resolveWindowMode();

  useEffect(() => {
    const stop = appearanceRuntime.start();
    startupTrace.mark("appearance-runtime");
    return stop;
  }, []);

  useEffect(() => focusPresentationRuntime.start(document), []);

  if (windowMode === "archive-manager") {
    return (
      <TooltipProvider subscribeToRouteChanges={subscribeToRouteChanges}>
        <div className="window-app window-app--archive-manager">
          <SkipLink targetId={ARCHIVE_MANAGER_MAIN_CONTENT_ID} />
          <WindowTitlebar canMaximize={false} />
          <div className="window-app__content">
            <AppErrorBoundary mainContentId={ARCHIVE_MANAGER_MAIN_CONTENT_ID}>
              <Suspense fallback={<ArchiveManagerWindowLoading />}>
                <ArchiveManagerWindow />
              </Suspense>
            </AppErrorBoundary>
          </div>
        </div>
      </TooltipProvider>
    );
  }

  if (windowMode === "settings") {
    return (
      <TooltipProvider>
        <AppErrorBoundary mainContentId={SETTINGS_MAIN_CONTENT_ID}>
          <Suspense fallback={null}>
            <SettingsWindow />
          </Suspense>
        </AppErrorBoundary>
      </TooltipProvider>
    );
  }

  if (windowMode === "theme-manager") {
    return (
      <TooltipProvider>
        <AppErrorBoundary mainContentId={THEME_MANAGER_MAIN_CONTENT_ID}>
          <Suspense fallback={null}>
            <ThemeManagerWindow />
          </Suspense>
        </AppErrorBoundary>
      </TooltipProvider>
    );
  }

  return (
    <TooltipProvider subscribeToRouteChanges={subscribeToRouteChanges}>
      <MainWindowApp />
    </TooltipProvider>
  );
}

type MainWindowStartupState =
  | { status: "loading" }
  | { status: "manager" }
  | {
      preparedArchive: NonNullable<
        Awaited<ReturnType<typeof initializeMainStartup>>["preparedArchive"]
      >;
      status: "app";
    }
  | { message: string; status: "error" };

type InitialStartupPhase =
  "initializing" | "archive-manager-open" | "completing-archive-manager" | "mounted" | "failed";

type InitialStartupAttempt = {
  archiveManagerCloseReceived: boolean;
  completion: Promise<void> | null;
  id: number;
  phase: InitialStartupPhase;
};

function StartupLoading() {
  return (
    <div className="window-app">
      <SkipLink targetId={MAIN_CONTENT_ID} />
      <div className="window-app__content">
        <main className="archive-setup" aria-busy="true" id={MAIN_CONTENT_ID} tabIndex={-1}>
          <p className="archive-loading">Opening Archeion</p>
        </main>
      </div>
    </div>
  );
}

function MainWindowApp() {
  const [startupState, setStartupState] = useState<MainWindowStartupState>({ status: "loading" });
  const startupAttemptRef = useRef<InitialStartupAttempt | null>(null);
  const startupAttemptSequenceRef = useRef(0);

  const publishStartupError = useCallback((attempt: InitialStartupAttempt, message: string) => {
    if (startupAttemptRef.current !== attempt) return;

    attempt.phase = "failed";
    setStartupState({ message, status: "error" });
  }, []);

  const completeInitialStartup = useCallback(
    (attempt: InitialStartupAttempt): Promise<void> => {
      if (startupAttemptRef.current !== attempt) {
        return attempt.completion ?? Promise.resolve();
      }

      if (
        attempt.phase === "completing-archive-manager" ||
        attempt.phase === "mounted" ||
        attempt.phase === "failed"
      ) {
        return attempt.completion ?? Promise.resolve();
      }

      if (!attempt.archiveManagerCloseReceived || attempt.phase !== "archive-manager-open") {
        return Promise.resolve();
      }

      attempt.phase = "completing-archive-manager";
      const completion = (async () => {
        try {
          const preparedArchive = await resumeInitialStartupAfterArchiveManagerClose({
            getArchiveState: archiveStore.getSnapshot,
            getStorage: getLibraryStorage,
            isCurrentAttempt: () =>
              startupAttemptRef.current === attempt &&
              attempt.phase === "completing-archive-manager",
            navigateToLibrary: () => router.navigate("/", { replace: true }),
            refreshActiveArchive: () => archiveStore.refreshActiveArchive(),
          });

          if (startupAttemptRef.current !== attempt) return;

          if (!preparedArchive) {
            publishStartupError(attempt, "Archeion could not open the selected archive.");
            return;
          }

          attempt.phase = "mounted";
          setStartupState({ preparedArchive, status: "app" });
        } catch (error) {
          console.error("Archive Manager startup completion failed", error);
          publishStartupError(attempt, "Archeion could not open the selected archive.");
        }
      })();

      attempt.completion = completion;
      return completion;
    },
    [publishStartupError],
  );

  const runStartup = useCallback(async () => {
    const attempt: InitialStartupAttempt = {
      archiveManagerCloseReceived: false,
      completion: null,
      id: startupAttemptSequenceRef.current + 1,
      phase: "initializing",
    };
    startupAttemptSequenceRef.current = attempt.id;
    startupAttemptRef.current = attempt;
    setStartupState({ status: "loading" });

    try {
      const result = await initializeMainStartup({
        onArchiveManagerOpened: () => {
          if (startupAttemptRef.current !== attempt || attempt.phase !== "initializing") return;

          attempt.phase = "archive-manager-open";
          if (attempt.archiveManagerCloseReceived) {
            void completeInitialStartup(attempt);
          }
        },
        restoreReaderRoute: (preferences, storage) =>
          restoreRememberedReaderRoute(preferences, storage, {
            getCurrentPathname: () => router.state.location.pathname,
            navigate: (path) => router.navigate(path, { replace: true }),
          }),
      });

      if (startupAttemptRef.current !== attempt) return;
      if (
        attempt.phase === "completing-archive-manager" ||
        attempt.phase === "mounted" ||
        attempt.phase === "failed"
      ) {
        return;
      }

      if (result.showArchiveManager) {
        attempt.phase = "archive-manager-open";
        if (attempt.archiveManagerCloseReceived) {
          void completeInitialStartup(attempt);
          return;
        }

        setStartupState({ status: "manager" });
        return;
      }

      attempt.phase = "mounted";
      setStartupState({ preparedArchive: result.preparedArchive, status: "app" });
    } catch (error) {
      console.error("Archeion startup failed", error);
      if (
        startupAttemptRef.current !== attempt ||
        attempt.phase === "completing-archive-manager" ||
        attempt.phase === "mounted" ||
        attempt.phase === "failed"
      ) {
        return;
      }

      publishStartupError(
        attempt,
        error instanceof StartupArchiveManagerOpenError
          ? error.message
          : "Archeion could not finish startup.",
      );
    }
  }, [completeInitialStartup, publishStartupError]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: () => void = () => undefined;

    void listenForArchiveManagerClosed(() => {
      const attempt = startupAttemptRef.current;
      if (!attempt || attempt.phase === "mounted" || attempt.phase === "failed" || cancelled) {
        return;
      }

      attempt.archiveManagerCloseReceived = true;
      if (attempt.phase === "archive-manager-open") {
        void completeInitialStartup(attempt);
      }
    })
      .then((stopListening) => {
        if (cancelled) {
          stopListening();
          return;
        }
        unlisten = stopListening;
        return runStartup();
      })
      .catch((error) => {
        console.error("Archive Manager lifecycle listener failed", error);
        if (!cancelled) {
          setStartupState({ message: "Archeion could not finish startup.", status: "error" });
        }
      });

    return () => {
      cancelled = true;
      startupAttemptRef.current = null;
      unlisten();
    };
  }, [completeInitialStartup, runStartup]);

  useLayoutEffect(() => {
    if (startupState.status === "app") {
      startupTrace.mark("shell");
    }
  }, [startupState.status]);

  useEffect(() => {
    if (startupState.status !== "app") {
      return;
    }

    void archiveStore.focusMainWindow();
    const windowStateController = new MainWindowStateController();
    void windowStateController.start();
    const stopNavigationTracking = startNavigationStateTracking(router);

    return () => {
      windowStateController.stop();
      stopNavigationTracking();
    };
  }, [startupState.status]);

  useEffect(() => {
    if (startupState.status === "error") {
      void archiveStore.focusMainWindow();
    }
  }, [startupState.status]);

  if (startupState.status === "loading" || startupState.status === "manager") {
    return <StartupLoading />;
  }

  if (startupState.status === "error") {
    return (
      <div className="window-app">
        <SkipLink targetId={MAIN_CONTENT_ID} />
        <WindowTitlebar canMaximize />
        <div className="window-app__content">
          <main className="reader-status-page" id={MAIN_CONTENT_ID} tabIndex={-1}>
            <h1>{startupState.message}</h1>
            <p data-tone="error" role="alert">
              Retry the startup window or quit Archeion.
            </p>
            <div className="reader-status-page__actions">
              <Button
                onClick={() => {
                  void hideMainWindowForStartup().then((hidden) => {
                    if (hidden) {
                      return runStartup();
                    }

                    setStartupState({
                      message: "Archive Manager window failed to open.",
                      status: "error",
                    });
                  });
                }}
                variant="secondary"
              >
                Retry
              </Button>
              <Button onClick={() => void quitFromStartup()} variant="secondary">
                Quit
              </Button>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="window-app window-app--main-shell">
      <SkipLink targetId={MAIN_CONTENT_ID} />
      <WindowTitlebar canMaximize />
      <div className="window-app__content">
        <AppErrorBoundary>
          <LibraryStorageProvider storage={startupState.preparedArchive.storage}>
            <QuickActionsProvider>
              <ArchiveGate
                preparedArchiveAtMount={{
                  id: startupState.preparedArchive.archiveId,
                  rootPath: startupState.preparedArchive.rootPath,
                }}
              >
                <RouterProvider router={router} />
              </ArchiveGate>
            </QuickActionsProvider>
          </LibraryStorageProvider>
        </AppErrorBoundary>
      </div>
    </div>
  );
}
