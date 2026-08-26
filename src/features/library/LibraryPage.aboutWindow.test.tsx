// @vitest-environment happy-dom

import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createStorage,
  renderLibraryPage,
  setupLibraryPageTestSuite,
} from "./LibraryPage.testUtils";

const mocks = vi.hoisted(() => ({
  openAboutWindow: vi.fn<() => Promise<void>>(),
}));

vi.mock("../about/aboutWindowLifecycle", () => ({
  openAboutWindow: mocks.openAboutWindow,
}));

describe("LibraryPage About window entry", () => {
  const suite = setupLibraryPageTestSuite();

  beforeEach(() => {
    mocks.openAboutWindow.mockReset();
    mocks.openAboutWindow.mockResolvedValue();
  });

  it("requests the standalone About window without changing Library navigation", async () => {
    const session = await renderLibraryPage(createStorage());
    suite.trackRoot(session.root);
    const library = session.container.querySelector<HTMLButtonElement>(
      'button[aria-label="Library"]',
    );
    const about = session.container.querySelector<HTMLButtonElement>(
      'button[aria-label="About Archeion"]',
    );
    const archive = session.container.querySelector<HTMLElement>(
      '[aria-label="Current archive: Books"]',
    );

    expect(library?.getAttribute("aria-current")).toBe("page");

    await act(async () => {
      about?.click();
      await Promise.resolve();
    });

    expect(mocks.openAboutWindow).toHaveBeenCalledOnce();
    expect(library?.getAttribute("aria-current")).toBe("page");
    expect(archive?.getAttribute("aria-label")).toBe("Current archive: Books");
    expect(session.container.querySelector("dialog")).toBeNull();
  });

  it("reports native launch failures through Library feedback", async () => {
    mocks.openAboutWindow.mockRejectedValue(new Error("window unavailable"));
    const session = await renderLibraryPage(createStorage());
    suite.trackRoot(session.root);

    await act(async () => {
      session.container
        .querySelector<HTMLButtonElement>('button[aria-label="About Archeion"]')
        ?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(session.container.querySelector('[role="alert"]')?.textContent).toContain(
      "The About window could not be opened. Try again.",
    );
  });
});
