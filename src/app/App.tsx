import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { RouterProvider } from "react-router-dom";

import { AppErrorBoundary } from "../components/AppErrorBoundary";
import { Button } from "../components/Button";
import { WindowFrame } from "../components/WindowFrame";
import { ArchiveGate } from "../features/archive/ArchiveGate";
import {
  hideMainWindowForStartup,
  listenForArchiveManagerClosed,
  quitFromStartup,
} from "../features/archive/archiveManagerLifecycle";
import { LibraryStorageProvider } from "../storage/LibraryStorageContext";
import { QuickActionsProvider } from "../features/quick-actions/QuickActionsProvider";
import { appPreferencesStore } from "../stores/appPreferencesStore";
import { archiveStore } from "../stores/archiveStore";
import { startNavigationStateTracking } from "./navigationState";
import { router } from "./router";
import {
  initializeMainStartup,
  resumeMainStartupAfterArchiveManagerClose,
  restoreRememberedReaderRoute,
  StartupArchiveManagerOpenError,
} from "./startupController";
import { MainWindowStateController } from "./windowState";
import { resolveWindowMode } from "./windowMode";

const ArchiveManagerWindow = lazy(() =>
  import("../features/archive/ArchiveManagerWindow").then((module) => ({
    default: module.ArchiveManagerWindow,
  })),
);

export function App() {
  const [windowMode, setWindowMode] = useState<ReturnType<typeof resolveWindowMode> | null>(null);

  useEffect(() => {
    let cancelled = false;
    void appPreferencesStore
      .initialize()
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) {
          setWindowMode(resolveWindowMode());
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (windowMode === null) {
    return <StartupLoading />;
  }

  if (windowMode === "archive-manager") {
    return (
      <div className="window-app">
        <WindowFrame frameStyleOverride="hidden" />
        <div className="window-app__content">
          <AppErrorBoundary>
            <Suspense fallback={null}>
              <ArchiveManagerWindow />
            </Suspense>
          </AppErrorBoundary>
        </div>
      </div>
    );
  }

  return <MainWindowApp />;
}

type MainWindowStartupState =
  { status: "loading" | "manager" | "app" } | { message: string; status: "error" };

function StartupLoading() {
  return (
    <div className="window-app">
      <div className="window-app__content">
        <main className="archive-setup" aria-busy="true">
          <p className="archive-loading">Opening Archeion</p>
        </main>
      </div>
    </div>
  );
}

function MainWindowApp() {
  const [startupState, setStartupState] = useState<MainWindowStartupState>({ status: "loading" });
  const startupAttemptRef = useRef(0);

  const runStartup = useCallback(async () => {
    const attempt = startupAttemptRef.current + 1;
    startupAttemptRef.current = attempt;
    setStartupState({ status: "loading" });

    try {
      const result = await initializeMainStartup({
        restoreReaderRoute: (preferences) =>
          restoreRememberedReaderRoute(preferences, {
            getCurrentPathname: () => router.state.location.pathname,
            navigate: (path) => router.navigate(path, { replace: true }),
          }),
      });

      if (startupAttemptRef.current === attempt) {
        setStartupState({ status: result.showArchiveManager ? "manager" : "app" });
      }
    } catch (error) {
      console.error("Archeion startup failed", error);
      if (startupAttemptRef.current !== attempt) return;

      setStartupState({
        message:
          error instanceof StartupArchiveManagerOpenError
            ? error.message
            : "Archeion could not finish startup.",
        status: "error",
      });
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlisten: () => void = () => undefined;

    void listenForArchiveManagerClosed(() => {
      startupAttemptRef.current += 1;
      void resumeMainStartupAfterArchiveManagerClose({
        navigateToLibrary: () => router.navigate("/", { replace: true }),
        refreshActiveArchive: () => archiveStore.refreshActiveArchive(),
      })
        .then((resumed) => {
          if (cancelled) return;

          setStartupState((current) => {
            if (resumed) return { status: "app" };
            if (current.status === "app" && archiveStore.getSnapshot().status === "ready") {
              return current;
            }
            return { message: "Archeion could not open the selected archive.", status: "error" };
          });
        })
        .catch((error) => {
          console.error("Archive Manager startup completion failed", error);
          if (!cancelled) {
            setStartupState({
              message: "Archeion could not open the selected archive.",
              status: "error",
            });
          }
        });
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
      startupAttemptRef.current += 1;
      unlisten();
    };
  }, [runStartup]);

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
        <WindowFrame />
        <div className="window-app__content">
          <main className="reader-status-page">
            <h1>{startupState.message}</h1>
            <p role="alert">Retry the startup window or quit Archeion.</p>
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
    <div className="window-app">
      <WindowFrame />
      <div className="window-app__content">
        <AppErrorBoundary>
          <LibraryStorageProvider>
            <QuickActionsProvider>
              <ArchiveGate>
                <RouterProvider router={router} />
              </ArchiveGate>
            </QuickActionsProvider>
          </LibraryStorageProvider>
        </AppErrorBoundary>
      </div>
    </div>
  );
}
