import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import type { HighlightAnnotation } from "../../types/annotation";
import { focusElementIfRestorationOwned } from "../../utils/focusRestoration";
import {
  normalizeClientRect,
  type ClientRect,
  type HighlightPaletteAnchor,
} from "./readerHighlightPaletteAnchor";
import type { ReaderContentDocumentAccess } from "./readerContentDocumentRegistry";

export type ReaderTextSelection = {
  cfiRange: string;
  chapterHref?: string;
  contextAfter?: string;
  contextBefore?: string;
  selectedText: string;
};

export type HighlightInteractionMenu = {
  anchor: HighlightPaletteAnchor;
  anchorRect: ClientRect;
  existingHighlight?: HighlightAnnotation;
  selection: ReaderTextSelection;
};

type UseHighlightPaletteControllerOptions = {
  containerRef: RefObject<HTMLDivElement | null>;
  onDismiss: () => void;
  paletteRef: RefObject<HTMLDivElement | null>;
  registry: ReaderContentDocumentAccess;
  viewerRef: RefObject<HTMLDivElement | null>;
};

export type HighlightPaletteController = {
  dismiss: (restoreFocus?: boolean) => void;
  getCurrent: () => HighlightInteractionMenu | null;
  handleDocumentRemoved: (document: Document) => void;
  handleEscape: () => boolean;
  handlePointerDown: () => void;
  handleSelectionCollapsed: (document: Document) => void;
  menu: HighlightInteractionMenu | null;
  open: (menu: HighlightInteractionMenu) => void;
  paletteViewport: ClientRect;
  refreshAnchor: () => void;
};

function windowViewport(): ClientRect {
  return {
    bottom: window.innerHeight,
    height: window.innerHeight,
    left: 0,
    right: window.innerWidth,
    top: 0,
    width: window.innerWidth,
  };
}

export function useHighlightPaletteController({
  containerRef,
  onDismiss,
  paletteRef,
  registry,
  viewerRef,
}: UseHighlightPaletteControllerOptions): HighlightPaletteController {
  const menuRef = useRef<HighlightInteractionMenu | null>(null);
  const [menu, setMenu] = useState<HighlightInteractionMenu | null>(null);
  const [paletteViewport, setPaletteViewport] = useState<ClientRect>(windowViewport);

  const readPaletteViewport = useCallback(
    () => normalizeClientRect(viewerRef.current?.getBoundingClientRect()) ?? windowViewport(),
    [viewerRef],
  );

  const dismiss = useCallback(
    (restoreFocus = true) => {
      const dismissedMenu = menuRef.current;
      const closingSurface = paletteRef.current;
      const focusTarget = restoreFocus ? dismissedMenu?.anchor.focusTarget : undefined;
      onDismiss();
      menuRef.current = null;
      setMenu(null);
      if (focusTarget) {
        window.requestAnimationFrame(() =>
          focusElementIfRestorationOwned(focusTarget, {
            closingSurface,
            invalidatedOrigin: closingSurface,
            requestIsCurrent: () => menuRef.current === null,
          }),
        );
      }
    },
    [onDismiss, paletteRef],
  );

  const open = useCallback(
    (nextMenu: HighlightInteractionMenu) => {
      menuRef.current = nextMenu;
      setPaletteViewport(readPaletteViewport());
      setMenu(nextMenu);
    },
    [readPaletteViewport],
  );

  const refreshAnchor = useCallback(() => {
    const current = menuRef.current;
    if (!current) return;
    registry.pruneDisconnected();
    const anchorRect = current.anchor.resolveRect();
    if (!anchorRect || !viewerRef.current?.isConnected) {
      dismiss(false);
      return;
    }
    const nextMenu = { ...current, anchorRect };
    menuRef.current = nextMenu;
    setPaletteViewport(readPaletteViewport());
    setMenu(nextMenu);
  }, [dismiss, readPaletteViewport, registry, viewerRef]);

  useEffect(() => {
    if (!menu?.anchor) return;
    const frame = window.requestAnimationFrame(() =>
      paletteRef.current?.querySelector("button")?.focus(),
    );
    return () => window.cancelAnimationFrame(frame);
  }, [menu?.anchor, paletteRef]);

  useLayoutEffect(() => {
    const anchor = menu?.anchor;
    if (!anchor) return;

    const sourceWindow = anchor.document.defaultView;
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(refreshAnchor);
    if (viewerRef.current) observer?.observe(viewerRef.current);
    let frame = sourceWindow?.frameElement;
    while (frame) {
      observer?.observe(frame);
      frame = frame.ownerDocument.defaultView?.frameElement ?? null;
    }
    const mutations =
      typeof MutationObserver === "undefined" || !containerRef.current
        ? undefined
        : new MutationObserver(refreshAnchor);
    if (containerRef.current) {
      mutations?.observe(containerRef.current, {
        attributes: true,
        childList: true,
        subtree: true,
      });
    }
    const onPageHide = () => dismiss(false);
    window.addEventListener("resize", refreshAnchor);
    document.addEventListener("scroll", refreshAnchor, true);
    anchor.document.addEventListener("scroll", refreshAnchor, true);
    sourceWindow?.addEventListener("pagehide", onPageHide);
    return () => {
      observer?.disconnect();
      mutations?.disconnect();
      window.removeEventListener("resize", refreshAnchor);
      document.removeEventListener("scroll", refreshAnchor, true);
      anchor.document.removeEventListener("scroll", refreshAnchor, true);
      sourceWindow?.removeEventListener("pagehide", onPageHide);
    };
  }, [containerRef, dismiss, menu?.anchor, refreshAnchor, viewerRef]);

  const getCurrent = useCallback(() => menuRef.current, []);
  const handleDocumentRemoved = useCallback(
    (document: Document) => {
      if (menuRef.current?.anchor.document === document) dismiss(false);
    },
    [dismiss],
  );
  const handleSelectionCollapsed = useCallback(
    (document: Document) => {
      if (menuRef.current?.anchor.document === document) dismiss(false);
    },
    [dismiss],
  );
  const handleEscape = useCallback(() => {
    if (!menuRef.current) return false;
    dismiss();
    return true;
  }, [dismiss]);
  const handlePointerDown = useCallback(() => dismiss(false), [dismiss]);

  return {
    dismiss,
    getCurrent,
    handleDocumentRemoved,
    handleEscape,
    handlePointerDown,
    handleSelectionCollapsed,
    menu,
    open,
    paletteViewport,
    refreshAnchor,
  };
}
