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

  it("clears display overrides without changing the EPUB record", async () => {
    const storage = new TauriVaultLibraryStorage();
    await storage.listBooks();

    const updated = await storage.updateBook("book-1", {
      displayTitle: undefined,
      displayAuthor: undefined,
    });

    expect(updated?.displayTitle).toBeUndefined();
    expect(updated?.relativePath).toBe("Author/Series/Volume_01.epub");
    const saveCall = invokeMock.mock.calls.find(
      ([command]) => command === "save_library_metadata",
    );
    expect(
      (
        saveCall?.[1] as {
          metadata: {
            books: Record<
              string,
              { displayTitle?: string; displayAuthor?: string }
            >;
          };
        }
      ).metadata.books["book-1"],
    ).toMatchObject({
      displayTitle: undefined,
      displayAuthor: undefined,
    });
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

  it("loads EPUB bytes without storing them in the book record", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_vault") {
        return firstScan;
      }
      if (command === "load_vault_metadata") {
        return structuredClone(metadata);
      }
      if (command === "read_epub_file") {
        return new Uint8Array([80, 75, 3, 4]).buffer;
      }
      return undefined;
    });
    const storage = new TauriVaultLibraryStorage();

    const blob = await storage.loadBookFile("book-1");

    expect(invokeMock).toHaveBeenCalledWith("read_epub_file", {
      relativePath: "Author/Series/Volume_01.epub",
    });
    expect(blob.type).toBe("application/epub+zip");
    expect(blob.size).toBe(4);
    expect((await storage.getBook("book-1"))?.fileBlob).toBeUndefined();
  });

  it("loads and reuses cached cover bytes", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_vault") {
        return firstScan;
      }
      if (command === "load_vault_metadata") {
        return structuredClone(metadata);
      }
      if (command === "load_epub_cover") {
        return new Uint8Array([255, 216, 255]).buffer;
      }
      return undefined;
    });
    const storage = new TauriVaultLibraryStorage();

    const [first, second] = await Promise.all([
      storage.loadBookCover("book-1"),
      storage.loadBookCover("book-1"),
    ]);

    expect(first?.size).toBe(3);
    expect(second).toBe(first);
    expect(
      invokeMock.mock.calls.filter(([command]) => command === "load_epub_cover"),
    ).toHaveLength(1);
  });
});
