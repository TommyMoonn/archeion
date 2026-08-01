import {
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

type UseModalDialogLifecycleOptions = {
  closeOnBackdropClick?: boolean;
  dialogRef: RefObject<HTMLDialogElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
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
  onClose,
  returnFocusTo,
  surfaceKind = "app-dialog",
}: UseModalDialogLifecycleOptions): ModalDialogLifecycle {
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
      if (reason === "escape") onClose();
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
    focusElementIfUsable(initialFocusRef?.current);

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
  }, [dialogRef, focusReturnRecord, initialFocusRef]);

  return {
    suppressFocusRestoration: () => {
      restoreFocusRef.current = false;
    },
    onCancel: (event) => {
      event.preventDefault();
      onClose();
    },
    onClick: (event) => {
      if (
        closeOnBackdropClick &&
        pointerStartedOnBackdropRef.current &&
        event.target === event.currentTarget
      ) {
        onClose();
      }
      pointerStartedOnBackdropRef.current = false;
    },
    onPointerDown: (event) => {
      pointerStartedOnBackdropRef.current = event.target === event.currentTarget;
    },
  };
}
