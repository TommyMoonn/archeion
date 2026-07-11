import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef, useState } from "react";

import {
  importDropDestinationAtPoint,
  importDragAutoScrollDelta,
  validateExternalEpubDrop,
  type ImportDropTarget,
} from "./externalEpubDrop";

type ExternalEpubDropInput = {
  onDrop: (sourcePaths: string[], destinationValue: string) => void;
  onInvalidDrop: (message: string) => void;
};

export function useExternalEpubDrop({ onDrop, onInvalidDrop }: ExternalEpubDropInput) {
  const [activeTarget, setActiveTarget] = useState<ImportDropTarget | null>(null);
  const activeTargetRef = useRef<ImportDropTarget | null>(null);
  const validDragRef = useRef(false);
  const callbacksRef = useRef({ onDrop, onInvalidDrop });
  const autoScrollFrameRef = useRef<number | null>(null);
  const autoScrollPointRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    callbacksRef.current = { onDrop, onInvalidDrop };
  }, [onDrop, onInvalidDrop]);

  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;

    function publishTarget(target: ImportDropTarget | null) {
      if (activeTargetRef.current?.id === target?.id) return;
      activeTargetRef.current = target;
      setActiveTarget(target);
    }

    function clearDrag() {
      validDragRef.current = false;
      publishTarget(null);
      autoScrollPointRef.current = null;
      if (autoScrollFrameRef.current !== null) {
        window.cancelAnimationFrame(autoScrollFrameRef.current);
        autoScrollFrameRef.current = null;
      }
    }

    function scheduleAutoScroll(x: number, y: number) {
      autoScrollPointRef.current = { x, y };
      if (autoScrollFrameRef.current !== null) return;

      autoScrollFrameRef.current = window.requestAnimationFrame(() => {
        autoScrollFrameRef.current = null;
        const point = autoScrollPointRef.current;
        if (!point || !validDragRef.current) return;

        const scrollers = document.querySelectorAll<HTMLElement>(
          ".sidebar__folder-scroll, .page-shell",
        );
        for (const scroller of scrollers) {
          const bounds = scroller.getBoundingClientRect();
          if (point.x < bounds.left || point.x > bounds.right) continue;
          const delta = importDragAutoScrollDelta(point.y, bounds.top, bounds.bottom);
          if (delta !== 0) {
            scroller.scrollTop += delta;
            break;
          }
        }
      });
    }

    void Promise.all([getCurrentWindow().scaleFactor(), Promise.resolve(getCurrentWebview())])
      .then(([scaleFactor, webview]) =>
        webview.onDragDropEvent(({ payload }) => {
          if (payload.type === "leave") {
            clearDrag();
            return;
          }

          const logicalPosition = payload.position.toLogical(scaleFactor);
          if (payload.type === "enter") {
            validDragRef.current = validateExternalEpubDrop(payload.paths).valid;
          }

          if (payload.type === "over" || payload.type === "enter") {
            if (validDragRef.current) {
              scheduleAutoScroll(logicalPosition.x, logicalPosition.y);
            }
            publishTarget(
              validDragRef.current
                ? importDropDestinationAtPoint(logicalPosition.x, logicalPosition.y)
                : null,
            );
            return;
          }

          const validation = validateExternalEpubDrop(payload.paths);
          const target = importDropDestinationAtPoint(logicalPosition.x, logicalPosition.y);
          clearDrag();
          if (!validation.valid) {
            callbacksRef.current.onInvalidDrop(validation.message);
          } else if (!target) {
            callbacksRef.current.onInvalidDrop("Drop EPUB files onto the library or a folder.");
          } else {
            callbacksRef.current.onDrop(validation.sourcePaths, target.destination);
          }
        }),
      )
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      clearDrag();
      unlisten?.();
    };
  }, []);

  return { activeTarget };
}
