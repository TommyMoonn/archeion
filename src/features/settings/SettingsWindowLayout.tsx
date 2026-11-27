import { useMemo, useRef, useState, type ReactNode } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { SettingsWindowLayoutContext } from "./settingsWindowLayoutContext";

export function SettingsSidebarFrame({ children }: { children: ReactNode }) {
  return (
    <aside
      aria-label="Settings navigation"
      className="settings-sidebar flex min-h-0 flex-col gap-dialog-gap border-0 border-e border-solid border-line-subtle bg-canvas-deep px-settings-sidebar-inset py-dialog-panel settings-window-narrow:px-overlay-viewport-inset settings-window-mobile:gap-dialog-gap-narrow settings-window-mobile:border-e-0 settings-window-mobile:border-b settings-window-mobile:p-button-standard"
    >
      <div className="settings-sidebar__header">
        <p className="m-0 text-muted text-caption tracking-settings-eyebrow uppercase">Archeion</p>
        <h1
          className="m-0 mt-settings-small-gap text-text-strong font-app-display text-page-title settings-window-mobile:mt-busy-inset settings-window-mobile:text-title settings-window-mobile:tracking-normal"
          id="settings-title"
        >
          Settings
        </h1>
      </div>
      {children}
    </aside>
  );
}

export function SettingsWindowLayout({ children }: { children: ReactNode }) {
  const [navigationHost, setNavigationHost] = useState<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLElement>(null);
  const value = useMemo(() => ({ navigationHost, contentRef }), [navigationHost]);
  return (
    <SettingsWindowLayoutContext.Provider value={value}>
      <div className="settings-window relative grid settings-window-columns size-full min-h-0 overflow-hidden border-0 rounded-none bg-canvas shadow-none settings-window-narrow:settings-window-columns-narrow settings-window-mobile:grid-cols-1 settings-window-mobile:settings-window-mobile-rows [&_.button]:text-meta-size [&_.button]:whitespace-normal [&_.button\_\_label]:min-w-0 [&_.button\_\_label]:wrap-anywhere [&_.button--prominent]:min-h-control-standard [&_.button--prominent]:px-button-standard">
        <SettingsSidebarFrame>
          <div
            className="settings-sidebar__body flex min-h-0 flex-col gap-dialog-gap"
            data-utility-slot="navigation"
            ref={setNavigationHost}
          >
            <div
              aria-hidden="true"
              className="settings-navigation-placeholder grid gap-dialog-gap [&:not(:only-child)]:hidden"
            >
              <Skeleton className="h-control-standard" />
              <div className="grid gap-settings-nav-gap">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton className="h-control-standard" key={i} />
                ))}
              </div>
            </div>
          </div>
        </SettingsSidebarFrame>
        <section
          aria-label="Settings content"
          className="settings-content min-h-0 overflow-y-auto overscroll-contain scrollbar-gutter-stable px-settings-content-inset pt-settings-content-top pb-settings-content-bottom settings-window-narrow:px-settings-content-narrow-inset settings-window-mobile:px-dialog-gap settings-window-mobile:pt-settings-content-narrow-inset settings-window-mobile:pb-settings-row-standard settings-window-short:pt-settings-content-short-top settings-window-short:pb-settings-content-short-bottom [&_[data-utility-stage=loading]]:absolute [&_[data-utility-stage=loading]]:inset-0 has-[[data-utility-stage=loading]]:relative has-[[data-utility-stage=loading]]:scrollbar-gutter-auto"
          data-utility-slot="content"
          ref={contentRef}
        >
          {children}
        </section>
      </div>
    </SettingsWindowLayoutContext.Provider>
  );
}
