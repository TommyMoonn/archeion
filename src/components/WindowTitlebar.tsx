import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, X } from "lucide-react";
import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Tooltip } from "./Tooltip";

type WindowTitlebarProps = {
  canMaximize: boolean;
};

let appActionsHost: Element | null = null;
const appActionsHostListeners = new Set<() => void>();

function setAppActionsHost(host: Element | null): void {
  if (appActionsHost === host) return;
  appActionsHost = host;
  appActionsHostListeners.forEach((listener) => listener());
}

function subscribeToAppActionsHost(listener: () => void): () => void {
  appActionsHostListeners.add(listener);
  return () => appActionsHostListeners.delete(listener);
}

export function WindowTitlebarAppActions({
  children,
  presentation,
}: {
  children: ReactNode;
  presentation?: "split";
}) {
  const host = useSyncExternalStore(
    subscribeToAppActionsHost,
    () => appActionsHost,
    () => null,
  );

  return host
    ? createPortal(
        <div
          className={
            presentation === "split"
              ? "window-titlebar__composition window-titlebar__navigation-plane"
              : "window-titlebar__composition"
          }
          data-window-titlebar-presentation={presentation}
        >
          {children}
        </div>,
        host,
      )
    : null;
}

export function WindowTitlebarAppActionsHost() {
  return (
    <div
      className="window-titlebar__app-actions"
      data-window-titlebar-app-actions
      ref={setAppActionsHost}
    />
  );
}

function MaximizeWindowIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <rect height="14" rx="1.5" width="14" x="5" y="5" />
    </svg>
  );
}

function RestoreWindowIcon() {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      viewBox="0 0 24 24"
    >
      <path d="M9 5.5h8.5A1.5 1.5 0 0 1 19 7v8" />
      <rect height="10" rx="1" width="10" x="5" y="9" />
    </svg>
  );
}

function WindowTitlebarControls({
  appWindow,
  canMaximize,
}: {
  appWindow: ReturnType<typeof getCurrentWindow>;
  canMaximize: boolean;
}) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    if (!canMaximize) return;

    let active = true;
    let unlisten: (() => void) | null = null;
    let latestRequest = 0;

    const syncMaximizedState = async () => {
      const request = ++latestRequest;
      try {
        const [nextMaximized, nextFullscreen] = await Promise.all([
          appWindow.isMaximized(),
          appWindow.isFullscreen(),
        ]);
        if (active && request === latestRequest) {
          setMaximized(nextMaximized || nextFullscreen);
        }
      } catch {
        if (active && request === latestRequest) {
          setMaximized(false);
        }
      }
    };

    const subscribe = async () => {
      try {
        const stopListening = await appWindow.onResized(() => {
          void syncMaximizedState();
        });
        if (!active) {
          stopListening();
          return;
        }
        unlisten = stopListening;
      } catch {
        // The initial state query still works if resize events are unavailable.
      }

      await syncMaximizedState();
    };

    void subscribe();

    return () => {
      active = false;
      unlisten?.();
    };
  }, [appWindow, canMaximize]);

  return (
    <div className="window-titlebar__controls" role="group" aria-label="Window controls">
      <Tooltip content="Minimize window" placement="bottom">
        <button
          aria-label="Minimize window"
          onClick={() => void appWindow.minimize()}
          type="button"
        >
          <span
            aria-hidden="true"
            className="window-titlebar__icon"
            data-window-control-icon="minimize"
          >
            <Minus strokeWidth={1.7} />
          </span>
        </button>
      </Tooltip>
      {canMaximize ? (
        <Tooltip content={maximized ? "Restore window" : "Maximize window"} placement="bottom">
          <button
            aria-label="Maximize or restore window"
            data-window-control-state={maximized ? "maximized" : "normal"}
            onClick={() => void appWindow.toggleMaximize()}
            type="button"
          >
            <span
              aria-hidden="true"
              className="window-titlebar__icon"
              data-window-control-icon={maximized ? "restore" : "maximize"}
            >
              {maximized ? <RestoreWindowIcon /> : <MaximizeWindowIcon />}
            </span>
          </button>
        </Tooltip>
      ) : null}
      <Tooltip content="Close window" placement="bottom">
        <button
          aria-label="Close window"
          className="window-titlebar__close"
          onClick={() => void appWindow.close()}
          type="button"
        >
          <span
            aria-hidden="true"
            className="window-titlebar__icon"
            data-window-control-icon="close"
          >
            <X strokeWidth={1.7} />
          </span>
        </button>
      </Tooltip>
    </div>
  );
}

export function WindowTitlebar({ canMaximize }: WindowTitlebarProps) {
  if (!isTauri()) {
    return null;
  }

  const appWindow = getCurrentWindow();

  return (
    <header aria-label="Window titlebar" className="window-titlebar">
      <WindowTitlebarAppActionsHost />
      <div className="window-titlebar__drag-region" data-tauri-drag-region />
      <WindowTitlebarControls appWindow={appWindow} canMaximize={canMaximize} />
    </header>
  );
}
