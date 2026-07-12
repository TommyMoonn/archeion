import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

import archeionIcon from "../assets/brand/archeion-icon-128.png";
import { useWindowFrameStylePreference } from "../stores/appPreferencesStore";
import type { WindowFrameStyle } from "../types/appSettings";

function setAppliedFrame(mode: WindowFrameStyle | "browser") {
  document.documentElement.dataset.windowFrameApplied = mode;
}

type WindowFrameProps = {
  frameStyleOverride?: WindowFrameStyle;
};

export function WindowFrame({ frameStyleOverride }: WindowFrameProps = {}) {
  const preferredWindowFrameStyle = useWindowFrameStylePreference();
  const windowFrameStyle = frameStyleOverride ?? preferredWindowFrameStyle;
  const [appliedMode, setAppliedMode] = useState<WindowFrameStyle>(windowFrameStyle);
  const desktop = isTauri();

  useEffect(() => {
    if (!desktop) {
      setAppliedFrame("browser");
      return;
    }

    let cancelled = false;
    const appWindow = getCurrentWindow();
    void appWindow
      .setDecorations(windowFrameStyle === "native")
      .then(() => {
        if (!cancelled) {
          setAppliedMode(windowFrameStyle);
          setAppliedFrame(windowFrameStyle);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setAppliedMode("hidden");
          setAppliedFrame("hidden");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [desktop, windowFrameStyle]);

  if (!desktop || appliedMode === "native") {
    return null;
  }

  const appWindow = getCurrentWindow();
  const isArcheionFrame = appliedMode === "archeion";

  return (
    <header
      aria-label={isArcheionFrame ? "Archeion window frame" : "Hidden window frame"}
      className="window-titlebar"
      data-mode={appliedMode}
    >
      <div
        className="window-titlebar__drag-region"
        data-tauri-drag-region
        onDoubleClick={() => void appWindow.toggleMaximize()}
      >
        {isArcheionFrame ? (
          <div className="window-titlebar__identity" data-tauri-drag-region>
            <img alt="" aria-hidden="true" className="window-titlebar__icon" src={archeionIcon} />
            <span>Archeion</span>
          </div>
        ) : null}
      </div>
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
        <button
          aria-label="Maximize window"
          title="Maximize window"
          onClick={() => void appWindow.toggleMaximize()}
          type="button"
        >
          <span aria-hidden="true" className="icon-slot icon-slot--compact">
            <Square />
          </span>
        </button>
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
