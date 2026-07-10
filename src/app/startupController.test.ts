import { describe, expect, it, vi } from "vitest";

import { defaultAppPreferences, type AppPreferences } from "../types/appSettings";
import type { Book } from "../types/book";
import { initializeMainStartup, restoreRememberedReaderRoute } from "./startupController";

function preferences(changes: Partial<AppPreferences> = {}): AppPreferences {
  return { ...defaultAppPreferences, ...changes };
}

const rememberedBook: Book = {
  addedAt: "1",
  fileName: "Book.epub",
  id: "book 1",
  isFavorite: false,
  originalTitle: "Book",
  updatedAt: "1",
};

describe("main startup coordinator", () => {
  it("runs startup initialization in the required order", async () => {
    const order: string[] = [];
    const result = await initializeMainStartup({
      getPreferences: () => preferences(),
      initializeArchiveRegistry: async () => {
        order.push("archive");
      },
      initializePreferences: async () => {
        order.push("preferences");
      },
      restoreReaderRoute: async () => {
        order.push("reader");
        return false;
      },
      restoreWindowState: async () => {
        order.push("window");
        return false;
      },
    });

    expect(order).toEqual(["preferences", "archive", "window", "reader"]);
    expect(result).toEqual({ restoredReader: false, showArchiveManager: false });
  });

  it("gives the startup archive manager precedence over reader restoration", async () => {
    const restoreReaderRoute = vi.fn(async () => true);
    const result = await initializeMainStartup({
      getPreferences: () => preferences({ startupBehavior: "show-archive-manager" }),
      initializeArchiveRegistry: async () => undefined,
      initializePreferences: async () => undefined,
      restoreReaderRoute,
      restoreWindowState: async () => false,
    });

    expect(result).toEqual({ restoredReader: false, showArchiveManager: true });
    expect(restoreReaderRoute).not.toHaveBeenCalled();
  });
});

describe("reader route restoration", () => {
  it("restores a readable book only in the remembered archive", async () => {
    const navigate = vi.fn(async () => undefined);
    const reset = vi.fn();
    const loadBookFile = vi.fn(async () => new Blob(["epub"]));
    const restored = await restoreRememberedReaderRoute(
      preferences({
        navigation: {
          archiveId: "archive-1",
          bookId: rememberedBook.id,
          lastRoute: "/reader/book%201",
        },
        restoreLastReader: true,
      }),
      {
        clearNavigation: vi.fn(async () => undefined),
        getArchiveState: () => ({
          archive: {
            createdAt: "1",
            displayName: "Books",
            id: "archive-1",
            lastOpenedAt: "1",
            rootPath: "D:\\Books",
          },
          archives: [],
          error: null,
          path: "D:\\Books",
          status: "ready",
          watcherError: null,
        }),
        getStorage: async () => ({
          getBook: async () => rememberedBook,
          loadBookFile,
          reset,
        }),
        navigate,
      },
    );

    expect(restored).toBe(true);
    expect(reset).toHaveBeenCalledWith("D:\\Books");
    expect(loadBookFile).toHaveBeenCalledWith(rememberedBook.id);
    expect(navigate).toHaveBeenCalledWith("/reader/book%201");
  });

  it("clears invalid restoration and falls back to the library", async () => {
    const clearNavigation = vi.fn(async () => undefined);
    const navigate = vi.fn(async () => undefined);
    const restored = await restoreRememberedReaderRoute(
      preferences({
        navigation: {
          archiveId: "archive-1",
          bookId: "missing",
          lastRoute: "/reader/missing",
        },
        restoreLastReader: true,
      }),
      {
        clearNavigation,
        getArchiveState: () => ({
          archive: {
            createdAt: "1",
            displayName: "Books",
            id: "archive-1",
            lastOpenedAt: "1",
            rootPath: "D:\\Books",
          },
          archives: [],
          error: null,
          path: "D:\\Books",
          status: "ready",
          watcherError: null,
        }),
        getStorage: async () => ({
          getBook: async () => undefined,
          loadBookFile: async () => new Blob(),
          reset: vi.fn(),
        }),
        navigate,
      },
    );

    expect(restored).toBe(false);
    expect(clearNavigation).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith("/");
  });
});
