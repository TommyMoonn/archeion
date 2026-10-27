// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { LibraryConfirmationFixture } from "../../../tests/browser/fixtures/confirmation-views";

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

for (const [opener, label, message] of [
  ["Delete selected books", "Delete selected books", "Deleting selected books…"],
  ["Clear reading progress", "Clear progress", "Clearing reading progress…"],
  ["Delete folder", "Delete folder", "Deleting folder…"],
]) {
  for (const rejected of [false, true]) {
    it(`${label} retains its action, one live status and close safety through ${rejected ? "failure" : "success"}`, async () => {
      vi.useFakeTimers();
      let resolve!: () => void;
      let reject!: (error: Error) => void;
      const mutation = vi.fn(
        () =>
          new Promise<void>((yes, no) => {
            resolve = yes;
            reject = no;
          }),
      );
      const container = document.createElement("div");
      document.body.append(container);
      const root = createRoot(container);
      const button = (scope: ParentNode, text: string) =>
        [...scope.querySelectorAll("button")].find(
          (element) => element.textContent?.trim() === text,
        )!;
      try {
        act(() => root.render(<LibraryConfirmationFixture performMutation={mutation} />));
        act(() => button(container, opener).click());
        const dialog = container.querySelector("dialog")!;
        const action = button(dialog, label);
        const live = dialog.querySelector('[role="status"]');
        expect(live).not.toBeNull();
        expect(live!.textContent).toBe("");
        const slot = action.querySelector(".button__icon");
        expect(slot).not.toBeNull();
        act(() => action.click());
        expect(action.textContent).toBe(label);
        expect(action.disabled).toBe(true);
        expect(action.getAttribute("aria-busy")).toBe("true");
        expect(dialog.querySelectorAll('[role="status"], [aria-live]')).toHaveLength(1);
        expect(live!.textContent).toBe(message);
        act(() => vi.advanceTimersByTime(180));
        expect(action.querySelector('.button__busy[data-visible="true"]')).not.toBeNull();
        act(() => {
          action.click();
          action.click();
          button(dialog, "Cancel").click();
          dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
        });
        expect(mutation).toHaveBeenCalledOnce();
        expect(container.querySelector("dialog")).toBe(dialog);
        expect(dialog.open).toBe(true);
        await act(async () => (rejected ? reject(new Error("Synthetic failure")) : resolve()));
        expect(container.querySelector('[data-testid="operation-outcome"]')?.textContent).toBe(
          rejected ? "rejected" : "resolved",
        );
        expect(action.textContent).toBe(label);
        expect(action.disabled).toBe(false);
        expect(action.querySelector(".button__icon")).toBe(slot);
        expect(action.querySelector(".button__busy")).toBeNull();
        expect(dialog.querySelector('[role="status"]')).toBe(live);
        expect(live!.textContent).toBe("");
      } finally {
        act(() => root.unmount());
      }
    });
  }
}
