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
import {
  currentFocusOrigin,
  focusElementIfUsable,
  shouldRestoreSurfaceFocus,
} from "../utils/focusRestoration";

type UseModalDialogLifecycleOptions = {
  closeOnBackdropClick?: boolean;
  dialogRef: RefObject<HTMLDialogElement | null>;
  initialFocusRef?: RefObject<HTMLElement | null>;
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
  initialFocusRef,
  onClose,
  returnFocusTo,
  surfaceKind = "app-dialog",
}: UseModalDialogLifecycleOptions): ModalDialogLifecycle {
  const pointerStartedOnBackdropRef = useRef(false);
  const restoreFocusFrameRef = useRef<number | null>(null);
  const restoreFocusRef = useRef(true);
  const returnFocusRef = useRef<HTMLElement | null>(
    returnFocusTo !== undefined
      ? returnFocusTo
      : typeof document !== "undefined"
        ? currentFocusOrigin(document)
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
    const ownerDocument = dialog?.ownerDocument ?? document;
    restoreFocusRef.current = true;
    if (restoreFocusFrameRef.current !== null) {
      window.cancelAnimationFrame(restoreFocusFrameRef.current);
      restoreFocusFrameRef.current = null;
    }

    if (dialog && !dialog.open) {
      dialog.showModal();
    }
    focusElementIfUsable(initialFocusRef?.current);

    return () => {
      if (dialog?.open) {
        dialog.close();
      }
      restoreFocusFrameRef.current = window.requestAnimationFrame(() => {
        restoreFocusFrameRef.current = null;
        if (
          restoreFocusRef.current &&
          shouldRestoreSurfaceFocus(dialog, returnFocus, ownerDocument)
        ) {
          focusElementIfUsable(returnFocus);
        }
      });
    };
  }, [dialogRef, initialFocusRef]);

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
