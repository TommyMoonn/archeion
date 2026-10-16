import { useEffect } from "react";

import {
  navigationPanelModule,
  searchPanelModule,
  annotationsPanelModule,
} from "./readerPanelModules";

/** An idle slot is requested only after first display. No module owns publication data. */
export function useReaderPanelPrewarm(ready: boolean, sessionIdentity: unknown) {
  useEffect(() => {
    if (!ready || !sessionIdentity) return;
    let current = true;
    const warm = () => {
      if (!current) return;
      void navigationPanelModule.preload();
      void searchPanelModule.preload();
      void annotationsPanelModule.preload();
    };
    const idle = typeof window.requestIdleCallback === "function";
    const handle = idle ? window.requestIdleCallback(warm) : window.setTimeout(warm, 250);
    return () => {
      current = false;
      if (idle) window.cancelIdleCallback(handle);
      else window.clearTimeout(handle);
    };
  }, [ready, sessionIdentity]);
}
