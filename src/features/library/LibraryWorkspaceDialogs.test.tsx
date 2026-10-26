// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { defaultAppPreferences } from "../../types/appSettings";
import { LibraryWorkspaceDialogs } from "./LibraryWorkspaceDialogs";
import { useLibraryWorkspaceDialogs } from "./useLibraryWorkspaceDialogs";

vi.mock("./libraryLazySurfaces", async () => {
  const { lazy } = await import("react");
  return { AddEpubDialog: lazy(() => new Promise(() => {})) };
});

afterEach(() => {
  document.body.innerHTML = "";
});

it("mounts native import chrome immediately and permits dismissal before the chunk arrives", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Fixture() {
    const { dialog, actions: dialogActions } = useLibraryWorkspaceDialogs();
    return (
      <>
        <button onClick={() => dialogActions.openAddEpub()}>Import</button>
        <LibraryWorkspaceDialogs
          books={[]}
          folders={[]}
          dialog={dialog}
          dialogActions={dialogActions}
          confirmDestructiveFileActions
          importDefaults={defaultAppPreferences.import}
          isBulkRunning={false}
          isClearingProgress={false}
          isDeleting={false}
          isImporting={false}
          isRescanning={false}
          onConfirmClearProgress={vi.fn()}
          onCreateFolder={vi.fn()}
          onDeleteBook={vi.fn()}
          onDeleteFolder={vi.fn()}
          onDeleteSelectedBooks={vi.fn()}
          onImport={vi.fn()}
          onMoveBook={vi.fn()}
          onMoveFolder={vi.fn()}
          onMoveSelectedBooks={vi.fn()}
          onPrepareBookCover={vi.fn()}
          onReadBook={vi.fn()}
          onReadBookFromBeginning={vi.fn()}
          onRenameBookFile={vi.fn()}
          onRenameFolder={vi.fn()}
          onRequestClearProgress={vi.fn()}
          onRequestDeleteBook={vi.fn()}
          onRescan={vi.fn()}
          onRevealBookFile={vi.fn()}
          onToggleFavorite={vi.fn()}
          onWriteBookCover={vi.fn()}
          onWriteBookMetadata={vi.fn()}
          onWriteSelectedBookMetadata={vi.fn()}
          selectedBookIds={new Set()}
          selectedBooks={[]}
        />
      </>
    );
  }
  act(() => root.render(<Fixture />));
  act(() => container.querySelector("button")!.click());
  expect(container.querySelector("dialog[open]")).not.toBeNull();
  expect(container.querySelector("h2")?.textContent).toBe("Add EPUB files");
  expect(container.querySelector('[role="status"]')?.textContent).toContain("Opening");
  expect(container.querySelectorAll(".dialog__copy button")).toHaveLength(0);
  act(() => container.querySelector<HTMLButtonElement>(".dialog__footer button")!.click());
  expect(container.querySelector("dialog")).toBeNull();
  act(() => root.unmount());
});
