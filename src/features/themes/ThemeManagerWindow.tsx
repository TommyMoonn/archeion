import { useEffect, useState } from "react";

import { Button } from "../../components/Button";
import { SkipLink, THEME_MANAGER_MAIN_CONTENT_ID } from "../../components/SkipLink";
import { WindowTitlebar } from "../../components/WindowTitlebar";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import { ThemeManagerSurface, type ThemeManagerServices } from "./ThemeManagerSurface";

type InitializationState = "loading" | "ready" | "error";

type ThemeManagerWindowProps = Readonly<{
  services?: ThemeManagerServices;
}>;

export function ThemeManagerWindow({ services }: ThemeManagerWindowProps = {}) {
  const [initializationState, setInitializationState] = useState<InitializationState>("loading");
  const [initializationAttempt, setInitializationAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void appPreferencesStore.initialize().then(
      () => {
        if (active) setInitializationState("ready");
      },
      (error) => {
        console.error("Theme Manager initialization failed", error);
        if (active) setInitializationState("error");
      },
    );
    return () => {
      active = false;
    };
  }, [initializationAttempt]);

  function retryInitialization() {
    setInitializationState("loading");
    setInitializationAttempt((attempt) => attempt + 1);
  }

  return (
    <div className="window-app window-app--theme-manager">
      <SkipLink targetId={THEME_MANAGER_MAIN_CONTENT_ID} />
      <WindowTitlebar canMaximize />
      <div className="window-app__content">
        <main
          aria-busy={initializationState === "loading" ? "true" : undefined}
          className="theme-manager-window-shell"
          id={THEME_MANAGER_MAIN_CONTENT_ID}
          tabIndex={-1}
        >
          {initializationState === "loading" ? (
            <p className="archive-loading" role="status">
              Opening Theme Manager
            </p>
          ) : null}
          {initializationState === "error" ? (
            <section className="reader-status-page" role="alert">
              <h1>Theme Manager could not be loaded</h1>
              <p>Close and reopen Theme Manager, or try again.</p>
              <Button onClick={retryInitialization} variant="secondary">
                Retry
              </Button>
            </section>
          ) : null}
          {initializationState === "ready" ? <ThemeManagerSurface services={services} /> : null}
        </main>
      </div>
    </div>
  );
}
