import {
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";

import {
  transientSurfaceClaimedOutsidePointer,
  activeTransientSurfaceElement,
  useTransientSurfaceOwnership,
} from "../../utils/transientSurfaceOwnership";
import { focusElementIfUsable, isUsableFocusTarget } from "../../utils/focusRestoration";
import {
  ReaderSideSurfaceDismissContext,
  createReaderSideSurfaceDismissController,
} from "./readerSideSurfaceDismissal";

type ReaderSideSurfaceLayerProps = {
  active?: boolean;
  children: ReactNode;
  onDismiss: () => void;
};

export function ReaderSideSurfaceLayer({
  active = true,
  children,
  onDismiss,
}: ReaderSideSurfaceLayerProps) {
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
    active,
    elementRef: layerRef,
    kind: "reader-panel",
    onDismiss: (reason) => {
      if (reason === "escape") controller.dismissTopmost();
    },
  });

  useLayoutEffect(() => {
    if (!active) pointerDownIdRef.current = null;
  }, [active]);

  function containTab(event: ReactKeyboardEvent<HTMLDivElement>) {
    const layer = layerRef.current;
    if (!active || !layer) return;
    const topSurface = activeTransientSurfaceElement();
    const ownsTab =
      topSurface === layer ||
      (topSurface?.dataset.applicationTransient === "details-disclosure" &&
        layer.contains(topSurface));
    if (event.key !== "Tab" || event.defaultPrevented || !ownsTab) return;
    const targets = [
      ...layer.querySelectorAll<HTMLElement>(
        "button, a[href], input, select, textarea, summary, [tabindex]",
      ),
    ].filter((target) => target.tabIndex >= 0 && isUsableFocusTarget(target));
    const first = targets[0];
    const last = targets.at(-1);
    const focused = document.activeElement;
    if (
      !layer.contains(focused) ||
      !targets.includes(focused as HTMLElement) ||
      (event.shiftKey ? focused === first : focused === last)
    ) {
      event.preventDefault();
      focusElementIfUsable(
        (event.shiftKey ? last : first) ??
          layer.querySelector<HTMLElement>(".reader-side-panel:not([hidden])"),
      );
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    pointerDownIdRef.current = null;
    if (
      !active ||
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
    if (active && startedOnBackdrop && event.target === event.currentTarget)
      controller.dismissTopmost();
  }

  function handlePointerCancel(event: ReactPointerEvent<HTMLDivElement>) {
    if (pointerDownIdRef.current === event.pointerId) pointerDownIdRef.current = null;
  }

  return (
    <ReaderSideSurfaceDismissContext.Provider value={controller}>
      <div
        className="reader-side-surface-layer"
        data-closing={!active || undefined}
        inert={!active}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={containTab}
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
