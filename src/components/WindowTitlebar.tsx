import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "@phosphor-icons/react";

type WindowTitlebarProps = {
  canMaximize: boolean;
};

export function WindowTitlebar({ canMaximize }: WindowTitlebarProps) {
  if (!isTauri()) {
    return null;
  }

  const appWindow = getCurrentWindow();

  return (
    <header aria-label="Window titlebar" className="window-titlebar">
      <div className="window-titlebar__drag-region" data-tauri-drag-region />
      <div className="window-titlebar__controls" role="group" aria-label="Window controls">
        <button
          aria-label="Minimize window"
          title="Minimize window"
          onClick={() => void appWindow.minimize()}
          type="button"
        >
          <span aria-hidden="true" className="icon-slot icon-slot--compact">
            <Minus />
          </span>
        </button>
        {canMaximize ? (
          <button
            aria-label="Maximize or restore window"
            title="Maximize or restore window"
            onClick={() => void appWindow.toggleMaximize()}
            type="button"
          >
            <span aria-hidden="true" className="icon-slot icon-slot--compact">
              <Square />
            </span>
          </button>
        ) : null}
        <button
          aria-label="Close window"
          title="Close window"
          className="window-titlebar__close"
          onClick={() => void appWindow.close()}
          type="button"
        >
          <span aria-hidden="true" className="icon-slot icon-slot--compact">
            <X />
          </span>
        </button>
      </div>
    </header>
  );
}
