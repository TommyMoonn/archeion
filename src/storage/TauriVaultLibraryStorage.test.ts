import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TauriVaultLibraryStorage } from "./TauriVaultLibraryStorage";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);

const firstScan = {
  folders: [
    {
      id: "folder:Author",
      name: "Author",
      relativePath: "Author",
      parentPath: null,
    },
    {
      id: "folder:Author/Series",
      name: "Series",
      relativePath: "Author/Series",
      parentPath: "Author",
    },
  ],
  books: [
    {
      id: "book-1",
      relativePath: "Author/Series/Volume_01.epub",
      fileName: "Volume_01.epub",
      folderPath: "Author/Series",
      size: 2048,
      modifiedAt: 1_700_000_000_000,
    },
  ],
};

const metadata = {
  library: {
    version: 1,
    books: {
      "book-1": {
        relativePath: "Author/Series/Volume_01.epub",
        displayTitle: "Custom Volume",
        isFavorite: true,
        addedAt: "2023-11-01T00:00:00.000Z",
        updatedAt: "2023-11-02T00:00:00.000Z",
      },
    },
  },
  progress: {
    version: 1,
    progress: {
      "book-1": {
        cfi: "epubcfi(/6/2)",
        percent: 42,
        lastOpenedAt: "2023-11-03T00:00:00.000Z",
      },
    },
  },
  settings: {
    version: 1,
    reader: {
      fontSize: 20,
      fontFamily: "serif",
      lineHeight: 1.7,
      margin: 40,
      theme: "sepia",
      flowMode: "paginated",
    },
    library: {
      viewMode: "grid",
      sortBy: "folder",
    },
  },
};

describe("TauriVaultLibraryStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_vault") {
        return firstScan;
      }
      if (command === "load_vault_metadata") {
        return structuredClone(metadata);
      }
      return undefined;
    });
  });

  it("maps scan results into the shared library models", async () => {
    const storage = new TauriVaultLibraryStorage();

    const [books, folders] = await Promise.all([
      storage.listBooks(),
      storage.listFolders(),
    ]);

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenCalledWith("scan_vault");
    expect(books[0]).toMatchObject({
      id: "book-1",
      displayTitle: "Custom Volume",
      folderId: "folder:Author/Series",
      isFavorite: true,
      progressPercent: 42,
      relativePath: "Author/Series/Volume_01.epub",
      size: 2048,
    });
    expect(folders[1]).toMatchObject({
      id: "folder:Author/Series",
      parentId: "folder:Author",
    });
  });

  it("replaces deleted files when rescanning", async () => {
    const storage = new TauriVaultLibraryStorage();
    await storage.listBooks();
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_vault") {
        return { books: [], folders: [] };
      }
      if (command === "load_vault_metadata") {
        return structuredClone(metadata);
      }
      return undefined;
    });

    await storage.rescan();

    await expect(storage.listBooks()).resolves.toEqual([]);
    await expect(storage.listFolders()).resolves.toEqual([]);
  });

  it("notifies observers after a scan", async () => {
    const storage = new TauriVaultLibraryStorage();
    const observed = new Promise<number>((resolve, reject) => {
      storage.observeBooks({
        next: (books) => resolve(books.length),
        error: reject,
      });
    });

    await expect(observed).resolves.toBe(1);
  });

  it("persists display metadata and progress in separate files", async () => {
    const storage = new TauriVaultLibraryStorage();
    await storage.listBooks();

    await storage.updateBook("book-1", {
      displayTitle: "Renamed",
      progressCfi: "epubcfi(/6/4)",
      progressPercent: 50,
    });

    expect(invokeMock).toHaveBeenCalledWith(
      "save_library_metadata",
      expect.objectContaining({
        metadata: expect.objectContaining({
          books: expect.objectContaining({
            "book-1": expect.objectContaining({ displayTitle: "Renamed" }),
          }),
        }),
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith(
      "save_progress_metadata",
      expect.objectContaining({
        metadata: expect.objectContaining({
          progress: expect.objectContaining({
            "book-1": expect.objectContaining({
              cfi: "epubcfi(/6/4)",
              percent: 50,
            }),
          }),
        }),
      }),
    );
  });

  it("persists reader settings", async () => {
    const storage = new TauriVaultLibraryStorage();
    const settings = await storage.updateReaderSettings({ fontSize: 22 });

    expect(settings.fontSize).toBe(22);
    expect(invokeMock).toHaveBeenCalledWith(
      "save_settings_metadata",
      expect.objectContaining({
        metadata: expect.objectContaining({
          reader: expect.objectContaining({ fontSize: 22 }),
        }),
      }),
    );
  });
});
