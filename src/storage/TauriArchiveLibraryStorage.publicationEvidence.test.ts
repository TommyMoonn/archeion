import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Book } from "../types/book";
import type { Folder } from "../types/folder";
import {
  firstScan,
  invokeMock,
  metadata,
  setupDefaultStorageMock,
} from "./tauri/storageTestSupport";
import { TauriArchiveLibraryStorage } from "./TauriArchiveLibraryStorage";

describe("TauriArchiveLibraryStorage publication evidence", () => {
  beforeEach(setupDefaultStorageMock);

  it("records one separate Book and Folder publication for one changed full scan", async () => {
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    const books = vi.fn<(value: Book[]) => void>();
    const folders = vi.fn<(value: Folder[]) => void>();
    const statuses = vi.fn<(value: string) => void>();
    const stopBooks = storage.observeBooks({ next: books });
    const stopFolders = storage.observeFolders({ next: folders });
    const stopStatus = storage.observeScanStatus({
      next: (status) => statuses(status.status),
    });
    books.mockClear();
    folders.mockClear();
    statuses.mockClear();
    const changedScan = structuredClone(firstScan);
    changedScan.folders.push({
      id: "folder:Replacement",
      name: "Replacement",
      relativePath: "Replacement",
      parentPath: null,
    });
    changedScan.books[0] = {
      ...changedScan.books[0],
      relativePath: "Replacement/Volume_01.epub",
      folderPath: "Replacement",
    };
    invokeMock.mockImplementation(async (command) => {
      if (command === "scan_archive") return structuredClone(changedScan);
      if (command === "load_archive_metadata") return structuredClone(metadata);
      return undefined;
    });

    await storage.rescan();

    expect(books).toHaveBeenCalledTimes(1);
    expect(folders).toHaveBeenCalledTimes(1);
    expect(statuses.mock.calls.map(([status]) => status)).toEqual(["scanning", "idle"]);
    stopBooks();
    stopFolders();
    stopStatus();
  });

  it("records only the Book publication for a Book-only mutation", async () => {
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    const books = vi.fn<(value: Book[]) => void>();
    const folders = vi.fn<(value: Folder[]) => void>();
    const stopBooks = storage.observeBooks({ next: books });
    const stopFolders = storage.observeFolders({ next: folders });
    books.mockClear();
    folders.mockClear();

    await storage.updateBook("book-1", { isFavorite: false });

    expect(books).toHaveBeenCalledTimes(1);
    expect(folders).not.toHaveBeenCalled();
    stopBooks();
    stopFolders();
  });

  it("records only the Folder publication for a Folder-only mutation", async () => {
    const storage = new TauriArchiveLibraryStorage();
    await storage.listBooks();
    const books = vi.fn<(value: Book[]) => void>();
    const folders = vi.fn<(value: Folder[]) => void>();
    const stopBooks = storage.observeBooks({ next: books });
    const stopFolders = storage.observeFolders({ next: folders });
    books.mockClear();
    folders.mockClear();

    await storage.createFolder({ name: "New Folder", parentId: null });

    expect(books).not.toHaveBeenCalled();
    expect(folders).toHaveBeenCalledTimes(1);
    stopBooks();
    stopFolders();
  });
});
