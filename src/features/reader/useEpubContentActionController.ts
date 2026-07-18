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
  illustrationElementFromTarget,
  illustrationTargetForElement,
  resolveEpubIllustration,
  type ResolvedEpubIllustration,
} from "./epubIllustrationResolver";
import {
  hasPublisherIllustrationInteractionOwner,
  READER_ILLUSTRATION_TRIGGER_ATTRIBUTE,
} from "./readerIllustrationTrigger";
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
import { openExternalUrl } from "../../app/openExternalUrl";

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

export type ReaderIllustrationState = Readonly<{
  anchor: ReaderContentActionAnchor;
  error?: string;
  loading: boolean;
  resource?: ResolvedEpubIllustration;
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
  dismissIllustration: (restoreFocus?: boolean) => void;
  external: ReaderExternalLinkState | null;
  feedback: string | null;
  footnote: ReaderFootnoteState | null;
  illustration: ReaderIllustrationState | null;
  handleContentClick: (event: MouseEvent, context: ReaderContentDocumentContext) => boolean;
  handleContentPointerDown: (event: PointerEvent, context: ReaderContentDocumentContext) => boolean;
  handleContentKeyDown: (event: KeyboardEvent, context: ReaderContentDocumentContext) => boolean;
  handleDocumentRemoved: (document: Document) => void;
  handleEscape: () => boolean;
  handleFootnoteAction: (action: Exclude<EpubContentAction, { kind: "unsupported" }>) => void;
  prepareDocument: (context: ReaderContentDocumentContext) => void;
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
  const illustrationRef = useRef<ReaderIllustrationState | null>(null);
  const [footnote, setFootnoteState] = useState<ReaderFootnoteState | null>(null);
  const [external, setExternalState] = useState<ReaderExternalLinkState | null>(null);
  const [illustration, setIllustrationState] = useState<ReaderIllustrationState | null>(null);
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

  const setIllustration = useCallback((next: ReaderIllustrationState | null) => {
    const previous = illustrationRef.current;
    illustrationRef.current = next;
    setIllustrationState(next);
    if (previous?.resource && previous.resource !== next?.resource) previous.resource.release();
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

  const dismissIllustration = useCallback(
    (shouldRestoreFocus = true) => {
      const current = illustrationRef.current;
      cancelResolution();
      setIllustration(null);
      if (shouldRestoreFocus) restoreFocus(current?.anchor);
    },
    [cancelResolution, restoreFocus, setIllustration],
  );

  const resetForSession = useCallback(() => {
    cancelResolution();
    setExternal(null);
    setFootnote(null);
    setIllustration(null);
    setFeedback(null);
  }, [cancelResolution, setExternal, setFootnote, setIllustration]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationRef.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      footnoteRef.current?.content?.release();
      illustrationRef.current?.resource?.release();
      footnoteRef.current = null;
      externalRef.current = null;
      illustrationRef.current = null;
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
      setIllustration(null);
      setFeedback(null);
      setExternal({
        anchor,
        host: action.host,
        opening: false,
        url: action.url,
      });
    },
    [cancelResolution, setExternal, setFootnote, setIllustration],
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
      setIllustration(null);
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
      setIllustration,
      viewerRef,
    ],
  );

  const openIllustration = useCallback(
    (
      action: Extract<EpubContentAction, { kind: "illustration" }>,
      anchor: ReaderContentActionAnchor,
    ) => {
      const session = getSession();
      if (!session) return;

      cancelResolution();
      setFeedback(null);
      setExternal(null);
      setFootnote(null);
      setIllustration({ anchor, loading: true });
      const controller = new AbortController();
      abortRef.current = controller;
      const operation = operationRef.current;

      void resolveEpubIllustration(session.book, action.target, controller.signal).then(
        (resolution) => {
          if (!isCurrentOperation(operation, session)) {
            if (resolution.kind === "resolved") resolution.value.release();
            return;
          }
          abortRef.current = null;
          if (resolution.kind === "cancelled") return;
          if (resolution.kind === "unsupported") {
            setIllustration({
              anchor,
              error: "This illustration could not be opened safely.",
              loading: false,
            });
            return;
          }
          setIllustration({ anchor, loading: false, resource: resolution.value });
        },
      );
    },
    [cancelResolution, getSession, isCurrentOperation, setExternal, setFootnote, setIllustration],
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
            setIllustration(null);
            navigate(action.target.displayTarget);
          }
          return;
        case "illustration":
          openIllustration(action, anchor);
      }
    },
    [
      dismissFootnote,
      navigate,
      onInteraction,
      openExternal,
      openIllustration,
      resolveFootnoteAction,
      setIllustration,
    ],
  );

  const activateIllustrationElement = useCallback(
    (element: Element, context: ReaderContentDocumentContext) => {
      const session = getSession();
      const currentDocumentHref = context.sectionHref?.trim() ?? "";
      if (!session || !currentDocumentHref) return false;
      const target = illustrationTargetForElement(session.book, element, currentDocumentHref);
      const focusTarget = illustrationFocusTarget(element);
      const anchor = focusTarget ? contentActionAnchorForElement(focusTarget) : null;
      if (!target || !anchor) return false;
      routeAction({ kind: "illustration", target }, anchor, {
        document: context.document,
        href: currentDocumentHref,
      });
      return true;
    },
    [getSession, routeAction],
  );

  const handleContentClick = useCallback(
    (event: MouseEvent, context: ReaderContentDocumentContext) => {
      if (event.defaultPrevented || event.button !== 0) return false;
      const target = eventTargetElement(event.target);
      const link = target?.closest<HTMLElement>("a[href], area[href]") ?? null;
      if (!link) {
        const illustrationElement = illustrationElementFromTarget(target);
        if (!illustrationElement || context.document.getSelection()?.isCollapsed === false) {
          return false;
        }
        return activateIllustrationElement(illustrationElement, context);
      }

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
        setIllustration(null);
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
    [
      activateIllustrationElement,
      dismissFootnote,
      onInteraction,
      routeAction,
      setExternal,
      setIllustration,
    ],
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
    (event: PointerEvent, context: ReaderContentDocumentContext) => {
      const target = eventTargetElement(event.target);
      const isContentLink = Boolean(target?.closest("a[href], area[href]"));
      const illustrationElement = illustrationElementFromTarget(target);
      const session = getSession();
      const isIllustration = Boolean(
        illustrationElement &&
        session &&
        context.sectionHref &&
        illustrationTargetForElement(session.book, illustrationElement, context.sectionHref),
      );
      if (footnoteRef.current) dismissFootnote(false);
      return isContentLink || isIllustration;
    },
    [dismissFootnote, getSession],
  );

  const handleContentKeyDown = useCallback(
    (event: KeyboardEvent, context: ReaderContentDocumentContext) => {
      if (event.defaultPrevented || (event.key !== "Enter" && event.key !== " ")) return false;
      const target = eventTargetElement(event.target);
      if (target?.closest("a[href], area[href]")) return false;
      const illustrationElement = illustrationElementFromTarget(target);
      return illustrationElement
        ? activateIllustrationElement(illustrationElement, context)
        : false;
    },
    [activateIllustrationElement],
  );

  const prepareDocument = useCallback(
    (context: ReaderContentDocumentContext) => {
      const session = getSession();
      if (!session || !context.sectionHref) return;
      for (const element of context.document.querySelectorAll("img, image")) {
        if (!illustrationTargetForElement(session.book, element, context.sectionHref)) continue;
        const focusTarget = illustrationFocusTarget(element);
        if (!focusTarget || hasPublisherIllustrationInteractionOwner(element, focusTarget)) {
          continue;
        }
        focusTarget.setAttribute(READER_ILLUSTRATION_TRIGGER_ATTRIBUTE, "");
        if (!focusTarget.hasAttribute("tabindex")) {
          focusTarget.setAttribute("tabindex", "0");
        }
        if (!focusTarget.hasAttribute("role")) {
          focusTarget.setAttribute("role", "button");
        }
        if (!focusTarget.hasAttribute("aria-label")) {
          focusTarget.setAttribute("aria-label", "Open illustration");
        }
      }
    },
    [getSession],
  );

  const handleDocumentRemoved = useCallback(
    (document: Document) => {
      if (footnoteRef.current?.anchor.document === document) dismissFootnote(false);
      if (externalRef.current?.anchor.document === document) dismissExternal(false);
      if (illustrationRef.current?.anchor.document === document) dismissIllustration(false);
    },
    [dismissExternal, dismissFootnote, dismissIllustration],
  );

  const handleEscape = useCallback(() => {
    if (illustrationRef.current) {
      dismissIllustration();
      return true;
    }
    if (externalRef.current) {
      dismissExternal();
      return true;
    }
    if (footnoteRef.current) {
      dismissFootnote();
      return true;
    }
    return false;
  }, [dismissExternal, dismissFootnote, dismissIllustration]);

  const confirmExternal = useCallback(() => {
    const current = externalRef.current;
    if (!current || current.opening) return;
    const session = getSession();
    if (!session) return;
    const operation = ++operationRef.current;
    const opening = { ...current, error: undefined, opening: true };
    setExternal(opening);

    void openExternalUrl(current.url).then(
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
    dismissIllustration,
    external,
    feedback,
    footnote,
    illustration,
    handleContentClick,
    handleContentKeyDown,
    handleContentPointerDown,
    handleDocumentRemoved,
    handleEscape,
    handleFootnoteAction,
    prepareDocument,
    resetForSession,
  };
}

function illustrationFocusTarget(element: Element) {
  const target = element.localName.toLowerCase() === "image" ? element.closest("svg") : element;
  if (!target || typeof (target as { focus?: unknown }).focus !== "function") return null;
  return target as Element & { focus: (options?: FocusOptions) => void };
}
