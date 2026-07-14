// @vitest-environment happy-dom

import { act, useLayoutEffect, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BookmarkAnnotation, HighlightAnnotation } from "../../types/annotation";
import { useReaderAnnotationPanelActions } from "./useReaderAnnotationPanelActions";

type ActionApi = ReturnType<typeof useReaderAnnotationPanelActions>;
type ActionOptions = Parameters<typeof useReaderAnnotationPanelActions>[0];

const timestamp = "2026-07-12T00:00:00.000Z";
const bookmark: BookmarkAnnotation = {
  cfiRange: "epubcfi(/6/2)",
  createdAt: timestamp,
  id: "bookmark-1",
  label: "Opening",
  type: "bookmark",
  updatedAt: timestamp,
};
const highlight: HighlightAnnotation = {
  anchorStatus: "detached",
  cfiRange: "epubcfi(/6/4,/1:0,/1:12)",
  color: "blue",
  createdAt: timestamp,
  id: "highlight-1",
  note: "Remember",
  selectedText: "Quoted passage",
  type: "highlight",
  updatedAt: timestamp,
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function Harness({
  apiRef,
  options,
}: {
  apiRef: MutableRefObject<ActionApi | undefined>;
  options: ActionOptions;
}) {
  const actions = useReaderAnnotationPanelActions(options);
  useLayoutEffect(() => {
    apiRef.current = actions;
  }, [actions, apiRef]);
  return null;
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function defaultOptions(overrides: Partial<ActionOptions> = {}): ActionOptions {
  return {
    onClose: vi.fn(),
    onEditNote: vi.fn(async () => true),
    onExport: vi.fn(async () => ({
      annotationCount: 2,
      bookCount: 1,
      path: "C:\\Exports\\annotations.md",
      status: "saved" as const,
    })),
    onNavigate: vi.fn(async () => true),
    onRecolorHighlight: vi.fn(async () => true),
    onRecover: vi.fn(
      async () =>
        ({
          kind: "resolved",
          cfiRange: highlight.cfiRange!,
          strategy: "exact-cfi",
        }) as const,
    ),
    onRemove: vi.fn(async () => true),
    onUpdateBookmarkLabel: vi.fn(async () => true),
    requestRowFocus: vi.fn(),
    survivingRowId: vi.fn(() => "highlight-1"),
    ...overrides,
  };
}

async function renderActions(options: ActionOptions) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  const apiRef = { current: undefined } as MutableRefObject<ActionApi | undefined>;
  await act(async () => root?.render(<Harness apiRef={apiRef} options={options} />));
  return apiRef;
}

beforeEach(() => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn(async () => undefined) },
  });
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
});

describe("useReaderAnnotationPanelActions", () => {
  it("owns bookmark rename state by annotation id and restores that row after save", async () => {
    const onUpdateBookmarkLabel = vi.fn(async () => true);
    const requestRowFocus = vi.fn();
    const apiRef = await renderActions(defaultOptions({ onUpdateBookmarkLabel, requestRowFocus }));

    act(() => apiRef.current?.beginBookmarkRename(bookmark));
    expect(apiRef.current?.editing).toEqual({ annotationId: bookmark.id, draftLabel: "Opening" });
    act(() => apiRef.current?.setBookmarkDraftLabel("Revised opening"));
    await act(async () => {
      await apiRef.current?.saveBookmarkLabel(bookmark);
    });

    expect(onUpdateBookmarkLabel).toHaveBeenCalledWith(bookmark, "Revised opening");
    expect(requestRowFocus).toHaveBeenCalledWith(bookmark.id);
    expect(apiRef.current?.editing).toBeUndefined();
    expect(apiRef.current?.rowMutation).toBeUndefined();
  });

  it("keeps removal pending on failure and uses the pure surviving-row decision on success", async () => {
    const onRemove = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const requestRowFocus = vi.fn();
    const survivingRowId = vi.fn(() => highlight.id);
    const apiRef = await renderActions(
      defaultOptions({ onRemove, requestRowFocus, survivingRowId }),
    );

    act(() => apiRef.current?.beginRemoval(bookmark));
    await act(async () => {
      expect(await apiRef.current?.removeAnnotation(bookmark)).toBe(false);
    });
    expect(apiRef.current?.pendingRemovalId).toBe(bookmark.id);
    expect(apiRef.current?.actionError).toEqual({
      annotationId: bookmark.id,
      message: "The annotation could not be removed.",
    });

    await act(async () => {
      expect(await apiRef.current?.removeAnnotation(bookmark)).toBe(true);
    });
    expect(survivingRowId).toHaveBeenCalledWith(bookmark.id);
    expect(requestRowFocus).toHaveBeenCalledWith(highlight.id);
    expect(apiRef.current?.pendingRemovalId).toBeUndefined();
  });

  it("keeps navigation and note pending state keyed to the originating annotation", async () => {
    const navigation = deferred<boolean>();
    const onClose = vi.fn();
    const onNavigate = vi.fn(() => navigation.promise);
    const apiRef = await renderActions(defaultOptions({ onClose, onNavigate }));

    let navigationResult: Promise<boolean> | undefined;
    act(() => {
      navigationResult = apiRef.current?.navigate(bookmark);
    });
    expect(apiRef.current?.panelAction).toEqual({ annotationId: bookmark.id, kind: "navigate" });

    await act(async () => {
      navigation.resolve(true);
      expect(await navigationResult).toBe(true);
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(apiRef.current?.panelAction).toBeUndefined();

    await act(async () => {
      expect(await apiRef.current?.editNote(highlight)).toBe(true);
    });
    expect(apiRef.current?.panelAction).toBeUndefined();
  });

  it("reports recovery and detached-copy results without transferring persistence to rows", async () => {
    const requestRowFocus = vi.fn();
    const onRecover = vi.fn(async () => ({ kind: "detached", reason: "conflict" }) as const);
    const apiRef = await renderActions(defaultOptions({ onRecover, requestRowFocus }));

    await act(async () => {
      expect(await apiRef.current?.recoverAnnotation(highlight)).toBe(false);
    });
    expect(apiRef.current?.recoveryFeedback).toMatchObject({
      annotationId: highlight.id,
      status: "warning",
    });

    await act(async () => {
      expect(await apiRef.current?.copyDetachedAnnotation(highlight)).toBe(true);
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining("Status: Detached"),
    );
    expect(requestRowFocus).toHaveBeenLastCalledWith(highlight.id);
  });

  it("ignores stale action settlement after unmount", async () => {
    const navigation = deferred<boolean>();
    const onClose = vi.fn();
    const apiRef = await renderActions(
      defaultOptions({ onClose, onNavigate: vi.fn(() => navigation.promise) }),
    );

    let result: Promise<boolean> | undefined;
    act(() => {
      result = apiRef.current?.navigate(bookmark);
    });
    await act(async () => root?.unmount());
    root = null;

    navigation.resolve(true);
    expect(await result).toBe(false);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("owns export status, cancellation, failure, and retry format independently of row state", async () => {
    const onExport = vi
      .fn()
      .mockResolvedValueOnce({ status: "empty" as const })
      .mockRejectedValueOnce(new Error("Export unavailable"))
      .mockResolvedValueOnce({
        annotationCount: 1,
        bookCount: 1,
        path: "C:\\Exports\\annotations.json",
        status: "saved" as const,
      });
    const apiRef = await renderActions(defaultOptions({ onExport }));

    await act(async () => apiRef.current?.exportAnnotations("markdown"));
    expect(apiRef.current?.exportState).toMatchObject({ format: "markdown", status: "warning" });

    await act(async () => apiRef.current?.exportAnnotations("json"));
    expect(apiRef.current?.exportState).toEqual({
      format: "json",
      message: "Export unavailable",
      status: "error",
    });

    await act(async () => apiRef.current?.exportAnnotations("json"));
    expect(apiRef.current?.exportState).toMatchObject({ format: "json", status: "success" });
    expect(onExport).toHaveBeenNthCalledWith(3, "json");
  });
});
