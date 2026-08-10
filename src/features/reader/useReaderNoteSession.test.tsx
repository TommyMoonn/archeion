// @vitest-environment happy-dom

import { act, useLayoutEffect, useRef, useState, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Annotation, HighlightAnnotation } from "../../types/annotation";
import type { ReaderTextSelection } from "./EpubViewer";
import { ReaderNoteEditor } from "./ReaderNoteEditor";
import type { ReaderAnnotationCommandSurface } from "./useReaderAnnotationMutations";
import { useReaderNoteSession, type ReaderNoteTarget } from "./useReaderNoteSession";

type NoteSessionApi = ReturnType<typeof useReaderNoteSession>;
type UpdateCommand = ReaderAnnotationCommandSurface["update"];

function highlight(id: string, changes: Partial<HighlightAnnotation> = {}): HighlightAnnotation {
  return {
    cfiRange: `epubcfi(/6/2!/4/2,/1:1,/1:${id.length + 4})`,
    color: "yellow",
    createdAt: "2026-07-14T00:00:00.000Z",
    id,
    selectedText: `Quote ${id}`,
    type: "highlight",
    updatedAt: "2026-07-14T00:00:00.000Z",
    ...changes,
  };
}

function selection(id: string): ReaderTextSelection {
  return {
    cfiRange: `epubcfi(/6/2!/4/2,/1:1,/1:${id.length + 4})`,
    chapterHref: "chapter.xhtml",
    selectedText: `Quote ${id}`,
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

function accepted(annotation: HighlightAnnotation): Awaited<ReturnType<UpdateCommand>> {
  return { annotation, status: "accepted" };
}

type HarnessProps = {
  apiRef: MutableRefObject<NoteSessionApi | undefined>;
  annotations?: readonly Annotation[];
  archiveId?: string;
  bookId?: string;
  claimNoteEditing?: (annotationId: string) => boolean;
  editorVisible?: boolean;
  ensureHighlight?: (selection: ReaderTextSelection) => Promise<HighlightAnnotation | undefined>;
  onClose?: (restoreFocus?: boolean) => void;
  onTargetUpdate?: (target: ReaderNoteTarget) => void;
  publishNoteRemoved?: (annotation: HighlightAnnotation) => void;
  resolveCurrentAnnotation?: (annotationId: string) => Annotation | undefined;
  retireNoteRemoval?: (annotationId: string) => void;
  targetRef: MutableRefObject<ReaderNoteTarget | null>;
  updateAnnotation: UpdateCommand;
};

function Harness({
  apiRef,
  annotations = [],
  archiveId = "archive-a",
  bookId = "book-a",
  claimNoteEditing = () => true,
  editorVisible = false,
  ensureHighlight = async () => undefined,
  onClose = () => undefined,
  onTargetUpdate,
  publishNoteRemoved = () => undefined,
  resolveCurrentAnnotation,
  retireNoteRemoval = () => undefined,
  targetRef: externalTargetRef,
  updateAnnotation,
}: HarnessProps) {
  const [target, setTarget] = useState<ReaderNoteTarget | null>(null);
  const targetRef = useRef(target);
  const session = useReaderNoteSession({
    archiveId,
    bookId,
    claimNoteEditing,
    ensureHighlight,
    publishNoteRemoved,
    resolveCurrentAnnotation:
      resolveCurrentAnnotation ??
      ((annotationId) => annotations.find((annotation) => annotation.id === annotationId)),
    retireNoteRemoval,
    updateAnnotation,
  });
  const editorState = target ? session.editorStateFor(target) : undefined;

  useLayoutEffect(() => {
    targetRef.current = target;
    externalTargetRef.current = target;
    return session.connectSurface({
      closeTarget: (restoreFocus) => {
        targetRef.current = null;
        externalTargetRef.current = null;
        setTarget(null);
        onClose(restoreFocus);
      },
      getTarget: () => targetRef.current,
      showTarget: (nextTarget) => {
        targetRef.current = nextTarget;
        externalTargetRef.current = nextTarget;
        setTarget(nextTarget);
      },
      updateTarget: (nextTarget) => {
        onTargetUpdate?.(nextTarget);
        targetRef.current = nextTarget;
        externalTargetRef.current = nextTarget;
        setTarget(nextTarget);
      },
    });
  }, [externalTargetRef, onClose, onTargetUpdate, session, target]);

  useLayoutEffect(() => {
    apiRef.current = session;
  }, [apiRef, session]);

  return target && editorVisible && editorState ? (
    <ReaderNoteEditor
      keepsHighlightOnEmptyClose={target.keepsHighlightOnEmptyClose}
      key={target.editorKey}
      onBack={(restoreFocus) => void session.close(target, restoreFocus)}
      onDelete={() => void session.discard(target)}
      onDraftChange={(text) => session.edit(target, text)}
      onRetry={() => void session.save(target)}
      onUnmount={() => session.handleEditorUnmount(target)}
      state={editorState}
    />
  ) : (
    <span data-testid="target">{target?.annotation.id}</span>
  );
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function renderHarness(props: HarnessProps) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  await act(async () => root?.render(<Harness {...props} />));
}

function editDraft(value: string) {
  const field = container?.querySelector<HTMLTextAreaElement>("textarea");
  if (!field) throw new Error("Expected a note textarea.");
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

afterEach(async () => {
  vi.useRealTimers();
  const mountedRoot = root;
  root = null;
  await act(async () => mountedRoot?.unmount());
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

describe("useReaderNoteSession", () => {
  it("creates a highlight before opening a fresh note target", async () => {
    const created = highlight("created");
    let authoritative: readonly Annotation[] = [];
    const ensureHighlight = vi.fn(async () => {
      authoritative = [created];
      return created;
    });
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    await renderHarness({
      apiRef,
      ensureHighlight,
      resolveCurrentAnnotation: (annotationId) =>
        authoritative.find((annotation) => annotation.id === annotationId),
      targetRef,
      updateAnnotation: vi.fn(),
    });

    act(() => apiRef.current?.openSelection(selection("created")));
    await act(async () => Promise.resolve());

    expect(ensureHighlight).toHaveBeenCalledWith(selection("created"));
    expect(targetRef.current?.annotation).toBe(created);
    expect(targetRef.current?.keepsHighlightOnEmptyClose).toBe(true);
    expect(targetRef.current?.targetIdentity).toBe(`annotation:${created.id}:${created.createdAt}`);
  });

  it("rejects opening a target whose note-editing ownership cannot be claimed", async () => {
    const blocked = highlight("blocked");
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    await renderHarness({
      apiRef,
      annotations: [blocked],
      claimNoteEditing: () => false,
      targetRef,
      updateAnnotation: vi.fn(),
    });

    await act(async () => {
      await expect(apiRef.current!.open(blocked)).resolves.toBe(false);
    });

    expect(targetRef.current).toBeNull();
  });

  it("rejects a save when the authoritative annotation was replaced with the same ID", async () => {
    const original = highlight("replaced-save", { note: "Original note" });
    const replacement = highlight("replaced-save", {
      createdAt: "2026-07-15T00:00:00.000Z",
      note: "Replacement note",
    });
    let authoritative: readonly Annotation[] = [original];
    const updateAnnotation = vi.fn<UpdateCommand>();
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    await renderHarness({
      apiRef,
      resolveCurrentAnnotation: (annotationId) =>
        authoritative.find((annotation) => annotation.id === annotationId),
      targetRef,
      updateAnnotation,
    });
    await act(async () => {
      await apiRef.current?.open(original);
    });
    const staleTarget = targetRef.current!;
    act(() => apiRef.current?.edit(staleTarget, "Stale note draft"));
    authoritative = [replacement];

    await act(async () => {
      await expect(apiRef.current!.save(staleTarget)).resolves.toBe(false);
    });

    expect(updateAnnotation).not.toHaveBeenCalled();
    expect(replacement.note).toBe("Replacement note");
    expect(targetRef.current).toBeNull();
  });

  it("rejects deletion when the authoritative annotation was replaced with the same ID", async () => {
    const original = highlight("replaced-delete", { note: "Original note" });
    const replacement = highlight("replaced-delete", {
      createdAt: "2026-07-15T00:00:00.000Z",
      note: "Replacement note",
    });
    let authoritative: readonly Annotation[] = [original];
    const publishNoteRemoved = vi.fn();
    const updateAnnotation = vi.fn<UpdateCommand>();
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    await renderHarness({
      apiRef,
      publishNoteRemoved,
      resolveCurrentAnnotation: (annotationId) =>
        authoritative.find((annotation) => annotation.id === annotationId),
      targetRef,
      updateAnnotation,
    });
    await act(async () => {
      await apiRef.current?.open(original);
    });
    const staleTarget = targetRef.current!;
    authoritative = [replacement];

    await act(async () => {
      await expect(apiRef.current!.discard(staleTarget)).resolves.toBe(false);
    });

    expect(updateAnnotation).not.toHaveBeenCalled();
    expect(publishNoteRemoved).not.toHaveBeenCalled();
    expect(replacement.note).toBe("Replacement note");
  });

  it("persists through the current live annotation when mutable fields changed", async () => {
    const original = highlight("live-mutable", { note: "Original note" });
    const live = {
      ...original,
      color: "blue" as const,
      updatedAt: "2026-07-15T00:00:00.000Z",
    };
    let authoritative: readonly Annotation[] = [original];
    const updateAnnotation = vi.fn<UpdateCommand>(async (command) => {
      if (command.annotationType !== "highlight") return { status: "rejected" };
      const saved = { ...command.annotation, note: command.changes.note };
      authoritative = [saved];
      return accepted(saved);
    });
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    await renderHarness({
      apiRef,
      resolveCurrentAnnotation: (annotationId) =>
        authoritative.find((annotation) => annotation.id === annotationId),
      targetRef,
      updateAnnotation,
    });
    await act(async () => {
      await apiRef.current?.open(original);
    });
    const target = targetRef.current!;
    authoritative = [live];
    act(() => apiRef.current?.edit(target, "Updated note"));

    await act(async () => {
      await expect(apiRef.current!.save(target)).resolves.toBe(true);
    });

    expect(updateAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ annotation: live, changes: { note: "Updated note" } }),
    );
    expect(targetRef.current?.annotation).toMatchObject({
      color: "blue",
      note: "Updated note",
      updatedAt: live.updatedAt,
    });
  });

  it("does not adopt an accepted persistence result with a different target identity", async () => {
    const original = highlight("mismatched-result", { note: "Original note" });
    const mismatched = highlight("mismatched-result", {
      createdAt: "2026-07-15T00:00:00.000Z",
      note: "Stale write",
    });
    let authoritative: readonly Annotation[] = [original];
    const onTargetUpdate = vi.fn();
    const updateAnnotation = vi.fn<UpdateCommand>(async () => {
      authoritative = [mismatched];
      return accepted(mismatched);
    });
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    await renderHarness({
      apiRef,
      onTargetUpdate,
      resolveCurrentAnnotation: (annotationId) =>
        authoritative.find((annotation) => annotation.id === annotationId),
      targetRef,
      updateAnnotation,
    });
    await act(async () => {
      await apiRef.current?.open(original);
    });
    const target = targetRef.current!;
    act(() => apiRef.current?.edit(target, "Stale write"));

    await act(async () => {
      await expect(apiRef.current!.save(target)).resolves.toBe(false);
    });

    expect(updateAnnotation).toHaveBeenCalledOnce();
    expect(onTargetUpdate).not.toHaveBeenCalled();
    expect(targetRef.current).toBeNull();
  });

  it("rejects an existing target replaced while its asynchronous open is settling", async () => {
    const active = highlight("active", { note: "Active note" });
    const opening = highlight("opening", { note: "Opening note" });
    const replacement = highlight("opening", {
      createdAt: "2026-07-15T00:00:00.000Z",
      note: "Replacement note",
    });
    const pendingSave = deferred<Awaited<ReturnType<UpdateCommand>>>();
    let authoritative: readonly Annotation[] = [active, opening];
    const updateAnnotation = vi.fn<UpdateCommand>(() => pendingSave.promise);
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    await renderHarness({
      apiRef,
      resolveCurrentAnnotation: (annotationId) =>
        authoritative.find((annotation) => annotation.id === annotationId),
      targetRef,
      updateAnnotation,
    });
    await act(async () => {
      await apiRef.current?.open(active);
    });
    act(() => apiRef.current?.edit(targetRef.current!, "Settled active note"));

    let openResult!: Promise<boolean>;
    act(() => {
      openResult = apiRef.current!.open(opening);
    });
    const savedActive = { ...active, note: "Settled active note" };
    authoritative = [savedActive, replacement];
    await act(async () => pendingSave.resolve(accepted(savedActive)));

    await expect(openResult).resolves.toBe(false);
    expect(targetRef.current?.annotation.id).toBe(active.id);
    expect(targetRef.current?.annotation.note).toBe("Settled active note");
  });

  it("keeps the owned draft when the editor surface moves away and returns", async () => {
    const original = highlight("moving-editor", { note: "Persisted note" });
    const updateAnnotation = vi.fn<UpdateCommand>(async () => ({ status: "failed" }));
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    const props: HarnessProps = {
      apiRef,
      annotations: [original],
      editorVisible: true,
      targetRef,
      updateAnnotation,
    };
    await renderHarness(props);
    await act(async () => {
      await apiRef.current?.open(original);
    });
    editDraft("Unsaved session draft");

    await renderHarness({ ...props, editorVisible: false });
    await act(async () => Promise.resolve());
    await renderHarness({ ...props, editorVisible: true });

    expect(container?.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe(
      "Unsaved session draft",
    );
    expect(apiRef.current?.draftFor(targetRef.current!)).toEqual({
      text: "Unsaved session draft",
    });
  });

  it("serializes saves and prevents an older completion from overwriting a newer draft", async () => {
    const original = highlight("serialized", { note: "Original" });
    const liveBetweenRevisions = {
      ...original,
      color: "rose" as const,
      updatedAt: "2026-07-15T00:00:00.000Z",
    };
    let authoritative: readonly Annotation[] = [original];
    const firstSave = deferred<Awaited<ReturnType<UpdateCommand>>>();
    const secondSave = deferred<Awaited<ReturnType<UpdateCommand>>>();
    const updateAnnotation = vi
      .fn<UpdateCommand>()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    await renderHarness({
      apiRef,
      resolveCurrentAnnotation: (annotationId) =>
        authoritative.find((annotation) => annotation.id === annotationId),
      targetRef,
      updateAnnotation,
    });
    await act(async () => {
      await apiRef.current?.open(original);
    });
    const target = targetRef.current!;

    act(() => apiRef.current?.edit(target, "First draft"));
    let settlement!: Promise<boolean>;
    act(() => {
      settlement = apiRef.current!.save(target);
    });
    act(() => apiRef.current?.edit(target, "Latest draft"));
    expect(apiRef.current?.editorStateFor(target)?.text).toBe("Latest draft");

    authoritative = [liveBetweenRevisions];
    await act(async () => firstSave.resolve(accepted({ ...original, note: "First draft" })));
    expect(updateAnnotation).toHaveBeenCalledTimes(2);
    expect(apiRef.current?.editorStateFor(target)?.text).toBe("Latest draft");

    await act(async () =>
      secondSave.resolve(accepted({ ...liveBetweenRevisions, note: "Latest draft" })),
    );
    await expect(settlement).resolves.toBe(true);
    expect(updateAnnotation).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        annotation: liveBetweenRevisions,
        changes: { note: "Latest draft" },
      }),
    );
    expect(targetRef.current?.annotation.note).toBe("Latest draft");
    expect(apiRef.current?.draftFor(targetRef.current!)).toBeUndefined();
  });

  it("keeps a failed save as a retryable session draft", async () => {
    const original = highlight("retryable", { note: "Original" });
    const saved = { ...original, note: "Retry draft" };
    const updateAnnotation = vi
      .fn<UpdateCommand>()
      .mockResolvedValueOnce({ status: "failed" })
      .mockResolvedValueOnce(accepted(saved));
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    await renderHarness({ annotations: [original], apiRef, targetRef, updateAnnotation });
    await act(async () => {
      await apiRef.current?.open(original);
    });
    const target = targetRef.current!;
    act(() => apiRef.current?.edit(target, "Retry draft"));

    await act(async () => {
      await expect(apiRef.current!.save(target)).resolves.toBe(false);
    });
    expect(apiRef.current?.editorStateFor(target)).toMatchObject({
      errorKind: "save",
      status: "error",
      text: "Retry draft",
    });
    expect(apiRef.current?.draftFor(target)).toEqual({ text: "Retry draft" });

    await act(async () => {
      await expect(apiRef.current!.save(target)).resolves.toBe(true);
    });
    expect(targetRef.current?.annotation).toEqual(saved);
    expect(apiRef.current?.draftFor(targetRef.current!)).toBeUndefined();
  });

  it("discards only the active target and rejects a stale target", async () => {
    const first = highlight("first", { note: "First note" });
    const second = highlight("second", { note: "Second note" });
    const removed = { ...second, note: undefined };
    const publishNoteRemoved = vi.fn();
    const updateAnnotation = vi.fn<UpdateCommand>(async () => accepted(removed));
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    await renderHarness({
      apiRef,
      annotations: [first, second],
      publishNoteRemoved,
      targetRef,
      updateAnnotation,
    });
    await act(async () => {
      await apiRef.current?.open(first);
    });
    const staleTarget = targetRef.current!;
    await act(async () => {
      await apiRef.current?.open(second);
    });
    const activeTarget = targetRef.current!;

    await expect(apiRef.current?.discard(staleTarget)).resolves.toBe(false);
    await act(async () => {
      await expect(apiRef.current!.discard(activeTarget)).resolves.toBe(true);
    });

    expect(updateAnnotation).toHaveBeenCalledOnce();
    expect(updateAnnotation).toHaveBeenCalledWith(
      expect.objectContaining({ annotation: second, changes: { note: undefined } }),
    );
    expect(publishNoteRemoved).toHaveBeenCalledWith(second);
  });

  it("settles the latest draft before closing the surface", async () => {
    const original = highlight("close", { note: "Original" });
    const saved = { ...original, note: "Final" };
    const onClose = vi.fn();
    const updateAnnotation = vi.fn<UpdateCommand>(async () => accepted(saved));
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    await renderHarness({
      annotations: [original],
      apiRef,
      onClose,
      targetRef,
      updateAnnotation,
    });
    await act(async () => {
      await apiRef.current?.open(original);
    });
    const target = targetRef.current!;
    act(() => apiRef.current?.edit(target, "Final"));

    await act(async () => {
      await expect(apiRef.current!.close(target, false)).resolves.toBe(true);
    });

    expect(updateAnnotation).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledWith(false);
    expect(targetRef.current).toBeNull();
  });

  it("retires an in-flight save when the Reader session identity changes", async () => {
    const original = highlight("stale-session", { note: "Original" });
    const pending = deferred<Awaited<ReturnType<UpdateCommand>>>();
    const updateAnnotation = vi.fn<UpdateCommand>(() => pending.promise);
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    const props: HarnessProps = {
      annotations: [original],
      apiRef,
      targetRef,
      updateAnnotation,
    };
    await renderHarness(props);
    await act(async () => {
      await apiRef.current?.open(original);
    });
    const staleTarget = targetRef.current!;
    act(() => apiRef.current?.edit(staleTarget, "Stale draft"));
    let save!: Promise<boolean>;
    act(() => {
      save = apiRef.current!.save(staleTarget);
    });

    await renderHarness({ ...props, archiveId: "archive-b" });
    await act(async () => pending.resolve(accepted({ ...original, note: "Stale draft" })));

    await expect(save).resolves.toBe(false);
    expect(targetRef.current).toBeNull();
  });

  it("does not let a replaced editor start persistence", async () => {
    const first = highlight("first");
    const second = highlight("second");
    const updateAnnotation = vi.fn<UpdateCommand>();
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    await renderHarness({ annotations: [first, second], apiRef, targetRef, updateAnnotation });
    await act(async () => {
      await apiRef.current?.open(first);
    });
    const staleTarget = targetRef.current!;
    await act(async () => {
      await apiRef.current?.open(second);
    });

    expect(apiRef.current?.edit(staleTarget, "Stale draft")).toBe(false);
    await expect(apiRef.current?.save(staleTarget)).resolves.toBe(false);
    expect(updateAnnotation).not.toHaveBeenCalled();
    expect(targetRef.current?.annotation.id).toBe(second.id);
  });

  it("starts unmount durability once and rejects later publication", async () => {
    const original = highlight("unmount");
    const pending = deferred<Awaited<ReturnType<UpdateCommand>>>();
    const updateAnnotation = vi.fn<UpdateCommand>(() => pending.promise);
    const onTargetUpdate = vi.fn();
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    await renderHarness({
      apiRef,
      annotations: [original],
      editorVisible: true,
      onTargetUpdate,
      targetRef,
      updateAnnotation,
    });
    await act(async () => {
      await apiRef.current?.open(original);
    });
    editDraft("Final draft");
    onTargetUpdate.mockClear();

    const mountedRoot = root;
    root = null;
    await act(async () => mountedRoot?.unmount());
    expect(updateAnnotation).toHaveBeenCalledOnce();

    await act(async () => pending.resolve(accepted({ ...original, note: "Final draft" })));
    expect(onTargetUpdate).not.toHaveBeenCalled();
  });

  it("cancels superseded note opens and publishes only the latest target", async () => {
    const first = highlight("first");
    const second = highlight("second");
    const apiRef = { current: undefined } as MutableRefObject<NoteSessionApi | undefined>;
    const targetRef = { current: null } as MutableRefObject<ReaderNoteTarget | null>;
    await renderHarness({
      annotations: [first, second],
      apiRef,
      targetRef,
      updateAnnotation: vi.fn(),
    });

    let firstResult = true;
    let secondResult = false;
    await act(async () => {
      const firstOpen = apiRef.current!.open(first);
      const secondOpen = apiRef.current!.open(second);
      firstResult = await firstOpen;
      secondResult = await secondOpen;
    });

    expect(firstResult).toBe(false);
    expect(secondResult).toBe(true);
    expect(targetRef.current?.annotation.id).toBe(second.id);
  });
});
