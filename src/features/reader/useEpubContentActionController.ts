import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

import type { EpubSessionSnapshot } from "./useEpubSession";
import {
  classifyEpubLink,
  epubSemanticsFromElement,
  findEpubFragmentTarget,
  normalizedEpubDocumentHref,
  targetSemanticsForElement,
  type EpubContentAction,
} from "./epubContentActions";
import { resolveEpubFootnote, type ResolvedEpubFootnote } from "./epubFootnoteResolver";
import {
  contentActionAnchorForElement,
  readerViewportRect,
  type ReaderContentActionAnchor,
} from "./readerContentActionAnchor";
import type {
  ReaderContentDocumentContext,
  ReaderContentDocumentRegistry,
} from "./readerContentDocumentRegistry";
import type { ClientRect } from "./readerHighlightPaletteAnchor";
import { openExternalEpubLink } from "./openExternalEpubLink";

export type ReaderFootnoteState = Readonly<{
  anchor: ReaderContentActionAnchor;
  anchorRect: ClientRect;
  content?: ResolvedEpubFootnote;
  message?: string;
  viewportRect: ClientRect;
}>;

export type ReaderExternalLinkState = Readonly<{
  anchor: ReaderContentActionAnchor;
  error?: string;
  host: string;
  opening: boolean;
  url: string;
}>;

type UseEpubContentActionControllerOptions = {
  getSession: () => EpubSessionSnapshot | null;
  navigateToTarget: (target: string) => Promise<boolean>;
  onInteraction: () => void;
  registry: ReaderContentDocumentRegistry;
  viewerRef: RefObject<HTMLDivElement | null>;
};

export type EpubContentActionController = {
  clearFeedback: () => void;
  confirmExternal: () => void;
  dismissExternal: (restoreFocus?: boolean) => void;
  dismissFootnote: (restoreFocus?: boolean) => void;
  external: ReaderExternalLinkState | null;
  feedback: string | null;
  footnote: ReaderFootnoteState | null;
  handleContentClick: (event: MouseEvent, context: ReaderContentDocumentContext) => boolean;
  handleContentPointerDown: (event: PointerEvent, context: ReaderContentDocumentContext) => boolean;
  handleDocumentRemoved: (document: Document) => void;
  handleEscape: () => boolean;
  handleFootnoteAction: (action: Exclude<EpubContentAction, { kind: "unsupported" }>) => void;
  resetForSession: () => void;
};

function eventTargetElement(target: EventTarget | null): Element | null {
  if (!target || typeof target !== "object") return null;
  const candidate = target as Partial<Element>;
  return candidate.nodeType === 1 && typeof candidate.closest === "function"
    ? (target as Element)
    : null;
}

export function useEpubContentActionController({
  getSession,
  navigateToTarget,
  onInteraction,
  registry,
  viewerRef,
}: UseEpubContentActionControllerOptions): EpubContentActionController {
  const mountedRef = useRef(true);
  const operationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const footnoteRef = useRef<ReaderFootnoteState | null>(null);
  const externalRef = useRef<ReaderExternalLinkState | null>(null);
  const [footnote, setFootnoteState] = useState<ReaderFootnoteState | null>(null);
  const [external, setExternalState] = useState<ReaderExternalLinkState | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const clearFeedback = useCallback(() => setFeedback(null), []);

  const setFootnote = useCallback((next: ReaderFootnoteState | null) => {
    const previous = footnoteRef.current;
    footnoteRef.current = next;
    setFootnoteState(next);
    if (previous?.content && previous.content !== next?.content) previous.content.release();
  }, []);

  const setExternal = useCallback((next: ReaderExternalLinkState | null) => {
    externalRef.current = next;
    setExternalState(next);
  }, []);

  const cancelResolution = useCallback(() => {
    operationRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const restoreFocus = useCallback((anchor: ReaderContentActionAnchor | undefined) => {
    const target = anchor?.focusTarget;
    if (!target?.isConnected) return;
    window.requestAnimationFrame(() => {
      if (target.isConnected) target.focus({ preventScroll: true });
    });
  }, []);

  const dismissFootnote = useCallback(
    (shouldRestoreFocus = true) => {
      const current = footnoteRef.current;
      cancelResolution();
      setFootnote(null);
      if (shouldRestoreFocus) restoreFocus(current?.anchor);
    },
    [cancelResolution, restoreFocus, setFootnote],
  );

  const dismissExternal = useCallback(
    (shouldRestoreFocus = true) => {
      const current = externalRef.current;
      if (current?.opening) return;
      setExternal(null);
      if (shouldRestoreFocus) restoreFocus(current?.anchor);
    },
    [restoreFocus, setExternal],
  );

  const resetForSession = useCallback(() => {
    cancelResolution();
    setExternal(null);
    setFootnote(null);
    setFeedback(null);
  }, [cancelResolution, setExternal, setFootnote]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      footnoteRef.current?.content?.release();
      footnoteRef.current = null;
      externalRef.current = null;
    };
  }, []);

  const isCurrentOperation = useCallback(
    (operation: number, session: EpubSessionSnapshot) => {
      const current = getSession();
      return (
        mountedRef.current &&
        operationRef.current === operation &&
        current === session &&
        current.generation === session.generation
      );
    },
    [getSession],
  );

  const navigate = useCallback(
    (target: string) => {
      const session = getSession();
      if (!session) return;
      setFeedback(null);
      void navigateToTarget(target).then((navigated) => {
        if (!navigated && mountedRef.current && getSession() === session) {
          setFeedback("This EPUB destination could not be opened.");
        }
      });
    },
    [getSession, navigateToTarget],
  );

  const openExternal = useCallback(
    (
      action: Extract<EpubContentAction, { kind: "external" }>,
      anchor: ReaderContentActionAnchor,
    ) => {
      cancelResolution();
      setFootnote(null);
      setFeedback(null);
      setExternal({
        anchor,
        host: action.host,
        opening: false,
        url: action.url,
      });
    },
    [cancelResolution, setExternal, setFootnote],
  );

  const resolveFootnoteAction = useCallback(
    (
      action: Extract<EpubContentAction, { kind: "footnote" | "internal" }>,
      anchor: ReaderContentActionAnchor,
      currentDocument: Readonly<{ document: Document; href: string }> | null,
      forceFootnote: boolean,
    ) => {
      const session = getSession();
      if (!session) return;

      cancelResolution();
      setFeedback(null);
      setExternal(null);
      setFootnote(null);
      const controller = new AbortController();
      abortRef.current = controller;
      const operation = operationRef.current;

      void resolveEpubFootnote({
        book: session.book,
        currentDocument,
        forceFootnote,
        signal: controller.signal,
        target: action.target,
      }).then((resolution) => {
        if (!isCurrentOperation(operation, session)) {
          if (resolution.kind === "resolved") resolution.value.release();
          return;
        }
        abortRef.current = null;

        if (resolution.kind === "cancelled") return;
        if (resolution.kind === "not-footnote") {
          navigate(action.target.displayTarget);
          return;
        }
        const anchorRect = anchor.resolveRect();
        if (!anchorRect) {
          if (resolution.kind === "resolved") resolution.value.release();
          return;
        }
        if (resolution.kind === "unsupported" && !forceFootnote) {
          navigate(action.target.displayTarget);
          return;
        }

        setFootnote({
          anchor,
          anchorRect,
          content: resolution.kind === "resolved" ? resolution.value : undefined,
          message: resolution.kind === "unsupported" ? resolution.message : undefined,
          viewportRect: readerViewportRect(viewerRef.current),
        });
      });
    },
    [
      cancelResolution,
      getSession,
      isCurrentOperation,
      navigate,
      setExternal,
      setFootnote,
      viewerRef,
    ],
  );

  const routeAction = useCallback(
    (
      action: Exclude<EpubContentAction, { kind: "unsupported" }>,
      anchor: ReaderContentActionAnchor,
      currentDocument: Readonly<{ document: Document; href: string }> | null,
    ) => {
      onInteraction();
      switch (action.kind) {
        case "external":
          openExternal(action, anchor);
          return;
        case "footnote":
          resolveFootnoteAction(action, anchor, currentDocument, true);
          return;
        case "internal":
          if (action.target.fragment) {
            resolveFootnoteAction(action, anchor, currentDocument, false);
          } else {
            dismissFootnote(false);
            navigate(action.target.displayTarget);
          }
          return;
        case "illustration":
          dismissFootnote(false);
          navigate(action.target.displayTarget);
      }
    },
    [dismissFootnote, navigate, onInteraction, openExternal, resolveFootnoteAction],
  );

  const handleContentClick = useCallback(
    (event: MouseEvent, context: ReaderContentDocumentContext) => {
      if (event.defaultPrevented || event.button !== 0) return false;
      const target = eventTargetElement(event.target);
      const link = target?.closest<HTMLElement>("a[href], area[href]") ?? null;
      if (!link) return false;

      const anchor = contentActionAnchorForElement(link);
      const href = link.getAttribute("href") ?? "";
      const currentDocumentHref = context.sectionHref?.trim() ?? "";
      if (!anchor || !currentDocumentHref) {
        setFeedback("This EPUB link is unavailable.");
        onInteraction();
        return true;
      }

      let action = classifyEpubLink({
        currentDocumentHref,
        href,
        sourceSemantics: epubSemanticsFromElement(link),
      });
      if (
        action.kind !== "external" &&
        action.kind !== "unsupported" &&
        action.target.fragment &&
        action.target.documentHref === normalizedEpubDocumentHref(currentDocumentHref)
      ) {
        const targetElement = findEpubFragmentTarget(context.document, action.target.fragment);
        action = classifyEpubLink({
          currentDocumentHref,
          href,
          sourceSemantics: epubSemanticsFromElement(link),
          targetSemantics: targetSemanticsForElement(targetElement),
        });
      }

      if (action.kind === "unsupported") {
        dismissFootnote(false);
        setExternal(null);
        setFeedback("This EPUB link cannot be opened safely.");
        onInteraction();
        return true;
      }

      routeAction(action, anchor, {
        document: context.document,
        href: currentDocumentHref,
      });
      return true;
    },
    [dismissFootnote, onInteraction, routeAction, setExternal],
  );

  const handleFootnoteAction = useCallback(
    (action: Exclude<EpubContentAction, { kind: "unsupported" }>) => {
      const anchor = footnoteRef.current?.anchor;
      if (!anchor) return;
      routeAction(action, anchor, null);
    },
    [routeAction],
  );

  const handleContentPointerDown = useCallback(
    (event: PointerEvent) => {
      const target = eventTargetElement(event.target);
      const isContentLink = Boolean(target?.closest("a[href], area[href]"));
      if (footnoteRef.current) dismissFootnote(false);
      return isContentLink;
    },
    [dismissFootnote],
  );

  const handleDocumentRemoved = useCallback(
    (document: Document) => {
      if (footnoteRef.current?.anchor.document === document) dismissFootnote(false);
      if (externalRef.current?.anchor.document === document) dismissExternal(false);
    },
    [dismissExternal, dismissFootnote],
  );

  const handleEscape = useCallback(() => {
    if (externalRef.current) {
      dismissExternal();
      return true;
    }
    if (footnoteRef.current) {
      dismissFootnote();
      return true;
    }
    return false;
  }, [dismissExternal, dismissFootnote]);

  const confirmExternal = useCallback(() => {
    const current = externalRef.current;
    if (!current || current.opening) return;
    const session = getSession();
    if (!session) return;
    const operation = ++operationRef.current;
    const opening = { ...current, error: undefined, opening: true };
    setExternal(opening);

    void openExternalEpubLink(current.url).then(
      () => {
        if (!isCurrentOperation(operation, session) || externalRef.current !== opening) return;
        setExternal(null);
        restoreFocus(current.anchor);
      },
      () => {
        if (!isCurrentOperation(operation, session) || externalRef.current !== opening) return;
        setExternal({
          ...current,
          error: "The link could not be opened in your browser.",
          opening: false,
        });
      },
    );
  }, [getSession, isCurrentOperation, restoreFocus, setExternal]);

  const refreshFootnoteAnchor = useCallback(() => {
    const current = footnoteRef.current;
    if (!current) return;
    registry.pruneDisconnected();
    const anchorRect = current.anchor.resolveRect();
    if (!anchorRect || !viewerRef.current?.isConnected) {
      dismissFootnote(false);
      return;
    }
    setFootnote({
      ...current,
      anchorRect,
      viewportRect: readerViewportRect(viewerRef.current),
    });
  }, [dismissFootnote, registry, setFootnote, viewerRef]);

  useLayoutEffect(() => {
    const current = footnote;
    if (!current) return;
    const sourceWindow = current.anchor.document.defaultView;
    const onPageHide = () => dismissFootnote(false);
    const observer =
      typeof ResizeObserver === "undefined" ? undefined : new ResizeObserver(refreshFootnoteAnchor);
    if (viewerRef.current) observer?.observe(viewerRef.current);
    let frame = sourceWindow?.frameElement;
    while (frame) {
      observer?.observe(frame);
      frame = frame.ownerDocument.defaultView?.frameElement ?? null;
    }
    window.addEventListener("resize", refreshFootnoteAnchor);
    document.addEventListener("scroll", refreshFootnoteAnchor, true);
    current.anchor.document.addEventListener("scroll", refreshFootnoteAnchor, true);
    sourceWindow?.addEventListener("pagehide", onPageHide);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", refreshFootnoteAnchor);
      document.removeEventListener("scroll", refreshFootnoteAnchor, true);
      current.anchor.document.removeEventListener("scroll", refreshFootnoteAnchor, true);
      sourceWindow?.removeEventListener("pagehide", onPageHide);
    };
  }, [dismissFootnote, footnote, refreshFootnoteAnchor, viewerRef]);

  useEffect(() => {
    if (!footnote) return;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(".reader-footnote, .reader-external-link-dialog")
      ) {
        return;
      }
      dismissFootnote(false);
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    return () => document.removeEventListener("pointerdown", dismissOutside, true);
  }, [dismissFootnote, footnote]);

  return {
    clearFeedback,
    confirmExternal,
    dismissExternal,
    dismissFootnote,
    external,
    feedback,
    footnote,
    handleContentClick,
    handleContentPointerDown,
    handleDocumentRemoved,
    handleEscape,
    handleFootnoteAction,
    resetForSession,
  };
}
