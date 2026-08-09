// @vitest-environment happy-dom

import { act, useLayoutEffect, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerTransientSurface,
  resetTransientSurfaceOwnershipForTests,
} from "../../utils/transientSurfaceOwnership";
import type { ReaderTransitionRequest } from "./useReaderControlledTransitions";
import { useReaderSideSurface } from "./useReaderSideSurface";

type NoteTarget = { annotationId: string };
type SideSurfaceApi = ReturnType<typeof useReaderSideSurface<NoteTarget>>;

const noteTargetId = (target: NoteTarget) => target.annotationId;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function createTransitions(settle: () => Promise<boolean>) {
  let currentRequest = 0;
  const owner = Object.freeze({ archiveId: null, readerIdentity: null });
  return {
    beginTransition: vi.fn((): ReaderTransitionRequest => ({
      id: ++currentRequest,
      owner,
    })),
    ownsTransition: vi.fn((request: ReaderTransitionRequest) => request.id === currentRequest),
    runAfterSettlement: vi.fn(
      async (action: () => void | Promise<void>, ownsRequest: () => boolean = () => true) => {
        const settled = await settle();
        if (!settled || !ownsRequest()) return false;
        await action();
        return true;
      },
    ),
  };
}

function Harness({
  apiRef,
  revealControls,
  transitions,
}: {
  apiRef: MutableRefObject<SideSurfaceApi | undefined>;
  revealControls: () => void;
  transitions: ReturnType<typeof createTransitions>;
}) {
  const surfaces = useReaderSideSurface<NoteTarget>({
    annotationId: noteTargetId,
    revealControls,
    transitions,
  });
  const {
    annotationButtonRef,
    noteTarget,
    restoreFocusAnnotationId,
    settingsButtonRef,
    surface,
    tocButtonRef,
  } = surfaces;
  useLayoutEffect(() => {
    apiRef.current = surfaces;
  }, [apiRef, surfaces]);
  return (
    <div>
      <button ref={annotationButtonRef} type="button">
        Annotations
      </button>
      <button ref={tocButtonRef} type="button">
        TOC
      </button>
      <button ref={settingsButtonRef} type="button">
        Settings
      </button>
      <span data-testid="surface">{surface ?? "closed"}</span>
      <span data-testid="note">{noteTarget?.annotationId}</span>
      <span data-testid="focus-id">{restoreFocusAnnotationId}</span>
    </div>
  );
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let animationFrameSequence = 0;
let animationFrames = new Map<number, FrameRequestCallback>();

async function renderHarness(
  transitions: ReturnType<typeof createTransitions>,
  apiRef: MutableRefObject<SideSurfaceApi | undefined>,
  revealControls = vi.fn(),
) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  await act(async () => {
    root?.render(
      <Harness apiRef={apiRef} revealControls={revealControls} transitions={transitions} />,
    );
  });
}

function flushAnimationFrames(): void {
  const pending = [...animationFrames.entries()];
  animationFrames.clear();
  act(() => pending.forEach(([, callback]) => callback(performance.now())));
}

function text(testId: string) {
  return container?.querySelector(`[data-testid="${testId}"]`)?.textContent;
}

beforeEach(() => {
  animationFrameSequence = 0;
  animationFrames = new Map();
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    const id = ++animationFrameSequence;
    animationFrames.set(id, callback);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
    animationFrames.delete(id);
  });
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  resetTransientSurfaceOwnershipForTests();
  vi.restoreAllMocks();
});

describe("useReaderSideSurface", () => {
  it("keeps TOC, settings, and annotations mutually exclusive", async () => {
    const transitions = createTransitions(async () => true);
    const apiRef: MutableRefObject<SideSurfaceApi | undefined> = { current: undefined };
    await renderHarness(transitions, apiRef);

    act(() => apiRef.current?.openToc());
    expect(text("surface")).toBe("toc");
    act(() => apiRef.current?.openSettings());
    expect(text("surface")).toBe("settings");
    act(() => apiRef.current?.openAnnotations());
    expect(text("surface")).toBe("annotations");
    expect(apiRef.current?.tocOpen).toBe(false);
    expect(apiRef.current?.settingsOpen).toBe(false);
  });

  it("models the note editor as an annotation subview and restores its row target", async () => {
    const settlement = deferred<boolean>();
    const transitions = createTransitions(() => settlement.promise);
    const apiRef: MutableRefObject<SideSurfaceApi | undefined> = { current: undefined };
    await renderHarness(transitions, apiRef);

    act(() => apiRef.current?.showNoteTarget({ annotationId: "highlight-1" }));
    expect(text("surface")).toBe("annotations");
    expect(text("note")).toBe("highlight-1");
    act(() => apiRef.current?.returnNoteToAnnotations());
    expect(text("note")).toBe("highlight-1");

    await act(async () => settlement.resolve(true));
    expect(text("surface")).toBe("annotations");
    expect(text("note")).toBe("");
    expect(text("focus-id")).toBe("highlight-1");
  });

  it("keeps the note editor active when settlement fails", async () => {
    const transitions = createTransitions(async () => false);
    const apiRef: MutableRefObject<SideSurfaceApi | undefined> = { current: undefined };
    await renderHarness(transitions, apiRef);
    act(() => apiRef.current?.showNoteTarget({ annotationId: "highlight-1" }));

    await act(async () => apiRef.current?.openToc());
    expect(text("surface")).toBe("annotations");
    expect(text("note")).toBe("highlight-1");
  });

  it("applies only the latest surface intent while note settlement is pending", async () => {
    const settlement = deferred<boolean>();
    const transitions = createTransitions(() => settlement.promise);
    const apiRef: MutableRefObject<SideSurfaceApi | undefined> = { current: undefined };
    await renderHarness(transitions, apiRef);
    act(() => apiRef.current?.showNoteTarget({ annotationId: "highlight-1" }));

    act(() => {
      apiRef.current?.openToc();
      apiRef.current?.openSettings();
    });
    await act(async () => settlement.resolve(true));
    expect(text("surface")).toBe("settings");
    expect(text("note")).toBe("");
  });

  it("closes the note subview before annotations and restores trigger focus", async () => {
    const transitions = createTransitions(async () => true);
    const apiRef: MutableRefObject<SideSurfaceApi | undefined> = { current: undefined };
    await renderHarness(transitions, apiRef);
    act(() => apiRef.current?.showNoteTarget({ annotationId: "highlight-1" }));

    await act(async () => expect(apiRef.current?.closeTopmost()).toBe(true));
    expect(text("surface")).toBe("annotations");
    expect(text("note")).toBe("");
    act(() => expect(apiRef.current?.closeTopmost()).toBe(true));
    flushAnimationFrames();
    expect(text("surface")).toBe("closed");
    expect(document.activeElement?.textContent).toBe("Annotations");
    expect(apiRef.current?.closeTopmost()).toBe(false);
  });

  it("rejects stale TOC focus restoration when annotations open before the next frame", async () => {
    const transitions = createTransitions(async () => true);
    const apiRef: MutableRefObject<SideSurfaceApi | undefined> = { current: undefined };
    await renderHarness(transitions, apiRef);
    const annotations = container?.querySelector<HTMLButtonElement>("button:first-of-type");
    const toc = container?.querySelector<HTMLButtonElement>("button:nth-of-type(2)");

    act(() => {
      apiRef.current?.openToc();
      toc?.focus();
      apiRef.current?.closeToc();
      apiRef.current?.openAnnotations();
      annotations?.focus();
    });
    flushAnimationFrames();

    expect(text("surface")).toBe("annotations");
    expect(document.activeElement).toBe(annotations);
  });

  it("rejects stale annotation focus restoration when settings open before the next frame", async () => {
    const transitions = createTransitions(async () => true);
    const apiRef: MutableRefObject<SideSurfaceApi | undefined> = { current: undefined };
    await renderHarness(transitions, apiRef);
    const settings = container?.querySelector<HTMLButtonElement>("button:nth-of-type(3)");

    act(() => {
      apiRef.current?.openAnnotations();
      apiRef.current?.closeAnnotations();
      apiRef.current?.openSettings();
      settings?.focus();
    });
    flushAnimationFrames();

    expect(text("surface")).toBe("settings");
    expect(document.activeElement).toBe(settings);
  });

  it("supports synchronous animation frames without retaining stale focus ownership", async () => {
    const consoleError = vi.spyOn(console, "error");
    const requestFrame = vi.mocked(window.requestAnimationFrame);
    const cancelFrame = vi.mocked(window.cancelAnimationFrame);
    requestFrame.mockImplementation((callback) => {
      callback(performance.now());
      return 91;
    });
    const transitions = createTransitions(async () => true);
    const apiRef: MutableRefObject<SideSurfaceApi | undefined> = { current: undefined };
    await renderHarness(transitions, apiRef);
    const annotations = container?.querySelector<HTMLButtonElement>("button:first-of-type");

    act(() => apiRef.current?.openAnnotations());
    expect(() => act(() => apiRef.current?.closeAnnotations())).not.toThrow();

    expect(text("surface")).toBe("closed");
    expect(document.activeElement).toBe(annotations);
    act(() => apiRef.current?.openSettings());
    expect(text("surface")).toBe("settings");
    expect(cancelFrame).not.toHaveBeenCalled();

    act(() => root?.unmount());
    root = null;
    expect(cancelFrame).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("does not schedule focus restoration when note settlement fails", async () => {
    const transitions = createTransitions(async () => false);
    const apiRef: MutableRefObject<SideSurfaceApi | undefined> = { current: undefined };
    await renderHarness(transitions, apiRef);
    act(() => apiRef.current?.showNoteTarget({ annotationId: "highlight-1" }));

    await act(async () => apiRef.current?.closeAnnotations());

    expect(text("surface")).toBe("annotations");
    expect(animationFrames.size).toBe(0);
  });

  it("keeps action callbacks stable when the controller object is freshly allocated", async () => {
    const transitions = createTransitions(async () => true);
    const apiRef: MutableRefObject<SideSurfaceApi | undefined> = { current: undefined };
    const revealControls = vi.fn();
    await renderHarness({ ...transitions }, apiRef, revealControls);
    const first = apiRef.current;

    await renderHarness({ ...transitions }, apiRef, revealControls);

    expect(apiRef.current?.transition).toBe(first?.transition);
    expect(apiRef.current?.openToc).toBe(first?.openToc);
    expect(apiRef.current?.toggleAnnotations).toBe(first?.toggleAnnotations);
  });

  it.each([
    ["TOC", (api: SideSurfaceApi) => api.openToc(), (api: SideSurfaceApi) => api.closeToc()],
    [
      "Reader Settings",
      (api: SideSurfaceApi) => api.openSettings(),
      (api: SideSurfaceApi) => api.closeSettings(),
    ],
  ])("does not restore %s focus behind a newer modal", async (_label, open, close) => {
    const transitions = createTransitions(async () => true);
    const apiRef: MutableRefObject<SideSurfaceApi | undefined> = { current: undefined };
    await renderHarness(transitions, apiRef);
    const api = apiRef.current!;

    act(() => {
      open(api);
      close(api);
    });

    const modal = document.body.appendChild(document.createElement("dialog"));
    modal.open = true;
    const modalButton = modal.appendChild(document.createElement("button"));
    modalButton.focus();
    const unregister = registerTransientSurface({
      element: modal,
      kind: "app-dialog",
      modal: true,
      onDismiss: vi.fn(),
    });

    flushAnimationFrames();

    expect(document.activeElement).toBe(modalButton);
    unregister();
    modal.remove();
    flushAnimationFrames();
    expect(document.activeElement).not.toBe(
      container?.querySelector<HTMLButtonElement>("button:nth-of-type(2)"),
    );
  });
});
