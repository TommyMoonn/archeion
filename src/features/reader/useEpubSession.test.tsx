// @vitest-environment happy-dom

import type { Book as EpubBook, Location, Rendition } from "epubjs";
import { act, forwardRef, useImperativeHandle, useRef, type RefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReaderContentDocumentRegistry, type EpubContent } from "./readerContentDocumentRegistry";
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
};

type MockBookSession = ReturnType<typeof createBookSession>;

type HarnessProps = Omit<UseEpubSessionOptions, "containerRef">;

const SessionHarness = forwardRef<EpubSessionFacade, HarnessProps>(
  function SessionHarness(props, ref) {
    const containerRef = useRef<HTMLDivElement>(null);
    const facade = useEpubSession({ ...props, containerRef });
    useImperativeHandle(ref, () => facade, [facade]);
    return <div ref={containerRef} />;
  },
);

const roots: Root[] = [];
const containers: HTMLDivElement[] = [];
const originalRequestIdleCallback = window.requestIdleCallback;
const originalCancelIdleCallback = window.cancelIdleCallback;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
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
  };
  return rendition as unknown as MockRendition;
}

function createBookSession(
  options: { navigation?: Promise<unknown>; started?: Promise<void> } = {},
) {
  const rendition = createRendition(options.started);
  const destroy = vi.fn();
  const book = {
    destroy,
    loaded: {
      navigation: options.navigation ?? Promise.resolve({ toc: [] }),
    },
    locations: {
      generate: vi.fn(async () => undefined),
    },
    opened: Promise.resolve(),
    packaging: {
      spine: [{}],
    },
    renderTo: vi.fn(() => rendition),
  } as unknown as EpubBook;

  return { book, destroy, rendition };
}

function createBridge(overrides: Partial<EpubSessionBridge> = {}): EpubSessionBridge {
  return {
    isLocationUsable: vi.fn(() => true),
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
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  roots.push(root);
  containers.push(container);
  await act(async () => {
    root.render(<SessionHarness {...props} ref={facadeRef} />);
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

function relocation(): Location {
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
      cfi: "epubcfi(/6/2!/4/2:4)",
      displayed: { page: 1, total: 2 },
      href: "Text/chapter.xhtml",
      index: 0,
      location: 0,
      percentage: 0.5,
    },
  };
}

beforeEach(() => {
  epubModuleMock.openBook.mockReset();
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
});

describe("useEpubSession lifecycle", () => {
  it("creates one session, displays the initial CFI, and tears it down exactly once", async () => {
    const session = createBookSession();
    const bridge = createBridge();
    epubModuleMock.openBook.mockReturnValue(session.book);
    const { root } = await renderHarness({
      bridgeRef: createBridgeRef(bridge),
      fileBlob: new Blob(["book-a"]),
      initialCfi: "epubcfi(/6/2!/4/2:4)",
      mode: "paged",
    });
    await waitForReady(session, bridge);

    expect(session.rendition.display).toHaveBeenCalledWith("epubcfi(/6/2!/4/2:4)");
    expect(bridge.onSessionCreated).toHaveBeenCalledTimes(1);

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
  });

  it("does not create an EPUB.js book when teardown cancels a pending byte conversion", async () => {
    const contents = deferred<ArrayBuffer>();
    const fileBlob = new Blob(["book-a"]);
    vi.spyOn(fileBlob, "arrayBuffer").mockReturnValue(contents.promise);
    const { root } = await renderHarness({
      bridgeRef: createBridgeRef(),
      fileBlob,
      mode: "paged",
    });

    act(() => root.unmount());
    await act(async () => contents.resolve(new ArrayBuffer(8)));

    expect(epubModuleMock.openBook).not.toHaveBeenCalled();
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
      { bridgeRef, fileBlob: new Blob(["book-0"]), mode: "paged" },
      facadeRef,
    );
    await waitForReady(sessions[0], bridge);

    for (let index = 1; index < sessions.length; index += 1) {
      await rerenderHarness(
        root,
        { bridgeRef, fileBlob: new Blob([`book-${index}`]), mode: "paged" },
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
      fileBlob: new Blob(["book-a"]),
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
      fileBlob: new Blob(["book-a"]),
      mode: "paged",
    });

    await act(async () => {
      started.reject(new Error("rendition start failed"));
      await vi.waitFor(() => expect(bridge.onError).toHaveBeenCalledWith({ kind: "open-failed" }));
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
      fileBlob: new Blob(["book-a"]),
      initialCfi: "epubcfi(/6/2!/4/2:4)",
      mode: "paged",
    });

    await act(async () => {
      await vi.waitFor(() => expect(bridge.onError).toHaveBeenCalledWith({ kind: "open-failed" }));
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
      fileBlob: new Blob(["book-a"]),
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
      fileBlob: new Blob(["book-a"]),
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
      fileBlob: new Blob(["book-a"]),
      mode: "paged",
    });
    await act(async () => {
      started.reject(new Error("rendition start failed"));
      await vi.waitFor(() => expect(bridge.onError).toHaveBeenCalled());
    });
    vi.mocked(bridge.onContent).mockClear();
    vi.mocked(bridge.onRendered).mockClear();
    vi.mocked(bridge.onRelocated).mockClear();
    vi.mocked(bridge.onSelected).mockClear();

    const content = { document: document.implementation.createHTMLDocument("stale") };
    session.rendition.contentCallbacks[0]?.(content);
    emitStaleEvent(session, "rendered", {}, {});
    emitStaleEvent(session, "relocated", relocation());
    emitStaleEvent(session, "selected", "epubcfi(/selection)", content);

    expect(bridge.onContent).not.toHaveBeenCalled();
    expect(bridge.onRendered).not.toHaveBeenCalled();
    expect(bridge.onRelocated).not.toHaveBeenCalled();
    expect(bridge.onSelected).not.toHaveBeenCalled();
  });

  it("routes arbitrary safe EPUB targets through the active rendition display path", async () => {
    const session = createBookSession();
    const bridge = createBridge();
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    epubModuleMock.openBook.mockReturnValue(session.book);
    await renderHarness(
      { bridgeRef: createBridgeRef(bridge), fileBlob: new Blob(["book-a"]), mode: "paged" },
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
    epubModuleMock.openBook.mockReturnValueOnce(sessionA.book).mockReturnValueOnce(sessionB.book);
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    const { root } = await renderHarness({ bridgeRef, fileBlob: fileA, mode: "paged" }, facadeRef);
    await waitForReady(sessionA, bridge);

    await rerenderHarness(
      root,
      {
        bridgeRef,
        fileBlob: fileB,
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

  it("ignores content after unmount", async () => {
    const session = createBookSession();
    const bridge = createBridge();
    epubModuleMock.openBook.mockReturnValue(session.book);
    const { root } = await renderHarness({
      bridgeRef: createBridgeRef(bridge),
      fileBlob: new Blob(["book-a"]),
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
    const registry = new ReaderContentDocumentRegistry();
    const onInteraction = vi.fn();
    const onKeyDown = vi.fn();
    const onPointerDown = vi.fn();
    const onSelectionCollapsed = vi.fn();
    const onWheel = vi.fn();
    registry.updateOptions({
      onInteraction,
      onKeyDown,
      onPointerDown,
      onSelectionCollapsed,
      onWheel,
    });
    const bridge = createBridge({
      onContent: (content) => {
        registry.bind(content);
      },
      onSessionEnding: () => {
        registry.clear();
      },
    });
    const bridgeRef = createBridgeRef(bridge);
    const fileA = new Blob(["book-a"]);
    epubModuleMock.openBook.mockReturnValueOnce(sessionA.book).mockReturnValueOnce(sessionB.book);
    const facadeRef = { current: null } as RefObject<EpubSessionFacade | null>;
    const { root } = await renderHarness({ bridgeRef, fileBlob: fileA, mode: "paged" }, facadeRef);
    await waitForReady(sessionA, bridge);

    await rerenderHarness(
      root,
      { bridgeRef, fileBlob: new Blob(["book-b"]), mode: "paged" },
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
      { bridgeRef, fileBlob: new Blob(["book-a"]), mode: "paged" },
      facadeRef,
    );
    await waitForReady(sessionA, bridge);

    let requestA!: Promise<void>;
    act(() => {
      requestA = facadeRef.current!.turn("forward");
    });
    await rerenderHarness(
      root,
      { bridgeRef, fileBlob: new Blob(["book-b"]), mode: "paged" },
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
    epubModuleMock.openBook.mockReturnValueOnce(sessionA.book).mockReturnValueOnce(sessionB.book);
    const { root } = await renderHarness({ bridgeRef, fileBlob, mode: "paged" }, facadeRef);
    await waitForReady(sessionA, bridge);

    let requestA!: Promise<void>;
    act(() => {
      requestA = facadeRef.current!.turn("backward");
    });
    const settledA = requestA.catch(() => undefined);
    await rerenderHarness(root, { bridgeRef, fileBlob, mode: "continuous" }, facadeRef);
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
          fileBlob: new Blob(["book-a"]),
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
