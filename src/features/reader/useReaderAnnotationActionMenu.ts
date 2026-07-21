import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from "react";

import type { Annotation } from "../../types/annotation";

const ACTION_MENU_ESTIMATED_HEIGHT = 168;
const ACTION_MENU_WIDTH = 184;

type FocusRequest = "first" | "recolor" | "selected-color";

export type ReaderAnnotationMenuState = {
  annotation: Annotation;
  mode: "actions" | "colors";
  placement: "above" | "below";
  right: number;
  top: number;
  trigger: HTMLButtonElement;
};

type ReaderAnnotationActionMenuOptions = {
  blocked: boolean;
  panelRef: RefObject<HTMLElement | null>;
};

export function useReaderAnnotationActionMenu({
  blocked,
  panelRef,
}: ReaderAnnotationActionMenuOptions) {
  const menuRef = useRef<HTMLDivElement>(null);
  const focusRequestRef = useRef<FocusRequest>("first");
  const menuStateRef = useRef<ReaderAnnotationMenuState | undefined>(undefined);
  const [menu, setMenu] = useState<ReaderAnnotationMenuState>();

  const publishMenu = useCallback((next: ReaderAnnotationMenuState | undefined) => {
    menuStateRef.current = next;
    setMenu(next);
  }, []);

  useLayoutEffect(() => {
    if (!menu) return;
    const focusRequest = focusRequestRef.current;
    focusRequestRef.current = "first";
    const requestedItem =
      focusRequest === "recolor"
        ? menuRef.current?.querySelector<HTMLButtonElement>("[data-recolor-highlight]")
        : focusRequest === "selected-color"
          ? menuRef.current?.querySelector<HTMLButtonElement>(
              '[role="menuitemradio"][aria-checked="true"]',
            )
          : undefined;
    (requestedItem ?? menuRef.current?.querySelector<HTMLButtonElement>("button"))?.focus();
  }, [menu]);

  const close = useCallback(
    (options: { restoreFocus?: boolean } = {}) => {
      const current = menuStateRef.current;
      publishMenu(undefined);
      if (options.restoreFocus) current?.trigger.focus();
    },
    [publishMenu],
  );

  const open = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>, annotation: Annotation) => {
      if (blocked) return;
      const trigger = event.currentTarget;
      const panelRect = panelRef.current?.getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      if (!panelRect) return;

      const current = menuStateRef.current;
      if (current?.annotation.id === annotation.id) {
        publishMenu(undefined);
        return;
      }

      const availableBelow = panelRect.bottom - triggerRect.bottom;
      const placement =
        availableBelow >= ACTION_MENU_ESTIMATED_HEIGHT ||
        triggerRect.top - panelRect.top < availableBelow
          ? "below"
          : "above";
      const unclampedRight = panelRect.right - triggerRect.right;
      const right = Math.max(8, Math.min(panelRect.width - ACTION_MENU_WIDTH - 8, unclampedRight));

      publishMenu({
        annotation,
        mode: "actions",
        placement,
        right,
        top:
          placement === "below"
            ? triggerRect.bottom - panelRect.top + 4
            : triggerRect.top - panelRect.top - 4,
        trigger,
      });
    },
    [blocked, panelRef, publishMenu],
  );

  const openColors = useCallback(() => {
    const current = menuStateRef.current;
    if (current?.annotation.type !== "highlight") return;
    focusRequestRef.current = "selected-color";
    publishMenu({ ...current, mode: "colors" });
  }, [publishMenu]);

  const returnToActions = useCallback(() => {
    const current = menuStateRef.current;
    if (!current) return;
    focusRequestRef.current = "recolor";
    publishMenu({ ...current, mode: "actions" });
  }, [publishMenu]);

  const handleEscape = useCallback(() => {
    if (menu?.mode === "colors") returnToActions();
    else close({ restoreFocus: true });
  }, [close, menu?.mode, returnToActions]);

  return {
    close,
    handleEscape,
    menu,
    menuRef,
    open,
    openColors,
  };
}

export type ReaderAnnotationActionMenuController = ReturnType<typeof useReaderAnnotationActionMenu>;
