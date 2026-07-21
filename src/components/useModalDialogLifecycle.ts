import {
  useEffect,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type RefObject,
  type SyntheticEvent,
} from "react";

import {
  useTransientSurfaceOwnership,
  type TransientSurfaceKind,
} from "../utils/transientSurfaceOwnership";

type UseModalDialogLifecycleOptions = {
  closeOnBackdropClick?: boolean;
  dialogRef: RefObject<HTMLDialogElement | null>;
  onClose: () => void;
  surfaceKind?: Extract<
    TransientSurfaceKind,
    "app-dialog" | "drawer" | "quick-actions" | "settings"
  >;
};

type ModalDialogLifecycle = {
  onCancel: (event: SyntheticEvent<HTMLDialogElement>) => void;
  onClick: (event: MouseEvent<HTMLDialogElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLDialogElement>) => void;
};

export function useModalDialogLifecycle({
  closeOnBackdropClick = true,
  dialogRef,
  onClose,
  surfaceKind = "app-dialog",
}: UseModalDialogLifecycleOptions): ModalDialogLifecycle {
  const pointerStartedOnBackdropRef = useRef(false);
  const restoreFocusFrameRef = useRef<number | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );

  useTransientSurfaceOwnership({
    elementRef: dialogRef,
    kind: surfaceKind,
    modal: true,
    onDismiss: (reason) => {
      if (reason === "escape") onClose();
    },
    originRef: returnFocusRef,
  });

  useEffect(() => {
    const dialog = dialogRef.current;
    const returnFocus = returnFocusRef.current;
    if (restoreFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFocusFrameRef.current);
      restoreFocusFrameRef.current = null;
    }

    if (dialog && !dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (dialog?.open) {
        dialog.close();
      }
      restoreFocusFrameRef.current = window.requestAnimationFrame(() => {
        restoreFocusFrameRef.current = null;
        if (returnFocus?.isConnected) {
          returnFocus.focus({ preventScroll: true });
        }
      });
    };
  }, [dialogRef]);

  return {
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
