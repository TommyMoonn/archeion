// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppUpdateClient } from "../updates/appUpdateClient";
import type { AppUpdateSnapshot } from "../updates/appUpdateTypes";
import {
  createStorage,
  renderLibraryPage,
  setupLibraryPageTestSuite,
} from "./LibraryPage.testUtils";

const updater = vi.hoisted(() => ({ client: null as AppUpdateClient | null }));
vi.mock("../updates/appUpdateClient", async (original) => ({
  ...(await original<typeof import("../updates/appUpdateClient")>()),
  get appUpdateClient() {
    return updater.client;
  },
}));

describe("Library updater integration", () => {
  const suite = setupLibraryPageTestSuite();
  beforeEach(() => {
    const update: AppUpdateSnapshot = {
      revision: 1,
      supported: true,
      currentVersion: "1.6.0",
      status: "available",
      available: { version: "1.6.1", notes: null, publishedAt: null },
      downloadedBytes: 0,
      totalBytes: null,
      error: null,
      prompt: {
        snoozedVersion: null,
        snoozedUntil: null,
        restartDeferred: false,
        completedVersion: null,
      },
    };
    updater.client = new AppUpdateClient({
      isDesktop: () => true,
      read: async () => update,
      subscribe: async () => () => undefined,
      check: vi.fn(),
      download: vi.fn(),
      install: vi.fn(),
      defer: vi.fn(),
      acknowledgeCompleted: vi.fn(),
    });
  });
  it("places shared update discovery in a separate Library notice, not operation feedback", async () => {
    const session = await renderLibraryPage(createStorage());
    suite.trackRoot(session.root);
    expect(
      session.container.querySelector('[aria-label="Application update"]')?.textContent,
    ).toContain("Archeion 1.6.1 is available");
    expect(
      session.container.querySelector('.library-feedback [aria-label="Application update"]'),
    ).toBeNull();
  });
});
