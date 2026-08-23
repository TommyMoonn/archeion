import { useEffect, useState } from "react";

import { Button } from "../../components/Button";
import { SETTINGS_MAIN_CONTENT_ID, SkipLink } from "../../components/SkipLink";
import { WindowTitlebar } from "../../components/WindowTitlebar";
import { appPreferencesStore } from "../../stores/appPreferencesStore";
import { QuickActionsProvider } from "../quick-actions/QuickActionsProvider";
import { SettingsSurface } from "./SettingsSurface";

type InitializationState = "loading" | "ready" | "error";

export function SettingsWindow() {
  const [initializationState, setInitializationState] = useState<InitializationState>("loading");
  const [initializationAttempt, setInitializationAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    void appPreferencesStore.initialize().then(
      () => {
        if (active) setInitializationState("ready");
      },
      (error) => {
        console.error("Settings initialization failed", error);
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
    <div className="window-app window-app--settings">
      <SkipLink targetId={SETTINGS_MAIN_CONTENT_ID} />
      <WindowTitlebar canMaximize />
      <div className="window-app__content">
        <main
          aria-busy={initializationState === "loading" ? "true" : undefined}
          className="settings-window-shell"
          id={SETTINGS_MAIN_CONTENT_ID}
          tabIndex={-1}
        >
          {initializationState === "loading" ? (
            <p className="archive-loading" role="status">
              Opening Settings
            </p>
          ) : null}
          {initializationState === "error" ? (
            <section className="reader-status-page" role="alert">
              <h1>Settings could not be loaded</h1>
              <p>Close and reopen Settings, or try again.</p>
              <Button onClick={retryInitialization} variant="secondary">
                Retry
              </Button>
            </section>
          ) : null}
          {initializationState === "ready" ? (
            <QuickActionsProvider>
              <SettingsSurface archiveAccess="unavailable" standalone />
            </QuickActionsProvider>
          ) : null}
        </main>
      </div>
    </div>
  );
}
