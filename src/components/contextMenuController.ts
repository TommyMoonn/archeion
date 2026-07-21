import { useCallback, useMemo, useState } from "react";
import { flushSync } from "react-dom";

export type ContextMenuPointAnchor = {
  type: "point";
  x: number;
  y: number;
};

export type ContextMenuElementAnchor = {
  element: HTMLElement;
  type: "element";
};

export type ContextMenuAnchor = ContextMenuPointAnchor | ContextMenuElementAnchor;

export type ContextMenuInvocation = {
  anchor: ContextMenuAnchor;
  focusTarget: "first" | "last" | null;
  restoreFocusTo: HTMLElement | null;
  triggerElement: HTMLElement | null;
};

type CloseContextMenuOptions = {
  restoreFocus?: boolean;
};

type ContextMenuPointerEvent = {
  clientX: number;
  clientY: number;
  preventDefault: () => void;
  stopPropagation: () => void;
};

type ContextMenuKeyboardEvent = {
  currentTarget: HTMLElement;
  key: string;
  preventDefault: () => void;
  shiftKey: boolean;
  stopPropagation: () => void;
};

export function isContextMenuKey(event: { key: string; shiftKey: boolean }): boolean {
  return event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey);
}

export function openContextMenuFromPointer(
  controller: ContextMenuController,
  event: ContextMenuPointerEvent,
  fallbackFocusTarget: HTMLElement | null,
  enabled = true,
): void {
  event.preventDefault();
  event.stopPropagation();
  if (!enabled) return;

  const activeElement = document.activeElement;
  controller.openAtPoint(
    { x: event.clientX, y: event.clientY },
    {
      restoreFocusTo:
        activeElement instanceof HTMLElement && activeElement !== document.body
          ? activeElement
          : fallbackFocusTarget,
    },
  );
}

export function openContextMenuFromKeyboard(
  controller: ContextMenuController,
  event: ContextMenuKeyboardEvent,
  enabled = true,
): boolean {
  if (!isContextMenuKey(event)) return false;

  event.preventDefault();
  event.stopPropagation();
  if (!enabled) return true;

  controller.openAtElement(event.currentTarget, {
    focusTarget: "first",
    restoreFocusTo: event.currentTarget,
  });
  return true;
}

export type ContextMenuController = {
  close: (options?: CloseContextMenuOptions) => void;
  invocation: ContextMenuInvocation | null;
  isOpen: boolean;
  openAtElement: (
    element: HTMLElement,
    options?: {
      focusTarget?: ContextMenuInvocation["focusTarget"];
      restoreFocusTo?: HTMLElement | null;
      triggerElement?: HTMLElement | null;
    },
  ) => void;
  openAtPoint: (
    point: { x: number; y: number },
    options?: {
      focusTarget?: ContextMenuInvocation["focusTarget"];
      restoreFocusTo?: HTMLElement | null;
    },
  ) => void;
  runAction: (action: () => void) => void;
};

export function useContextMenuController(): ContextMenuController {
  const [invocation, setInvocation] = useState<ContextMenuInvocation | null>(null);

  const close = useCallback(
    (options: CloseContextMenuOptions = {}) => {
      if (!invocation) return;

      if (options.restoreFocus) {
        flushSync(() => setInvocation(null));
        if (invocation.restoreFocusTo?.isConnected) invocation.restoreFocusTo.focus();
        return;
      }

      setInvocation(null);
    },
    [invocation],
  );

  const openAtElement = useCallback(
    (
      element: HTMLElement,
      options: {
        focusTarget?: ContextMenuInvocation["focusTarget"];
        restoreFocusTo?: HTMLElement | null;
        triggerElement?: HTMLElement | null;
      } = {},
    ) => {
      setInvocation({
        anchor: { element, type: "element" },
        focusTarget: options.focusTarget ?? null,
        restoreFocusTo: options.restoreFocusTo ?? element,
        triggerElement: options.triggerElement ?? null,
      });
    },
    [],
  );

  const openAtPoint = useCallback(
    (
      point: { x: number; y: number },
      options: {
        focusTarget?: ContextMenuInvocation["focusTarget"];
        restoreFocusTo?: HTMLElement | null;
      } = {},
    ) => {
      setInvocation({
        anchor: { type: "point", x: point.x, y: point.y },
        focusTarget: options.focusTarget ?? null,
        restoreFocusTo: options.restoreFocusTo ?? null,
        triggerElement: null,
      });
    },
    [],
  );

  const runAction = useCallback((action: () => void) => {
    flushSync(() => setInvocation(null));
    action();
  }, []);

  return useMemo(
    () => ({
      close,
      invocation,
      isOpen: invocation !== null,
      openAtElement,
      openAtPoint,
      runAction,
    }),
    [close, invocation, openAtElement, openAtPoint, runAction],
  );
}
