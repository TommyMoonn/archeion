import {
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  type SyntheticEvent,
} from "react";

import {
  useTransientSurfaceOwnership,
  isTopmostTransientSurface,
  type TransientSurfaceKind,
} from "../utils/transientSurfaceOwnership";
import {
  captureFocusReturn,
  claimFocusReturnSurface,
  type FocusReturnRecord,
  focusCapturedReturn,
  focusElementIfUsable,
} from "../utils/focusRestoration";
import { focusPresentationRuntime } from "../app/inputModality";

import { SurfacePresenceContext } from "./modalPresenceContext";
import { waitForModalExit } from "./modalExit";

type UseModalDialogLifecycleOptions = {
  closeOnBackdropClick?: boolean | (() => boolean);
  dialogRef: RefObject<HTMLDialogElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
  resolveInitialFocus?: () => HTMLElement | null;
  focusReturn?: FocusReturnRecord;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
  surfaceKind?: Extract<
    TransientSurfaceKind,
    "app-dialog" | "drawer" | "quick-actions" | "settings"
  >;
};

type ModalDialogLifecycle = {
  suppressFocusRestoration: () => void;
  onCancel: (event: SyntheticEvent<HTMLDialogElement>) => void;
  onClick: (event: MouseEvent<HTMLDialogElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDialogElement>) => void;
};

export function useModalDialogLifecycle({
  closeOnBackdropClick = true,
  dialogRef,
  focusReturn,
  initialFocusRef,
  resolveInitialFocus,
  onClose,
  returnFocusTo,
  surfaceKind = "app-dialog",
}: UseModalDialogLifecycleOptions): ModalDialogLifecycle {
  const presence = useContext(SurfacePresenceContext);
  const register = presence?.register;
  useLayoutEffect(() => register?.(), [register]);
  const closing = presence?.present === false;
  const closingRef = useRef(closing);
  const interruptedFocusRef = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    closingRef.current = closing;
  }, [closing]);
  const requestClose = () => {
    if (!closingRef.current) onClose();
  };
  const pointerStartedOnBackdropRef = useRef(false);
  const restoreFocusFrameRef = useRef<number | null>(null);
  const restoreFocusRef = useRef(true);
  const [focusReturnRecord] = useState(
    () =>
      focusReturn ?? (typeof document !== "undefined" ? captureFocusReturn(returnFocusTo) : null),
  );

  useTransientSurfaceOwnership({
    elementRef: dialogRef,
    kind: surfaceKind,
    modal: true,
    onDismiss: (reason) => {
      if (reason === "escape") requestClose();
    },
    origin: focusReturnRecord?.candidate ?? null,
  });

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    const focusReturn = focusReturnRecord;
    restoreFocusRef.current = true;
    if (restoreFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFocusFrameRef.current);
      restoreFocusFrameRef.current = null;
    }

    if (dialog && !dialog.open) {
      dialog.showModal();
    }
    if (focusReturn) claimFocusReturnSurface(focusReturn, dialog ?? null);
    focusPresentationRuntime.markProgrammatic();
    focusElementIfUsable(resolveInitialFocus?.() ?? initialFocusRef?.current);

    return () => {
      if (dialog?.open) {
        dialog.close();
      }
      restoreFocusFrameRef.current = window.requestAnimationFrame(() => {
        restoreFocusFrameRef.current = null;
        if (restoreFocusRef.current && focusReturn) {
          focusCapturedReturn(focusReturn);
        }
      });
    };
  }, [dialogRef, focusReturnRecord, initialFocusRef, resolveInitialFocus]);

  useLayoutEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousState = dialog.dataset.surfaceState;
    const wasClosing = previousState === "closing";
    if (previousState && wasClosing !== closing) {
      // Reverse from the displayed pose, including Escape during entry and reopen during exit.
      const pose = window.getComputedStyle(dialog);
      dialog.style.setProperty("--surface-from-opacity", pose.opacity);
      dialog.style.setProperty("--surface-from-transform", pose.transform);
    }
    dialog.dataset.surfaceState = closing ? "closing" : "open";
    const panels = [...dialog.children].filter(
      (child): child is HTMLElement => child instanceof HTMLElement,
    );
    for (const panel of panels) panel.inert = closing;
    if (!closing) {
      if (wasClosing && isTopmostTransientSurface(dialog))
        focusElementIfUsable(interruptedFocusRef.current);
      return;
    }
    interruptedFocusRef.current =
      dialog.contains(document.activeElement) && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    // Keep the native top layer, but retire action targets before another input can submit.
    dialog.tabIndex = -1;
    if (dialog.contains(document.activeElement)) dialog.focus({ preventScroll: true });
    const block = (event: Event) => {
      event.preventDefault();
      event.stopPropagation();
    };
    dialog.addEventListener("click", block, true);
    dialog.addEventListener("submit", block, true);
    const cancel = waitForModalExit(dialog, () => presence?.complete());
    return () => {
      cancel();
      dialog.removeEventListener("click", block, true);
      dialog.removeEventListener("submit", block, true);
      for (const panel of panels) panel.inert = false;
    };
  }, [closing, dialogRef, presence]);

  return {
    suppressFocusRestoration: () => {
      restoreFocusRef.current = false;
    },
    onCancel: (event) => {
      event.preventDefault();
      requestClose();
    },
    onClick: (event) => {
      if (
        (typeof closeOnBackdropClick === "function"
          ? closeOnBackdropClick()
          : closeOnBackdropClick) &&
        pointerStartedOnBackdropRef.current &&
        event.target === event.currentTarget
      ) {
        requestClose();
      }
      pointerStartedOnBackdropRef.current = false;
    },
    onPointerDown: (event) => {
      pointerStartedOnBackdropRef.current = event.target === event.currentTarget;
    },
  };
}
