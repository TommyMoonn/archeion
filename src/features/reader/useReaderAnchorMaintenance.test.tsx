// @vitest-environment happy-dom

import { act, useLayoutEffect, useMemo, useRef, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryStorage } from "../../storage/LibraryStorage";
import type { Annotation, HighlightAnnotation } from "../../types/annotation";
import {
  sameReaderAnnotationSession,
  type ReaderAnnotationMutation,
  type ReaderAnnotationSession,
} from "./readerAnnotationState";
import type { ReaderAnnotationFeedback } from "./useReaderAnnotationMutations";
import { useReaderAnchorMaintenance } from "./useReaderAnchorMaintenance";

type AnchorApi = ReturnType<typeof useReaderAnchorMaintenance>;

function highlight(id = "highlight", anchorStatus?: "detached"): HighlightAnnotation {
  return {
    anchorStatus,
    cfiRange: "epubcfi(/6/2!/4/2,/1:1,/1:8)",
    color: "yellow",
    createdAt: "2026-07-14T00:00:00.000Z",
    id,
    selectedText: "Passage",
    type: "highlight",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

function Harness({
  apiRef,
  blockMaintenance = false,
  bookId,
  busyOwnerRef,
  feedback,
  sessionKey = bookId,
  storage,
  synced,
}: {
  apiRef: MutableRefObject<AnchorApi | undefined>;
  blockMaintenance?: boolean;
  bookId: string;
  busyOwnerRef: MutableRefObject<ReaderAnnotationMutation | undefined>;
  feedback: ReaderAnnotationFeedback[];
  sessionKey?: string;
  storage: LibraryStorage;
  synced: Annotation[];
}) {
  const session = useMemo<ReaderAnnotationSession>(
    () => ({ archiveId: "archive-a", bookId, token: Symbol(`anchor-test-${sessionKey}`) }),
    [bookId, sessionKey],
  );
  const sessionRef = useRef(session);
  const mountedRef = useRef(true);
  const cancelRef = useRef<(annotationId: string) => void>(() => undefined);
  const drainRef = useRef<() => void>(() => undefined);
  useLayoutEffect(() => {
    sessionRef.current = session;
    mountedRef.current = true;
    busyOwnerRef.current = blockMaintenance ? { id: 1, session } : undefined;
    return () => {
      mountedRef.current = false;
      busyOwnerRef.current = undefined;
    };
  }, [blockMaintenance, busyOwnerRef, session]);
  const api = useReaderAnchorMaintenance({
    busyOwnerRef,
    cancelQueuedAnchorUpdateRef: cancelRef,
    drainAnchorMaintenanceRef: drainRef,
    isCurrentSession: (candidate) => sameReaderAnnotationSession(sessionRef.current, candidate),
    publishFeedback: (_session, next) => {
      if (next) feedback.push(next);
    },
    session,
    update: async (command) => {
      try {
        const updated =
          command.annotationType === "bookmark"
            ? await storage.updateBookmarkAnnotation(bookId, command.annotation.id, command.changes)
            : await storage.updateHighlightAnnotation(
                bookId,
                command.annotation.id,
                command.changes,
              );
        if (!mountedRef.current || !sameReaderAnnotationSession(sessionRef.current, session)) {
          return { status: "retired" } as const;
        }
        if (!updated) return { status: "failed" } as const;
        synced.push(updated);
        return { annotation: updated, status: "accepted" } as const;
      } catch {
        return mountedRef.current && sameReaderAnnotationSession(sessionRef.current, session)
          ? ({ status: "failed" } as const)
          : ({ status: "retired" } as const);
      }
    },
  });
  useLayoutEffect(() => {
    apiRef.current = api;
    if (!blockMaintenance) drainRef.current();
  }, [api, apiRef, blockMaintenance]);
  return null;
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function renderHarness(
  props: Omit<Parameters<typeof Harness>[0], "apiRef">,
  apiRef: MutableRefObject<AnchorApi | undefined>,
) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  await act(async () => {
    root?.render(<Harness {...props} apiRef={apiRef} />);
  });
}

function baseProps(storage: LibraryStorage) {
  return {
    bookId: "book-a",
    busyOwnerRef: { current: undefined } as MutableRefObject<ReaderAnnotationMutation | undefined>,
    feedback: [] as ReaderAnnotationFeedback[],
    storage,
    synced: [] as Annotation[],
  };
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("useReaderAnchorMaintenance", () => {
  it("drains multiple annotation requests serially", async () => {
    const first = highlight("first");
    const second = highlight("second");
    const firstWrite = deferred<Annotation | undefined>();
    const storage = {
      updateHighlightAnnotation: vi
        .fn()
        .mockReturnValueOnce(firstWrite.promise)
        .mockResolvedValueOnce({ ...second, anchorStatus: "detached" }),
    } as unknown as LibraryStorage;
    const props = baseProps(storage);
    const apiRef: MutableRefObject<AnchorApi | undefined> = { current: undefined };
    await renderHarness(props, apiRef);

    const firstResult = apiRef.current!.queueAnchorUpdate(
      first,
      { anchorStatus: "detached" },
      "first",
    );
    const secondResult = apiRef.current!.queueAnchorUpdate(
      second,
      { anchorStatus: "detached" },
      "second",
    );
    expect(storage.updateHighlightAnnotation).toHaveBeenCalledOnce();
    await act(async () => firstWrite.resolve({ ...first, anchorStatus: "detached" }));
    await act(async () => expect(firstResult).resolves.toBe(true));
    await act(async () => expect(secondResult).resolves.toBe(true));
    expect(storage.updateHighlightAnnotation).toHaveBeenCalledTimes(2);
    expect(props.synced.map(({ id }) => id)).toEqual(["first", "second"]);
  });

  it("waits while an interactive mutation owns persistence and drains when released", async () => {
    const annotation = highlight();
    const storage = {
      updateHighlightAnnotation: vi.fn(async () => ({ ...annotation, anchorStatus: "detached" })),
    } as unknown as LibraryStorage;
    const props = { ...baseProps(storage), blockMaintenance: true };
    const apiRef: MutableRefObject<AnchorApi | undefined> = { current: undefined };
    await renderHarness(props, apiRef);
    const pending = apiRef.current!.queueAnchorUpdate(
      annotation,
      { anchorStatus: "detached" },
      "blocked",
    );
    expect(storage.updateHighlightAnnotation).not.toHaveBeenCalled();

    await renderHarness({ ...props, blockMaintenance: false }, apiRef);
    await act(async () => expect(pending).resolves.toBe(true));
    expect(storage.updateHighlightAnnotation).toHaveBeenCalledOnce();
  });

  it("coalesces duplicate signatures into one durable write", async () => {
    const annotation = highlight();
    const update = deferred<Annotation | undefined>();
    const storage = {
      updateHighlightAnnotation: vi.fn(() => update.promise),
    } as unknown as LibraryStorage;
    const props = baseProps(storage);
    const apiRef: MutableRefObject<AnchorApi | undefined> = { current: undefined };
    await renderHarness(props, apiRef);

    const first = apiRef.current!.queueAnchorUpdate(
      annotation,
      { anchorStatus: "detached" },
      "same-signature",
    );
    const duplicate = apiRef.current!.queueAnchorUpdate(
      annotation,
      { anchorStatus: "detached" },
      "same-signature",
    );
    expect(duplicate).toBe(first);
    await act(async () => update.resolve({ ...annotation, anchorStatus: "detached" }));
    await expect(first).resolves.toBe(true);
    expect(storage.updateHighlightAnnotation).toHaveBeenCalledOnce();
  });

  it("replaces older queued work for the same annotation", async () => {
    const annotation = highlight();
    const storage = {
      updateHighlightAnnotation: vi.fn(async () => ({ ...annotation, anchorStatus: "detached" })),
    } as unknown as LibraryStorage;
    const props = { ...baseProps(storage), blockMaintenance: true };
    const apiRef: MutableRefObject<AnchorApi | undefined> = { current: undefined };
    await renderHarness(props, apiRef);

    const old = apiRef.current!.queueAnchorUpdate(annotation, { anchorStatus: "detached" }, "old");
    const replacement = apiRef.current!.queueAnchorUpdate(
      annotation,
      { anchorStatus: "detached" },
      "replacement",
    );
    await expect(old).resolves.toBe(false);
    expect(replacement).not.toBe(old);
    await renderHarness({ ...props, blockMaintenance: false }, apiRef);
    await expect(replacement).resolves.toBe(true);
  });

  it("settles an explicitly cancelled queued request", async () => {
    const annotation = highlight();
    const storage = { updateHighlightAnnotation: vi.fn() } as unknown as LibraryStorage;
    const props = { ...baseProps(storage), blockMaintenance: true };
    const apiRef: MutableRefObject<AnchorApi | undefined> = { current: undefined };
    await renderHarness(props, apiRef);

    const pending = apiRef.current!.queueAnchorUpdate(
      annotation,
      { anchorStatus: "detached" },
      "cancelled",
    );
    act(() => apiRef.current?.cancelQueuedAnchorUpdate(annotation.id));
    await expect(pending).resolves.toBe(false);
    expect(storage.updateHighlightAnnotation).not.toHaveBeenCalled();
  });

  it("reports active-session write failure and permits retry", async () => {
    const annotation = highlight();
    const storage = {
      updateHighlightAnnotation: vi
        .fn()
        .mockRejectedValueOnce(new Error("write failed"))
        .mockResolvedValueOnce({ ...annotation, anchorStatus: "detached" }),
    } as unknown as LibraryStorage;
    const props = baseProps(storage);
    const apiRef: MutableRefObject<AnchorApi | undefined> = { current: undefined };
    await renderHarness(props, apiRef);

    await act(async () =>
      expect(
        apiRef.current!.queueAnchorUpdate(annotation, { anchorStatus: "detached" }, "failure"),
      ).resolves.toBe(false),
    );
    expect(props.feedback.at(-1)).toEqual({
      kind: "error",
      message: "The annotation location could not be updated.",
    });
    await act(async () =>
      expect(
        apiRef.current!.queueAnchorUpdate(annotation, { anchorStatus: "detached" }, "retry"),
      ).resolves.toBe(true),
    );
  });

  it("settles queued work after session change without stale feedback", async () => {
    const annotation = highlight();
    const storage = { updateHighlightAnnotation: vi.fn() } as unknown as LibraryStorage;
    const props = { ...baseProps(storage), blockMaintenance: true };
    const apiRef: MutableRefObject<AnchorApi | undefined> = { current: undefined };
    await renderHarness(props, apiRef);
    const queued = apiRef.current!.queueAnchorUpdate(
      annotation,
      { anchorStatus: "detached" },
      "queued",
    );

    await renderHarness({ ...props, bookId: "book-b", blockMaintenance: false }, apiRef);
    await expect(queued).resolves.toBe(false);
    expect(props.feedback).toEqual([]);
  });

  it("settles running work and ignores stale completion after session change", async () => {
    const annotation = highlight();
    const update = deferred<Annotation | undefined>();
    const storage = {
      updateHighlightAnnotation: vi.fn(() => update.promise),
    } as unknown as LibraryStorage;
    const props = baseProps(storage);
    const apiRef: MutableRefObject<AnchorApi | undefined> = { current: undefined };
    await renderHarness(props, apiRef);
    const running = apiRef.current!.queueAnchorUpdate(
      annotation,
      { anchorStatus: "detached" },
      "running",
    );

    await renderHarness({ ...props, bookId: "book-b" }, apiRef);
    await expect(running).resolves.toBe(false);
    await act(async () => update.resolve({ ...annotation, anchorStatus: "detached" }));
    expect(props.synced).toEqual([]);
    expect(props.feedback).toEqual([]);
  });

  it("does not publish failure feedback when a stale running write rejects", async () => {
    const annotation = highlight();
    const update = deferred<Annotation | undefined>();
    const storage = {
      updateHighlightAnnotation: vi.fn(() => update.promise),
    } as unknown as LibraryStorage;
    const props = baseProps(storage);
    const apiRef: MutableRefObject<AnchorApi | undefined> = { current: undefined };
    await renderHarness(props, apiRef);
    const running = apiRef.current!.queueAnchorUpdate(
      annotation,
      { anchorStatus: "detached" },
      "stale-failure",
    );

    await renderHarness({ ...props, bookId: "book-b" }, apiRef);
    await expect(running).resolves.toBe(false);
    await act(async () => update.reject(new Error("late write failure")));
    expect(props.feedback).toEqual([]);
  });

  it("invalidates work when returning to the same book ID with a new token", async () => {
    const annotation = highlight();
    const update = deferred<Annotation | undefined>();
    const storage = {
      updateHighlightAnnotation: vi.fn(() => update.promise),
    } as unknown as LibraryStorage;
    const props = baseProps(storage);
    const apiRef: MutableRefObject<AnchorApi | undefined> = { current: undefined };
    await renderHarness({ ...props, sessionKey: "first" }, apiRef);
    const running = apiRef.current!.queueAnchorUpdate(
      annotation,
      { anchorStatus: "detached" },
      "first-session",
    );

    await renderHarness({ ...props, sessionKey: "second" }, apiRef);
    await expect(running).resolves.toBe(false);
    await act(async () => update.resolve({ ...annotation, anchorStatus: "detached" }));
    expect(props.synced).toEqual([]);
  });

  it.each([false, true])("settles %s work on unmount", async (running) => {
    const annotation = highlight();
    const update = deferred<Annotation | undefined>();
    const storage = {
      updateHighlightAnnotation: vi.fn(() => update.promise),
    } as unknown as LibraryStorage;
    const props = { ...baseProps(storage), blockMaintenance: !running };
    const apiRef: MutableRefObject<AnchorApi | undefined> = { current: undefined };
    await renderHarness(props, apiRef);
    const pending = apiRef.current!.queueAnchorUpdate(
      annotation,
      { anchorStatus: "detached" },
      running ? "running" : "queued",
    );

    act(() => root?.unmount());
    root = null;
    await expect(pending).resolves.toBe(false);
    if (running) await act(async () => update.resolve({ ...annotation, anchorStatus: "detached" }));
    expect(props.synced).toEqual([]);
  });

  it("short-circuits detached-to-detached maintenance without storage", async () => {
    const annotation = highlight("detached", "detached");
    const storage = { updateHighlightAnnotation: vi.fn() } as unknown as LibraryStorage;
    const props = baseProps(storage);
    const apiRef: MutableRefObject<AnchorApi | undefined> = { current: undefined };
    await renderHarness(props, apiRef);

    await expect(
      apiRef.current!.queueAnchorUpdate(
        annotation,
        { anchorStatus: "detached" },
        "already-detached",
      ),
    ).resolves.toBe(true);
    expect(storage.updateHighlightAnnotation).not.toHaveBeenCalled();
  });
});
