import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "@phosphor-icons/react";
import { useSyncExternalStore, type ReactNode } from "react";
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

export function WindowTitlebarAppActions({ children }: { children: ReactNode }) {
  const host = useSyncExternalStore(
    subscribeToAppActionsHost,
    () => appActionsHost,
    () => null,
  );

  return host ? createPortal(children, host) : null;
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

export function WindowTitlebar({ canMaximize }: WindowTitlebarProps) {
  if (!isTauri()) {
    return null;
  }

  const appWindow = getCurrentWindow();

  return (
    <header aria-label="Window titlebar" className="window-titlebar">
      <WindowTitlebarAppActionsHost />
      <div className="window-titlebar__drag-region" data-tauri-drag-region />
      <div className="window-titlebar__controls" role="group" aria-label="Window controls">
        <Tooltip content="Minimize window" placement="bottom">
          <button
            aria-label="Minimize window"
            onClick={() => void appWindow.minimize()}
            type="button"
          >
            <span aria-hidden="true" className="icon-slot icon-slot--compact">
              <Minus />
            </span>
          </button>
        </Tooltip>
        {canMaximize ? (
          <Tooltip content="Maximize or restore window" placement="bottom">
            <button
              aria-label="Maximize or restore window"
              onClick={() => void appWindow.toggleMaximize()}
              type="button"
            >
              <span aria-hidden="true" className="icon-slot icon-slot--compact">
                <Square />
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
            <span aria-hidden="true" className="icon-slot icon-slot--compact">
              <X />
            </span>
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
