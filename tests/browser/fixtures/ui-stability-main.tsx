import { createRoot } from "react-dom/client";
import { installUIStabilityBackend } from "./ui-stability-backend";
import "../../../src/styles/index.css";

const backend = await installUIStabilityBackend(new URLSearchParams(location.search));
// App/router must be imported after mock Windows/IPC installation. Production owners are unchanged.
const [{ App }, { archiveStore }, { router }, { getLibraryStorage }, { appPreferencesStore }] =
  await Promise.all([
    import("../../../src/app/App"),
    import("../../../src/stores/archiveStore"),
    import("../../../src/app/router"),
    import("../../../src/storage/defaultLibraryStorage"),
    import("../../../src/stores/appPreferencesStore"),
  ]);
await router.navigate("/");
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
window.uiStabilityFixture = {
  recoverAppearance: async () =>
    (
      await import("../../../src/themes/appearanceRuntimeInstance")
    ).appearanceRuntime.refreshAppearance(),
  getStoredAppTheme: () => appPreferencesStore.getSnapshot().appTheme,
  themeReadStarted: backend.themeReadStarted,
  setAppTheme: (appTheme) => appPreferencesStore.update({ appTheme }).then(() => undefined),
  unexpected: backend.unexpected,
  setUpdate: backend.setUpdate,
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
      recoverAppearance: () => Promise<void>;
      getStoredAppTheme: () => import("../../../src/types/settings").AppThemeSelection;
      themeReadStarted: () => boolean;
      setAppTheme: (
        selection: import("../../../src/types/settings").AppThemeSelection,
      ) => Promise<void>;
      unexpected: string[];
      resizeCatalog: (count: number) => Promise<void>;
      switchArchive: (id: string) => Promise<boolean>;
      setUpdate: typeof backend.setUpdate;
      setView: (view: "grid" | "list") => Promise<void>;
    };
  }
}
