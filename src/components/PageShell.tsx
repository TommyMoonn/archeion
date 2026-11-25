import { type ReactNode, type Ref } from "react";
import { MAIN_CONTENT_ID } from "./SkipLink";

type PageShellProps = {
  children: ReactNode;
  importDropTarget?: {
    active: boolean;
    destination: string;
    id: string;
    label: string;
  };
  mainRef?: Ref<HTMLElement>;
  notice?: ReactNode;
  sidebar: ReactNode;
  sidebarCollapsed?: boolean;
  detailsPanel?: ReactNode;
};

export function PageShell({
  children,
  importDropTarget,
  mainRef,
  notice,
  sidebar,
  sidebarCollapsed = false,
  detailsPanel,
}: PageShellProps) {
  return (
    <div
      className="app-shell"
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-pinned={detailsPanel ? true : undefined}
    >
      {sidebar}
      <main
        className="page-shell relative min-w-0 h-auto min-h-0 overflow-x-hidden overflow-y-auto overscroll-contain scrollbar-gutter-stable m-0 pt-page-top px-page-inline pb-page-bottom border-0 rounded-none bg-surface-main shadow-none page-short:pt-page-short-top page-short:pb-page-short-bottom page-narrow:px-dialog-panel page-mobile:px-collection-loading page-mobile:pt-field-standard page-mobile:pb-page-compact-bottom page-compact:pt-page-compact-top page-compact:pb-page-compact-bottom"
        data-import-drop-active={importDropTarget?.active || undefined}
        data-import-drop-destination={importDropTarget?.destination}
        data-import-drop-id={importDropTarget?.id}
        data-import-drop-label={importDropTarget?.label}
        data-import-drop-target={importDropTarget ? "true" : undefined}
        id={MAIN_CONTENT_ID}
        ref={mainRef}
        tabIndex={-1}
      >
        {children}
      </main>
      {detailsPanel}
      {notice ? <div className="page-shell-notice">{notice}</div> : null}
    </div>
  );
}
