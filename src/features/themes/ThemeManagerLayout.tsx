import { useMemo, useState, type ReactNode } from "react";
import { ThemeManagerLayoutContext } from "./themeManagerLayoutContext";

export function ThemeManagerLayout({ children }: { children: ReactNode }) {
  const [toolbarHost, setToolbarHost] = useState<HTMLDivElement | null>(null);
  const [noticeHost, setNoticeHost] = useState<HTMLDivElement | null>(null);
  const [catalogHost, setCatalogHost] = useState<HTMLDivElement | null>(null);
  const [previewHost, setPreviewHost] = useState<HTMLDivElement | null>(null);
  const value = useMemo(
    () => ({ toolbarHost, noticeHost, catalogHost, previewHost }),
    [toolbarHost, noticeHost, catalogHost, previewHost],
  );
  return (
    <ThemeManagerLayoutContext.Provider value={value}>
      <section
        aria-label="Theme Manager"
        className="relative grid min-h-0 min-w-0 flex-1 grid-rows-theme-manager bg-canvas"
      >
        <header
          className="grid min-w-0 gap-theme-header border-0 border-b border-solid border-line-subtle px-theme-window pb-theme-header-bottom pt-theme-header-top theme-manager-stacked:px-theme-window-narrow theme-manager-stacked:pb-theme-window-narrow theme-manager-stacked:pt-theme-header-narrow"
          data-utility-slot="header"
        >
          <h1 className="m-0 text-balance font-app-display text-page-title text-text-strong">
            Theme Manager
          </h1>
          <div data-utility-slot="toolbar" ref={setToolbarHost}>
            <div
              aria-hidden="true"
              className="flex h-control-standard gap-control-gap not-only:hidden"
            >
              <span className="w-theme-import-placeholder rounded-control bg-surface-raised" />
              <span className="w-field-standard rounded-control bg-surface-raised" />
              <span className="w-field-standard rounded-control bg-surface-raised" />
            </div>
          </div>
        </header>
        <div
          className="row-start-2 mx-theme-window mt-sidebar-inset max-h-theme-notice-limit min-h-theme-notice min-w-0 overflow-y-auto overscroll-contain theme-manager-stacked:mx-theme-window-narrow"
          ref={setNoticeHost}
        />
        <div
          className="row-start-3 grid min-h-0 min-w-0 grid-cols-theme-manager bg-canvas theme-manager-stacked:grid-cols-1 theme-manager-stacked:grid-rows-theme-manager-stacked"
          data-utility-slot="workspace"
        >
          <div
            className="min-h-0 min-w-0 overflow-hidden"
            data-utility-slot="catalog"
            ref={setCatalogHost}
          >
            <div
              aria-hidden="true"
              className="grid h-full content-start gap-sidebar-inset border-0 border-e border-solid border-line-subtle bg-canvas p-theme-window-narrow not-only:hidden"
            >
              {Array.from({ length: 3 }, (_, i) => (
                <span
                  className="h-theme-card-placeholder rounded-control bg-surface-raised"
                  key={i}
                />
              ))}
            </div>
          </div>
          <div className="min-h-0 min-w-0 overflow-hidden" data-utility-slot="details">
            {children}
          </div>
        </div>
        <div className="row-start-4 min-w-0 empty:hidden" ref={setPreviewHost} />
      </section>
    </ThemeManagerLayoutContext.Provider>
  );
}
