// @vitest-environment happy-dom

import { act, useLayoutEffect, useMemo, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Annotation, BookmarkAnnotation, HighlightAnnotation } from "../../types/annotation";
import type { ReaderAnnotationRecoveryResult } from "./readerAnnotationRecovery";
import type { ReaderAnnotationAnchorChanges } from "./readerAnnotationState";
import type { ReaderAnnotationCommandSurface } from "./useReaderAnnotationMutations";
import {
  recoveredAnnotationAnchorConflicts,
  useReaderAnnotationRecovery,
} from "./useReaderAnnotationRecovery";

type RecoveryApi = ReturnType<typeof useReaderAnnotationRecovery>;

function highlight(id: string, changes: Partial<HighlightAnnotation> = {}): HighlightAnnotation {
  return {
    cfiRange: `epubcfi(/6/2!/4/2,/1:2,/1:${id.length + 8})`,
    color: "yellow",
    createdAt: "2026-07-14T00:00:00.000Z",
    id,
    selectedText: `Quote ${id}`,
    type: "highlight",
    updatedAt: "2026-07-14T00:00:00.000Z",
    ...changes,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

type HarnessProps = Omit<
  Parameters<typeof useReaderAnnotationRecovery>[0],
  "cancelQueuedAnchorUpdate" | "commands" | "session"
> & {
  activeArchiveId?: string | null;
  apiRef: MutableRefObject<RecoveryApi | undefined>;
  bookId?: string;
  cancelQueuedAnchorUpdate?: (annotationId: string) => void;
  commands?: Pick<ReaderAnnotationCommandSurface, "update">;
  sessionKey?: string;
  updateAnchor?: (
    annotation: Annotation,
    changes: ReaderAnnotationAnchorChanges,
  ) => Promise<Annotation | undefined>;
};

function Harness({
  activeArchiveId = "archive-a",
  apiRef,
  bookId = "book-1",
  cancelQueuedAnchorUpdate = () => undefined,
  commands,
  sessionKey = `${activeArchiveId}:${bookId}`,
  updateAnchor,
  ...options
}: HarnessProps) {
  const session = useMemo(
    () => ({ archiveId: activeArchiveId, bookId, token: Symbol(`recovery-${sessionKey}`) }),
    [activeArchiveId, bookId, sessionKey],
  );
  const commandSurface = useMemo<Pick<ReaderAnnotationCommandSurface, "update">>(
    () =>
      commands ?? {
        update: async (command) => {
          const annotation = await updateAnchor?.(command.annotation, command.changes);
          return annotation ? { annotation, status: "accepted" } : { status: "failed" };
        },
      },
    [commands, updateAnchor],
  );
  const recovery = useReaderAnnotationRecovery({
    ...options,
    cancelQueuedAnchorUpdate,
    commands: commandSurface,
    session,
  });
  useLayoutEffect(() => {
    apiRef.current = recovery;
  }, [apiRef, recovery]);
  return null;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderHarness(props: HarnessProps) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  await act(async () => root?.render(<Harness {...props} />));
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("useReaderAnnotationRecovery", () => {
  it("persists a recovered anchor in place and clears detached state", async () => {
    const detached = highlight("detached", { anchorStatus: "detached" });
    const updated = {
      ...detached,
      anchorStatus: undefined,
      cfiRange: "epubcfi(/6/8!/4/2,/1:4,/1:22)",
    };
    const updateAnchor = vi.fn(async () => updated);
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    await renderHarness({
      annotations: [detached],
      apiRef,
      bookId: "book-1",
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(async () => ({
        chapterHref: "Text/renamed.xhtml",
        cfiRange: updated.cfiRange,
        kind: "resolved" as const,
        strategy: "context-text" as const,
      })),
      updateAnchor,
    });

    let result: ReaderAnnotationRecoveryResult | undefined;
    await act(async () => {
      result = await apiRef.current?.recoverAnnotationAnchor(detached);
    });
    expect(result?.kind).toBe("resolved");
    expect(updateAnchor).toHaveBeenCalledWith(detached, {
      anchorStatus: undefined,
      cfiRange: updated.cfiRange,
      chapterHref: "Text/renamed.xhtml",
    });
  });

  it("rejects stale persistence before touching a same-id replacement", async () => {
    const annotation = highlight("stale-persistence");
    const replacement = {
      ...annotation,
      createdAt: "2026-07-15T00:00:00.000Z",
      selectedText: "Replacement passage",
    };
    const cancelQueuedAnchorUpdate = vi.fn();
    const update = vi.fn(async () => ({ annotation: replacement, status: "accepted" }) as const);
    const commands = { update };
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    const common = {
      apiRef,
      cancelQueuedAnchorUpdate,
      commands,
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(),
    };
    await renderHarness({ ...common, annotations: [annotation] });
    const stalePersistAnchor = apiRef.current!.persistAnchor;
    await renderHarness({ ...common, annotations: [replacement] });

    let persisted: Annotation | undefined;
    await act(async () => {
      persisted = await stalePersistAnchor(annotation, {
        cfiRange: "epubcfi(/6/8!/4/2,/1:4,/1:22)",
        kind: "resolved",
        strategy: "context-text",
      });
    });

    expect(persisted).toBeUndefined();
    expect(update).not.toHaveBeenCalled();
    expect(cancelQueuedAnchorUpdate).not.toHaveBeenCalled();
    expect(replacement).toMatchObject({
      cfiRange: annotation.cfiRange,
      createdAt: "2026-07-15T00:00:00.000Z",
      selectedText: "Replacement passage",
    });
  });

  it("persists through the latest live object for a matching identity", async () => {
    const annotation = highlight("live-persistence", { chapterHref: "Text/old.xhtml" });
    const liveAnnotation = {
      ...annotation,
      chapterHref: "Text/current.xhtml",
      note: "Current note",
    };
    const recoveredCfi = "epubcfi(/6/8!/4/2,/1:4,/1:22)";
    const cancelQueuedAnchorUpdate = vi.fn();
    const update = vi.fn(
      async (command: Parameters<ReaderAnnotationCommandSurface["update"]>[0]) => {
        const persisted =
          command.annotationType === "bookmark"
            ? ({ ...command.annotation, ...command.changes } as BookmarkAnnotation)
            : ({ ...command.annotation, ...command.changes } as HighlightAnnotation);
        return { annotation: persisted, status: "accepted" as const };
      },
    );
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    const common = {
      apiRef,
      cancelQueuedAnchorUpdate,
      commands: { update },
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(),
    };
    await renderHarness({ ...common, annotations: [annotation] });
    const retainedPersistAnchor = apiRef.current!.persistAnchor;
    await renderHarness({ ...common, annotations: [liveAnnotation] });

    let persisted: Annotation | undefined;
    await act(async () => {
      persisted = await retainedPersistAnchor(annotation, {
        cfiRange: recoveredCfi,
        kind: "resolved",
        strategy: "context-text",
      });
    });

    expect(update).toHaveBeenCalledWith({
      annotation: liveAnnotation,
      annotationType: "highlight",
      changes: {
        anchorStatus: undefined,
        cfiRange: recoveredCfi,
        chapterHref: liveAnnotation.chapterHref,
      },
    });
    expect(cancelQueuedAnchorUpdate).toHaveBeenCalledWith(annotation.id);
    expect(persisted).toMatchObject({
      cfiRange: recoveredCfi,
      note: "Current note",
    });
  });

  it("keeps highlight and bookmark collisions detached without persisting", async () => {
    const occupied = highlight("occupied", {
      cfiRange: "epubcfi(/6/2!/4/2,/1:4,/1:20)",
    });
    const detached = highlight("detached", { anchorStatus: "detached" });
    const result = {
      cfiRange: occupied.cfiRange,
      kind: "resolved" as const,
      strategy: "context-text" as const,
    };
    expect(recoveredAnnotationAnchorConflicts(detached, result, [occupied, detached])).toBe(true);

    const bookmark: BookmarkAnnotation = {
      cfiRange: "epubcfi(/6/2!/4/2:8)",
      createdAt: "2026-07-14T00:00:00.000Z",
      id: "bookmark",
      type: "bookmark",
      updatedAt: "2026-07-14T00:00:00.000Z",
    };
    const detachedBookmark: BookmarkAnnotation = {
      ...bookmark,
      anchorStatus: "detached",
      id: "detached-bookmark",
    };
    expect(
      recoveredAnnotationAnchorConflicts(
        detachedBookmark,
        { ...result, cfiRange: bookmark.cfiRange! },
        [bookmark, detachedBookmark],
      ),
    ).toBe(true);

    const updateAnchor = vi.fn();
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    await renderHarness({
      annotations: [occupied, detached],
      apiRef,
      bookId: "book-1",
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(async () => result),
      updateAnchor,
    });
    await act(async () => {
      expect(await apiRef.current?.recoverAnnotationAnchor(detached)).toEqual({
        kind: "detached",
        reason: "conflict",
      });
    });
    expect(updateAnchor).not.toHaveBeenCalled();
  });

  it("returns cancelled without persistence when recovery settles in another book session", async () => {
    const annotation = highlight("stale", { anchorStatus: "detached" });
    const resolution = deferred<ReaderAnnotationRecoveryResult>();
    const updateAnchor = vi.fn();
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    const common = {
      annotations: [annotation] as readonly Annotation[],
      apiRef,
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(() => resolution.promise),
      updateAnchor,
    };
    await renderHarness({ ...common, bookId: "book-1" });
    const recovery = apiRef.current?.recoverAnnotationAnchor(annotation);
    await renderHarness({ ...common, bookId: "book-2" });
    await act(async () => {
      resolution.resolve({
        cfiRange: "epubcfi(/6/8!/4/2,/1:4,/1:22)",
        kind: "resolved",
        strategy: "context-text",
      });
      expect(await recovery).toEqual({ kind: "cancelled" });
    });
    expect(updateAnchor).not.toHaveBeenCalled();
  });

  it("rejects an invalid-anchor callback retained by an earlier book session", async () => {
    const annotation = highlight("session-a");
    const queueAnchorUpdate = vi.fn(async () => true);
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    const common = {
      annotations: [annotation] as readonly Annotation[],
      apiRef,
      queueAnchorUpdate,
      resolveAnchor: vi.fn(),
      updateAnchor: vi.fn(),
    };
    await renderHarness({ ...common, bookId: "book-1" });
    const staleHandler = apiRef.current?.handleInvalidHighlightAnchor;
    await renderHarness({ ...common, bookId: "book-2" });

    await expect(staleHandler?.(annotation.id, "stale-signature")).resolves.toBe(false);
    expect(queueAnchorUpdate).not.toHaveBeenCalled();
  });

  it("rejects an invalid-anchor callback retained by another archive with the same book", async () => {
    const archiveAAnnotation = highlight("shared-id");
    const archiveBAnnotation = highlight("shared-id", {
      selectedText: "A different archive's passage",
    });
    const archiveAQueue = vi.fn(async () => true);
    const archiveBQueue = vi.fn(async () => true);
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    const common = {
      apiRef,
      bookId: "book-1",
      resolveAnchor: vi.fn(),
      updateAnchor: vi.fn(),
    };
    await renderHarness({
      ...common,
      activeArchiveId: "archive-a",
      annotations: [archiveAAnnotation],
      queueAnchorUpdate: archiveAQueue,
    });
    const staleHandler = apiRef.current?.handleInvalidHighlightAnchor;
    await renderHarness({
      ...common,
      activeArchiveId: "archive-b",
      annotations: [archiveBAnnotation],
      queueAnchorUpdate: archiveBQueue,
    });

    await expect(staleHandler?.(archiveAAnnotation.id, "archive-a-signature")).resolves.toBe(false);
    expect(archiveAQueue).not.toHaveBeenCalled();
    expect(archiveBQueue).not.toHaveBeenCalled();
  });

  it("reports a pending invalid-anchor acknowledgement as stale after an archive change", async () => {
    const annotation = highlight("pending-archive");
    const acknowledgement = deferred<boolean>();
    const archiveAQueue = vi.fn(() => acknowledgement.promise);
    const archiveBQueue = vi.fn(async () => true);
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    const common = { apiRef, bookId: "book-1", resolveAnchor: vi.fn(), updateAnchor: vi.fn() };
    await renderHarness({
      ...common,
      activeArchiveId: "archive-a",
      annotations: [annotation],
      queueAnchorUpdate: archiveAQueue,
    });
    const pending = apiRef.current?.handleInvalidHighlightAnchor(annotation.id, "archive-a");
    expect(archiveAQueue).toHaveBeenCalledOnce();

    await renderHarness({
      ...common,
      activeArchiveId: "archive-b",
      annotations: [annotation],
      queueAnchorUpdate: archiveBQueue,
    });
    await act(async () => acknowledgement.resolve(true));

    await expect(pending).resolves.toBe(false);
    expect(archiveBQueue).not.toHaveBeenCalled();
  });

  it("reports a pending invalid-anchor acknowledgement as stale after a book change", async () => {
    const annotation = highlight("pending-book");
    const acknowledgement = deferred<boolean>();
    const queueAnchorUpdate = vi.fn(() => acknowledgement.promise);
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    const common = {
      annotations: [annotation] as readonly Annotation[],
      apiRef,
      queueAnchorUpdate,
      resolveAnchor: vi.fn(),
      updateAnchor: vi.fn(),
    };
    await renderHarness({ ...common, bookId: "book-1" });
    const pending = apiRef.current?.handleInvalidHighlightAnchor(annotation.id, "book-1");
    await renderHarness({ ...common, bookId: "book-2" });
    await act(async () => acknowledgement.resolve(true));

    await expect(pending).resolves.toBe(false);
    expect(queueAnchorUpdate).toHaveBeenCalledOnce();
  });

  it("reports a pending invalid-anchor acknowledgement as stale after unmount", async () => {
    const annotation = highlight("pending-unmount");
    const acknowledgement = deferred<boolean>();
    const queueAnchorUpdate = vi.fn(() => acknowledgement.promise);
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    await renderHarness({
      annotations: [annotation],
      apiRef,
      queueAnchorUpdate,
      resolveAnchor: vi.fn(),
      updateAnchor: vi.fn(),
    });
    const pending = apiRef.current?.handleInvalidHighlightAnchor(annotation.id, "unmount");
    await act(async () => root?.unmount());
    root = null;
    await act(async () => acknowledgement.resolve(true));

    await expect(pending).resolves.toBe(false);
  });

  it("does not queue an invalid-anchor acknowledgement for a removed target", async () => {
    const annotation = highlight("removed-before-queue");
    const queueAnchorUpdate = vi.fn(async () => true);
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    const common = { apiRef, queueAnchorUpdate, resolveAnchor: vi.fn(), updateAnchor: vi.fn() };
    await renderHarness({ ...common, annotations: [annotation] });
    await renderHarness({ ...common, annotations: [] });

    await expect(apiRef.current?.handleInvalidHighlightAnchor(annotation.id)).resolves.toBe(false);
    expect(queueAnchorUpdate).not.toHaveBeenCalled();
  });

  it("returns true for a successful invalid-anchor acknowledgement in the current session", async () => {
    const annotation = highlight("current-acknowledgement");
    const queueAnchorUpdate = vi.fn(async () => true);
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    await renderHarness({
      annotations: [annotation],
      apiRef,
      queueAnchorUpdate,
      resolveAnchor: vi.fn(),
      updateAnchor: vi.fn(),
    });

    await expect(
      apiRef.current?.handleInvalidHighlightAnchor(annotation.id, "current-signature"),
    ).resolves.toBe(true);
    expect(queueAnchorUpdate).toHaveBeenCalledWith(
      annotation,
      { anchorStatus: "detached" },
      "current-signature",
    );
  });

  it("enters invalid-anchor recovery once for duplicate rendered callbacks", async () => {
    const annotation = highlight("duplicate-invalid");
    const acknowledgement = deferred<boolean>();
    const queueAnchorUpdate = vi.fn(() => acknowledgement.promise);
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    await renderHarness({
      annotations: [annotation],
      apiRef,
      queueAnchorUpdate,
      resolveAnchor: vi.fn(),
      updateAnchor: vi.fn(),
    });

    const first = apiRef.current!.handleInvalidHighlightAnchor(annotation.id, "same-anchor");
    const duplicate = apiRef.current!.handleInvalidHighlightAnchor(annotation.id, "same-anchor");
    expect(duplicate).toBe(first);
    expect(queueAnchorUpdate).toHaveBeenCalledOnce();

    await act(async () => acknowledgement.resolve(true));
    await expect(first).resolves.toBe(true);
    await expect(duplicate).resolves.toBe(true);
  });

  it("cancels manual recovery after a same-book archive change", async () => {
    const archiveAAnnotation = highlight("shared-id", { anchorStatus: "detached" });
    const archiveBAnnotation = highlight("shared-id", { anchorStatus: "detached" });
    const resolution = deferred<ReaderAnnotationRecoveryResult>();
    const archiveAUpdate = vi.fn();
    const archiveBUpdate = vi.fn();
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    const common = {
      apiRef,
      bookId: "book-1",
      queueAnchorUpdate: vi.fn(),
    };
    await renderHarness({
      ...common,
      activeArchiveId: "archive-a",
      annotations: [archiveAAnnotation],
      resolveAnchor: vi.fn(() => resolution.promise),
      updateAnchor: archiveAUpdate,
    });
    const recovery = apiRef.current?.recoverAnnotationAnchor(archiveAAnnotation);
    await renderHarness({
      ...common,
      activeArchiveId: "archive-b",
      annotations: [archiveBAnnotation],
      resolveAnchor: vi.fn(async () => ({
        cfiRange: archiveBAnnotation.cfiRange,
        kind: "resolved" as const,
        strategy: "exact-cfi" as const,
      })),
      updateAnchor: archiveBUpdate,
    });
    await act(async () => {
      resolution.resolve({
        cfiRange: "epubcfi(/6/8!/4/2,/1:4,/1:22)",
        kind: "resolved",
        strategy: "context-text",
      });
      expect(await recovery).toEqual({ kind: "cancelled" });
    });

    expect(archiveAUpdate).not.toHaveBeenCalled();
    expect(archiveBUpdate).not.toHaveBeenCalled();
  });

  it("cancels recovery when its target is removed during resolution", async () => {
    const annotation = highlight("removed", { anchorStatus: "detached" });
    const resolution = deferred<ReaderAnnotationRecoveryResult>();
    const updateAnchor = vi.fn();
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    const common = {
      apiRef,
      bookId: "book-1",
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(() => resolution.promise),
      updateAnchor,
    };
    await renderHarness({ ...common, annotations: [annotation] });
    const recovery = apiRef.current?.recoverAnnotationAnchor(annotation);
    await renderHarness({ ...common, annotations: [] });
    await act(async () => {
      resolution.resolve({
        cfiRange: "epubcfi(/6/8!/4/2,/1:4,/1:22)",
        kind: "resolved",
        strategy: "context-text",
      });
      expect(await recovery).toEqual({ kind: "cancelled" });
    });
    expect(updateAnchor).not.toHaveBeenCalled();
  });

  it("cancels recovery when the stored identity is replaced", async () => {
    const annotation = highlight("replaced", { anchorStatus: "detached" });
    const replacement = {
      ...annotation,
      createdAt: "2026-07-15T00:00:00.000Z",
      selectedText: "Replacement record",
    };
    const resolution = deferred<ReaderAnnotationRecoveryResult>();
    const updateAnchor = vi.fn();
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    const common = {
      apiRef,
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(() => resolution.promise),
      updateAnchor,
    };
    await renderHarness({ ...common, annotations: [annotation] });
    const recovery = apiRef.current?.recoverAnnotationAnchor(annotation);
    await renderHarness({ ...common, annotations: [replacement] });
    await act(async () => {
      resolution.resolve({
        cfiRange: "epubcfi(/6/8!/4/2,/1:4,/1:22)",
        kind: "resolved",
        strategy: "context-text",
      });
      expect(await recovery).toEqual({ kind: "cancelled" });
    });
    expect(updateAnchor).not.toHaveBeenCalled();
  });

  it("cancels recovery when the target becomes active or changes type", async () => {
    const annotation = highlight("changed", { anchorStatus: "detached" });
    const resolution = deferred<ReaderAnnotationRecoveryResult>();
    const updateAnchor = vi.fn();
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    const common = {
      apiRef,
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(() => resolution.promise),
      updateAnchor,
    };
    await renderHarness({ ...common, annotations: [annotation] });
    const activeRecovery = apiRef.current?.recoverAnnotationAnchor(annotation);
    await renderHarness({ ...common, annotations: [{ ...annotation, anchorStatus: undefined }] });
    await act(async () => {
      resolution.resolve({
        cfiRange: annotation.cfiRange,
        kind: "resolved",
        strategy: "exact-cfi",
      });
      expect(await activeRecovery).toEqual({ kind: "cancelled" });
    });

    const secondResolution = deferred<ReaderAnnotationRecoveryResult>();
    await renderHarness({
      ...common,
      annotations: [annotation],
      resolveAnchor: vi.fn(() => secondResolution.promise),
    });
    const typeRecovery = apiRef.current?.recoverAnnotationAnchor(annotation);
    const bookmark: BookmarkAnnotation = {
      anchorStatus: "detached",
      cfiRange: annotation.cfiRange,
      createdAt: annotation.createdAt,
      id: annotation.id,
      type: "bookmark",
      updatedAt: annotation.updatedAt,
    };
    await renderHarness({ ...common, annotations: [bookmark] });
    await act(async () => {
      secondResolution.resolve({
        cfiRange: annotation.cfiRange,
        kind: "resolved",
        strategy: "exact-cfi",
      });
      expect(await typeRecovery).toEqual({ kind: "cancelled" });
    });
    expect(updateAnchor).not.toHaveBeenCalled();
  });

  it("keys concurrent recovery requests by annotation identity", async () => {
    const first = highlight("first", { anchorStatus: "detached" });
    const second = highlight("second", { anchorStatus: "detached" });
    const firstResolution = deferred<ReaderAnnotationRecoveryResult>();
    const updateAnchor = vi.fn(async (annotation: Annotation) => ({
      ...annotation,
      anchorStatus: undefined,
    }));
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    await renderHarness({
      annotations: [first, second],
      apiRef,
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn((annotation: Annotation) =>
        annotation.id === first.id
          ? firstResolution.promise
          : Promise.resolve({
              cfiRange: annotation.cfiRange!,
              kind: "resolved" as const,
              strategy: "exact-cfi" as const,
            }),
      ),
      updateAnchor,
    });
    const firstRecovery = apiRef.current?.recoverAnnotationAnchor(first);
    await act(async () => {
      expect((await apiRef.current?.recoverAnnotationAnchor(second))?.kind).toBe("resolved");
    });
    await act(async () => {
      firstResolution.resolve({
        cfiRange: first.cfiRange,
        kind: "resolved",
        strategy: "exact-cfi",
      });
      expect(await firstRecovery).toMatchObject({ kind: "resolved" });
    });
    expect(updateAnchor).toHaveBeenCalledTimes(2);
    expect(updateAnchor.mock.calls.map(([annotation]) => annotation.id)).toEqual([
      second.id,
      first.id,
    ]);
  });

  it("shares one recovery attempt for duplicate requests of the same annotation", async () => {
    const annotation = highlight("duplicate-recovery", { anchorStatus: "detached" });
    const resolution = deferred<ReaderAnnotationRecoveryResult>();
    const updateAnchor = vi.fn(async (target: Annotation) => ({
      ...target,
      anchorStatus: undefined,
    }));
    const resolveAnchor = vi.fn(() => resolution.promise);
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    await renderHarness({
      annotations: [annotation],
      apiRef,
      queueAnchorUpdate: vi.fn(),
      resolveAnchor,
      updateAnchor,
    });

    const first = apiRef.current!.recoverAnnotationAnchor(annotation);
    const duplicate = apiRef.current!.recoverAnnotationAnchor(annotation);
    expect(duplicate).toBe(first);
    expect(resolveAnchor).toHaveBeenCalledOnce();

    await act(async () =>
      resolution.resolve({
        cfiRange: annotation.cfiRange,
        kind: "resolved",
        strategy: "exact-cfi",
      }),
    );
    await expect(first).resolves.toMatchObject({ kind: "resolved" });
    expect(updateAnchor).toHaveBeenCalledOnce();
  });

  it("publishes persistence failure as a retryable recovery failure", async () => {
    const annotation = highlight("persistence-failure", { anchorStatus: "detached" });
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    await renderHarness({
      annotations: [annotation],
      apiRef,
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(async () => ({
        cfiRange: annotation.cfiRange,
        kind: "resolved" as const,
        strategy: "exact-cfi" as const,
      })),
      updateAnchor: vi.fn(async () => undefined),
    });

    await act(async () => {
      await expect(apiRef.current!.recoverAnnotationAnchor(annotation)).resolves.toEqual({
        kind: "failed",
      });
    });
  });

  it("uses the latest target and collection snapshot for collision checks", async () => {
    const annotation = highlight("recovering", {
      anchorStatus: "detached",
      chapterHref: "Text/old.xhtml",
    });
    const latest = { ...annotation, chapterHref: "Text/latest.xhtml" };
    const occupied = highlight("occupied", {
      cfiRange: "epubcfi(/6/8!/4/2,/1:4,/1:22)",
    });
    const resolution = deferred<ReaderAnnotationRecoveryResult>();
    const updateAnchor = vi.fn();
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    const common = {
      apiRef,
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(() => resolution.promise),
      updateAnchor,
    };
    await renderHarness({ ...common, annotations: [annotation] });
    const recovery = apiRef.current?.recoverAnnotationAnchor(annotation);
    await renderHarness({ ...common, annotations: [latest, occupied] });
    await act(async () => {
      resolution.resolve({
        cfiRange: occupied.cfiRange,
        kind: "resolved",
        strategy: "context-text",
      });
      expect(await recovery).toEqual({ kind: "detached", reason: "conflict" });
    });
    expect(updateAnchor).not.toHaveBeenCalled();
  });

  it("persists recovery from the latest live target snapshot", async () => {
    const annotation = highlight("latest-target", {
      anchorStatus: "detached",
      chapterHref: "Text/old.xhtml",
    });
    const latest = { ...annotation, chapterHref: "Text/latest.xhtml", note: "Latest note" };
    const resolution = deferred<ReaderAnnotationRecoveryResult>();
    const updateAnchor = vi.fn(async (target: Annotation) => ({
      ...target,
      anchorStatus: undefined,
    }));
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    const common = {
      apiRef,
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(() => resolution.promise),
      updateAnchor,
    };
    await renderHarness({ ...common, annotations: [annotation] });
    const recovery = apiRef.current?.recoverAnnotationAnchor(annotation);
    await renderHarness({ ...common, annotations: [latest] });
    await act(async () => {
      resolution.resolve({
        cfiRange: "epubcfi(/6/8!/4/2,/1:4,/1:22)",
        kind: "resolved",
        strategy: "context-text",
      });
      expect(await recovery).toMatchObject({ kind: "resolved" });
    });

    expect(updateAnchor).toHaveBeenCalledWith(latest, {
      anchorStatus: undefined,
      cfiRange: "epubcfi(/6/8!/4/2,/1:4,/1:22)",
      chapterHref: "Text/latest.xhtml",
    });
  });

  it("invalidates pending recovery and retained callbacks on unmount", async () => {
    const annotation = highlight("unmounted", { anchorStatus: "detached" });
    const resolution = deferred<ReaderAnnotationRecoveryResult>();
    const queueAnchorUpdate = vi.fn();
    const updateAnchor = vi.fn();
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    await renderHarness({
      annotations: [annotation],
      apiRef,
      bookId: "book-1",
      queueAnchorUpdate,
      resolveAnchor: vi.fn(() => resolution.promise),
      updateAnchor,
    });
    const recovery = apiRef.current?.recoverAnnotationAnchor(annotation);
    const invalidHandler = apiRef.current?.handleInvalidHighlightAnchor;
    await act(async () => root?.unmount());
    root = null;
    await act(async () => {
      resolution.resolve({
        cfiRange: "epubcfi(/6/8!/4/2,/1:4,/1:22)",
        kind: "resolved",
        strategy: "context-text",
      });
      expect(await recovery).toEqual({ kind: "cancelled" });
      expect(await invalidHandler?.(annotation.id)).toBe(false);
    });
    expect(queueAnchorUpdate).not.toHaveBeenCalled();
    expect(updateAnchor).not.toHaveBeenCalled();
  });

  it("keeps a conclusive detached result and leaves failures unchanged", async () => {
    const annotation = highlight("missing", { anchorStatus: "detached" });
    const updateAnchor = vi.fn();
    const apiRef = { current: undefined } as MutableRefObject<RecoveryApi | undefined>;
    const props = {
      annotations: [annotation],
      apiRef,
      bookId: "book-1",
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(async () => ({
        kind: "detached" as const,
        reason: "not-found" as const,
      })),
      updateAnchor,
    };
    await renderHarness(props);
    await act(async () => {
      expect(await apiRef.current?.recoverAnnotationAnchor(annotation)).toEqual({
        kind: "detached",
        reason: "not-found",
      });
    });
    expect(updateAnchor).not.toHaveBeenCalled();

    await renderHarness({
      ...props,
      resolveAnchor: vi.fn(async () => ({ kind: "failed" as const })),
    });
    await act(async () => {
      expect(await apiRef.current?.recoverAnnotationAnchor(annotation)).toEqual({ kind: "failed" });
    });
    expect(updateAnchor).not.toHaveBeenCalled();
  });
});
