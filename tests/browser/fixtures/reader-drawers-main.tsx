import "./reader-interactions-main";
import { useLayoutEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { Rendition } from "epubjs";
import { ReaderSideDrawer } from "../../../src/features/reader/ReaderSideDrawer";
import { ReaderNavigationPanel } from "../../../src/features/reader/ReaderNavigationPanel";
import { ReaderSearchPanel } from "../../../src/features/reader/ReaderSearchPanel";
import { ReaderAnnotationsPanel } from "../../../src/features/reader/ReaderAnnotationsPanel";
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

export function Drawers() {
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
        style={
          {
            position: "absolute",
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
        <ReaderSideDrawer open={api.surface !== null} onDismiss={close}>
          {api.surface ? (
            <>
              {api.navigationOpen ? (
                <ReaderNavigationPanel
                  navigation={navigation}
                  onClose={api.closeNavigation}
                  onNavigate={succeed}
                />
              ) : null}
              {api.searchOpen ? (
                <ReaderSearchPanel
                  onClose={api.closeSearch}
                  onActivateResult={succeed}
                  onNextResult={succeed}
                  onPreviousResult={succeed}
                  onQueryChange={ignore}
                  state={{
                    error: null,
                    query: "",
                    requestRevision: 0,
                    results: [],
                    selectedResult: null,
                    status: "idle",
                    truncated: false,
                  }}
                />
              ) : null}
              {api.annotationsOpen ? (
                <ReaderAnnotationsPanel
                  annotations={[]}
                  loadStatus="ready"
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
};
flushSync(() => root.render(<Drawers />));
