import { useContext, useSyncExternalStore } from "react";
import { MAIN_CONTENT_ID } from "../components/SkipLink";
import { ReaderExitPresentation } from "../features/reader/ReaderExitPresentation";
import { appearanceRuntime } from "../themes/appearanceRuntimeInstance";
import { readerThemeCssProperties } from "../themes/themeCssVariables";
import { ReaderExitFrameContext } from "./readerExitFrame";

// Mounted only by the router's explicit error boundary, never by pending/idle inference.
export function LibraryRouteError() {
  const frame = useContext(ReaderExitFrameContext)?.frame;
  const currentTheme = useSyncExternalStore(
    appearanceRuntime.subscribe,
    appearanceRuntime.getReaderSnapshot,
    appearanceRuntime.getReaderSnapshot,
  );
  const theme = frame?.theme ?? currentTheme;
  return (
    <main
      className="reader-page"
      data-reader-theme={theme.base}
      data-reader-phase="closed"
      data-reader-retiring
      data-toolbar-expanded={(frame?.toolbarExpanded ?? true) || undefined}
      id={MAIN_CONTENT_ID}
      style={readerThemeCssProperties(theme)}
      tabIndex={-1}
    >
      <ReaderExitPresentation
        failure="rejected"
        toolbarExpanded={frame?.toolbarExpanded ?? true}
        onReturn={() => window.location.reload()}
      />
    </main>
  );
}
