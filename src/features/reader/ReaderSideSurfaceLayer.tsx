import { useCallback, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";

import {
  transientSurfaceClaimedOutsidePointer,
  useTransientSurfaceOwnership,
} from "../../utils/transientSurfaceOwnership";
import {
  ReaderSideSurfaceDismissContext,
  type ReaderSideSurfaceDismissHandler,
  type ReaderSideSurfaceDismissRegistration,
} from "./readerSideSurfaceDismissal";

type ReaderSideSurfaceLayerProps = {
  children: ReactNode;
  onDismiss: () => void;
};

export function ReaderSideSurfaceLayer({ children, onDismiss }: ReaderSideSurfaceLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const pointerDownIdRef = useRef<number | null>(null);
  const dismissHandlersRef = useRef<ReaderSideSurfaceDismissHandler[]>([]);

  const registerDismissHandler = useCallback<ReaderSideSurfaceDismissRegistration>((handler) => {
    dismissHandlersRef.current.push(handler);
    return () => {
      const index = dismissHandlersRef.current.lastIndexOf(handler);
      if (index >= 0) dismissHandlersRef.current.splice(index, 1);
    };
  }, []);

  const dismissTopmost = useCallback(() => {
    const handler = dismissHandlersRef.current.at(-1);
    if (!handler?.()) onDismiss();
  }, [onDismiss]);

  useTransientSurfaceOwnership({
    elementRef: layerRef,
    kind: "reader-panel",
    onDismiss: (reason) => {
      if (reason === "escape") dismissTopmost();
    },
  });

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    pointerDownIdRef.current = null;
    if (
      event.button !== 0 ||
      event.target !== event.currentTarget ||
      transientSurfaceClaimedOutsidePointer(event.nativeEvent)
    ) {
      return;
    }
    pointerDownIdRef.current = event.pointerId;
  }

  function handlePointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const startedOnBackdrop = pointerDownIdRef.current === event.pointerId;
    pointerDownIdRef.current = null;
    if (startedOnBackdrop && event.target === event.currentTarget) dismissTopmost();
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointerDownIdRef.current === event.pointerId) pointerDownIdRef.current = null;
  }

  return (
    <ReaderSideSurfaceDismissContext.Provider value={registerDismissHandler}>
      <div
        className="reader-side-surface-layer"
        onPointerCancel={handlePointerCancel}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        ref={layerRef}
      >
        {children}
      </div>
    </ReaderSideSurfaceDismissContext.Provider>
  );
}
