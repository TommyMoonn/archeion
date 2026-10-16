import "./reader-interactions-main";
import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Rendition } from "epubjs";
import { ReaderSideDrawer } from "../../../src/features/reader/ReaderSideDrawer";
import { LazyReaderNavigationPanel } from "../../../src/features/reader/LazyReaderNavigationPanel";
import { LazyReaderSearchPanel } from "../../../src/features/reader/LazyReaderSearchPanel";
import { LazyReaderAnnotationsPanel } from "../../../src/features/reader/LazyReaderAnnotationsPanel";
import { useReaderPanelPrewarm } from "../../../src/features/reader/useReaderPanelPrewarm";
import {
  navigationPanelModule,
  searchPanelModule,
  annotationsPanelModule,
} from "../../../src/features/reader/readerPanelModules";
import { ReaderSettingsPanel } from "../../../src/features/reader/ReaderSettingsPanel";
import { useReaderSideSurface } from "../../../src/features/reader/useReaderSideSurface";
import { ReaderSideSurfaceDismissContext } from "../../../src/features/reader/readerSideSurfaceDismissal";
import { createInstalledFontCatalog } from "../../../src/storage/installedFontCatalog";
import { defaultReaderSettings, type ReaderNavigationState } from "../../../src/types/reader";
import type { ReaderTransitionRequest } from "../../../src/features/reader/useReaderControlledTransitions";

const navigation: ReaderNavigationState = {
  chapters: [],
  landmarks: [],
  pageReferences: [],
  status: "ready",
};
const fontCatalog = createInstalledFontCatalog(async () => []);
const ignore = () => undefined;
const succeed = async () => true;
const root = createRoot(document.getElementById("drawer-root")!);
const originalResize = Rendition.prototype.resize;
let resizeCalls = 0;
Rendition.prototype.resize = function (...args) {
  resizeCalls++;
  return originalResize.apply(this, args);
};
let drawerApi: ReturnType<typeof useReaderSideSurface<never>>;
let resolveData: () => void;
let switchBook: () => void;
let prewarm: () => void;

export function Drawers() {
  const [loading, setLoading] = useState(new URLSearchParams(location.search).has("pending"));
  const [book, setBook] = useState(1);
  const [ready, setReady] = useState(false);
  useReaderPanelPrewarm(ready, book);
  useLayoutEffect(() => {
    resolveData = () => setLoading(false);
    switchBook = () => {
      setBook((value) => value + 1);
      setLoading(true);
    };
    prewarm = () => setReady(true);
  }, []);
  const [transitions] = useState(() => {
    let id = 0;
    const owner = { archiveId: null, readerIdentity: null };
    return {
      beginTransition: (): ReaderTransitionRequest => ({ id: ++id, owner }),
      ownsTransition: (request: ReaderTransitionRequest) => request.id === id,
      runAfterSettlement: async (action: () => void | Promise<void>) => {
        await action();
        return true;
      },
    };
  });
  const surfaces = useReaderSideSurface<never>({
    annotationId: () => "",
    onVisibilityOwnershipChange: ignore,
    transitions,
  });
  useLayoutEffect(() => {
    drawerApi = surfaces;
  }, [surfaces]);
  const api = surfaces;
  const { navigationButtonRef, searchButtonRef, annotationButtonRef, settingsButtonRef } = surfaces;
  const close = surfaces.closeTopmost;
  return (
    <ReaderSideSurfaceDismissContext.Provider value={api.dismissalController}>
      <div
        className="reader-page"
        style={
          {
            position: "absolute",
            background: "transparent",
            inset: 0,
            "--reader-header-clearance": "42px",
          } as React.CSSProperties
        }
      >
        <nav style={{ position: "absolute", top: 0, pointerEvents: "auto" }}>
          <button ref={navigationButtonRef} onClick={api.toggleNavigation}>
            Navigation
          </button>
          <button ref={searchButtonRef} onClick={api.toggleSearch}>
            Search
          </button>
          <button ref={annotationButtonRef} onClick={api.toggleAnnotations}>
            Annotations
          </button>
          <button ref={settingsButtonRef} onClick={api.toggleSettings}>
            Appearance
          </button>
        </nav>
        <ReaderSideDrawer key={book} open={api.surface !== null} onDismiss={close}>
          {api.surface ? (
            <>
              {api.navigationOpen ? (
                <LazyReaderNavigationPanel
                  onModuleReload={() => window.location.reload()}
                  navigation={{ ...navigation, status: loading ? "loading" : "ready" }}
                  onClose={api.closeNavigation}
                  onNavigate={succeed}
                />
              ) : null}
              {api.searchOpen ? (
                <LazyReaderSearchPanel
                  onModuleReload={() => window.location.reload()}
                  onClose={api.closeSearch}
                  onActivateResult={succeed}
                  onNextResult={succeed}
                  onPreviousResult={succeed}
                  onQueryChange={ignore}
                  state={{
                    error: null,
                    query: loading ? "fixture" : "",
                    requestRevision: 0,
                    results: [],
                    selectedResult: null,
                    status: loading ? "searching" : "idle",
                    truncated: false,
                  }}
                />
              ) : null}
              {api.annotationsOpen ? (
                <LazyReaderAnnotationsPanel
                  onModuleReload={() => window.location.reload()}
                  annotations={[]}
                  loadStatus={loading ? "loading" : "ready"}
                  navigation={navigation}
                  onClose={api.closeAnnotations}
                  onEditNote={succeed}
                  onExport={async () => ({ status: "cancelled" })}
                  onNavigate={succeed}
                  onRecover={async () => ({ kind: "failed" })}
                  onRecolorHighlight={succeed}
                  onReload={succeed}
                  onRemove={succeed}
                  onUpdateBookmarkLabel={succeed}
                />
              ) : null}
              {api.settingsOpen ? (
                <ReaderSettingsPanel
                  fontCatalog={fontCatalog}
                  layoutCapability="reflowable"
                  onClose={api.closeSettings}
                  onReaderThemeCommit={ignore}
                  onReaderThemeOpen={ignore}
                  onSettingsCommit={ignore}
                  persistenceFailed={false}
                  readerThemeCatalogError={null}
                  readerThemeEntries={[]}
                  readerThemeSelection={{ kind: "builtin", id: "light" }}
                  settings={defaultReaderSettings}
                  presentation="archeion"
                  presentationStatus="idle"
                  onPresentationCommit={ignore}
                  onPresentationRetry={ignore}
                />
              ) : null}
            </>
          ) : null}
        </ReaderSideDrawer>
      </div>
    </ReaderSideSurfaceDismissContext.Provider>
  );
}

declare global {
  interface Window {
    readerDrawer: {
      show: (kind: "navigation" | "search" | "annotations" | "settings") => void;
      close: () => void;
      dispose: () => void;
      resizeCalls: () => number;
      resolveData: () => void;
      switchBook: () => void;
      prewarm: () => void;
      warmPanels: () => Promise<void>;
    };
  }
}
window.readerDrawer = {
  show: (kind) => flushSync(() => drawerApi.transition(kind)),
  close: () =>
    flushSync(() => {
      drawerApi.closeTopmost();
    }),
  dispose: () => {
    root.unmount();
    Rendition.prototype.resize = originalResize;
  },
  resizeCalls: () => resizeCalls,
  resolveData: () => flushSync(resolveData),
  switchBook: () => flushSync(switchBook),
  prewarm: () => flushSync(prewarm),
  warmPanels: async () => {
    await Promise.all([
      navigationPanelModule.preload(),
      searchPanelModule.preload(),
      annotationsPanelModule.preload(),
    ]);
  },
};
flushSync(() => root.render(<Drawers />));
