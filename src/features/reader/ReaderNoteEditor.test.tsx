// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ReaderNoteEditor } from "./ReaderNoteEditor";
import {
  createReaderSideSurfaceDismissController,
  ReaderSideSurfaceDismissContext,
} from "./readerSideSurfaceDismissal";
import type { ReaderNoteEditorState } from "./useReaderNoteSession";

const baseState: ReaderNoteEditorState = {
  deleting: false,
  errorKind: null,
  hasPersistedNote: true,
  status: "idle",
  text: "Existing note",
};

let container: HTMLDivElement | null = null;
let root: Root | null = null;

function props(overrides: Partial<React.ComponentProps<typeof ReaderNoteEditor>> = {}) {
  return {
    onBack: vi.fn(),
    onDelete: vi.fn(),
    onDraftChange: vi.fn(),
    onRetry: vi.fn(),
    onUnmount: vi.fn(),
    state: baseState,
    ...overrides,
  };
}

async function renderEditor(
  componentProps: React.ComponentProps<typeof ReaderNoteEditor>,
  dismissalController?: ReturnType<typeof createReaderSideSurfaceDismissController>,
) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  await act(async () =>
    root?.render(
      dismissalController ? (
        <ReaderSideSurfaceDismissContext.Provider value={dismissalController}>
          <ReaderNoteEditor {...componentProps} />
        </ReaderSideSurfaceDismissContext.Provider>
      ) : (
        <ReaderNoteEditor {...componentProps} />
      ),
    ),
  );
}

function clickButton(label: string) {
  const button = [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`Expected button labeled ${label}.`);
  act(() => button.click());
}

afterEach(async () => {
  const mountedRoot = root;
  root = null;
  await act(async () => mountedRoot?.unmount());
  container?.remove();
  container = null;
  vi.restoreAllMocks();
});

describe("ReaderNoteEditor", () => {
  it("renders session-owned text and publishes edits without owning a draft", async () => {
    const onDraftChange = vi.fn();
    await renderEditor(props({ onDraftChange }));

    const textarea = container?.querySelector<HTMLTextAreaElement>("textarea");
    expect(textarea?.value).toBe("Existing note");

    act(() => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(textarea, "Edited note");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });

    expect(onDraftChange).toHaveBeenCalledOnce();
    expect(onDraftChange).toHaveBeenCalledWith("Edited note");
    expect(textarea?.value).toBe("Existing note");
  });

  it("renders save failure state and delegates retry", async () => {
    const onRetry = vi.fn();
    await renderEditor(
      props({
        onRetry,
        state: { ...baseState, errorKind: "save", status: "error" },
      }),
    );

    expect(container?.querySelector('[role="status"]')?.textContent).toContain("Not saved. Retry.");
    clickButton("Retry");
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it("confirms deletion before delegating discard", async () => {
    const onDelete = vi.fn();
    await renderEditor(props({ onDelete }));

    clickButton("Delete note");
    expect(container?.querySelector('[role="group"]')?.textContent).toContain("Delete this note?");
    expect(onDelete).not.toHaveBeenCalled();

    clickButton("Delete");
    expect(onDelete).toHaveBeenCalledOnce();
  });

  it("cancels deletion confirmation without closing the note", async () => {
    const onBack = vi.fn();
    await renderEditor(props({ onBack }));

    clickButton("Delete note");
    clickButton("Cancel");

    expect(container?.querySelector('[role="group"]')).toBeNull();
    expect(onBack).not.toHaveBeenCalled();
  });

  it("propagates Reader dismissal focus intent to the note close owner", async () => {
    const onBack = vi.fn();
    const controller = createReaderSideSurfaceDismissController();
    await renderEditor(props({ onBack }), controller);

    act(() => expect(controller.dismissTopmost()).toBe(true));
    expect(onBack).toHaveBeenCalledWith(true);

    onBack.mockClear();
    const unregister = controller.register("illustration", () => true);
    expect(onBack).toHaveBeenCalledOnce();
    expect(onBack).toHaveBeenCalledWith(false);
    unregister();
  });

  it("disables editing and navigation while deletion is pending", async () => {
    const onBack = vi.fn();
    await renderEditor(
      props({
        onBack,
        state: { ...baseState, deleting: true },
      }),
    );

    expect(container?.querySelector("[aria-busy='true']")).not.toBeNull();
    expect(container?.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(true);
    const back = container?.querySelector<HTMLButtonElement>(
      'button[aria-label="Back to annotations"]',
    );
    act(() => back?.click());
    expect(onBack).not.toHaveBeenCalled();
  });

  it("explains empty fresh-note close behavior", async () => {
    await renderEditor(
      props({
        keepsHighlightOnEmptyClose: true,
        state: {
          ...baseState,
          hasPersistedNote: false,
          text: "",
        },
      }),
    );

    expect(container?.querySelector('[role="status"]')?.textContent).toContain(
      "Closing without a note keeps the highlight.",
    );
    expect(
      [...(container?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
        (button) => button.textContent?.trim() === "Delete note",
      )?.disabled,
    ).toBe(true);
  });

  it("reports editor unmount exactly once", async () => {
    const onUnmount = vi.fn();
    await renderEditor(props({ onUnmount }));

    await act(async () => root?.unmount());
    root = null;

    expect(onUnmount).toHaveBeenCalledOnce();
  });
});
