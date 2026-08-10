import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Book as EpubBook, Location, Rendition } from "epubjs";

import type { ReaderNavigationState } from "../../types/reader";
import { measurePerformance, measurePerformanceAsync } from "../../utils/measurePerformance";
import { snapshotReaderRelocation, type ReaderRelocation } from "./readerLocation";
import {
  ReaderContentDocumentSessionOwner,
  type ReaderContentDocumentAccess,
} from "./readerContentDocumentRegistry";
import type { ReaderContentTheme } from "./readerTheme";
import { stabilizeContinuousRendition, type RenditionWithManager } from "./readerContinuousScroll";
import { loadReaderNavigationModel } from "./readerNavigationModel";
import {
  createReaderDeliberateNavigationController,
  READER_NAVIGATION_HISTORY_LIMIT,
  type ReaderDeliberateNavigationDisplayOptions,
} from "./readerDeliberateNavigation";
import type { ReaderNavigationHistorySnapshot } from "./readerNavigationHistory";
import {
  createLoadingReaderNavigationState,
  createReaderNavigationStateController,
  type ReaderNavigationStateController,
} from "./readerNavigationState";
import type { EpubContent } from "./readerContentDocumentRegistry";
import type { ReaderNavigationIntent } from "./readerNavigation";
import type { ReaderFileLease, ReaderSourceHandoff } from "./readerFileLease";
import type { ReaderSessionIdentity } from "./readerSession";
import {
  createEpubSessionInteractionAccess,
  type EpubSessionInteractionAccess,
} from "./epubSessionInteractionAccess";

export type EpubSessionError = { kind: "open-failed" };

type EpubSessionSnapshot = {
  book: EpubBook;
  generation: number;
  interactions: EpubSessionInteractionAccess;
  rendition: Rendition;
};

export type EpubSessionBridge = {
  onContent: (content: EpubContent) => void;
  onDisplayed: () => void;
  onError: (identity: ReaderSessionIdentity, error: EpubSessionError) => void;
  onLocationChange: (relocation: ReaderRelocation) => void;
  onNavigationChange: (navigation: ReaderNavigationState) => void;
  onReady: (identity: ReaderSessionIdentity) => void;
  onRelocated: () => void;
  onRendered: (section: unknown, view: unknown) => void;
  onSelected: (cfiRange: string, contents: EpubContent) => void;
  onSessionCreated: (session: EpubSessionInteractionAccess) => void;
  onSessionEnding: () => void;
};

type RenditionWithContentHook = Rendition & {
  hooks?: {
    content?: {
      register?: (callback: (contents: EpubContent) => void) => void;
    };
  };
};

type EpubBookOpenEventListener = (error: unknown) => void;

type EpubBookWithOpenEvents = EpubBook & {
  off: (event: "openFailed", listener: EpubBookOpenEventListener) => unknown;
  on: (event: "openFailed", listener: EpubBookOpenEventListener) => unknown;
};

type EpubBookOpenBoundary = Readonly<{
  cancel: () => void;
  result: Promise<"cancelled" | "opened">;
}>;

type IdleWindow = Window & {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
};

function renderedSectionHref(section: unknown): string | undefined {
  if (typeof section !== "object" || section === null) return undefined;
  const href = (section as { href?: unknown }).href;
  return typeof href === "string" ? href : undefined;
}

let epubModulePromise: Promise<typeof import("epubjs")> | null = null;

function loadEpubModule(): Promise<typeof import("epubjs")> {
  epubModulePromise ??= import("epubjs").catch((error: unknown) => {
    epubModulePromise = null;
    throw error;
  });
  return epubModulePromise;
}

type EpubTurnOwner = {
  requestId: symbol;
  resetTimer: number | null;
  session: EpubSessionSnapshot;
};

type EpubSessionLifecycle = {
  cancelDeferredNavigation: () => void;
  identity: ReaderSessionIdentity;
  onRelocated: (location: Location) => void;
  onRendered: (section: unknown, view: unknown) => void;
  onSelected: (cfiRange: string, contents: EpubContent) => void;
  snapshot: EpubSessionSnapshot;
  tornDown: boolean;
};

function createEpubBookOpenBoundary(book: EpubBook): EpubBookOpenBoundary {
  const eventBook = book as EpubBookWithOpenEvents;
  let settled = false;
  let resolveResult!: (result: "cancelled" | "opened") => void;
  let rejectResult!: (error: unknown) => void;
  const result = new Promise<"cancelled" | "opened">((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const removeListener = () => {
    eventBook.off("openFailed", onOpenFailed);
  };
  const settle = (
    outcome: { kind: "cancelled" | "opened" } | { error: unknown; kind: "failed" },
  ) => {
    if (settled) return;
    settled = true;
    removeListener();
    if (outcome.kind === "failed") rejectResult(outcome.error);
    else resolveResult(outcome.kind);
  };
  const onOpenFailed: EpubBookOpenEventListener = (error) => {
    settle({ error, kind: "failed" });
  };

  eventBook.on("openFailed", onOpenFailed);
  void book.opened.then(
    () => settle({ kind: "opened" }),
    (error: unknown) => settle({ error, kind: "failed" }),
  );

  return Object.freeze({
    cancel: () => settle({ kind: "cancelled" }),
    result,
  });
}

export type UseEpubSessionOptions = {
  bridgeRef: RefObject<EpubSessionBridge>;
  containerRef: RefObject<HTMLDivElement | null>;
  fileLease: ReaderFileLease;
  initialCfi?: string;
  mode: "continuous" | "paged";
  sessionIdentity: ReaderSessionIdentity;
};

export type EpubSessionFacade = {
  applyContentTheme: (theme: ReaderContentTheme, container: HTMLElement | null) => void;
  documents: ReaderContentDocumentAccess;
  getInteractionSession: () => EpubSessionInteractionAccess | null;
  getNavigationHistorySnapshot: () => ReaderNavigationHistorySnapshot;
  getRelocation: () => ReaderRelocation | null;
  getNavigationState: () => ReaderNavigationState;
  isLoading: boolean;
  navigateBack: () => Promise<boolean>;
  navigateForward: () => Promise<boolean>;
  navigateToChapter: (chapterId: string) => Promise<boolean>;
  navigateToLocation: (cfi: string) => Promise<boolean>;
  navigateToTarget: (target: string) => Promise<boolean>;
  subscribeNavigationHistory: (listener: () => void) => () => void;
  teardown: () => void;
  turn: (intent: ReaderNavigationIntent) => Promise<void>;
};

export function useEpubSession({
  bridgeRef,
  containerRef,
  fileLease,
  initialCfi,
  mode,
  sessionIdentity,
}: UseEpubSessionOptions): EpubSessionFacade {
  const initialCfiRef = useRef(initialCfi);
  const [documentSessions] = useState(() => new ReaderContentDocumentSessionOwner());
  const [deliberateNavigation] = useState(() =>
    createReaderDeliberateNavigationController(READER_NAVIGATION_HISTORY_LIMIT),
  );
  const sessionRef = useRef<EpubSessionSnapshot | null>(null);
  const relocationRef = useRef<ReaderRelocation | null>(null);
  const teardownRef = useRef<() => void>(() => undefined);
  const activeSessionIdentityRef = useRef<ReaderSessionIdentity | null>(null);
  const navigationControllerRef = useRef<ReaderNavigationStateController | null>(null);
  const generationRef = useRef(0);
  const canonicalCfiFileRef = useRef<ReaderFileLease | null>(null);
  const turnOwnerRef = useRef<EpubTurnOwner | null>(null);
  const sessionKey = useMemo(
    () => ({ fileLease, mode, sessionIdentity }),
    [fileLease, mode, sessionIdentity],
  );
  const [settledSessionKey, setSettledSessionKey] = useState<typeof sessionKey | null>(null);

  useEffect(() => {
    initialCfiRef.current = initialCfi;
  }, [initialCfi]);

  useEffect(() => {
    deliberateNavigation.startSession(sessionIdentity, initialCfiRef.current);
    return () => {
      deliberateNavigation.endSession(sessionIdentity);
    };
  }, [deliberateNavigation, sessionIdentity]);

  const invalidateTurnOwner = useCallback((session?: EpubSessionSnapshot) => {
    const owner = turnOwnerRef.current;
    if (!owner || (session && owner.session !== session)) return;

    if (owner.resetTimer !== null) {
      window.clearTimeout(owner.resetTimer);
      owner.resetTimer = null;
    }
    turnOwnerRef.current = null;
  }, []);

  const turn = useCallback(
    async (intent: ReaderNavigationIntent) => {
      const session = sessionRef.current;
      if (!session) return;

      const activeOwner = turnOwnerRef.current;
      if (activeOwner?.session === session) return;
      if (activeOwner) invalidateTurnOwner(activeOwner.session);

      const owner: EpubTurnOwner = {
        requestId: Symbol("epub-turn"),
        resetTimer: null,
        session,
      };
      turnOwnerRef.current = owner;

      try {
        if (intent === "forward") await session.rendition.next();
        else await session.rendition.prev();
      } finally {
        const currentOwner = turnOwnerRef.current;
        if (
          currentOwner?.session === session &&
          currentOwner.requestId === owner.requestId &&
          sessionRef.current === session &&
          generationRef.current === session.generation
        ) {
          owner.resetTimer = window.setTimeout(() => {
            const resetOwner = turnOwnerRef.current;
            if (
              resetOwner?.session !== session ||
              resetOwner.requestId !== owner.requestId ||
              sessionRef.current !== session ||
              generationRef.current !== session.generation
            ) {
              return;
            }
            owner.resetTimer = null;
            turnOwnerRef.current = null;
          }, 80);
        }
      }
    },
    [invalidateTurnOwner],
  );

  const displayTargetForSession = useCallback(
    async (
      session: EpubSessionSnapshot,
      rawTarget: string,
      options: ReaderDeliberateNavigationDisplayOptions,
    ) => {
      const target = rawTarget.trim();
      if (!target || sessionRef.current !== session) return false;

      try {
        await session.rendition.display(target);
        if (sessionRef.current !== session || generationRef.current !== session.generation) {
          return false;
        }
        const bridge = bridgeRef.current;
        if (
          options.requireUsableLocation &&
          !documentSessions.renditionTargetIsUsable(session.rendition, target)
        ) {
          return false;
        }
        documentSessions.bindMounted(containerRef.current);
        bridge?.onDisplayed();
        return true;
      } catch {
        return false;
      }
    },
    [bridgeRef, containerRef, documentSessions],
  );

  const navigateToChapter = useCallback(
    async (chapterId: string) => {
      const target = navigationControllerRef.current?.getModel().resolveItemTarget(chapterId);
      return target ? deliberateNavigation.jump(target) : false;
    },
    [deliberateNavigation],
  );

  const navigateToLocation = useCallback(
    (cfi: string) => deliberateNavigation.jump(cfi, { requireUsableLocation: true }),
    [deliberateNavigation],
  );

  const navigateToTarget = useCallback(
    (target: string) => deliberateNavigation.jump(target),
    [deliberateNavigation],
  );

  const navigateBack = useCallback(() => deliberateNavigation.back(), [deliberateNavigation]);
  const navigateForward = useCallback(() => deliberateNavigation.forward(), [deliberateNavigation]);
  const getNavigationHistorySnapshot = useCallback(
    () => deliberateNavigation.getHistorySnapshot(),
    [deliberateNavigation],
  );
  const subscribeNavigationHistory = useCallback(
    (listener: () => void) => deliberateNavigation.subscribeHistory(listener),
    [deliberateNavigation],
  );

  useEffect(() => {
    let retired = false;
    let book: EpubBook | null = null;
    let bookDestroyed = false;
    let lifecycle: EpubSessionLifecycle | null = null;
    let cancelPendingBookOpen: () => void = () => undefined;
    const generation = ++generationRef.current;
    const sessionDocuments = documentSessions.activate();
    activeSessionIdentityRef.current = sessionIdentity;
    relocationRef.current = null;
    const navigationController = createReaderNavigationStateController((state) =>
      bridgeRef.current?.onNavigationChange(state),
    );
    navigationControllerRef.current = navigationController;
    const displayCfi =
      canonicalCfiFileRef.current === fileLease
        ? deliberateNavigation.getCurrentTarget()
        : initialCfiRef.current;
    canonicalCfiFileRef.current = fileLease;
    invalidateTurnOwner();
    navigationController.reset();

    const destroyBookOnce = () => {
      if (!book || bookDestroyed) return;
      bookDestroyed = true;
      book.destroy();
    };

    const ownsSession = (session: EpubSessionSnapshot) =>
      !retired &&
      lifecycle?.identity === sessionIdentity &&
      lifecycle?.snapshot === session &&
      !lifecycle.tornDown &&
      sessionRef.current === session &&
      activeSessionIdentityRef.current === sessionIdentity &&
      generationRef.current === session.generation;

    const teardownSession = (session: EpubSessionSnapshot) => {
      const owner = lifecycle;
      if (!owner || owner.snapshot !== session || owner.tornDown) return;

      measurePerformance("archeion:reader-session-teardown", () => {
        owner.tornDown = true;
        const wasCurrent = sessionRef.current === session;
        if (wasCurrent) sessionRef.current = null;
        deliberateNavigation.unbindDisplay(session);
        owner.cancelDeferredNavigation();
        owner.cancelDeferredNavigation = () => undefined;
        invalidateTurnOwner(session);
        session.rendition.off("rendered", owner.onRendered);
        session.rendition.off("relocated", owner.onRelocated);
        session.rendition.off("selected", owner.onSelected);
        if (wasCurrent) relocationRef.current = null;
        if (navigationControllerRef.current === navigationController) {
          navigationControllerRef.current = null;
        }
        documentSessions.retire(sessionDocuments);
        bridgeRef.current?.onSessionEnding();
        destroyBookOnce();
      });
    };

    const loadNavigation = async (owner: EpubSessionLifecycle) => {
      const model = await loadReaderNavigationModel(owner.snapshot.book);
      if (!ownsSession(owner.snapshot)) return;
      navigationController.setModel(model);
    };

    const deferNavigationLoad = (owner: EpubSessionLifecycle) => {
      const idleWindow = window as IdleWindow;
      if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
        const idleId = idleWindow.requestIdleCallback(() => void loadNavigation(owner), {
          timeout: 1000,
        });
        owner.cancelDeferredNavigation = () => idleWindow.cancelIdleCallback?.(idleId);
        return;
      }
      const timeoutId = window.setTimeout(() => void loadNavigation(owner), 0);
      owner.cancelDeferredNavigation = () => window.clearTimeout(timeoutId);
    };

    const openBook = async () => {
      let sourceHandoff: ReaderSourceHandoff | null = null;
      try {
        const epubModule = loadEpubModule();
        sourceHandoff = await fileLease.acquire();
        if (
          retired ||
          activeSessionIdentityRef.current !== sessionIdentity ||
          !containerRef.current
        ) {
          void epubModule.catch(() => undefined);
          return;
        }
        let fileContents: ArrayBuffer | null = await measurePerformanceAsync(
          "archeion:reader-blob-to-array-buffer",
          () => sourceHandoff!.blob.arrayBuffer(),
        );
        if (
          retired ||
          activeSessionIdentityRef.current !== sessionIdentity ||
          !containerRef.current
        ) {
          fileContents = null;
          void epubModule.catch(() => undefined);
          return;
        }

        const { default: ePub } = await epubModule;
        if (
          retired ||
          activeSessionIdentityRef.current !== sessionIdentity ||
          !containerRef.current
        ) {
          fileContents = null;
          return;
        }
        book = measurePerformance("archeion:reader-epub-book-create", () => ePub(fileContents!));
        const openBoundary = createEpubBookOpenBoundary(book);
        cancelPendingBookOpen = openBoundary.cancel;
        fileContents = null;
        sourceHandoff.release();
        sourceHandoff = null;
        const openResult = await openBoundary.result;
        cancelPendingBookOpen = () => undefined;
        if (
          openResult === "cancelled" ||
          retired ||
          activeSessionIdentityRef.current !== sessionIdentity ||
          !containerRef.current
        ) {
          destroyBookOnce();
          return;
        }

        const rendition = measurePerformance("archeion:reader-rendition-create", () =>
          book!.renderTo(containerRef.current!, {
            width: "100%",
            height: "100%",
            flow: mode === "continuous" ? "scrolled-continuous" : "paginated",
            manager: mode === "continuous" ? "continuous" : "default",
            spread: "none",
            allowScriptedContent: false,
          }),
        );
        const interactions = createEpubSessionInteractionAccess(book, rendition);
        const session: EpubSessionSnapshot = { book, generation, interactions, rendition };
        const owner: EpubSessionLifecycle = {
          cancelDeferredNavigation: () => undefined,
          identity: sessionIdentity,
          onRendered: (section, view) => {
            if (!ownsSession(session)) return;
            sessionDocuments.pruneDisconnected();
            sessionDocuments.bindRenderedView(view, renderedSectionHref(section));
            bridgeRef.current?.onRendered(section, view);
          },
          onRelocated: (location) => {
            if (!ownsSession(session)) return;
            deliberateNavigation.relocate(session, location.start.cfi);
            navigationController.relocate(location);
            bridgeRef.current?.onRelocated();
            const acceptedRelocation = snapshotReaderRelocation(
              location,
              session.book.packaging.spine.length,
            );
            relocationRef.current = acceptedRelocation;
            bridgeRef.current?.onLocationChange(acceptedRelocation);
          },
          onSelected: (cfiRange, contents) => {
            if (!ownsSession(session)) return;
            bridgeRef.current?.onSelected(cfiRange, contents);
          },
          snapshot: session,
          tornDown: false,
        };
        lifecycle = owner;
        sessionRef.current = session;
        deliberateNavigation.bindDisplay(
          sessionIdentity,
          session,
          (target, options) => displayTargetForSession(session, target, options),
          displayCfi,
        );
        (rendition as RenditionWithContentHook).hooks?.content?.register?.(
          (content: EpubContent) => {
            if (!ownsSession(session)) return;
            sessionDocuments.bind(content);
            bridgeRef.current?.onContent(content);
          },
        );
        bridgeRef.current?.onSessionCreated(interactions);
        rendition.on("rendered", owner.onRendered);
        rendition.on("relocated", owner.onRelocated);
        rendition.on("selected", owner.onSelected);

        await (rendition as RenditionWithManager).started;
        if (!ownsSession(session)) return;
        if (mode === "continuous") stabilizeContinuousRendition(rendition as RenditionWithManager);

        await measurePerformanceAsync("archeion:reader-first-location-display", async () => {
          try {
            await rendition.display(displayCfi);
          } catch {
            if (!ownsSession(session)) return;
            await rendition.display();
          }
        });
        if (!ownsSession(session)) return;

        sessionDocuments.bindMounted(containerRef.current);
        bridgeRef.current?.onDisplayed();
        void book.locations.generate(1600).catch(() => {
          // Reading can continue without a calculated percentage.
        });
        setSettledSessionKey(sessionKey);
        bridgeRef.current?.onReady(sessionIdentity);
        deferNavigationLoad(owner);
      } catch {
        const failedSession = lifecycle?.snapshot;
        if (failedSession) teardownSession(failedSession);
        else {
          documentSessions.retire(sessionDocuments);
          destroyBookOnce();
        }
        if (!retired && activeSessionIdentityRef.current === sessionIdentity) {
          setSettledSessionKey(sessionKey);
          bridgeRef.current?.onError(sessionIdentity, { kind: "open-failed" });
        }
      } finally {
        sourceHandoff?.release();
      }
    };

    const retireAttempt = () => {
      if (retired) return;
      retired = true;
      cancelPendingBookOpen();
      cancelPendingBookOpen = () => undefined;
      const endingSession = lifecycle?.snapshot;
      if (endingSession) teardownSession(endingSession);
      else {
        documentSessions.retire(sessionDocuments);
        destroyBookOnce();
      }
      invalidateTurnOwner();
      relocationRef.current = null;
      if (navigationControllerRef.current === navigationController) {
        navigationControllerRef.current = null;
      }
      if (activeSessionIdentityRef.current === sessionIdentity) {
        activeSessionIdentityRef.current = null;
      }
      if (teardownRef.current === retireAttempt) {
        teardownRef.current = () => undefined;
      }
    };

    teardownRef.current = retireAttempt;
    void openBook();

    return retireAttempt;
  }, [
    bridgeRef,
    containerRef,
    deliberateNavigation,
    displayTargetForSession,
    documentSessions,
    fileLease,
    invalidateTurnOwner,
    mode,
    sessionIdentity,
    sessionKey,
  ]);

  const getNavigationState = useCallback(
    () => navigationControllerRef.current?.getState() ?? createLoadingReaderNavigationState(),
    [],
  );
  const applyContentTheme = useCallback(
    (theme: ReaderContentTheme, container: HTMLElement | null) => {
      documentSessions.applyTheme(sessionRef.current?.rendition ?? null, theme, container);
    },
    [documentSessions],
  );
  const getInteractionSession = useCallback(() => sessionRef.current?.interactions ?? null, []);
  const getRelocation = useCallback(() => relocationRef.current, []);
  const teardown = useCallback(() => teardownRef.current(), []);

  return {
    applyContentTheme,
    documents: documentSessions.access,
    getInteractionSession,
    getNavigationHistorySnapshot,
    getRelocation,
    getNavigationState,
    isLoading: settledSessionKey !== sessionKey,
    navigateBack,
    navigateForward,
    navigateToChapter,
    navigateToLocation,
    navigateToTarget,
    subscribeNavigationHistory,
    teardown,
    turn,
  };
}
