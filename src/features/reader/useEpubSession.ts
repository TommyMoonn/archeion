import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { Book as EpubBook, Location, Rendition } from "epubjs";

import type { ReaderNavigationState } from "../../types/reader";
import type { ReaderLocation } from "./readerLocation";
import { normalizeReaderLocation } from "./readerLocation";
import { stabilizeContinuousRendition, type RenditionWithManager } from "./readerContinuousScroll";
import { loadReaderNavigationModel } from "./readerNavigationModel";
import {
  createReaderNavigationStateController,
  type ReaderNavigationStateController,
} from "./readerNavigationState";
import type { EpubContent } from "./readerContentDocumentRegistry";
import type { ReaderNavigationIntent } from "./readerNavigation";

export type EpubSessionError = { kind: "open-failed" };

export type EpubSessionSnapshot = {
  book: EpubBook;
  generation: number;
  rendition: Rendition;
};

export type EpubSessionBridge = {
  isLocationUsable: (rendition: Rendition, target: string) => boolean;
  onContent: (content: EpubContent) => void;
  onDisplayed: () => void;
  onError: (error: EpubSessionError) => void;
  onLocationChange: (location: ReaderLocation) => void;
  onNavigationChange: (navigation: ReaderNavigationState) => void;
  onReady: () => void;
  onRelocated: () => void;
  onRendered: (section: unknown, view: unknown) => void;
  onSelected: (cfiRange: string, contents: EpubContent) => void;
  onSessionCreated: (session: EpubSessionSnapshot) => void;
  onSessionEnding: (session: EpubSessionSnapshot) => void;
};

type RenditionWithContentHook = Rendition & {
  hooks?: {
    content?: {
      register?: (callback: (contents: EpubContent) => void) => void;
    };
  };
};

type IdleWindow = Window & {
  cancelIdleCallback?: (handle: number) => void;
  requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
};

type EpubTurnOwner = {
  requestId: symbol;
  resetTimer: number | null;
  session: EpubSessionSnapshot;
};

type EpubSessionLifecycle = {
  cancelDeferredNavigation: () => void;
  onRelocated: (location: Location) => void;
  onRendered: (section: unknown, view: unknown) => void;
  onSelected: (cfiRange: string, contents: EpubContent) => void;
  snapshot: EpubSessionSnapshot;
  tornDown: boolean;
};

export type UseEpubSessionOptions = {
  bridgeRef: RefObject<EpubSessionBridge>;
  containerRef: RefObject<HTMLDivElement | null>;
  fileBlob: Blob;
  initialCfi?: string;
  mode: "continuous" | "paged";
};

export type EpubSessionFacade = {
  getNavigationState: () => ReaderNavigationState;
  getRendition: () => Rendition | null;
  getSession: () => EpubSessionSnapshot | null;
  isLoading: boolean;
  navigateToChapter: (chapterId: string) => Promise<boolean>;
  navigateToLocation: (cfi: string) => Promise<boolean>;
  navigateToTarget: (target: string) => Promise<boolean>;
  turn: (intent: ReaderNavigationIntent) => Promise<void>;
};

export function useEpubSession({
  bridgeRef,
  containerRef,
  fileBlob,
  initialCfi,
  mode,
}: UseEpubSessionOptions): EpubSessionFacade {
  const initialCfiRef = useRef(initialCfi);
  const sessionRef = useRef<EpubSessionSnapshot | null>(null);
  const navigationControllerRef = useRef<ReaderNavigationStateController | null>(null);
  const generationRef = useRef(0);
  const canonicalCfiRef = useRef(initialCfi);
  const canonicalCfiFileRef = useRef<Blob | null>(null);
  const isNavigatingRef = useRef(false);
  const turnOwnerRef = useRef<EpubTurnOwner | null>(null);
  const sessionKey = useMemo(() => ({ fileBlob, mode }), [fileBlob, mode]);
  const [settledSessionKey, setSettledSessionKey] = useState<typeof sessionKey | null>(null);

  useEffect(() => {
    initialCfiRef.current = initialCfi;
  }, [initialCfi]);

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

  const displayTarget = useCallback(
    async (rawTarget: string, requireUsableLocation = false) => {
      const session = sessionRef.current;
      const target = rawTarget.trim();
      if (!session || !target || isNavigatingRef.current) return false;

      isNavigatingRef.current = true;
      try {
        await session.rendition.display(target);
        if (sessionRef.current !== session) return false;
        const bridge = bridgeRef.current;
        if (requireUsableLocation && !bridge?.isLocationUsable(session.rendition, target)) {
          return false;
        }
        bridge?.onDisplayed();
        return true;
      } catch {
        return false;
      } finally {
        if (sessionRef.current === session) isNavigatingRef.current = false;
      }
    },
    [bridgeRef],
  );

  const navigateToChapter = useCallback(
    async (chapterId: string) => {
      const target = navigationControllerRef.current?.getModel().resolveChapterTarget(chapterId);
      return target ? displayTarget(target) : false;
    },
    [displayTarget],
  );

  const navigateToLocation = useCallback(
    (cfi: string) => displayTarget(cfi, true),
    [displayTarget],
  );

  const navigateToTarget = useCallback((target: string) => displayTarget(target), [displayTarget]);

  useEffect(() => {
    let cancelled = false;
    let book: EpubBook | null = null;
    let bookDestroyed = false;
    let lifecycle: EpubSessionLifecycle | null = null;
    const generation = ++generationRef.current;
    const navigationController = createReaderNavigationStateController((state) =>
      bridgeRef.current?.onNavigationChange(state),
    );
    navigationControllerRef.current = navigationController;
    const displayCfi =
      canonicalCfiFileRef.current === fileBlob ? canonicalCfiRef.current : initialCfiRef.current;
    canonicalCfiFileRef.current = fileBlob;
    canonicalCfiRef.current = displayCfi;
    isNavigatingRef.current = false;
    invalidateTurnOwner();
    navigationController.reset();

    const destroyBookOnce = () => {
      if (!book || bookDestroyed) return;
      bookDestroyed = true;
      book.destroy();
    };

    const ownsSession = (session: EpubSessionSnapshot) =>
      !cancelled &&
      lifecycle?.snapshot === session &&
      !lifecycle.tornDown &&
      sessionRef.current === session &&
      generationRef.current === session.generation;

    const teardownSession = (session: EpubSessionSnapshot) => {
      const owner = lifecycle;
      if (!owner || owner.snapshot !== session || owner.tornDown) return;

      owner.tornDown = true;
      const wasCurrent = sessionRef.current === session;
      if (wasCurrent) sessionRef.current = null;
      owner.cancelDeferredNavigation();
      owner.cancelDeferredNavigation = () => undefined;
      invalidateTurnOwner(session);
      session.rendition.off("rendered", owner.onRendered);
      session.rendition.off("relocated", owner.onRelocated);
      session.rendition.off("selected", owner.onSelected);
      if (wasCurrent) isNavigatingRef.current = false;
      if (navigationControllerRef.current === navigationController) {
        navigationControllerRef.current = null;
      }
      bridgeRef.current?.onSessionEnding(session);
      destroyBookOnce();
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
      try {
        const epubModule = import("epubjs");
        let fileContents: ArrayBuffer | null = await fileBlob.arrayBuffer();
        if (cancelled || !containerRef.current) {
          fileContents = null;
          void epubModule.catch(() => undefined);
          return;
        }

        const { default: ePub } = await epubModule;
        if (cancelled || !containerRef.current) {
          fileContents = null;
          return;
        }
        book = ePub(fileContents);
        fileContents = null;
        await book.opened;
        if (cancelled || !containerRef.current) {
          destroyBookOnce();
          return;
        }

        const rendition = book.renderTo(containerRef.current, {
          width: "100%",
          height: "100%",
          flow: mode === "continuous" ? "scrolled-continuous" : "paginated",
          manager: mode === "continuous" ? "continuous" : "default",
          spread: "none",
          allowScriptedContent: false,
        });
        const session: EpubSessionSnapshot = { book, generation, rendition };
        const owner: EpubSessionLifecycle = {
          cancelDeferredNavigation: () => undefined,
          onRendered: (section, view) => {
            if (!ownsSession(session)) return;
            bridgeRef.current?.onRendered(section, view);
          },
          onRelocated: (location) => {
            if (!ownsSession(session)) return;
            canonicalCfiRef.current = location.start.cfi;
            navigationController.relocate(location);
            bridgeRef.current?.onRelocated();
            bridgeRef.current?.onLocationChange(
              normalizeReaderLocation(location, session.book.packaging.spine.length),
            );
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
        (rendition as RenditionWithContentHook).hooks?.content?.register?.(
          (content: EpubContent) => {
            if (!ownsSession(session)) return;
            bridgeRef.current?.onContent(content);
          },
        );
        bridgeRef.current?.onSessionCreated(session);
        rendition.on("rendered", owner.onRendered);
        rendition.on("relocated", owner.onRelocated);
        rendition.on("selected", owner.onSelected);

        await (rendition as RenditionWithManager).started;
        if (!ownsSession(session)) return;
        if (mode === "continuous") stabilizeContinuousRendition(rendition as RenditionWithManager);

        try {
          await rendition.display(displayCfi);
        } catch {
          if (!ownsSession(session)) return;
          await rendition.display();
        }
        if (!ownsSession(session)) return;

        bridgeRef.current?.onDisplayed();
        void book.locations.generate(1600).catch(() => {
          // Reading can continue without a calculated percentage.
        });
        setSettledSessionKey(sessionKey);
        bridgeRef.current?.onReady();
        deferNavigationLoad(owner);
      } catch {
        const failedSession = lifecycle?.snapshot;
        if (failedSession) teardownSession(failedSession);
        else destroyBookOnce();
        if (!cancelled) {
          setSettledSessionKey(sessionKey);
          bridgeRef.current?.onError({ kind: "open-failed" });
        }
      }
    };

    void openBook();

    return () => {
      cancelled = true;
      const endingSession = lifecycle?.snapshot;
      if (endingSession) teardownSession(endingSession);
      else destroyBookOnce();
      invalidateTurnOwner();
      isNavigatingRef.current = false;
      if (navigationControllerRef.current === navigationController) {
        navigationControllerRef.current = null;
      }
    };
  }, [bridgeRef, containerRef, fileBlob, invalidateTurnOwner, mode, sessionKey]);

  const getNavigationState = useCallback(
    () =>
      navigationControllerRef.current?.getState() ?? {
        chapters: [],
        status: "loading",
      },
    [],
  );
  const getRendition = useCallback(() => sessionRef.current?.rendition ?? null, []);
  const getSession = useCallback(() => sessionRef.current, []);

  return {
    getNavigationState,
    getRendition,
    getSession,
    isLoading: settledSessionKey !== sessionKey,
    navigateToChapter,
    navigateToLocation,
    navigateToTarget,
    turn,
  };
}
