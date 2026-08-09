// @vitest-environment happy-dom

import { act, useLayoutEffect, useMemo, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Annotation, HighlightAnnotation } from "../../types/annotation";
import type { ReaderAnnotationRecoveryResult } from "./readerAnnotationRecovery";
import type { ReaderLocation } from "./readerLocation";
import { useReaderAnnotationNavigation } from "./useReaderAnnotationNavigation";
import { useReaderAnnotationRecovery } from "./useReaderAnnotationRecovery";

type NavigationApi = ReturnType<typeof useReaderAnnotationNavigation>;

const initialLocation: ReaderLocation = {
  atEnd: false,
  atStart: true,
  cfi: "epubcfi(/6/2!/4/2:0)",
  percentage: 0,
};

function highlight(id: string): HighlightAnnotation {
  return {
    cfiRange: "epubcfi(/6/2!/4/2,/1:10,/1:30)",
    color: "yellow",
    createdAt: "2026-07-14T00:00:00.000Z",
    id,
    selectedText: "Boundary passage",
    type: "highlight",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function resolvedAnchor(annotation: Annotation): ReaderAnnotationRecoveryResult {
  return {
    cfiRange: annotation.cfiRange ?? "",
    kind: "resolved",
    strategy: "exact-cfi",
  };
}

type HarnessProps = {
  activeArchiveId?: string | null;
  annotations: readonly Annotation[];
  apiRef: MutableRefObject<NavigationApi | undefined>;
  bookId: string;
  loadStatus?: "error" | "loading" | "ready";
  navigateToLocation: (cfi: string) => Promise<boolean>;
  persistAnchor: Parameters<typeof useReaderAnnotationNavigation>[0]["persistAnchor"];
  queueAnchorUpdate: Parameters<typeof useReaderAnnotationNavigation>[0]["queueAnchorUpdate"];
  resolveAnchor: Parameters<typeof useReaderAnnotationNavigation>[0]["resolveAnchor"];
  sessionKey?: string;
};

function Harness({
  activeArchiveId = "archive-a",
  apiRef,
  bookId,
  loadStatus = "ready",
  sessionKey = `${activeArchiveId}:${bookId}`,
  ...options
}: HarnessProps) {
  const session = useMemo(
    () => ({ archiveId: activeArchiveId, bookId, token: Symbol(`navigation-${sessionKey}`) }),
    [activeArchiveId, bookId, sessionKey],
  );
  const navigation = useReaderAnnotationNavigation({
    ...options,
    initialLocation,
    loadStatus,
    session,
  });
  useLayoutEffect(() => {
    apiRef.current = navigation;
  }, [apiRef, navigation]);
  return <span data-testid="current">{navigation.currentAnnotationId}</span>;
}

type IntegratedHarnessProps = Omit<HarnessProps, "persistAnchor"> & {
  cancelQueuedAnchorUpdate: (annotationId: string) => void;
  commands: Parameters<typeof useReaderAnnotationRecovery>[0]["commands"];
};

function IntegratedHarness({
  activeArchiveId = "archive-a",
  annotations,
  apiRef,
  bookId,
  cancelQueuedAnchorUpdate,
  commands,
  loadStatus = "ready",
  navigateToLocation,
  queueAnchorUpdate,
  resolveAnchor,
  sessionKey = `${activeArchiveId}:${bookId}`,
}: IntegratedHarnessProps) {
  const session = useMemo(
    () => ({ archiveId: activeArchiveId, bookId, token: Symbol(`integrated-${sessionKey}`) }),
    [activeArchiveId, bookId, sessionKey],
  );
  const recovery = useReaderAnnotationRecovery({
    annotations,
    cancelQueuedAnchorUpdate,
    commands,
    queueAnchorUpdate,
    resolveAnchor,
    session,
  });
  const navigation = useReaderAnnotationNavigation({
    annotations,
    initialLocation,
    loadStatus,
    navigateToLocation,
    persistAnchor: recovery.persistAnchor,
    queueAnchorUpdate,
    resolveAnchor,
    session,
  });
  useLayoutEffect(() => {
    apiRef.current = navigation;
  }, [apiRef, navigation]);
  return <span data-testid="current">{navigation.currentAnnotationId}</span>;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderHarness(props: HarnessProps) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  await act(async () => root?.render(<Harness {...props} />));
}

async function renderIntegratedHarness(props: IntegratedHarnessProps) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  await act(async () => root?.render(<IntegratedHarness {...props} />));
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("useReaderAnnotationNavigation", () => {
  it("validates, persists, and navigates a range highlight to its canonical start", async () => {
    const annotation = highlight("highlight-1");
    const navigateToLocation = vi.fn<(cfi: string) => Promise<boolean>>(async () => true);
    const apiRef = { current: undefined } as MutableRefObject<NavigationApi | undefined>;
    await renderHarness({
      annotations: [annotation],
      apiRef,
      bookId: "book-1",
      navigateToLocation,
      persistAnchor: vi.fn(async () => annotation),
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(async () => ({
        cfiRange: annotation.cfiRange,
        kind: "resolved" as const,
        strategy: "exact-cfi" as const,
      })),
    });

    await act(async () => {
      expect(await apiRef.current?.navigateToAnnotation(annotation)).toBe(true);
    });

    const target = navigateToLocation.mock.calls[0]?.[0];
    expect(target).toContain(":10");
    expect(target).not.toContain(",");
    expect(apiRef.current?.currentAnnotationId).toBe(annotation.id);
  });

  it("persists invalid exact anchors as detached without navigating", async () => {
    const annotation = highlight("invalid");
    const queueAnchorUpdate = vi.fn(async () => true);
    const navigateToLocation = vi.fn();
    const apiRef = { current: undefined } as MutableRefObject<NavigationApi | undefined>;
    await renderHarness({
      annotations: [annotation],
      apiRef,
      bookId: "book-1",
      navigateToLocation,
      persistAnchor: vi.fn(),
      queueAnchorUpdate,
      resolveAnchor: vi.fn(async () => ({
        kind: "detached" as const,
        reason: "not-found" as const,
      })),
    });

    await act(async () => {
      expect(await apiRef.current?.navigateToAnnotation(annotation)).toBe(false);
    });
    expect(queueAnchorUpdate).toHaveBeenCalledWith(
      annotation,
      { anchorStatus: "detached" },
      `${annotation.cfiRange}\u0000navigation-validation`,
    );
    expect(navigateToLocation).not.toHaveBeenCalled();
  });

  it("allows only the latest navigation request to become current", async () => {
    const first = highlight("first");
    const second = highlight("second");
    const firstNavigation = deferred<boolean>();
    const secondNavigation = deferred<boolean>();
    const navigateToLocation = vi
      .fn()
      .mockImplementationOnce(() => firstNavigation.promise)
      .mockImplementationOnce(() => secondNavigation.promise);
    const apiRef = { current: undefined } as MutableRefObject<NavigationApi | undefined>;
    const resolveAnchor = vi.fn(async (annotation: Annotation) => ({
      cfiRange: annotation.cfiRange ?? "",
      kind: "resolved" as const,
      strategy: "exact-cfi" as const,
    }));
    await renderHarness({
      annotations: [first, second],
      apiRef,
      bookId: "book-1",
      navigateToLocation,
      persistAnchor: vi.fn(async (annotation) => annotation),
      queueAnchorUpdate: vi.fn(),
      resolveAnchor,
    });

    let firstResult: Promise<boolean> | undefined;
    await act(async () => {
      firstResult = apiRef.current?.navigateToAnnotation(first);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(navigateToLocation).toHaveBeenCalledTimes(1);
    let secondResult: Promise<boolean> | undefined;
    await act(async () => {
      secondResult = apiRef.current?.navigateToAnnotation(second);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(navigateToLocation).toHaveBeenCalledTimes(2);
    await act(async () => {
      secondNavigation.resolve(true);
      expect(await secondResult).toBe(true);
      firstNavigation.resolve(true);
      expect(await firstResult).toBe(false);
    });
    expect(apiRef.current?.currentAnnotationId).toBe(second.id);
  });

  it("invalidates delayed validation as soon as a newer intent starts", async () => {
    const first = highlight("validation-a");
    const second = highlight("validation-b");
    const firstValidation = deferred<ReaderAnnotationRecoveryResult>();
    const navigateToLocation = vi.fn(async () => true);
    const persistAnchor = vi.fn(async (annotation: Annotation) => annotation);
    const apiRef = { current: undefined } as MutableRefObject<NavigationApi | undefined>;
    await renderHarness({
      annotations: [first, second],
      apiRef,
      bookId: "book-1",
      navigateToLocation,
      persistAnchor,
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn((annotation: Annotation) =>
        annotation.id === first.id
          ? firstValidation.promise
          : Promise.resolve(resolvedAnchor(annotation)),
      ),
    });

    const firstResult = apiRef.current?.navigateToAnnotation(first);
    await act(async () => {
      expect(await apiRef.current?.navigateToAnnotation(second)).toBe(true);
    });
    await act(async () => {
      firstValidation.resolve(resolvedAnchor(first));
      expect(await firstResult).toBe(false);
    });

    expect(persistAnchor).toHaveBeenCalledTimes(1);
    expect(navigateToLocation).toHaveBeenCalledTimes(1);
    expect(apiRef.current?.currentAnnotationId).toBe(second.id);
  });

  it("keeps the existing current row when a newer intent fails before navigation", async () => {
    const first = highlight("current-a");
    const second = highlight("failed-b");
    const apiRef = { current: undefined } as MutableRefObject<NavigationApi | undefined>;
    await renderHarness({
      annotations: [first, second],
      apiRef,
      bookId: "book-1",
      navigateToLocation: vi.fn(async () => true),
      persistAnchor: vi.fn(async (annotation) => annotation),
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(async (annotation: Annotation) =>
        annotation.id === second.id ? { kind: "failed" as const } : resolvedAnchor(annotation),
      ),
    });

    await act(async () => {
      expect(await apiRef.current?.navigateToAnnotation(first)).toBe(true);
      expect(await apiRef.current?.navigateToAnnotation(second)).toBe(false);
    });
    expect(apiRef.current?.currentAnnotationId).toBe(first.id);
  });

  it("prevents delayed older persistence from regaining navigation ownership", async () => {
    const first = highlight("persistence-a");
    const second = highlight("persistence-b");
    const firstPersistence = deferred<Annotation | undefined>();
    const navigateToLocation = vi.fn(async () => true);
    const apiRef = { current: undefined } as MutableRefObject<NavigationApi | undefined>;
    await renderHarness({
      annotations: [first, second],
      apiRef,
      bookId: "book-1",
      navigateToLocation,
      persistAnchor: vi.fn((annotation: Annotation) =>
        annotation.id === first.id ? firstPersistence.promise : Promise.resolve(annotation),
      ),
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(async (annotation: Annotation) => resolvedAnchor(annotation)),
    });

    const firstResult = apiRef.current?.navigateToAnnotation(first);
    await act(async () => {
      await Promise.resolve();
      expect(await apiRef.current?.navigateToAnnotation(second)).toBe(true);
    });
    await act(async () => {
      firstPersistence.resolve(first);
      expect(await firstResult).toBe(false);
    });

    expect(navigateToLocation).toHaveBeenCalledTimes(1);
    expect(apiRef.current?.currentAnnotationId).toBe(second.id);
  });

  it("does not queue a stale detached validation after a newer intent", async () => {
    const first = highlight("detached-a");
    const second = highlight("detached-b");
    const firstValidation = deferred<ReaderAnnotationRecoveryResult>();
    const queueAnchorUpdate = vi.fn(async () => true);
    const apiRef = { current: undefined } as MutableRefObject<NavigationApi | undefined>;
    await renderHarness({
      annotations: [first, second],
      apiRef,
      bookId: "book-1",
      navigateToLocation: vi.fn(async () => true),
      persistAnchor: vi.fn(async (annotation) => annotation),
      queueAnchorUpdate,
      resolveAnchor: vi.fn((annotation: Annotation) =>
        annotation.id === first.id
          ? firstValidation.promise
          : Promise.resolve(resolvedAnchor(annotation)),
      ),
    });

    const firstResult = apiRef.current?.navigateToAnnotation(first);
    await act(async () => {
      expect(await apiRef.current?.navigateToAnnotation(second)).toBe(true);
      firstValidation.resolve({ kind: "detached", reason: "not-found" });
      expect(await firstResult).toBe(false);
    });
    expect(queueAnchorUpdate).not.toHaveBeenCalled();
  });

  it("clears current identity when location moves or the record detaches", async () => {
    const annotation = highlight("current");
    const apiRef = { current: undefined } as MutableRefObject<NavigationApi | undefined>;
    const common = {
      apiRef,
      bookId: "book-1",
      navigateToLocation: vi.fn(async () => true),
      persistAnchor: vi.fn(async () => annotation),
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(async () => ({
        cfiRange: annotation.cfiRange,
        kind: "resolved" as const,
        strategy: "exact-cfi" as const,
      })),
    };
    await renderHarness({ ...common, annotations: [annotation] });
    await act(async () => {
      await apiRef.current?.navigateToAnnotation(annotation);
      apiRef.current?.handleLocationChange({
        ...initialLocation,
        atStart: false,
        cfi: "epubcfi(/6/4!/4/2:0)",
      });
    });
    expect(apiRef.current?.currentAnnotationId).toBe(annotation.id);

    act(() => {
      apiRef.current?.handleLocationChange({
        ...initialLocation,
        atStart: false,
        cfi: "epubcfi(/6/6!/4/2:0)",
      });
    });
    expect(apiRef.current?.currentAnnotationId).toBeUndefined();

    await act(async () => apiRef.current?.navigateToAnnotation(annotation));
    await renderHarness({
      ...common,
      annotations: [{ ...annotation, anchorStatus: "detached" }],
    });
    expect(apiRef.current?.currentAnnotationId).toBeUndefined();
  });

  it("rejects a target removed while anchor resolution is pending", async () => {
    const annotation = highlight("removed-resolution");
    const validation = deferred<ReaderAnnotationRecoveryResult>();
    const persistAnchor = vi.fn();
    const navigateToLocation = vi.fn();
    const apiRef = { current: undefined } as MutableRefObject<NavigationApi | undefined>;
    const common = {
      apiRef,
      bookId: "book-1",
      navigateToLocation,
      persistAnchor,
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(() => validation.promise),
    };
    await renderHarness({ ...common, annotations: [annotation] });
    const result = apiRef.current?.navigateToAnnotation(annotation);
    await renderHarness({ ...common, annotations: [] });
    await act(async () => {
      validation.resolve(resolvedAnchor(annotation));
      expect(await result).toBe(false);
    });
    expect(persistAnchor).not.toHaveBeenCalled();
    expect(navigateToLocation).not.toHaveBeenCalled();
  });

  it("does not persist stale recovery after a same-id replacement during resolution", async () => {
    const annotation = highlight("replaced-resolution");
    const replacement = {
      ...annotation,
      createdAt: "2026-07-15T00:00:00.000Z",
      selectedText: "Replacement passage",
    };
    const validation = deferred<ReaderAnnotationRecoveryResult>();
    const update = vi.fn(async () => ({ annotation: replacement, status: "accepted" }) as const);
    const cancelQueuedAnchorUpdate = vi.fn();
    const navigateToLocation = vi.fn(async () => true);
    const apiRef = { current: undefined } as MutableRefObject<NavigationApi | undefined>;
    const common = {
      apiRef,
      bookId: "book-1",
      cancelQueuedAnchorUpdate,
      commands: { update },
      navigateToLocation,
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(() => validation.promise),
    };
    await renderIntegratedHarness({ ...common, annotations: [annotation] });
    const result = apiRef.current!.navigateToAnnotation(annotation);
    await renderIntegratedHarness({ ...common, annotations: [replacement] });

    await act(async () => {
      validation.resolve({
        cfiRange: "epubcfi(/6/8!/4/2,/1:4,/1:22)",
        kind: "resolved",
        strategy: "context-text",
      });
      await expect(result).resolves.toBe(false);
    });

    expect(update).not.toHaveBeenCalled();
    expect(cancelQueuedAnchorUpdate).not.toHaveBeenCalled();
    expect(navigateToLocation).not.toHaveBeenCalled();
  });

  it("rejects a target removed while anchor persistence is pending", async () => {
    const annotation = highlight("removed-persistence");
    const persistence = deferred<Annotation | undefined>();
    const navigateToLocation = vi.fn();
    const apiRef = { current: undefined } as MutableRefObject<NavigationApi | undefined>;
    const common = {
      apiRef,
      bookId: "book-1",
      navigateToLocation,
      persistAnchor: vi.fn(() => persistence.promise),
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(async () => resolvedAnchor(annotation)),
    };
    await renderHarness({ ...common, annotations: [annotation] });
    const result = apiRef.current?.navigateToAnnotation(annotation);
    await act(async () => await Promise.resolve());
    await renderHarness({ ...common, annotations: [] });
    await act(async () => {
      persistence.resolve(annotation);
      expect(await result).toBe(false);
    });
    expect(navigateToLocation).not.toHaveBeenCalled();
  });

  it("does not publish a target removed during rendition navigation", async () => {
    const annotation = highlight("removed-rendition");
    const navigation = deferred<boolean>();
    const apiRef = { current: undefined } as MutableRefObject<NavigationApi | undefined>;
    const common = {
      apiRef,
      bookId: "book-1",
      navigateToLocation: vi.fn(() => navigation.promise),
      persistAnchor: vi.fn(async () => annotation),
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(async () => resolvedAnchor(annotation)),
    };
    await renderHarness({ ...common, annotations: [annotation] });
    const result = apiRef.current?.navigateToAnnotation(annotation);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(common.navigateToLocation).toHaveBeenCalledOnce();
    await renderHarness({ ...common, annotations: [] });
    await act(async () => {
      navigation.resolve(true);
      expect(await result).toBe(false);
    });
    expect(apiRef.current?.currentAnnotationId).toBeUndefined();
  });

  it("does not publish a target detached during rendition navigation", async () => {
    const annotation = highlight("detached-rendition");
    const navigation = deferred<boolean>();
    const apiRef = { current: undefined } as MutableRefObject<NavigationApi | undefined>;
    const common = {
      apiRef,
      bookId: "book-1",
      navigateToLocation: vi.fn(() => navigation.promise),
      persistAnchor: vi.fn(async () => annotation),
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(async () => resolvedAnchor(annotation)),
    };
    await renderHarness({ ...common, annotations: [annotation] });
    const result = apiRef.current?.navigateToAnnotation(annotation);
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await renderHarness({
      ...common,
      annotations: [{ ...annotation, anchorStatus: "detached" }],
    });
    await act(async () => {
      navigation.resolve(true);
      expect(await result).toBe(false);
    });
    expect(apiRef.current?.currentAnnotationId).toBeUndefined();
  });

  it("uses a returned recovered annotation while its detached collection snapshot catches up", async () => {
    const detached = { ...highlight("recovered"), anchorStatus: "detached" as const };
    const persisted = { ...detached, anchorStatus: undefined };
    const apiRef = { current: undefined } as MutableRefObject<NavigationApi | undefined>;
    await renderHarness({
      annotations: [detached],
      apiRef,
      bookId: "book-1",
      navigateToLocation: vi.fn(async () => true),
      persistAnchor: vi.fn(async () => persisted),
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(async () => resolvedAnchor(persisted)),
    });

    await act(async () => {
      expect(await apiRef.current?.navigateToAnnotation(detached)).toBe(true);
    });
    expect(apiRef.current?.currentAnnotationId).toBe(detached.id);
  });

  it("rejects resolution completing after a book-session change", async () => {
    const annotation = highlight("stale");
    const validation = deferred<ReaderAnnotationRecoveryResult>();
    const navigateToLocation = vi.fn();
    const apiRef = { current: undefined } as MutableRefObject<NavigationApi | undefined>;
    const common = {
      annotations: [annotation],
      apiRef,
      navigateToLocation,
      persistAnchor: vi.fn(async () => annotation),
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(() => validation.promise),
    };
    await renderHarness({ ...common, bookId: "book-1" });
    const result = apiRef.current?.navigateToAnnotation(annotation);
    await renderHarness({ ...common, bookId: "book-2" });
    await act(async () => {
      validation.resolve({
        cfiRange: annotation.cfiRange,
        kind: "resolved",
        strategy: "exact-cfi",
      });
      expect(await result).toBe(false);
    });
    expect(navigateToLocation).not.toHaveBeenCalled();
  });

  it("rejects the same-book navigation callback after an archive-session change", async () => {
    const annotation = highlight("same-id");
    const validation = deferred<ReaderAnnotationRecoveryResult>();
    const archiveAPersist = vi.fn(async () => annotation);
    const archiveBPersist = vi.fn(async () => annotation);
    const archiveANavigate = vi.fn(async () => true);
    const archiveBNavigate = vi.fn(async () => true);
    const apiRef = { current: undefined } as MutableRefObject<NavigationApi | undefined>;
    const common = {
      annotations: [annotation],
      apiRef,
      bookId: "book-1",
      queueAnchorUpdate: vi.fn(),
    };
    await renderHarness({
      ...common,
      activeArchiveId: "archive-a",
      navigateToLocation: archiveANavigate,
      persistAnchor: archiveAPersist,
      resolveAnchor: vi.fn(() => validation.promise),
    });
    const result = apiRef.current?.navigateToAnnotation(annotation);
    await renderHarness({
      ...common,
      activeArchiveId: "archive-b",
      navigateToLocation: archiveBNavigate,
      persistAnchor: archiveBPersist,
      resolveAnchor: vi.fn(async () => resolvedAnchor(annotation)),
    });
    await act(async () => {
      validation.resolve(resolvedAnchor(annotation));
      expect(await result).toBe(false);
    });

    expect(archiveAPersist).not.toHaveBeenCalled();
    expect(archiveBPersist).not.toHaveBeenCalled();
    expect(archiveANavigate).not.toHaveBeenCalled();
    expect(archiveBNavigate).not.toHaveBeenCalled();
    expect(apiRef.current?.currentAnnotationId).toBeUndefined();
  });

  it("invalidates a pending request when the hook unmounts", async () => {
    const annotation = highlight("unmounted");
    const validation = deferred<ReaderAnnotationRecoveryResult>();
    const persistAnchor = vi.fn();
    const navigateToLocation = vi.fn();
    const apiRef = { current: undefined } as MutableRefObject<NavigationApi | undefined>;
    await renderHarness({
      annotations: [annotation],
      apiRef,
      bookId: "book-1",
      navigateToLocation,
      persistAnchor,
      queueAnchorUpdate: vi.fn(),
      resolveAnchor: vi.fn(() => validation.promise),
    });
    const result = apiRef.current?.navigateToAnnotation(annotation);
    await act(async () => root?.unmount());
    root = null;
    await act(async () => {
      validation.resolve(resolvedAnchor(annotation));
      expect(await result).toBe(false);
    });
    expect(persistAnchor).not.toHaveBeenCalled();
    expect(navigateToLocation).not.toHaveBeenCalled();
  });
});
