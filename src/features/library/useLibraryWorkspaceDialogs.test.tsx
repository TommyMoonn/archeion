// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { useLibraryWorkspaceDialogs } from "./useLibraryWorkspaceDialogs";

it("stale async close and editor completion cannot retire a newer Library dialog", async () => {
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  let current!: ReturnType<typeof useLibraryWorkspaceDialogs>;
  function Fixture() {
    current = useLibraryWorkspaceDialogs();
    return null;
  }
  act(() => root.render(<Fixture />));
  act(() => current.actions.openBookDetailsById("one"));
  const oldClose = current.actions.captureClose();
  const oldEditorClose = current.actions.captureClose("close-book-editor");
  act(() => current.actions.openCreateFolder());
  await act(async () => {
    await Promise.resolve();
    oldClose();
    oldEditorClose();
  });
  expect(current.dialog.type).toBe("create-folder");
  act(() => current.actions.close());
  expect(current.dialog.type).toBe("none");
  act(() => root.unmount());
  container.remove();
});
