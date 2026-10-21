import { useMemo, useRef, useState, type ReactNode } from "react";
import { SettingsWindowLayoutContext } from "./settingsWindowLayoutContext";

export function SettingsSidebarFrame({ children }: { children: ReactNode }) {
  return (
    <aside aria-label="Settings navigation" className="settings-sidebar">
      <div className="settings-sidebar__header">
        <p>Archeion</p>
        <h1 id="settings-title">Settings</h1>
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
      <div className="settings-window">
        <SettingsSidebarFrame>
          <div
            className="settings-sidebar__body"
            data-utility-slot="navigation"
            ref={setNavigationHost}
          >
            <div
              aria-hidden="true"
              className="utility-slot-placeholder settings-navigation-placeholder"
            >
              <span />
              <div>
                {Array.from({ length: 8 }, (_, i) => (
                  <span key={i} />
                ))}
              </div>
            </div>
          </div>
        </SettingsSidebarFrame>
        <section
          aria-label="Settings content"
          className="settings-content"
          data-utility-slot="content"
          ref={contentRef}
        >
          {children}
        </section>
      </div>
    </SettingsWindowLayoutContext.Provider>
  );
}
