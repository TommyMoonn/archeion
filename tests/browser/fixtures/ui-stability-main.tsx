import { createRoot } from "react-dom/client";
import { installUIStabilityBackend } from "./ui-stability-backend";
import "../../../src/styles/index.css";

const fixtureLocation = location.href;
const backend = await installUIStabilityBackend(new URLSearchParams(location.search));
window.installCoverReadinessProbe?.();
// App/router must be imported after mock Windows/IPC installation. Production owners are unchanged.
const [{ App }, { archiveStore }, { router }, { getLibraryStorage }, { appPreferencesStore }] =
  await Promise.all([
    import("../../../src/app/App"),
    import("../../../src/stores/archiveStore"),
    import("../../../src/app/router"),
    import("../../../src/storage/defaultLibraryStorage"),
    import("../../../src/stores/appPreferencesStore"),
  ]);
await router.navigate(
  backend.windowMode === "main" ? "/" : { pathname: "/", search: location.search },
);
// Utility recovery must reload this instrumented entry, not the unmocked production index.
if (backend.windowMode !== "main") history.replaceState(history.state, "", fixtureLocation);
window.uiStabilityState = () => ({
  ...backend.state(),
  route:
    backend.windowMode !== "main"
      ? backend.windowMode
      : router.state.location.pathname.startsWith("/reader/")
        ? "reader"
        : "library",
  status: archiveStore.getSnapshot().status,
  ready: Boolean(
    document.querySelector(
      backend.windowMode === "main"
        ? ".book-grid, .book-list, .empty-state, .epub-container iframe"
        : ".about-window-shell, .settings-window-shell, .archive-manager-shell, .theme-manager-window-shell",
    ),
  ),
});
let releaseUtilityInitialization = () => {};
let exitControl = {
  saveStarted: false,
  destinationStarted: false,
  saveCalls: 0,
  destinationCalls: 0,
};
let releaseExitSave: (fail?: boolean) => void = () => {};
let releaseExitDestination = () => {};
let commitAcknowledgedExit = () => {};
window.uiStabilityFixture = {
  async holdReaderExit() {
    const storage = await getLibraryStorage();
    const flush = storage.flushPendingWrites.bind(storage);
    const libraryRoute = router.routes.find((route) => route.path === "/")!;
    const loader = libraryRoute.loader;
    let releaseSave!: () => void;
    let releaseDestination!: () => void;
    const save = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const destination = new Promise<void>((resolve) => {
      releaseDestination = resolve;
    });
    let failSave = false;
    exitControl = {
      saveStarted: false,
      destinationStarted: false,
      saveCalls: 0,
      destinationCalls: 0,
    };
    storage.flushPendingWrites = async () => {
      exitControl.saveStarted = true;
      exitControl.saveCalls++;
      await save;
      if (failSave) throw new Error("Synthetic delayed progress failure");
      await flush();
    };
    libraryRoute.loader = async (...args) => {
      exitControl.destinationStarted = true;
      exitControl.destinationCalls++;
      await destination;
      return typeof loader === "function" ? loader(...args) : null;
    };
    releaseExitSave = (fail = false) => {
      failSave = fail;
      releaseSave();
    };
    releaseExitDestination = () => {
      libraryRoute.loader = loader;
      storage.flushPendingWrites = flush;
      releaseDestination();
    };
  },
  exitControl: () => exitControl,
  releaseExitSave: (fail = false) => releaseExitSave(fail),
  releaseExitDestination: () => releaseExitDestination(),
  interruptExit: () => router.navigate(router.state.location),
  acknowledgeNextExit: () => {
    const navigate = router.navigate.bind(router);
    router.navigate = ((...args: Parameters<typeof navigate>) => {
      router.navigate = navigate;
      commitAcknowledgedExit = () => {
        void navigate(...args);
      };
      return Promise.resolve();
    }) as typeof navigate;
  },
  commitAcknowledgedExit: () => commitAcknowledgedExit(),
  failNextLibraryLoader: () => {
    const libraryRoute = router.routes.find((route) => route.path === "/")!;
    const loader = libraryRoute.loader;
    libraryRoute.loader = () => {
      libraryRoute.loader = loader;
      throw new Error("Synthetic Library loader failure");
    };
  },
  rejectNextExit: () => {
    const navigate = router.navigate.bind(router);
    router.navigate = () => {
      router.navigate = navigate;
      return Promise.reject(new Error("Synthetic rejected navigation"));
    };
  },
  utilityEvents: backend.utilityEvents,
  holdUtilityInitialization: () => {
    const initialize = appPreferencesStore.initialize.bind(appPreferencesStore);
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    appPreferencesStore.initialize = async () => {
      await initialize();
      await held;
    };
    releaseUtilityInitialization = () => {
      appPreferencesStore.initialize = initialize;
      release();
    };
  },
  releaseUtilityInitialization: () => releaseUtilityInitialization(),
  recoverAppearance: async () =>
    (
      await import("../../../src/themes/appearanceRuntimeInstance")
    ).appearanceRuntime.refreshAppearance(),
  getStoredAppTheme: () => appPreferencesStore.getSnapshot().appTheme,
  themeReadStarted: backend.themeReadStarted,
  setAppTheme: (appTheme) => appPreferencesStore.update({ appTheme }).then(() => undefined),
  unexpected: backend.unexpected,
  setUpdate: backend.setUpdate,
  setDestinationCount: backend.setCount,
  setView: (view: "grid" | "list") =>
    appPreferencesStore
      .update({
        library: {
          ...appPreferencesStore.getSnapshot().library,
          collections: {
            ...appPreferencesStore.getSnapshot().library.collections,
            books: {
              ...appPreferencesStore.getSnapshot().library.collections.books,
              viewMode: view,
            },
          },
        },
      })
      .then(() => undefined),
  async resizeCatalog(count: number) {
    backend.setCount(count);
    const storage = await getLibraryStorage();
    storage.reset(`fixture-${backend.state().archive}`);
    await storage.rescan();
  },
  switchArchive: (id: string) => archiveStore.switchArchive(id),
};
createRoot(document.getElementById("root")!).render(<App />);

declare global {
  interface Window {
    uiStabilityFixture: {
      holdReaderExit: () => Promise<void>;
      exitControl: () => {
        saveStarted: boolean;
        destinationStarted: boolean;
        saveCalls: number;
        destinationCalls: number;
      };
      releaseExitSave: (fail?: boolean) => void;
      releaseExitDestination: () => void;
      interruptExit: () => Promise<void>;
      acknowledgeNextExit: () => void;
      commitAcknowledgedExit: () => void;
      failNextLibraryLoader: () => void;
      rejectNextExit: () => void;
      utilityEvents: Array<{ kind: string; time: number; shell: boolean }>;
      holdUtilityInitialization: () => void;
      releaseUtilityInitialization: () => void;
      recoverAppearance: () => Promise<void>;
      getStoredAppTheme: () => import("../../../src/types/settings").AppThemeSelection;
      themeReadStarted: () => boolean;
      setAppTheme: (
        selection: import("../../../src/types/settings").AppThemeSelection,
      ) => Promise<void>;
      unexpected: string[];
      resizeCatalog: (count: number) => Promise<void>;
      setDestinationCount: (count: number) => void;
      switchArchive: (id: string) => Promise<boolean>;
      setUpdate: typeof backend.setUpdate;
      setView: (view: "grid" | "list") => Promise<void>;
    };
  }
}
