import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { Button } from "../../components/Button";
import { ReaderPanelFrameContext } from "./readerPanelFrameContext";
import { ReaderSidePanel } from "./ReaderSidePanel";
import { useReaderPanelFocus } from "./useReaderPanelFocus";

type PanelKind = "navigation" | "search" | "annotations";
export type ReaderPanelReadiness =
  "module-loading" | "loading" | "idle" | "ready" | "empty" | "error";

const panels = {
  navigation: {
    label: "Book navigation",
    title: "Navigation",
    eyebrow: "Navigate",
    id: "reader-publication-navigation",
    close: "Close book navigation",
    loading: "Loading book navigation",
  },
  search: {
    label: "Find in book",
    title: "Find in Book",
    eyebrow: "Search",
    id: "reader-find-in-book",
    close: "Close Find in Book",
    loading: "Loading Find in Book",
  },
  annotations: {
    label: "Annotations",
    title: "Annotations",
    eyebrow: "Reading",
    id: "reader-annotations",
    close: "Close annotations",
    loading: "Loading annotations",
  },
} as const;

/** The header, close button and live region survive both module and data resolution. */
export function ReaderPanelFrame({
  kind,
  active = true,
  onClose,
  readiness,
  onModuleReload,
  children,
}: {
  kind: PanelKind;
  active?: boolean;
  onClose: () => void;
  readiness: ReaderPanelReadiness;
  onModuleReload?: () => void;
  children?: ReactNode;
}) {
  const panel = panels[kind];
  const panelRef = useRef<HTMLElement>(null);
  const focusInitialTarget = useReaderPanelFocus();
  const [actionsHost, setActionsHost] = useState<HTMLSpanElement | null>(null);
  const host = useMemo(
    () => ({ actionsHost, panelRef, focusInitialTarget }),
    [actionsHost, focusInitialTarget],
  );
  useLayoutEffect(() => {
    if (active && !panelRef.current?.contains(document.activeElement))
      focusInitialTarget(panelRef.current);
  }, [active, focusInitialTarget]);
  const loading = readiness === "module-loading" || readiness === "loading";
  const loadingAnnouncement =
    loading && (kind !== "search" || readiness === "module-loading") ? panel.loading : "";
  return (
    <ReaderSidePanel
      accessibleLabel={panel.label}
      className={`reader-${kind}`}
      closeLabel={active ? panel.close : undefined}
      eyebrow={panel.eyebrow}
      headerActions={<span ref={setActionsHost} className="reader-panel-header-actions" />}
      hidden={!active}
      id={active ? panel.id : undefined}
      ignoreReaderShortcuts
      onClose={active ? onClose : undefined}
      ref={panelRef}
      tabIndex={active ? -1 : undefined}
      title={panel.title}
    >
      <p aria-label={loadingAnnouncement || undefined} className="sr-only" role="status">
        {loadingAnnouncement}
      </p>
      <ReaderPanelFrameContext.Provider value={host}>
        <div
          aria-busy={loading || undefined}
          className="reader-panel-content"
          data-readiness={readiness}
        >
          {readiness === "module-loading" ? (
            <ReaderPanelSkeleton />
          ) : onModuleReload && readiness === "error" ? (
            <div className="reader-panel-empty" role="alert">
              <p>{panel.title} could not be loaded.</p>
              <span>Reload the Reader to try again.</span>
              <Button onClick={onModuleReload} size="standard" variant="secondary">
                Reload Reader
              </Button>
            </div>
          ) : (
            children
          )}
        </div>
      </ReaderPanelFrameContext.Provider>
    </ReaderSidePanel>
  );
}

export function ReaderPanelSkeleton() {
  return (
    <div aria-hidden="true" className="reader-panel-loading">
      <span />
      <span />
      <span />
    </div>
  );
}
