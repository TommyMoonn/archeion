// @vitest-environment happy-dom

import type { Book as EpubBook, Location, Rendition } from "epubjs";
import type EpubSection from "epubjs/types/section";
import {
  act,
  forwardRef,
  StrictMode,
  useImperativeHandle,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EpubContent } from "./readerContentDocumentRegistry";
import { createReaderContentTheme } from "./readerTheme";
import { defaultReaderSettings } from "../../types/reader";
import { resolveBuiltInReaderTheme } from "../../themes/resolveTheme";
import { createReaderFileLease, type ReaderFileLease } from "./readerFileLease";
import {
  createReaderSessionLifecycle,
  transitionReaderSession,
  type ReaderSessionIdentity,
} from "./readerSession";
import {
  useEpubSession,
  type EpubSessionBridge,
  type EpubSessionFacade,
  type UseEpubSessionOptions,
} from "./useEpubSession";

const epubModuleMock = vi.hoisted(() => ({
  openBook: vi.fn(),
}));

vi.mock("epubjs", () => ({
  default: epubModuleMock.openBook,
}));

type Deferred<T> = {
  promise: Promise<T>;
  reject: (reason?: unknown) => void;
  resolve: (value: T) => void;
};

type MockRendition = Rendition & {
  contentCallbacks: Array<(content: EpubContent) => void>;
  display: ReturnType<typeof vi.fn>;
  eventCallbacks: Map<string, Array<(...args: unknown[]) => void>>;
  next: ReturnType<typeof vi.fn>;
  off: ReturnType<typeof vi.fn>;
  prev: ReturnType<typeof vi.fn>;
  started: Promise<void>;
  themes: {
    register: ReturnType<typeof vi.fn>;
    select: ReturnType<typeof vi.fn>;
  };
};

type MockBookSession = ReturnType<typeof createBookSession>;

type HarnessProps = Omit<UseEpubSessionOptions, "containerRef" | "sessionIdentity"> & {
  sessionIdentity?: ReaderSessionIdentity;
};

const SessionHarness = forwardRef<EpubSessionFacade, HarnessProps>(
  function SessionHarness(props, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const [fallbackIdentity] = useState(() => createSessionIdentity("test-book"));
    const facade = useEpubSession({
      ...props,
      containerRef,
      sessionIdentity: props.sessionIdentity ?? fallbackIdentity,
    });
    useImperativeHandle(ref, () => facade, [facade]);
    return <div ref={containerRef} />;
  },
);

const roots: Root[] = [];
const containers: HTMLDivElement[] = [];
const originalRequestIdleCallback = window.requestIdleCallback;
const originalCancelIdleCallback = window.cancelIdleCallback;
const SOURCE_RELEASE_MARK = "archeion:reader-source-bytes-released";
const SESSION_TEARDOWN_MEASURE = "archeion:reader-session-teardown";
let leaseSequence = 0;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createSessionIdentity(bookId: string): ReaderSessionIdentity {
  const opened = transitionReaderSession(createReaderSessionLifecycle(), { bookId, type: "open" });
  if (opened.kind !== "accepted" || !opened.state.identity) {
    throw new Error("Expected an opened Reader session identity.");
  }
  return opened.state.identity;
}

function leaseFor(
  blob: Blob,
  load: () => Promise<Blob> = () => Promise.resolve(blob),
): ReaderFileLease {
  return createReaderFileLease({
    initialBlob: blob,
    load,
    requestKey: `test:${blob.size}:${leaseSequence++}`,
  });
}

function createRendition(started: Promise<void> = Promise.resolve()): MockRendition {
  const currentListeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const eventCallbacks = new Map<string, Array<(...args: unknown[]) => void>>();
  const contentCallbacks: Array<(content: EpubContent) => void> = [];
  const rendition = {
    contentCallbacks,
    display: vi.fn(async () => undefined),
    eventCallbacks,
    hooks: {
      content: {
        register: vi.fn((callback: (content: EpubContent) => void) => {
          contentCallbacks.push(callback);
        }),
      },
    },
    next: vi.fn(async () => undefined),
    off: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      currentListeners.get(event)?.delete(callback);
    }),
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      const listeners = currentListeners.get(event) ?? new Set();
      listeners.add(callback);
      currentListeners.set(event, listeners);
      const registrations = eventCallbacks.get(event) ?? [];
      registrations.push(callback);
      eventCallbacks.set(event, registrations);
    }),
    prev: vi.fn(async () => undefined),
    started,
    themes: {
      register: vi.fn(),
      select: vi.fn(),
    },
  };
  return rendition as unknown as MockRendition;
}

function createBookSession(
  options: {
    locationsGenerate?: Promise<string[]>;
    navigation?: Promise<unknown>;
    opened?: Promise<unknown>;
    started?: Promise<void>;
  } = {},
) {
  const bookEventCallbacks = new Map<string, Array<(...args: unknown[]) => void>>();
  const bookListeners = new Map<string, Set<(...args: unknown[]) => void>>();
  const rendition = createRendition(options.started);
  const destroy = vi.fn();
  const generatedLocations = ["epubcfi(/6/2!/4/2:0)", "epubcfi(/6/4!/4/2:0)"];
  const generateLocations = vi.fn(
    () => options.locationsGenerate ?? Promise.resolve(generatedLocations),
  );
  const book = {
    destroy,
    loaded: {
      navigation: options.navigation ?? Promise.resolve({ toc: [] }),
    },
    locations: {
      cfiFromPercentage: vi.fn((percentage: number) =>
        percentage >= 1 ? generatedLocations[1] : generatedLocations[0],
      ),
      generate: generateLocations,
      percentageFromCfi: vi.fn((cfi: string) => (cfi === generatedLocations[1] ? 1 : 0)),
    },
    off: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      bookListeners.get(event)?.delete(callback);
    }),
    on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
      const listeners = bookListeners.get(event) ?? new Set();
      listeners.add(callback);
      bookListeners.set(event, listeners);
      const registrations = bookEventCallbacks.get(event) ?? [];
      registrations.push(callback);
      bookEventCallbacks.set(event, registrations);
    }),
    opened: options.opened ?? Promise.resolve(),
    packaging: {
      spine: [{}],
    },
    renderTo: vi.fn(() => rendition),
  } as unknown as EpubBook;

  return {
    book,
    bookEventCallbacks,
    destroy,
    generateLocations,
    emitBookEvent(event: string, ...args: unknown[]) {
      for (const callback of bookListeners.get(event) ?? []) callback(...args);
    },
    rendition,
  };
}

function createBridge(overrides: Partial<EpubSessionBridge> = {}): EpubSessionBridge {
  return {
    onContent: vi.fn(),
    onDisplayed: vi.fn(),
    onError: vi.fn(),
    onLocationChange: vi.fn(),
    onNavigationChange: vi.fn(),
    onReady: vi.fn(),
    onRelocated: vi.fn(),
    onRendered: vi.fn(),
    onSelected: vi.fn(),
    onSessionCreated: vi.fn(),
    onSessionEnding: vi.fn(),
    ...overrides,
  };
}

function createBridgeRef(bridge = createBridge()): RefObject<EpubSessionBridge> & {
  current: EpubSessionBridge;
} {
  return { current: bridge };
}

async function renderHarness(
  props: HarnessProps,
  facadeRef: RefObject<EpubSessionFacade | null> = { current: null },
  strictMode = false,
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  await act(async () => {
    root.render(
      strictMode ? (
        <StrictMode>
          <SessionHarness {...props} ref={facadeRef} />
        </StrictMode>
      ) : (
        <SessionHarness {...props} ref={facadeRef} />
      ),
    );
  });
  return { facadeRef, root };
}

async function rerenderHarness(
  root: Root,
  props: HarnessProps,
  facadeRef: RefObject<EpubSessionFacade | null>,
) {
  await act(async () => {
    root.render(<SessionHarness {...props} ref={facadeRef} />);
  });
}

async function waitForReady(session: MockBookSession, bridge: EpubSessionBridge): Promise<void> {
  await act(async () => {
    await vi.waitFor(() => {
      expect(session.rendition.display).toHaveBeenCalled();
      expect(bridge.onReady).toHaveBeenCalled();
    });
  });
}

function renditionOffCount(session: MockBookSession, event: string): number {
  return session.rendition.off.mock.calls.filter((call) => call[0] === event).length;
}

function emitStaleEvent(session: MockBookSession, event: string, ...args: unknown[]): void {
  for (const callback of session.rendition.eventCallbacks.get(event) ?? []) {
    callback(...args);
  }
}

function relocation(cfi = "epubcfi(/6/2!/4/2:4)"): Location {
  return {
    atEnd: false,
    atStart: false,
    end: {
      cfi: "epubcfi(/6/2!/4/2:8)",
      displayed: { page: 1, total: 2 },
      href: "Text/chapter.xhtml",
      index: 0,
      location: 0,
      percentage: 0.5,
    },
    start: {
      cfi,
      displayed: { page: 1, total: 2 },
      href: "Text/chapter.xhtml",
      index: 0,
      location: 0,
      percentage: 0.5,
    },
  };
}

beforeEach(() => {
  leaseSequence = 0;
  epubModuleMock.openBook.mockReset();
  performance.clearMarks(SOURCE_RELEASE_MARK);
  performance.clearMeasures(SESSION_TEARDOWN_MEASURE);
});

afterEach(() => {
  for (const root of roots.splice(0)) {
    act(() => root.unmount());
  }
  for (const container of containers.splice(0)) container.remove();
  vi.useRealTimers();
  window.requestIdleCallback = originalRequestIdleCallback;
  window.cancelIdleCallback = originalCancelIdleCallback;
  vi.restoreAllMocks();
  performance.clearMarks(SOURCE_RELEASE_MARK);
  performance.clearMeasures(SESSION_TEARDOWN_MEASURE);
});

describe("useEpubSession lifecycle", () => {
  it("releases source bytes after EPUB.js construction without ending the active session", async () => {
    const stages: string[] = [];
    const mark = performance.mark.bind(performance);
    vi.spyOn(performance, "mark").mockImplementation((name, options) => {
      if (name === SOURCE_RELEASE_MARK) stages.push("source-bytes-released");
      return mark(name, options);
    });
    const session = createBookSession();
    const fileBlob = new Blob(["book-a"]);
    vi.spyOn(fileBlob, "arrayBuffer").mockImplementation(async () => {
      stages.push("blob-to-array-buffer");
      return new ArrayBuffer(6);
    });
    epubModuleMock.openBook.mockImplementation(() => {
      stages.push("book-created");
      return session.book;
    });
    vi.mocked(session.book.on).mockImplementation(() => {
      stages.push("open-failure-listener-registered");
    });
    vi.mocked(session.book.off).mockImplementation(() => {
      stages.push("open-failure-listener-removed");
    });
    session.book.renderTo = vi.fn(() => {
      stages.push("rendition-created");
      return session.rendition;
    });
    session.rendition.display.mockImplementation(async () => {
      stages.push("first-location-displayed");
    });
    session.destroy.mockImplementation(() => {
      stages.push("book-destroyed");
    });
    const bridge = createBridge({
      onReady: vi.fn(() => stages.push("session-ready")),
      onSessionCreated: vi.fn(() => stages.push("session-created")),
      onSessionEnding: vi.fn(() => stages.push("session-ending")),
    });
    const { root } = await renderHarness({
      bridgeRef: createBridgeRef(bridge),
      fileLease: leaseFor(fileBlob),
      mode: "paged",
    });
    await waitForReady(session, bridge);

    expect(performance.getEntriesByName(SOURCE_RELEASE_MARK, "mark")).toHaveLength(1);
    expect(session.destroy).not.toHaveBeenCalled();
    expect(bridge.onSessionEnding).not.toHaveBeenCalled();

    act(() => root.unmount());

    expect(stages).toEqual([
      "blob-to-array-buffer",
      "book-created",
      "open-failure-listener-registered",
      "source-bytes-released",
      "open-failure-listener-removed",
      "rendition-created",
      "session-created",
      "first-location-displayed",
      "session-ready",
      "session-ending",
      "book-destroyed",
    ]);
    expect(performance.getEntriesByName(SESSION_TEARDOWN_MEASURE, "measure")).toHaveLength(1);
    expect(performance.getEntriesByName(SOURCE_RELEASE_MARK, "mark")).toHaveLength(1);
  });

  it("creates one session, displays the initial CFI, and tears it down exactly once", async () => {
    const session = createBookSession();
    const bridge = createBridge();
    epubModuleMock.openBook.mockReturnValue(session.book);
    const { root } = await renderHarness({
      bridgeRef: createBridgeRef(bridge),
      fileLease: leaseFor(new Blob(["book-a"])),
      initialCfi: "epubcfi(/6/2!/4/2:4)",
      mode: "paged",
    });
    await waitForReady(session, bridge);

    expect(session.rendition.display).toHaveBeenCalledWith("epubcfi(/6/2!/4/2:4)");
    expect(bridge.onSessionCreated).toHaveBeenCalledTimes(1);
    expect(session.book.on).toHaveBeenCalledTimes(1);
    expect(session.book.on).toHaveBeenCalledWith("openFailed", expect.any(Function));
    expect(session.book.off).toHaveBeenCalledTimes(1);
    expect(session.book.off).toHaveBeenCalledWith("openFailed", expect.any(Function));

    act(() => root.unmount());

    expect(session.rendition.off).toHaveBeenCalledTimes(3);
    expect(renditionOffCount(session, "rendered")).toBe(1);
    expect(renditionOffCount(session, "relocated")).toBe(1);
    expect(renditionOffCount(session, "selected")).toBe(1);
    expect(session.rendition.off).toHaveBeenCalledWith(
      "rendered",
      session.rendition.eventCallbacks.get("rendered")?.[0],
    );
    expect(session.rendition.off).toHaveBeenCalledWith(
      "relocated",
      session.rendition.eventCallbacks.get("relocated")?.[0],
    );
    expect(session.rendition.off).toHaveBeenCalledWith(
      "selected",
      session.rendition.eventCallbacks.get("selected")?.[0],
    );
    expect(bridge.onSessionEnding).toHaveBeenCalledTimes(1);
    expect(session.destroy).toHaveBeenCalledTimes(1);
    expect(session.book.off).toHaveBeenCalledTimes(1);
  });

  it("returns narrow navigation, location, document, and teardown capabilities", async () => {
    const session = createBookSession();
    const bridge = createBridge();
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    epubModuleMock.openBook.mockReturnValue(session.book);
    await renderHarness(
      {
        bridgeRef: createBridgeRef(bridge),
        fileLease: leaseFor(new Blob(["book-a"])),
        mode: "paged",
      },
      facadeRef,
    );
    await waitForReady(session, bridge);

    expect(facadeRef.current).toEqual(
      expect.objectContaining({
        applyContentTheme: expect.any(Function),
        documents: expect.any(Object),
        getInteractionSession: expect.any(Function),
        getNavigationHistorySnapshot: expect.any(Function),
        getRelocation: expect.any(Function),
        getNavigationState: expect.any(Function),
        getSeekMapState: expect.any(Function),
        navigateBack: expect.any(Function),
        navigateForward: expect.any(Function),
        navigateToChapter: expect.any(Function),
        navigateToLocation: expect.any(Function),
        navigateToTarget: expect.any(Function),
        searchPublication: expect.any(Function),
        subscribeSeekMap: expect.any(Function),
        teardown: expect.any(Function),
        turn: expect.any(Function),
      }),
    );
    expect(facadeRef.current).not.toHaveProperty("getRendition");
    expect(facadeRef.current).not.toHaveProperty("getSession");
    expect(facadeRef.current?.documents).not.toHaveProperty("bind");
    expect(facadeRef.current?.documents).not.toHaveProperty("clear");
    const interactionSession = facadeRef.current?.getInteractionSession();
    expect(interactionSession).toBe(vi.mocked(bridge.onSessionCreated).mock.calls[0]?.[0]);
    expect(interactionSession).not.toHaveProperty("book");
    expect(interactionSession).not.toHaveProperty("rendition");
    expect(interactionSession).not.toHaveProperty("destroy");
  });

  it("owns seek-map generation from pending through ready after the first usable display", async () => {
    const locationGeneration = deferred<string[]>();
    const session = createBookSession({ locationsGenerate: locationGeneration.promise });
    const stages: string[] = [];
    session.rendition.display.mockImplementation(async () => {
      stages.push("display");
    });
    session.generateLocations.mockImplementation(() => {
      stages.push("generate-locations");
      return locationGeneration.promise;
    });
    const bridge = createBridge();
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    epubModuleMock.openBook.mockReturnValue(session.book);
    await renderHarness(
      {
        bridgeRef: createBridgeRef(bridge),
        fileLease: leaseFor(new Blob(["book-a"])),
        mode: "paged",
      },
      facadeRef,
    );
    await waitForReady(session, bridge);

    expect(stages).toEqual(["display", "generate-locations"]);
    expect(facadeRef.current?.getSeekMapState()).toEqual({ status: "pending" });
    const onSeekMapChange = vi.fn();
    const unsubscribe = facadeRef.current?.subscribeSeekMap(onSeekMapChange);

    await act(async () => {
      locationGeneration.resolve(["epubcfi(/6/2!/4/2:0)", "epubcfi(/6/4!/4/2:0)"]);
      await locationGeneration.promise;
    });

    expect(onSeekMapChange).toHaveBeenCalledTimes(1);
    unsubscribe?.();
    const seekState = facadeRef.current?.getSeekMapState();
    expect(seekState?.status).toBe("ready");
    if (seekState?.status === "ready") {
      expect(seekState.resolveCfi(0)).toBe("epubcfi(/6/2!/4/2:0)");
      expect(seekState.resolveCfi(1)).toBe("epubcfi(/6/4!/4/2:0)");
      expect(seekState.resolvePercentage("epubcfi(/6/4!/4/2:0)")).toBe(1);
    }
  });

  it("keeps ordinary reading ready when seek-map generation fails", async () => {
    const locationGeneration = deferred<string[]>();
    const session = createBookSession({ locationsGenerate: locationGeneration.promise });
    const bridge = createBridge();
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    epubModuleMock.openBook.mockReturnValue(session.book);
    await renderHarness(
      {
        bridgeRef: createBridgeRef(bridge),
        fileLease: leaseFor(new Blob(["book-a"])),
        mode: "paged",
      },
      facadeRef,
    );
    await waitForReady(session, bridge);

    await act(async () => {
      locationGeneration.reject(new Error("seek map unavailable"));
      await locationGeneration.promise.catch(() => undefined);
    });

    await vi.waitFor(() => {
      expect(facadeRef.current?.getSeekMapState()).toEqual({ status: "unavailable" });
    });
    expect(facadeRef.current?.isLoading).toBe(false);
    expect(bridge.onReady).toHaveBeenCalledTimes(1);
    expect(bridge.onError).not.toHaveBeenCalled();
  });

  it("prevents an old seek-map generation from becoming current after same-Reader rendition replacement", async () => {
    const generationA = deferred<string[]>();
    const generationB = deferred<string[]>();
    const sessionA = createBookSession({ locationsGenerate: generationA.promise });
    const sessionB = createBookSession({ locationsGenerate: generationB.promise });
    const bridge = createBridge();
    const bridgeRef = createBridgeRef(bridge);
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    const identity = createSessionIdentity("book-a");
    const fileLease = leaseFor(new Blob(["book-a"]));
    epubModuleMock.openBook.mockReturnValueOnce(sessionA.book).mockReturnValueOnce(sessionB.book);
    const { root } = await renderHarness(
      {
        bridgeRef,
        fileLease,
        mode: "paged",
        sessionIdentity: identity,
      },
      facadeRef,
    );
    await waitForReady(sessionA, bridge);

    await rerenderHarness(
      root,
      {
        bridgeRef,
        fileLease,
        mode: "continuous",
        sessionIdentity: identity,
      },
      facadeRef,
    );
    await act(async () => {
      await vi.waitFor(() => expect(sessionB.rendition.display).toHaveBeenCalled());
    });
    expect(facadeRef.current?.getSeekMapState()).toEqual({ status: "pending" });

    await act(async () => {
      generationA.resolve(["epubcfi(/6/2!/4/2:0)"]);
      await generationA.promise;
    });
    expect(facadeRef.current?.getSeekMapState()).toEqual({ status: "pending" });

    await act(async () => {
      generationB.resolve(["epubcfi(/6/4!/4/2:0)"]);
      await generationB.promise;
    });
    await vi.waitFor(() => expect(facadeRef.current?.getSeekMapState().status).toBe("ready"));
  });

  it("clears seek readiness when the active EPUB session is torn down", async () => {
    const session = createBookSession();
    const bridge = createBridge();
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    epubModuleMock.openBook.mockReturnValue(session.book);
    await renderHarness(
      {
        bridgeRef: createBridgeRef(bridge),
        fileLease: leaseFor(new Blob(["book-a"])),
        mode: "paged",
      },
      facadeRef,
    );
    await waitForReady(session, bridge);
    await vi.waitFor(() => expect(facadeRef.current?.getSeekMapState().status).toBe("ready"));

    act(() => facadeRef.current?.teardown());

    expect(facadeRef.current?.getSeekMapState()).toEqual({ status: "pending" });
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  it("uses one idempotent teardown for explicit retirement and effect cleanup", async () => {
    const session = createBookSession();
    const bridge = createBridge();
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    epubModuleMock.openBook.mockReturnValue(session.book);
    const { root } = await renderHarness(
      {
        bridgeRef: createBridgeRef(bridge),
        fileLease: leaseFor(new Blob(["book-a"])),
        mode: "paged",
      },
      facadeRef,
    );
    await waitForReady(session, bridge);
    const registeredDocument = document.implementation.createHTMLDocument("active-session");
    session.rendition.contentCallbacks[0]?.({ document: registeredDocument });
    expect(facadeRef.current?.documents.has(registeredDocument)).toBe(true);

    act(() => {
      facadeRef.current?.teardown();
      facadeRef.current?.teardown();
    });

    expect(facadeRef.current?.getInteractionSession()).toBeNull();
    expect(facadeRef.current?.getRelocation()).toBeNull();
    expect(facadeRef.current?.documents.has(registeredDocument)).toBe(false);
    expect(bridge.onSessionEnding).toHaveBeenCalledOnce();
    expect(session.rendition.off).toHaveBeenCalledTimes(3);
    expect(session.destroy).toHaveBeenCalledOnce();

    act(() => root.unmount());

    expect(bridge.onSessionEnding).toHaveBeenCalledOnce();
    expect(session.rendition.off).toHaveBeenCalledTimes(3);
    expect(session.destroy).toHaveBeenCalledOnce();
  });

  it("does not retain a disposed rendition across StrictMode effect replay", async () => {
    const sessions = [createBookSession(), createBookSession()];
    const bridge = createBridge();
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    epubModuleMock.openBook
      .mockReturnValueOnce(sessions[0].book)
      .mockReturnValueOnce(sessions[1].book);
    const { root } = await renderHarness(
      {
        bridgeRef: createBridgeRef(bridge),
        fileLease: leaseFor(new Blob(["strict-book"])),
        mode: "paged",
        sessionIdentity: createSessionIdentity("strict-book"),
      },
      facadeRef,
      true,
    );
    await act(async () => {
      await vi.waitFor(() => expect(bridge.onReady).toHaveBeenCalledOnce());
    });

    const createdSessions = sessions.slice(0, epubModuleMock.openBook.mock.calls.length);
    expect(facadeRef.current?.getInteractionSession()).not.toBeNull();
    expect(createdSessions.at(-1)?.destroy).not.toHaveBeenCalled();
    for (const retiredSession of createdSessions.slice(0, -1)) {
      expect(retiredSession.destroy).toHaveBeenCalledOnce();
    }

    act(() => root.unmount());

    for (const createdSession of createdSessions) {
      expect(createdSession.destroy).toHaveBeenCalledOnce();
    }
    expect(facadeRef.current).toBeNull();
  });

  it("destroys a retired book session before its identity replacement publishes ready", async () => {
    const stages: string[] = [];
    const sessionA = createBookSession();
    const sessionB = createBookSession();
    sessionA.destroy.mockImplementation(() => stages.push("session-a-destroyed"));
    const bridge = createBridge({
      onReady: vi
        .fn()
        .mockImplementationOnce(() => stages.push("session-a-ready"))
        .mockImplementationOnce(() => stages.push("session-b-ready")),
    });
    const bridgeRef = createBridgeRef(bridge);
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    const identityA = createSessionIdentity("book-a");
    const identityB = createSessionIdentity("book-b");
    epubModuleMock.openBook.mockReturnValueOnce(sessionA.book).mockReturnValueOnce(sessionB.book);
    const { root } = await renderHarness(
      {
        bridgeRef,
        fileLease: leaseFor(new Blob(["book-a"])),
        mode: "paged",
        sessionIdentity: identityA,
      },
      facadeRef,
    );
    await waitForReady(sessionA, bridge);

    await rerenderHarness(
      root,
      {
        bridgeRef,
        fileLease: leaseFor(new Blob(["book-b"])),
        mode: "paged",
        sessionIdentity: identityB,
      },
      facadeRef,
    );
    await act(async () => {
      await vi.waitFor(() => expect(bridge.onReady).toHaveBeenCalledTimes(2));
    });

    expect(stages).toEqual(["session-a-ready", "session-a-destroyed", "session-b-ready"]);
    expect(facadeRef.current?.getInteractionSession()).toBe(
      vi.mocked(bridge.onSessionCreated).mock.calls.at(-1)?.[0],
    );
  });

  it("retires the previous registry before replacement readiness and rejects its documents", async () => {
    const stages: string[] = [];
    const sessionA = createBookSession();
    const sessionB = createBookSession();
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    const bridge = createBridge({
      onReady: vi.fn(() => stages.push(`ready:${facadeRef.current?.documents.list().length}`)),
      onSessionEnding: vi.fn(() =>
        stages.push(`ending:${facadeRef.current?.documents.list().length}`),
      ),
    });
    const bridgeRef = createBridgeRef(bridge);
    epubModuleMock.openBook.mockReturnValueOnce(sessionA.book).mockReturnValueOnce(sessionB.book);
    const { root } = await renderHarness(
      {
        bridgeRef,
        fileLease: leaseFor(new Blob(["book-a"])),
        mode: "paged",
        sessionIdentity: createSessionIdentity("book-a"),
      },
      facadeRef,
    );
    await waitForReady(sessionA, bridge);
    const oldDocument = document.implementation.createHTMLDocument("book-a");
    sessionA.rendition.contentCallbacks[0]?.({ document: oldDocument });
    expect(facadeRef.current?.documents.has(oldDocument)).toBe(true);

    await rerenderHarness(
      root,
      {
        bridgeRef,
        fileLease: leaseFor(new Blob(["book-b"])),
        mode: "paged",
        sessionIdentity: createSessionIdentity("book-b"),
      },
      facadeRef,
    );
    await act(async () => {
      await vi.waitFor(() => {
        expect(sessionB.rendition.display).toHaveBeenCalled();
        expect(bridge.onReady).toHaveBeenCalledTimes(2);
      });
    });

    expect(stages).toEqual(["ready:0", "ending:0", "ready:0"]);
    expect(facadeRef.current?.documents.has(oldDocument)).toBe(false);
    sessionA.rendition.contentCallbacks[0]?.({ document: oldDocument });
    expect(facadeRef.current?.documents.has(oldDocument)).toBe(false);
  });

  it("applies Reader appearance only to the active replacement rendition", async () => {
    const sessionA = createBookSession();
    const sessionB = createBookSession();
    const bridge = createBridge();
    const bridgeRef = createBridgeRef(bridge);
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    const dark = resolveBuiltInReaderTheme("dark");
    const sepia = resolveBuiltInReaderTheme("sepia");
    const darkContent = createReaderContentTheme(defaultReaderSettings, dark.tokens);
    const sepiaContent = createReaderContentTheme(defaultReaderSettings, sepia.tokens);
    epubModuleMock.openBook.mockReturnValueOnce(sessionA.book).mockReturnValueOnce(sessionB.book);
    const { root } = await renderHarness(
      {
        bridgeRef,
        fileLease: leaseFor(new Blob(["book-a"])),
        mode: "paged",
        sessionIdentity: createSessionIdentity("book-a"),
      },
      facadeRef,
    );
    await waitForReady(sessionA, bridge);

    facadeRef.current?.applyContentTheme(darkContent, null);
    expect(sessionA.rendition.themes.register).toHaveBeenCalledOnce();

    await rerenderHarness(
      root,
      {
        bridgeRef,
        fileLease: leaseFor(new Blob(["book-b"])),
        mode: "paged",
        sessionIdentity: createSessionIdentity("book-b"),
      },
      facadeRef,
    );
    await waitForReady(sessionB, bridge);
    facadeRef.current?.applyContentTheme(sepiaContent, null);

    expect(sessionA.rendition.themes.register).toHaveBeenCalledOnce();
    expect(sessionB.rendition.themes.register).toHaveBeenLastCalledWith(
      "archeion-reader",
      expect.objectContaining({
        body: expect.objectContaining({ background: `${sepia.tokens.background} !important` }),
      }),
    );
    sessionA.rendition.contentCallbacks[0]?.({
      document: document.implementation.createHTMLDocument("retired"),
    });
    expect(facadeRef.current?.documents.list()).toHaveLength(0);
  });

  it("exposes location only for the active session and ignores stale relocation", async () => {
    const sessionA = createBookSession();
    const sessionB = createBookSession();
    const bridge = createBridge();
    const bridgeRef = createBridgeRef(bridge);
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    epubModuleMock.openBook.mockReturnValueOnce(sessionA.book).mockReturnValueOnce(sessionB.book);
    const { root } = await renderHarness(
      {
        bridgeRef,
        fileLease: leaseFor(new Blob(["book-a"])),
        mode: "paged",
        sessionIdentity: createSessionIdentity("book-a"),
      },
      facadeRef,
    );
    await waitForReady(sessionA, bridge);
    emitStaleEvent(sessionA, "relocated", relocation("epubcfi(/book-a)"));
    expect(facadeRef.current?.getRelocation()?.cfi).toBe("epubcfi(/book-a)");
    expect(bridge.onLocationChange).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cfi: "epubcfi(/book-a)",
        rawPercentage: 0.5,
        sectionCount: 1,
      }),
    );

    await rerenderHarness(
      root,
      {
        bridgeRef,
        fileLease: leaseFor(new Blob(["book-b"])),
        mode: "paged",
        sessionIdentity: createSessionIdentity("book-b"),
      },
      facadeRef,
    );
    await act(async () => {
      await vi.waitFor(() => {
        expect(sessionB.rendition.display).toHaveBeenCalled();
        expect(bridge.onReady).toHaveBeenCalledTimes(2);
      });
    });
    expect(facadeRef.current?.getRelocation()).toBeNull();

    const publicationCount = vi.mocked(bridge.onLocationChange).mock.calls.length;
    emitStaleEvent(sessionA, "relocated", relocation("epubcfi(/stale-book-a)"));
    expect(facadeRef.current?.getRelocation()).toBeNull();
    expect(bridge.onLocationChange).toHaveBeenCalledTimes(publicationCount);

    emitStaleEvent(sessionB, "relocated", relocation("epubcfi(/book-b)"));
    expect(facadeRef.current?.getRelocation()?.cfi).toBe("epubcfi(/book-b)");
  });

  it("settles startup failure once and retries with a fresh Reader session identity", async () => {
    const failedStart = deferred<void>();
    const failedSession = createBookSession({ started: failedStart.promise });
    const retrySession = createBookSession();
    const bridge = createBridge();
    const bridgeRef = createBridgeRef(bridge);
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    const fileLease = leaseFor(new Blob(["retry-book"]));
    const failedIdentity = createSessionIdentity("retry-book");
    const retryIdentity = createSessionIdentity("retry-book");
    epubModuleMock.openBook
      .mockReturnValueOnce(failedSession.book)
      .mockReturnValueOnce(retrySession.book);
    const { root } = await renderHarness(
      {
        bridgeRef,
        fileLease,
        mode: "paged",
        sessionIdentity: failedIdentity,
      },
      facadeRef,
    );

    await act(async () => {
      failedStart.reject(new Error("rendition start failed"));
      await vi.waitFor(() => expect(bridge.onError).toHaveBeenCalledOnce());
    });
    expect(failedSession.destroy).toHaveBeenCalledOnce();
    expect(bridge.onError).toHaveBeenCalledWith(failedIdentity, { kind: "open-failed" });
    expect(bridge.onReady).not.toHaveBeenCalled();
    expect(facadeRef.current?.documents.list()).toEqual([]);
    expect(facadeRef.current?.getInteractionSession()).toBeNull();

    await rerenderHarness(
      root,
      {
        bridgeRef,
        fileLease,
        mode: "paged",
        sessionIdentity: retryIdentity,
      },
      facadeRef,
    );
    await waitForReady(retrySession, bridge);

    expect(epubModuleMock.openBook).toHaveBeenCalledTimes(2);
    expect(bridge.onError).toHaveBeenCalledOnce();
    expect(bridge.onReady).toHaveBeenCalledOnce();
    expect(bridge.onReady).toHaveBeenCalledWith(retryIdentity);
    expect(facadeRef.current?.getInteractionSession()).not.toBeNull();
  });

  it("does not create an EPUB.js book when teardown cancels a pending byte conversion", async () => {
    const contents = deferred<ArrayBuffer>();
    const fileBlob = new Blob(["book-a"]);
    vi.spyOn(fileBlob, "arrayBuffer").mockReturnValue(contents.promise);
    const { root } = await renderHarness({
      bridgeRef: createBridgeRef(),
      fileLease: leaseFor(fileBlob),
      mode: "paged",
    });

    act(() => root.unmount());
    await act(async () => contents.resolve(new ArrayBuffer(8)));

    expect(epubModuleMock.openBook).not.toHaveBeenCalled();
    expect(performance.getEntriesByName(SOURCE_RELEASE_MARK, "mark")).toHaveLength(1);
  });

  it("does not convert a source handoff acquired after its session was cancelled", async () => {
    const replacement = deferred<Blob>();
    const fileLease = leaseFor(new Blob(["initial"]), () => replacement.promise);
    const initial = await fileLease.acquire();
    initial.release();
    const replacementBlob = new Blob(["replacement"]);
    const arrayBuffer = vi.spyOn(replacementBlob, "arrayBuffer");
    const { root } = await renderHarness({
      bridgeRef: createBridgeRef(),
      fileLease,
      mode: "paged",
    });

    act(() => root.unmount());
    await act(async () => replacement.resolve(replacementBlob));

    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(epubModuleMock.openBook).not.toHaveBeenCalled();
  });

  it("releases source bytes when Blob conversion fails", async () => {
    const fileBlob = new Blob(["book-a"]);
    vi.spyOn(fileBlob, "arrayBuffer").mockRejectedValue(new Error("conversion failed"));
    const bridge = createBridge();

    await renderHarness({
      bridgeRef: createBridgeRef(bridge),
      fileLease: leaseFor(fileBlob),
      mode: "paged",
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(bridge.onError).toHaveBeenCalledWith(expect.anything(), { kind: "open-failed" }),
      );
    });

    expect(epubModuleMock.openBook).not.toHaveBeenCalled();
    expect(performance.getEntriesByName(SOURCE_RELEASE_MARK, "mark")).toHaveLength(1);
  });

  it("releases source bytes when EPUB.js Book construction fails", async () => {
    const bridge = createBridge();
    epubModuleMock.openBook.mockImplementation(() => {
      throw new Error("book construction failed");
    });

    await renderHarness({
      bridgeRef: createBridgeRef(bridge),
      fileLease: leaseFor(new Blob(["book-a"])),
      mode: "paged",
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(bridge.onError).toHaveBeenCalledWith(expect.anything(), { kind: "open-failed" }),
      );
    });

    expect(performance.getEntriesByName(SOURCE_RELEASE_MARK, "mark")).toHaveLength(1);
  });

  it("handles EPUB.js openFailed while book.opened remains pending", async () => {
    const opened = deferred<unknown>();
    const session = createBookSession({ opened: opened.promise });
    const bridge = createBridge();
    epubModuleMock.openBook.mockReturnValue(session.book);

    await renderHarness({
      bridgeRef: createBridgeRef(bridge),
      fileLease: leaseFor(new Blob(["book-a"])),
      mode: "paged",
    });
    await act(async () => {
      await vi.waitFor(() => expect(session.book.on).toHaveBeenCalled());
    });

    act(() => {
      session.emitBookEvent("openFailed", new Error("invalid EPUB"));
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(bridge.onError).toHaveBeenCalledWith(expect.anything(), { kind: "open-failed" }),
      );
    });

    expect(session.destroy).toHaveBeenCalledTimes(1);
    expect(performance.getEntriesByName(SOURCE_RELEASE_MARK, "mark")).toHaveLength(1);
    expect(session.book.renderTo).not.toHaveBeenCalled();
    expect(bridge.onSessionCreated).not.toHaveBeenCalled();
    expect(session.book.off).toHaveBeenCalledTimes(1);
    expect(session.book.off).toHaveBeenCalledWith(
      "openFailed",
      session.bookEventCallbacks.get("openFailed")?.[0],
    );
  });

  it("settles a pending Book open on unmount without publishing an error", async () => {
    const opened = deferred<unknown>();
    const session = createBookSession({ opened: opened.promise });
    const bridge = createBridge();
    epubModuleMock.openBook.mockReturnValue(session.book);
    const { root } = await renderHarness({
      bridgeRef: createBridgeRef(bridge),
      fileLease: leaseFor(new Blob(["book-a"])),
      mode: "paged",
    });
    await act(async () => {
      await vi.waitFor(() => expect(session.book.on).toHaveBeenCalled());
    });

    act(() => root.unmount());

    expect(session.book.off).toHaveBeenCalledTimes(1);
    expect(session.destroy).toHaveBeenCalledTimes(1);
    expect(session.book.renderTo).not.toHaveBeenCalled();
    expect(bridge.onError).not.toHaveBeenCalled();
    expect(bridge.onSessionCreated).not.toHaveBeenCalled();
  });

  it.each([
    ["file replacement", "file"],
    ["mode replacement", "mode"],
  ] as const)("ignores an old Book openFailed event after %s", async (_label, replacementKind) => {
    const openedA = deferred<unknown>();
    const sessionA = createBookSession({ opened: openedA.promise });
    const sessionB = createBookSession();
    const bridge = createBridge();
    const bridgeRef = createBridgeRef(bridge);
    const fileLeaseA = leaseFor(new Blob(["book-a"]));
    const fileLeaseB = replacementKind === "file" ? leaseFor(new Blob(["book-b"])) : fileLeaseA;
    epubModuleMock.openBook.mockReturnValueOnce(sessionA.book).mockReturnValueOnce(sessionB.book);
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    const { root } = await renderHarness(
      { bridgeRef, fileLease: fileLeaseA, mode: "paged" },
      facadeRef,
    );
    await act(async () => {
      await vi.waitFor(() => expect(sessionA.book.on).toHaveBeenCalled());
    });
    const staleOpenFailed = sessionA.bookEventCallbacks.get("openFailed")?.[0];

    await rerenderHarness(
      root,
      {
        bridgeRef,
        fileLease: fileLeaseB,
        mode: replacementKind === "mode" ? "continuous" : "paged",
      },
      facadeRef,
    );
    await waitForReady(sessionB, bridge);

    act(() => {
      staleOpenFailed?.(new Error("stale open failure"));
    });

    expect(sessionA.book.off).toHaveBeenCalledTimes(1);
    expect(sessionA.destroy).toHaveBeenCalledTimes(1);
    expect(sessionB.destroy).not.toHaveBeenCalled();
    expect(bridge.onError).not.toHaveBeenCalled();
    expect(bridge.onSessionCreated).toHaveBeenCalledTimes(1);
  });

  it("defensively handles a rejected book.opened Promise", async () => {
    const session = createBookSession({
      opened: Promise.reject(new Error("book open failed")),
    });
    const bridge = createBridge();
    epubModuleMock.openBook.mockReturnValue(session.book);

    await renderHarness({
      bridgeRef: createBridgeRef(bridge),
      fileLease: leaseFor(new Blob(["book-a"])),
      mode: "paged",
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(bridge.onError).toHaveBeenCalledWith(expect.anything(), { kind: "open-failed" }),
      );
    });

    expect(session.destroy).toHaveBeenCalledTimes(1);
    expect(session.book.off).toHaveBeenCalledTimes(1);
    expect(session.book.renderTo).not.toHaveBeenCalled();
    expect(bridge.onSessionCreated).not.toHaveBeenCalled();
  });

  it("destroys the Book and releases source bytes when Rendition construction fails", async () => {
    const session = createBookSession();
    session.book.renderTo = vi.fn(() => {
      throw new Error("rendition construction failed");
    });
    const bridge = createBridge();
    epubModuleMock.openBook.mockReturnValue(session.book);

    await renderHarness({
      bridgeRef: createBridgeRef(bridge),
      fileLease: leaseFor(new Blob(["book-a"])),
      mode: "paged",
    });
    await act(async () => {
      await vi.waitFor(() =>
        expect(bridge.onError).toHaveBeenCalledWith(expect.anything(), { kind: "open-failed" }),
      );
    });

    expect(session.destroy).toHaveBeenCalledTimes(1);
    expect(performance.getEntriesByName(SOURCE_RELEASE_MARK, "mark")).toHaveLength(1);
  });

  it("releases every superseded EPUB.js session across repeated book transitions", async () => {
    const sessions = Array.from({ length: 5 }, () => createBookSession());
    const bridge = createBridge();
    const bridgeRef = createBridgeRef(bridge);
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    for (const session of sessions) {
      epubModuleMock.openBook.mockReturnValueOnce(session.book);
    }

    const { root } = await renderHarness(
      { bridgeRef, fileLease: leaseFor(new Blob(["book-0"])), mode: "paged" },
      facadeRef,
    );
    await waitForReady(sessions[0], bridge);

    for (let index = 1; index < sessions.length; index += 1) {
      await rerenderHarness(
        root,
        { bridgeRef, fileLease: leaseFor(new Blob([`book-${index}`])), mode: "paged" },
        facadeRef,
      );
      await waitForReady(sessions[index], bridge);
      expect(sessions[index - 1].destroy).toHaveBeenCalledTimes(1);
    }

    act(() => root.unmount());
    expect(sessions.at(-1)?.destroy).toHaveBeenCalledTimes(1);
    expect(epubModuleMock.openBook).toHaveBeenCalledTimes(sessions.length);
  });

  it("keeps the session when the initial display fails but fallback display succeeds", async () => {
    const session = createBookSession();
    session.rendition.display
      .mockRejectedValueOnce(new Error("saved CFI unavailable"))
      .mockResolvedValueOnce(undefined);
    const bridge = createBridge();
    epubModuleMock.openBook.mockReturnValue(session.book);

    await renderHarness({
      bridgeRef: createBridgeRef(bridge),
      fileLease: leaseFor(new Blob(["book-a"])),
      initialCfi: "epubcfi(/6/2!/4/2:4)",
      mode: "paged",
    });
    await waitForReady(session, bridge);

    expect(session.rendition.display).toHaveBeenNthCalledWith(1, "epubcfi(/6/2!/4/2:4)");
    expect(session.rendition.display).toHaveBeenNthCalledWith(2);
    expect(bridge.onError).not.toHaveBeenCalled();
    expect(bridge.onSessionEnding).not.toHaveBeenCalled();
    expect(session.destroy).not.toHaveBeenCalled();
  });

  it("uses complete idempotent teardown when rendition startup fails", async () => {
    const started = deferred<void>();
    const session = createBookSession({ started: started.promise });
    const bridge = createBridge();
    epubModuleMock.openBook.mockReturnValue(session.book);
    const { root } = await renderHarness({
      bridgeRef: createBridgeRef(bridge),
      fileLease: leaseFor(new Blob(["book-a"])),
      mode: "paged",
    });

    await act(async () => {
      started.reject(new Error("rendition start failed"));
      await vi.waitFor(() =>
        expect(bridge.onError).toHaveBeenCalledWith(expect.anything(), { kind: "open-failed" }),
      );
    });

    expect(session.rendition.off).toHaveBeenCalledTimes(3);
    expect(renditionOffCount(session, "rendered")).toBe(1);
    expect(renditionOffCount(session, "relocated")).toBe(1);
    expect(renditionOffCount(session, "selected")).toBe(1);
    expect(bridge.onSessionEnding).toHaveBeenCalledTimes(1);
    expect(session.destroy).toHaveBeenCalledTimes(1);

    act(() => root.unmount());

    expect(session.rendition.off).toHaveBeenCalledTimes(3);
    expect(bridge.onSessionEnding).toHaveBeenCalledTimes(1);
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  it("tears down once when both initial and fallback display fail", async () => {
    const session = createBookSession();
    session.rendition.display.mockRejectedValue(new Error("display failed"));
    const bridge = createBridge();
    epubModuleMock.openBook.mockReturnValue(session.book);
    const { root } = await renderHarness({
      bridgeRef: createBridgeRef(bridge),
      fileLease: leaseFor(new Blob(["book-a"])),
      initialCfi: "epubcfi(/6/2!/4/2:4)",
      mode: "paged",
    });

    await act(async () => {
      await vi.waitFor(() =>
        expect(bridge.onError).toHaveBeenCalledWith(expect.anything(), { kind: "open-failed" }),
      );
    });

    expect(session.rendition.display).toHaveBeenCalledTimes(2);
    expect(session.rendition.off).toHaveBeenCalledTimes(3);
    expect(renditionOffCount(session, "rendered")).toBe(1);
    expect(renditionOffCount(session, "relocated")).toBe(1);
    expect(renditionOffCount(session, "selected")).toBe(1);
    expect(bridge.onSessionEnding).toHaveBeenCalledTimes(1);
    expect(session.destroy).toHaveBeenCalledTimes(1);

    act(() => root.unmount());

    expect(session.rendition.off).toHaveBeenCalledTimes(3);
    expect(bridge.onSessionEnding).toHaveBeenCalledTimes(1);
    expect(session.destroy).toHaveBeenCalledTimes(1);
  });

  it("uses current bridge callbacks without recreating the active EPUB session", async () => {
    const session = createBookSession();
    const initialBridge = createBridge();
    const bridgeRef = createBridgeRef(initialBridge);
    epubModuleMock.openBook.mockReturnValue(session.book);
    await renderHarness({
      bridgeRef,
      fileLease: leaseFor(new Blob(["book-a"])),
      mode: "paged",
    });
    await waitForReady(session, initialBridge);

    const currentBridge = createBridge();
    bridgeRef.current = currentBridge;
    const content = { document: document.implementation.createHTMLDocument("current") };
    session.rendition.contentCallbacks[0]?.(content);
    emitStaleEvent(session, "rendered", {}, { document: content.document });
    emitStaleEvent(session, "relocated", relocation());
    emitStaleEvent(session, "selected", "epubcfi(/selection)", content);

    expect(currentBridge.onContent).toHaveBeenCalledWith(content);
    expect(currentBridge.onRendered).toHaveBeenCalledTimes(1);
    expect(currentBridge.onRelocated).toHaveBeenCalledTimes(1);
    expect(currentBridge.onSelected).toHaveBeenCalledTimes(1);
    expect(initialBridge.onContent).not.toHaveBeenCalled();
    expect(epubModuleMock.openBook).toHaveBeenCalledTimes(1);
    expect(session.book.renderTo).toHaveBeenCalledTimes(1);
  });

  it("cancels deferred navigation for the exact session and ignores its stale completion", async () => {
    const navigation = deferred<unknown>();
    const session = createBookSession({ navigation: navigation.promise });
    const bridge = createBridge();
    const idleCallbacks = new Map<number, () => void>();
    window.requestIdleCallback = vi.fn((callback: IdleRequestCallback) => {
      idleCallbacks.set(17, () => callback({ didTimeout: false, timeRemaining: () => 50 }));
      return 17;
    });
    window.cancelIdleCallback = vi.fn((id: number) => idleCallbacks.delete(id));
    epubModuleMock.openBook.mockReturnValue(session.book);
    const { root } = await renderHarness({
      bridgeRef: createBridgeRef(bridge),
      fileLease: leaseFor(new Blob(["book-a"])),
      mode: "paged",
    });
    await waitForReady(session, bridge);
    const deferredLoad = idleCallbacks.get(17);
    expect(deferredLoad).toBeTypeOf("function");
    vi.mocked(bridge.onNavigationChange).mockClear();

    act(() => root.unmount());
    expect(window.cancelIdleCallback).toHaveBeenCalledWith(17);

    deferredLoad?.();
    await act(async () => {
      navigation.resolve({
        toc: [{ href: "Text/chapter.xhtml", id: "chapter", label: "Chapter" }],
      });
      await navigation.promise;
      await Promise.resolve();
    });

    expect(bridge.onNavigationChange).not.toHaveBeenCalled();
  });

  it("ignores stale rendered, relocated, selected, and content callbacks after failure", async () => {
    const started = deferred<void>();
    const session = createBookSession({ started: started.promise });
    const bridge = createBridge();
    epubModuleMock.openBook.mockReturnValue(session.book);
    await renderHarness({
      bridgeRef: createBridgeRef(bridge),
      fileLease: leaseFor(new Blob(["book-a"])),
      mode: "paged",
    });
    await act(async () => {
      started.reject(new Error("rendition start failed"));
      await vi.waitFor(() => expect(bridge.onError).toHaveBeenCalled());
    });
    vi.mocked(bridge.onContent).mockClear();
    vi.mocked(bridge.onRendered).mockClear();
    vi.mocked(bridge.onRelocated).mockClear();
    vi.mocked(bridge.onLocationChange).mockClear();
    vi.mocked(bridge.onSelected).mockClear();

    const content = { document: document.implementation.createHTMLDocument("stale") };
    session.rendition.contentCallbacks[0]?.(content);
    emitStaleEvent(session, "rendered", {}, {});
    emitStaleEvent(session, "relocated", relocation());
    emitStaleEvent(session, "selected", "epubcfi(/selection)", content);

    expect(bridge.onContent).not.toHaveBeenCalled();
    expect(bridge.onRendered).not.toHaveBeenCalled();
    expect(bridge.onRelocated).not.toHaveBeenCalled();
    expect(bridge.onLocationChange).not.toHaveBeenCalled();
    expect(bridge.onSelected).not.toHaveBeenCalled();
  });

  it("records deliberate jumps and replay while ordinary page turns stay outside history", async () => {
    const session = createBookSession();
    const bridge = createBridge();
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    epubModuleMock.openBook.mockReturnValue(session.book);
    await renderHarness(
      {
        bridgeRef: createBridgeRef(bridge),
        fileLease: leaseFor(new Blob(["book-a"])),
        mode: "paged",
      },
      facadeRef,
    );
    await waitForReady(session, bridge);
    emitStaleEvent(session, "relocated", relocation("epubcfi(/6/2!/4/2:2)"));
    session.rendition.display.mockClear();

    await expect(facadeRef.current!.navigateToTarget("Text/chapter-2.xhtml")).resolves.toBe(true);
    expect(facadeRef.current!.getNavigationHistorySnapshot()).toEqual({
      backCount: 1,
      canGoBack: true,
      canGoForward: false,
      forwardCount: 0,
    });

    emitStaleEvent(session, "relocated", relocation("epubcfi(/6/4!/4/2:2)"));
    await facadeRef.current!.turn("forward");
    emitStaleEvent(session, "relocated", relocation("epubcfi(/6/4!/4/8:8)"));
    expect(facadeRef.current!.getNavigationHistorySnapshot().backCount).toBe(1);

    await expect(facadeRef.current!.navigateToTarget("Text/chapter-3.xhtml")).resolves.toBe(true);
    emitStaleEvent(session, "relocated", relocation("epubcfi(/6/6!/4/2:2)"));
    expect(facadeRef.current!.getNavigationHistorySnapshot().backCount).toBe(2);

    await expect(facadeRef.current!.navigateBack()).resolves.toBe(true);
    expect(session.rendition.display).toHaveBeenLastCalledWith("epubcfi(/6/4!/4/8:8)");
    expect(facadeRef.current!.getNavigationHistorySnapshot()).toEqual({
      backCount: 1,
      canGoBack: true,
      canGoForward: true,
      forwardCount: 1,
    });

    emitStaleEvent(session, "relocated", relocation("epubcfi(/6/4!/4/8:8)"));
    await expect(facadeRef.current!.navigateForward()).resolves.toBe(true);
    expect(session.rendition.display).toHaveBeenLastCalledWith("epubcfi(/6/6!/4/2:2)");
    expect(facadeRef.current!.getNavigationHistorySnapshot()).toEqual({
      backCount: 2,
      canGoBack: true,
      canGoForward: false,
      forwardCount: 0,
    });
  });

  it("leaves history unchanged when a deliberate target display fails", async () => {
    const session = createBookSession();
    const bridge = createBridge();
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    epubModuleMock.openBook.mockReturnValue(session.book);
    await renderHarness(
      {
        bridgeRef: createBridgeRef(bridge),
        fileLease: leaseFor(new Blob(["book-a"])),
        mode: "paged",
      },
      facadeRef,
    );
    await waitForReady(session, bridge);
    emitStaleEvent(session, "relocated", relocation("epubcfi(/6/2!/4/2:2)"));
    session.rendition.display.mockRejectedValueOnce(new Error("display failed"));

    await expect(facadeRef.current!.navigateToTarget("Text/chapter-2.xhtml")).resolves.toBe(false);
    expect(facadeRef.current!.getNavigationHistorySnapshot()).toEqual({
      backCount: 0,
      canGoBack: false,
      canGoForward: false,
      forwardCount: 0,
    });
  });

  it("keeps Continuous-mode scrolling outside deliberate history", async () => {
    const session = createBookSession();
    const bridge = createBridge();
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    epubModuleMock.openBook.mockReturnValue(session.book);
    await renderHarness(
      {
        bridgeRef: createBridgeRef(bridge),
        fileLease: leaseFor(new Blob(["book-a"])),
        mode: "continuous",
      },
      facadeRef,
    );
    await waitForReady(session, bridge);

    emitStaleEvent(session, "relocated", relocation("epubcfi(/6/2!/4/2:2)"));
    emitStaleEvent(session, "relocated", relocation("epubcfi(/6/2!/4/8:8)"));
    emitStaleEvent(session, "relocated", relocation("epubcfi(/6/4!/4/2:2)"));

    expect(facadeRef.current!.getNavigationHistorySnapshot()).toEqual({
      backCount: 0,
      canGoBack: false,
      canGoForward: false,
      forwardCount: 0,
    });
  });

  it("retires an in-flight publication search when the Reader session identity is replaced", async () => {
    const sessionA = createBookSession();
    const sessionB = createBookSession();
    const bridgeRef = createBridgeRef();
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    const identityA = createSessionIdentity("search-book-a");
    const identityB = createSessionIdentity("search-book-b");
    const leaseA = leaseFor(new Blob(["search-book-a"]));
    const leaseB = leaseFor(new Blob(["search-book-b"]));
    const chapter = document.implementation.createHTMLDocument("search-chapter");
    chapter.body.textContent = "needle from the retired session";
    const load = deferred<Element>();
    const section = {
      cfiFromRange: vi.fn(() => "epubcfi(/6/2!/4/2:0,/4/2:6)"),
      contents: undefined as Element | undefined,
      document: undefined as Document | undefined,
      href: "Text/search.xhtml",
      index: 0,
      linear: true,
      load: vi.fn(async () => {
        await load.promise;
        section.document = chapter;
        section.contents = chapter.documentElement;
        return chapter.documentElement;
      }),
      unload: vi.fn(() => {
        section.document = undefined;
        section.contents = undefined;
      }),
    };
    const searchableBook = sessionA.book as unknown as {
      load: (...args: unknown[]) => Promise<unknown>;
      spine: { each: (callback: (section: EpubSection) => void) => void };
    };
    searchableBook.load = vi.fn(async () => undefined);
    searchableBook.spine = {
      each: (callback) => callback(section as unknown as EpubSection),
    };
    epubModuleMock.openBook.mockReturnValueOnce(sessionA.book).mockReturnValueOnce(sessionB.book);

    const { root } = await renderHarness(
      { bridgeRef, fileLease: leaseA, mode: "paged", sessionIdentity: identityA },
      facadeRef,
    );
    await waitForReady(sessionA, bridgeRef.current);

    const pendingSearch = facadeRef.current!.searchPublication("needle");
    await vi.waitFor(() => expect(section.load).toHaveBeenCalledOnce());

    await rerenderHarness(
      root,
      { bridgeRef, fileLease: leaseB, mode: "paged", sessionIdentity: identityB },
      facadeRef,
    );
    await waitForReady(sessionB, bridgeRef.current);
    load.resolve(chapter.documentElement);

    await expect(pendingSearch).resolves.toEqual({ kind: "cancelled" });
    expect(section.unload).toHaveBeenCalledOnce();
  });

  it("retires an in-flight deliberate jump when the Reader session identity is replaced", async () => {
    const sessionA = createBookSession();
    const sessionB = createBookSession();
    const bridge = createBridge();
    const bridgeRef = createBridgeRef(bridge);
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    const identityA = createSessionIdentity("book-a");
    const identityB = createSessionIdentity("book-b");
    const leaseA = leaseFor(new Blob(["book-a"]));
    const leaseB = leaseFor(new Blob(["book-b"]));
    epubModuleMock.openBook.mockReturnValueOnce(sessionA.book).mockReturnValueOnce(sessionB.book);
    const { root } = await renderHarness(
      { bridgeRef, fileLease: leaseA, mode: "paged", sessionIdentity: identityA },
      facadeRef,
    );
    await waitForReady(sessionA, bridge);
    emitStaleEvent(sessionA, "relocated", relocation("epubcfi(/6/2!/4/2:2)"));
    await expect(facadeRef.current!.navigateToTarget("Text/chapter-2.xhtml")).resolves.toBe(true);
    emitStaleEvent(sessionA, "relocated", relocation("epubcfi(/6/4!/4/2:2)"));
    expect(facadeRef.current!.getNavigationHistorySnapshot().backCount).toBe(1);

    const pendingDisplay = deferred<void>();
    sessionA.rendition.display.mockImplementationOnce(() => pendingDisplay.promise);
    const staleJump = facadeRef.current!.navigateToTarget("Text/chapter-3.xhtml");
    await rerenderHarness(
      root,
      { bridgeRef, fileLease: leaseB, mode: "paged", sessionIdentity: identityB },
      facadeRef,
    );
    await waitForReady(sessionB, bridge);

    pendingDisplay.resolve(undefined);
    await expect(staleJump).resolves.toBe(false);
    expect(facadeRef.current!.getNavigationHistorySnapshot()).toEqual({
      backCount: 0,
      canGoBack: false,
      canGoForward: false,
      forwardCount: 0,
    });
  });

  it("routes arbitrary safe EPUB targets through the active rendition display path", async () => {
    const session = createBookSession();
    const bridge = createBridge();
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    epubModuleMock.openBook.mockReturnValue(session.book);
    await renderHarness(
      {
        bridgeRef: createBridgeRef(bridge),
        fileLease: leaseFor(new Blob(["book-a"])),
        mode: "paged",
      },
      facadeRef,
    );
    await waitForReady(session, bridge);
    session.rendition.display.mockClear();
    vi.mocked(bridge.onDisplayed).mockClear();

    let navigated = false;
    await act(async () => {
      navigated = await facadeRef.current!.navigateToTarget("Text/chapter-2.xhtml#part");
    });

    expect(navigated).toBe(true);
    expect(session.rendition.display).toHaveBeenCalledWith("Text/chapter-2.xhtml#part");
    expect(bridge.onDisplayed).toHaveBeenCalledOnce();
  });
});

describe("useEpubSession content-hook ownership", () => {
  it.each([
    ["file replacement", "file"],
    ["mode replacement", "mode"],
  ] as const)("ignores session A content after %s", async (_label, replacement) => {
    const sessionA = createBookSession();
    const sessionB = createBookSession();
    const bridge = createBridge();
    const bridgeRef = createBridgeRef(bridge);
    const fileA = new Blob(["book-a"]);
    const fileB = replacement === "file" ? new Blob(["book-b"]) : fileA;
    const leaseA = leaseFor(fileA);
    const leaseB = replacement === "file" ? leaseFor(fileB) : leaseA;
    epubModuleMock.openBook.mockReturnValueOnce(sessionA.book).mockReturnValueOnce(sessionB.book);
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    const { root } = await renderHarness(
      { bridgeRef, fileLease: leaseA, mode: "paged" },
      facadeRef,
    );
    await waitForReady(sessionA, bridge);

    await rerenderHarness(
      root,
      {
        bridgeRef,
        fileLease: leaseB,
        mode: replacement === "mode" ? "continuous" : "paged",
      },
      facadeRef,
    );
    await waitForReady(sessionB, bridge);
    vi.mocked(bridge.onContent).mockClear();

    sessionA.rendition.contentCallbacks[0]?.({
      document: document.implementation.createHTMLDocument("session-a-stale"),
    });

    expect(bridge.onContent).not.toHaveBeenCalled();
    expect(sessionA.destroy).toHaveBeenCalledTimes(1);
    expect(renditionOffCount(sessionA, "rendered")).toBe(1);
    expect(renditionOffCount(sessionA, "relocated")).toBe(1);
    expect(renditionOffCount(sessionA, "selected")).toBe(1);
    expect(epubModuleMock.openBook).toHaveBeenCalledTimes(2);
  });

  it("reopens a mode replacement at the current canonical location", async () => {
    const sessionA = createBookSession();
    const sessionB = createBookSession();
    const bridge = createBridge();
    const bridgeRef = createBridgeRef(bridge);
    const fileLease = leaseFor(new Blob(["book-a"]));
    epubModuleMock.openBook.mockReturnValueOnce(sessionA.book).mockReturnValueOnce(sessionB.book);
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    const { root } = await renderHarness(
      {
        bridgeRef,
        fileLease,
        initialCfi: "epubcfi(/initial)",
        mode: "paged",
      },
      facadeRef,
    );
    await waitForReady(sessionA, bridge);
    emitStaleEvent(sessionA, "relocated", relocation());
    await expect(facadeRef.current!.navigateToTarget("Text/chapter-2.xhtml")).resolves.toBe(true);
    emitStaleEvent(sessionA, "relocated", relocation("epubcfi(/6/4!/4/2:2)"));
    expect(facadeRef.current!.getNavigationHistorySnapshot().backCount).toBe(1);

    await rerenderHarness(
      root,
      {
        bridgeRef,
        fileLease,
        initialCfi: "epubcfi(/initial)",
        mode: "continuous",
      },
      facadeRef,
    );
    await waitForReady(sessionB, bridge);

    expect(sessionA.destroy).toHaveBeenCalledTimes(1);
    expect(bridge.onSessionEnding).toHaveBeenCalledWith("replacement");
    expect(sessionB.rendition.display).toHaveBeenCalledWith("epubcfi(/6/4!/4/2:2)");
    expect(facadeRef.current!.getNavigationHistorySnapshot().backCount).toBe(1);
  });

  it("ignores content after unmount", async () => {
    const session = createBookSession();
    const bridge = createBridge();
    epubModuleMock.openBook.mockReturnValue(session.book);
    const { root } = await renderHarness({
      bridgeRef: createBridgeRef(bridge),
      fileLease: leaseFor(new Blob(["book-a"])),
      mode: "paged",
    });
    await waitForReady(session, bridge);
    vi.mocked(bridge.onContent).mockClear();

    act(() => root.unmount());
    session.rendition.contentCallbacks[0]?.({
      document: document.implementation.createHTMLDocument("unmounted"),
    });

    expect(bridge.onContent).not.toHaveBeenCalled();
  });

  it("prevents an old document from entering the current registry or firing current callbacks", async () => {
    const sessionA = createBookSession();
    const sessionB = createBookSession();
    const onInteraction = vi.fn();
    const onKeyDown = vi.fn();
    const onPointerDown = vi.fn();
    const onSelectionCollapsed = vi.fn();
    const onWheel = vi.fn();
    const bridge = createBridge();
    const bridgeRef = createBridgeRef(bridge);
    const fileA = new Blob(["book-a"]);
    epubModuleMock.openBook.mockReturnValueOnce(sessionA.book).mockReturnValueOnce(sessionB.book);
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    const { root } = await renderHarness(
      { bridgeRef, fileLease: leaseFor(fileA), mode: "paged" },
      facadeRef,
    );
    await waitForReady(sessionA, bridge);
    const registry = facadeRef.current!.documents;
    registry.updateOptions({
      onInteraction,
      onKeyDown,
      onPointerDown,
      onSelectionCollapsed,
      onWheel,
    });

    await rerenderHarness(
      root,
      { bridgeRef, fileLease: leaseFor(new Blob(["book-b"])), mode: "paged" },
      facadeRef,
    );
    await waitForReady(sessionB, bridge);

    const oldDocument = document.implementation.createHTMLDocument("old-session-document");
    sessionA.rendition.contentCallbacks[0]?.({ document: oldDocument });
    expect(registry.has(oldDocument)).toBe(false);

    oldDocument.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" }));
    oldDocument.dispatchEvent(new WheelEvent("wheel"));
    oldDocument.dispatchEvent(new PointerEvent("pointerdown"));
    oldDocument.dispatchEvent(new Event("selectionchange"));
    oldDocument.dispatchEvent(new MouseEvent("click"));

    expect(onKeyDown).not.toHaveBeenCalled();
    expect(onWheel).not.toHaveBeenCalled();
    expect(onPointerDown).not.toHaveBeenCalled();
    expect(onSelectionCollapsed).not.toHaveBeenCalled();
    expect(onInteraction).not.toHaveBeenCalled();
  });
});

describe("useEpubSession page-turn ownership", () => {
  it("does not let a resolved old turn release the current session lock", async () => {
    const turnA = deferred<void>();
    const turnB = deferred<void>();
    const sessionA = createBookSession();
    const sessionB = createBookSession();
    sessionA.rendition.next.mockReturnValueOnce(turnA.promise);
    sessionB.rendition.next.mockReturnValueOnce(turnB.promise).mockResolvedValueOnce(undefined);
    const bridge = createBridge();
    const bridgeRef = createBridgeRef(bridge);
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    epubModuleMock.openBook.mockReturnValueOnce(sessionA.book).mockReturnValueOnce(sessionB.book);
    const { root } = await renderHarness(
      { bridgeRef, fileLease: leaseFor(new Blob(["book-a"])), mode: "paged" },
      facadeRef,
    );
    await waitForReady(sessionA, bridge);

    let requestA!: Promise<void>;
    act(() => {
      requestA = facadeRef.current!.turn("forward");
    });
    await rerenderHarness(
      root,
      { bridgeRef, fileLease: leaseFor(new Blob(["book-b"])), mode: "paged" },
      facadeRef,
    );
    await waitForReady(sessionB, bridge);

    let requestB!: Promise<void>;
    act(() => {
      requestB = facadeRef.current!.turn("forward");
    });
    vi.useFakeTimers();
    await act(async () => {
      turnA.resolve(undefined);
      await requestA;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    act(() => {
      void facadeRef.current!.turn("forward");
    });
    expect(sessionB.rendition.next).toHaveBeenCalledTimes(1);

    await act(async () => {
      turnB.resolve(undefined);
      await requestB;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(79);
    });
    act(() => {
      void facadeRef.current!.turn("forward");
    });
    expect(sessionB.rendition.next).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    act(() => {
      void facadeRef.current!.turn("forward");
    });
    expect(sessionB.rendition.next).toHaveBeenCalledTimes(2);
  });

  it("does not let a rejected old backward turn release a mode-replacement lock", async () => {
    const turnA = deferred<void>();
    const turnB = deferred<void>();
    const sessionA = createBookSession();
    const sessionB = createBookSession();
    sessionA.rendition.prev.mockReturnValueOnce(turnA.promise);
    sessionB.rendition.prev.mockReturnValueOnce(turnB.promise).mockResolvedValueOnce(undefined);
    const bridge = createBridge();
    const bridgeRef = createBridgeRef(bridge);
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    const fileBlob = new Blob(["book-a"]);
    const fileLease = leaseFor(fileBlob);
    epubModuleMock.openBook.mockReturnValueOnce(sessionA.book).mockReturnValueOnce(sessionB.book);
    const { root } = await renderHarness({ bridgeRef, fileLease, mode: "paged" }, facadeRef);
    await waitForReady(sessionA, bridge);

    let requestA!: Promise<void>;
    act(() => {
      requestA = facadeRef.current!.turn("backward");
    });
    const settledA = requestA.catch(() => undefined);
    await rerenderHarness(root, { bridgeRef, fileLease, mode: "continuous" }, facadeRef);
    await waitForReady(sessionB, bridge);

    let requestB!: Promise<void>;
    act(() => {
      requestB = facadeRef.current!.turn("backward");
    });
    vi.useFakeTimers();
    await act(async () => {
      turnA.reject(new Error("old turn failed"));
      await settledA;
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    act(() => {
      void facadeRef.current!.turn("backward");
    });
    expect(sessionB.rendition.prev).toHaveBeenCalledTimes(1);

    await act(async () => {
      turnB.resolve(undefined);
      await requestB;
      await vi.advanceTimersByTimeAsync(80);
    });
    act(() => {
      void facadeRef.current!.turn("backward");
    });
    expect(sessionB.rendition.prev).toHaveBeenCalledTimes(2);
  });

  it.each(["forward", "backward"] as const)(
    "invalidates a pending %s turn on unmount",
    async (intent) => {
      const pendingTurn = deferred<void>();
      const session = createBookSession();
      const turnMock = intent === "forward" ? session.rendition.next : session.rendition.prev;
      turnMock.mockReturnValueOnce(pendingTurn.promise);
      const bridge = createBridge();
      const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
      epubModuleMock.openBook.mockReturnValue(session.book);
      const { root } = await renderHarness(
        {
          bridgeRef: createBridgeRef(bridge),
          fileLease: leaseFor(new Blob(["book-a"])),
          mode: "paged",
        },
        facadeRef,
      );
      await waitForReady(session, bridge);

      let request!: Promise<void>;
      act(() => {
        request = facadeRef.current!.turn(intent);
      });
      act(() => root.unmount());
      vi.useFakeTimers();
      await act(async () => {
        pendingTurn.resolve(undefined);
        await request;
        await vi.advanceTimersByTimeAsync(100);
      });

      expect(turnMock).toHaveBeenCalledTimes(1);
      expect(session.destroy).toHaveBeenCalledTimes(1);
    },
  );
});
