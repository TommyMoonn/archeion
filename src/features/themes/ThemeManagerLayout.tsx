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
      <section aria-label="Theme Manager" className="theme-manager-surface">
        <header className="theme-manager__header" data-utility-slot="header">
          <h1>Theme Manager</h1>
          <div data-utility-slot="toolbar" ref={setToolbarHost}>
            <div
              aria-hidden="true"
              className="utility-slot-placeholder theme-manager__toolbar-placeholder"
            >
              <span />
              <span />
              <span />
            </div>
          </div>
        </header>
        <div className="theme-manager__notice-region" ref={setNoticeHost} />
        <div className="theme-manager__workspace" data-utility-slot="workspace">
          <div
            className="theme-manager__catalog-slot"
            data-utility-slot="catalog"
            ref={setCatalogHost}
          >
            <div
              aria-hidden="true"
              className="utility-slot-placeholder theme-manager__catalog-placeholder"
            >
              <div>
                {Array.from({ length: 3 }, (_, i) => (
                  <span key={i} />
                ))}
              </div>
            </div>
          </div>
          <div className="theme-manager__details-slot" data-utility-slot="details">
            {children}
          </div>
        </div>
        <div className="theme-manager__preview-slot" ref={setPreviewHost} />
      </section>
    </ThemeManagerLayoutContext.Provider>
  );
}
