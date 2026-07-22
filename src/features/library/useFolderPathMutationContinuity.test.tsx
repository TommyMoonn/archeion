// @vitest-environment happy-dom

import { act, useLayoutEffect, type MutableRefObject } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Folder } from "../../types/folder";
import {
  registerTransientSurface,
  resetTransientSurfaceOwnershipForTests,
} from "../../utils/transientSurfaceOwnership";
import { useFolderPathMutationContinuity } from "./useFolderPathMutationContinuity";

function folder(relativePath: string): Folder {
  return {
    createdAt: "1",
    id: `folder:${relativePath}`,
    name: relativePath,
    parentId: null,
    parentPath: null,
    relativePath,
    updatedAt: "1",
  };
}

type Api = ReturnType<typeof useFolderPathMutationContinuity>;

function Harness({ apiRef, folders }: { apiRef: MutableRefObject<Api | null>; folders: Folder[] }) {
  const api = useFolderPathMutationContinuity({
    activeArchiveId: "archive",
    folders,
    searchParams: new URLSearchParams("view=folders"),
    setSearchParams: vi.fn(),
  });
  useLayoutEffect(() => {
    apiRef.current = api;
  }, [api, apiRef]);
  return (
    <div>
      {folders.map((item) => (
        <div
          data-library-folder-path={item.relativePath}
          data-library-folder-surface="browser"
          key={item.id}
        >
          <button data-library-folder-primary-action type="button">
            {item.name}
          </button>
        </div>
      ))}
    </div>
  );
}

describe("folder path mutation focus ownership", () => {
  let container: HTMLDivElement;
  let root: Root;
  let frames: FrameRequestCallback[];

  beforeEach(() => {
    container = document.body.appendChild(document.createElement("div"));
    root = createRoot(container);
    frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    resetTransientSurfaceOwnershipForTests();
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("does not apply a pending folder restoration behind a newer modal", async () => {
    const original = folder("Fiction");
    const renamed = folder("Novels");
    const apiRef: MutableRefObject<Api | null> = { current: null };
    act(() => root.render(<Harness apiRef={apiRef} folders={[original]} />));
    const originalButton = container.querySelector<HTMLButtonElement>("button")!;
    originalButton.focus();
    act(() => apiRef.current?.captureFocus(original));

    await act(async () => {
      await apiRef.current?.run(original, { name: "Novels" }, async () => renamed);
    });
    act(() => root.render(<Harness apiRef={apiRef} folders={[renamed]} />));

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
    act(() => frames.splice(0).forEach((frame) => frame(0)));

    expect(document.activeElement).toBe(modalButton);
    unregister();
    modal.remove();
    act(() => frames.splice(0).forEach((frame) => frame(0)));
    expect(document.activeElement).not.toBe(container.querySelector("button"));
  });
});
