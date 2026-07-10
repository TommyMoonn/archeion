import { lazy, Suspense, useEffect, useState } from "react";
import { RouterProvider } from "react-router-dom";

import { AppErrorBoundary } from "../components/AppErrorBoundary";
import { WindowFrame } from "../components/WindowFrame";
import { ArchiveGate } from "../features/archive/ArchiveGate";
import { ArchiveManagerWindowContent } from "../features/archive/ArchiveManagerWindowContent";
import { LibraryStorageProvider } from "../storage/LibraryStorageContext";
import { appPreferencesStore } from "../stores/appPreferencesStore";
import { useArchive } from "../features/archive/useArchive";
import { startNavigationStateTracking } from "./navigationState";
import { router } from "./router";
import { initializeMainStartup, restoreRememberedReaderRoute } from "./startupController";
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

type MainWindowStartupState = "loading" | "manager" | "app" | "error";

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
  const archive = useArchive();
  const [startupState, setStartupState] = useState<MainWindowStartupState>("loading");

  useEffect(() => {
    let cancelled = false;

    void initializeMainStartup({
      restoreReaderRoute: (preferences) =>
        restoreRememberedReaderRoute(preferences, {
          navigate: (path) => router.navigate(path, { replace: true }),
        }),
    })
      .then((result) => {
        if (!cancelled) {
          setStartupState(result.showArchiveManager ? "manager" : "app");
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStartupState("error");
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (startupState !== "app") {
      return;
    }

    const windowStateController = new MainWindowStateController();
    void windowStateController.start();
    const stopNavigationTracking = startNavigationStateTracking(router);

    return () => {
      windowStateController.stop();
      stopNavigationTracking();
    };
  }, [startupState]);

  if (startupState === "loading") {
    return <StartupLoading />;
  }

  if (startupState === "error") {
    return (
      <div className="window-app">
        <div className="window-app__content">
          <main className="archive-setup">
            <p className="archive-loading" role="alert">
              Archeion could not finish startup.
            </p>
          </main>
        </div>
      </div>
    );
  }

  if (startupState === "manager") {
    return (
      <div className="window-app">
        <WindowFrame />
        <div className="window-app__content">
          <AppErrorBoundary>
            <ArchiveManagerWindowContent
              mode="launcher"
              onArchiveChoiceComplete={async () => {
                await router.navigate("/", { replace: true });
                setStartupState("app");
              }}
              state={archive}
            />
          </AppErrorBoundary>
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
            <ArchiveGate>
              <RouterProvider router={router} />
            </ArchiveGate>
          </LibraryStorageProvider>
        </AppErrorBoundary>
      </div>
    </div>
  );
}
