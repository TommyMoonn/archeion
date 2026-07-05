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

describe("TauriVaultLibraryStorage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invokeMock.mockResolvedValue(firstScan);
  });

  it("maps scan results into the shared library models", async () => {
    const storage = new TauriVaultLibraryStorage();

    const [books, folders] = await Promise.all([
      storage.listBooks(),
      storage.listFolders(),
    ]);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    expect(invokeMock).toHaveBeenCalledWith("scan_vault");
    expect(books[0]).toMatchObject({
      id: "book-1",
      originalTitle: "Volume 01",
      folderId: "folder:Author/Series",
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
    invokeMock.mockResolvedValue({ books: [], folders: [] });

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
});
