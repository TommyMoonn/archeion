// @vitest-environment happy-dom

import { act, createRef, type ComponentProps, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HighlightAnnotation } from "../../types/annotation";
import { ReaderNoteEditor, type ReaderNoteEditorHandle } from "./ReaderNoteEditor";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

const annotation: HighlightAnnotation = {
  id: "highlight-1",
  type: "highlight",
  cfiRange: "epubcfi(/6/2!/4/2:1)",
  selectedText: "Passage",
  color: "yellow",
  note: "Original",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
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

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.useRealTimers();
});

function createContainer() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  return container;
}

function defaultProps(): ComponentProps<typeof ReaderNoteEditor> {
  return {
    annotation,
    onBusyChange: vi.fn(),
    onBack: vi.fn(),
    onDelete: vi.fn(async () => true),
    onSave: vi.fn(async (note: string) => ({ ...annotation, note })),
  };
}

function renderElement(element: ReactElement) {
  const target = container ?? createContainer();
  act(() => root?.render(element));
  return target;
}

function renderEditor(overrides: Partial<ComponentProps<typeof ReaderNoteEditor>> = {}) {
  const props = { ...defaultProps(), ...overrides };
  const target = renderElement(<ReaderNoteEditor {...props} />);
  return { container: target, props };
}

function enterText(target: HTMLElement, text: string) {
  const textarea = target.querySelector<HTMLTextAreaElement>("textarea");
  if (!textarea) throw new Error("Note textarea was not rendered.");
  act(() => {
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setValue?.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function button(target: HTMLElement, label: string): HTMLButtonElement {
  const match = Array.from(target.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) =>
      candidate.getAttribute("aria-label") === label || candidate.textContent?.trim() === label,
  );
  if (!match) throw new Error(`Button ${label} was not rendered.`);
  return match;
}

async function click(target: HTMLElement, label: string) {
  await act(async () => button(target, label).click());
}

async function confirmDelete(target: HTMLElement) {
  await click(target, "Delete note");
  await click(target, "Delete");
}

describe("ReaderNoteEditor", () => {
  it("explains that closing an empty fresh note keeps its new highlight", async () => {
    const freshHighlight = { ...annotation, note: undefined };
    const { container: target, props } = renderEditor({
      annotation: freshHighlight,
      keepsHighlightOnEmptyClose: true,
    });

    expect(target.textContent).toContain("Closing without a note keeps the highlight.");
    await click(target, "Back to annotations");

    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onDelete).not.toHaveBeenCalled();
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it("autosaves only after the debounce while preserving editor geometry", async () => {
    vi.useFakeTimers();
    const { container: target, props } = renderEditor();
    enterText(target, "Updated note");

    expect(props.onSave).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(649));
    expect(props.onSave).not.toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTimeAsync(1));

    expect(props.onSave).toHaveBeenCalledWith("Updated note", annotation);
    expect(target.querySelector("[role=status]")?.textContent).toContain("Saved");
    expect(target.querySelector(".reader-note-editor__status")).toBeInstanceOf(HTMLDivElement);
    expect(target.querySelector(".reader-note-editor__footer")).toBeInstanceOf(HTMLElement);
  });

  it("coalesces a rapid editing burst into one final note write", async () => {
    vi.useFakeTimers();
    const { container: target, props } = renderEditor();

    for (let index = 1; index <= 50; index += 1) {
      enterText(target, `Draft ${index}`);
    }
    await act(async () => vi.advanceTimersByTimeAsync(650));

    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onSave).toHaveBeenCalledWith("Draft 50", annotation);
  });

  it("flushes a pending edit before closing without a duplicate timer save", async () => {
    vi.useFakeTimers();
    const { container: target, props } = renderEditor();
    enterText(target, "Close-safe note");

    await click(target, "Back to annotations");
    await act(async () => vi.runAllTimersAsync());

    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onSave).toHaveBeenCalledWith("Close-safe note", annotation);
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it("exposes an awaited flush that keeps a failed draft visible and retryable", async () => {
    const editorRef = createRef<ReaderNoteEditorHandle>();
    const onSave = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async (note: string) => ({ ...annotation, note }));
    const props = { ...defaultProps(), onSave };
    const target = renderElement(<ReaderNoteEditor {...props} ref={editorRef} />);
    enterText(target, "Await this note");

    let flushed = true;
    await act(async () => {
      flushed = (await editorRef.current?.settle()) ?? true;
    });

    expect(flushed).toBe(false);
    expect(props.onBack).not.toHaveBeenCalled();
    expect(target.querySelector("[role=status]")?.textContent).toContain("Not saved");
    expect(target.querySelector("[role=status]")?.getAttribute("aria-live")).toBe("assertive");
    expect(button(target, "Retry")).toBeInstanceOf(HTMLButtonElement);

    await click(target, "Retry");
    expect(target.querySelector("[role=status]")?.textContent).toContain("Saved");
  });

  it("does not duplicate a controlled flush during the later unmount fallback", async () => {
    const editorRef = createRef<ReaderNoteEditorHandle>();
    const props = defaultProps();
    const target = renderElement(<ReaderNoteEditor {...props} ref={editorRef} />);
    enterText(target, "Persist once");

    await act(async () => {
      expect(await editorRef.current?.settle()).toBe(true);
    });
    act(() => {
      root?.unmount();
      root = null;
    });
    await act(async () => Promise.resolve());

    expect(props.onSave).toHaveBeenCalledTimes(1);
  });

  it("flushes a meaningful pending draft when unmounted", async () => {
    vi.useFakeTimers();
    const { container: target, props } = renderEditor();
    enterText(target, "Unmount-safe note");

    await act(async () => {
      root?.unmount();
      root = null;
      await Promise.resolve();
    });

    expect(props.onSave).toHaveBeenCalledTimes(1);
    expect(props.onSave).toHaveBeenCalledWith("Unmount-safe note", annotation);
  });

  it("flushes the previous editor session when another note replaces it", async () => {
    vi.useFakeTimers();
    const firstProps = defaultProps();
    const second = { ...annotation, id: "highlight-2", note: "Second" };
    const secondProps = { ...defaultProps(), annotation: second };
    const target = renderElement(<ReaderNoteEditor key="first" {...firstProps} />);
    enterText(target, "First pending draft");

    await act(async () => {
      root?.render(<ReaderNoteEditor key="second" {...secondProps} />);
      await Promise.resolve();
    });

    expect(firstProps.onSave).toHaveBeenCalledTimes(1);
    expect(firstProps.onSave).toHaveBeenCalledWith("First pending draft", annotation);
    expect(secondProps.onSave).not.toHaveBeenCalled();
  });

  it("serializes saves and persists the newest draft after an active save", async () => {
    vi.useFakeTimers();
    const firstSave = deferred<HighlightAnnotation | undefined>();
    const onSave = vi
      .fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(async (note: string) => ({ ...annotation, note }));
    const { container: target } = renderEditor({ onSave });

    enterText(target, "First draft");
    await act(async () => vi.advanceTimersByTimeAsync(650));
    expect(onSave).toHaveBeenCalledTimes(1);

    enterText(target, "Newest draft");
    await act(async () => firstSave.resolve({ ...annotation, note: "First draft" }));

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1]?.[0]).toBe("Newest draft");
    expect(target.querySelector("[role=status]")?.textContent).toContain("Saved");
  });

  it("does not let an older completion mark a newer draft as saved", async () => {
    vi.useFakeTimers();
    const firstSave = deferred<HighlightAnnotation | undefined>();
    const secondSave = deferred<HighlightAnnotation | undefined>();
    const onSave = vi
      .fn()
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => secondSave.promise);
    const { container: target } = renderEditor({ onSave });

    enterText(target, "First draft");
    await act(async () => vi.advanceTimersByTimeAsync(650));
    enterText(target, "Second draft");
    await act(async () => firstSave.resolve({ ...annotation, note: "First draft" }));

    expect(target.querySelector("[role=status]")?.textContent).toContain("Saving");
    await act(async () => secondSave.resolve({ ...annotation, note: "Second draft" }));
    expect(target.querySelector("[role=status]")?.textContent).toContain("Saved");
  });

  it("keeps the latest failed save visible and retryable", async () => {
    vi.useFakeTimers();
    const onSave = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async (note: string) => ({ ...annotation, note }));
    const { container: target } = renderEditor({ onSave });
    enterText(target, "Retry this note");
    await act(async () => vi.advanceTimersByTimeAsync(650));

    expect(target.querySelector("[role=status]")?.textContent).toContain("Not saved");
    await click(target, "Retry");

    expect(onSave).toHaveBeenCalledTimes(2);
    expect(onSave.mock.calls[1]?.[0]).toBe("Retry this note");
    expect(target.querySelector("[role=status]")?.textContent).toContain("Saved");
  });

  it("does not publish completion callbacks after unmount", async () => {
    vi.useFakeTimers();
    const pending = deferred<HighlightAnnotation | undefined>();
    const onBusyChange = vi.fn();
    const { container: target } = renderEditor({
      onBusyChange,
      onSave: vi.fn(() => pending.promise),
    });
    enterText(target, "Pending during unmount");
    await act(async () => vi.advanceTimersByTimeAsync(650));
    expect(onBusyChange).toHaveBeenLastCalledWith(true);

    act(() => {
      root?.unmount();
      root = null;
    });
    const callsBeforeCompletion = onBusyChange.mock.calls.length;
    await act(async () => pending.resolve({ ...annotation, note: "Pending during unmount" }));

    expect(onBusyChange).toHaveBeenCalledTimes(callsBeforeCompletion);
  });

  it("requires explicit deletion when an existing note is cleared", async () => {
    vi.useFakeTimers();
    const { container: target, props } = renderEditor();
    enterText(target, "");
    await act(async () => vi.runAllTimersAsync());

    expect(props.onSave).not.toHaveBeenCalled();
    expect(target.querySelector("[role=status]")?.textContent).toContain(
      "Use Delete note to remove it.",
    );
    expect(button(target, "Delete note").disabled).toBe(false);

    await click(target, "Back to annotations");
    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it("waits for a pending existing-note update before deleting the updated record", async () => {
    vi.useFakeTimers();
    const update = deferred<HighlightAnnotation | undefined>();
    const updated = { ...annotation, note: "Updated before delete" };
    const onSave = vi.fn(() => update.promise);
    const onDelete = vi.fn(async () => true);
    const { container: target } = renderEditor({ onDelete, onSave });

    enterText(target, "Updated before delete");
    await act(async () => vi.advanceTimersByTimeAsync(650));
    await click(target, "Delete note");
    await act(async () => {
      button(target, "Delete").click();
      await Promise.resolve();
    });

    expect(onDelete).not.toHaveBeenCalled();
    await act(async () => update.resolve(updated));
    expect(onDelete).toHaveBeenCalledWith(updated);
  });

  it("does not recreate a note after deletion and deduplicates repeated confirmation", async () => {
    vi.useFakeTimers();
    const deletion = deferred<boolean>();
    const onDelete = vi.fn(() => deletion.promise);
    const { container: target, props } = renderEditor({ onDelete });

    await click(target, "Delete note");
    await act(async () => {
      const confirm = button(target, "Delete");
      confirm.click();
      confirm.click();
      await Promise.resolve();
    });
    expect(onDelete).toHaveBeenCalledTimes(1);

    await act(async () => deletion.resolve(true));
    await act(async () => vi.runAllTimersAsync());

    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it("keeps the editor open with visible feedback when deletion fails", async () => {
    const { container: target, props } = renderEditor({ onDelete: vi.fn(async () => false) });

    await confirmDelete(target);

    expect(props.onBack).toHaveBeenCalledTimes(1);
    expect(target.querySelector("[role=status]")?.textContent).toContain(
      "Note could not be deleted.",
    );
    expect(target.querySelector("textarea")).toBeInstanceOf(HTMLTextAreaElement);
  });

  it("settles a pending confirmed deletion before external close", async () => {
    const editorRef = createRef<ReaderNoteEditorHandle>();
    const deletion = deferred<boolean>();
    const onDelete = vi.fn(() => deletion.promise);
    const props = { ...defaultProps(), onDelete };
    const target = renderElement(<ReaderNoteEditor {...props} ref={editorRef} />);

    await click(target, "Delete note");
    act(() => button(target, "Delete").click());

    let settled: boolean | undefined;
    const settlement = editorRef.current?.settle().then((result) => {
      settled = result;
    });
    await act(async () => Promise.resolve());

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(settled).toBeUndefined();

    await act(async () => deletion.resolve(false));
    await act(async () => settlement);

    expect(settled).toBe(false);
    expect(props.onBack).toHaveBeenCalledTimes(1);
    expect(target.querySelector("[role=status]")?.textContent).toContain(
      "Note could not be deleted.",
    );
  });

  it("flushes and closes through Escape", async () => {
    vi.useFakeTimers();
    const { container: target, props } = renderEditor();
    enterText(target, "Escape-safe note");

    await act(async () => {
      target
        .querySelector(".reader-note-editor")
        ?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });

    expect(props.onSave).not.toHaveBeenCalled();
    expect(props.onBack).toHaveBeenCalledTimes(1);
  });

  it("dismisses delete confirmation before using Escape as Back", async () => {
    const { container: target, props } = renderEditor();
    await click(target, "Delete note");
    const editor = target.querySelector(".reader-note-editor")!;
    const confirmDeleteButton = button(target, "Delete");
    expect(document.activeElement).toBe(confirmDeleteButton);

    act(() => {
      confirmDeleteButton.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      );
    });

    expect(target.textContent).not.toContain("Delete this note?");
    expect(props.onBack).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(button(target, "Delete note"));

    await act(async () => {
      editor.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Escape" }),
      );
    });

    expect(props.onBack).toHaveBeenCalledTimes(1);
  });
});
