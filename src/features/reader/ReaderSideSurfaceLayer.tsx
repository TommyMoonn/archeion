import {
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  transientSurfaceClaimedOutsidePointer,
  useTransientSurfaceOwnership,
} from "../../utils/transientSurfaceOwnership";
import {
  ReaderSideSurfaceDismissContext,
  createReaderSideSurfaceDismissController,
} from "./readerSideSurfaceDismissal";

type ReaderSideSurfaceLayerProps = {
  children: ReactNode;
  onDismiss: () => void;
};

export function ReaderSideSurfaceLayer({ children, onDismiss }: ReaderSideSurfaceLayerProps) {
  const layerRef = useRef<HTMLDivElement>(null);
  const pointerDownIdRef = useRef<number | null>(null);
  const parentController = useContext(ReaderSideSurfaceDismissContext);
  const [localController] = useState(createReaderSideSurfaceDismissController);
  const controller = parentController ?? localController;

  useLayoutEffect(() => {
    if (parentController) return;
    localController.setFallback(() => {
      onDismiss();
      return true;
    });
    return () => localController.setFallback(null);
  }, [localController, onDismiss, parentController]);

  useTransientSurfaceOwnership({
    elementRef: layerRef,
    kind: "reader-panel",
    onDismiss: (reason) => {
      if (reason === "escape") controller.dismissTopmost();
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
    if (startedOnBackdrop && event.target === event.currentTarget) controller.dismissTopmost();
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointerDownIdRef.current === event.pointerId) pointerDownIdRef.current = null;
  }

  return (
    <ReaderSideSurfaceDismissContext.Provider value={controller}>
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
