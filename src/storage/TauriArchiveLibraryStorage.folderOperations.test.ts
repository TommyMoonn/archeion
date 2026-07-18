import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  expectCommandRootPath,
  firstScan,
  invokeMock,
  metadata,
  scopedStorage,
  setupDefaultStorageMock,
} from "./tauri/storageTestSupport";
import { TauriArchiveLibraryStorage } from "./TauriArchiveLibraryStorage";

describe("TauriArchiveLibraryStorage folder operations", () => {
  beforeEach(setupDefaultStorageMock);

  it("moves an archive folder and rewrites contained book metadata paths", async () => {
    let currentScan = structuredClone(firstScan);
    let currentMetadata = structuredClone(metadata);
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "scan_archive") {
        return structuredClone(currentScan);
      }
      if (command === "load_archive_metadata") {
        return structuredClone(currentMetadata);
      }
      if (command === "move_archive_folder") {
        expect(args).toMatchObject({
          relativePath: "Author/Series",
          destinationParentPath: undefined,
        });
        currentScan = {
          folders: [
            currentScan.folders[0],
            {
              ...currentScan.folders[1],
              id: "folder:Series",
              relativePath: "Series",
              parentPath: null,
            },
          ],
          books: [
            {
              ...currentScan.books[0],
              relativePath: "Series/Volume_01.epub",
              folderPath: "Series",
            },
          ],
        };
        return {
          oldRelativePath: "Author/Series",
          newRelativePath: "Series",
        };
      }
      if (command === "save_library_metadata") {
        currentMetadata = {
          ...currentMetadata,
          library: (args as { metadata: typeof currentMetadata.library }).metadata,
        };
      }
      return undefined;
    });
    const storage = new TauriArchiveLibraryStorage();
    await storage.listFolders();

    const moved = await storage.updateFolder("folder:Author/Series", {
      parentId: null,
    });

    expect(moved).toMatchObject({
      id: "folder:Series",
      relativePath: "Series",
      parentId: null,
    });
    expect(currentMetadata.library.books["book-1"].relativePath).toBe("Series/Volume_01.epub");
  });

  it("reports cache warnings from folder deletion", async () => {
    const { storage } = await scopedStorage();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const surfaced: unknown[] = [];
    storage.observeOperationWarnings({ next: (value) => surfaced.push(value) });
    invokeMock.mockImplementation(async (command) => {
      if (command === "delete_archive_folder") {
        return {
          cacheWarning: {
            message: "Folder cache entries will be rebuilt.",
            repairRequired: false,
          },
        };
      }
      return undefined;
    });

    await storage.deleteFolder("folder:Author/Series");

    expect(warning).toHaveBeenCalledWith("Folder cache entries will be rebuilt.");
    expect(surfaced).toHaveLength(1);
    warning.mockRestore();
  });

  it.each([
    [
      "createFolder",
      "create_archive_folder",
      (storage: TauriArchiveLibraryStorage) =>
        storage.createFolder({ name: "New Folder", parentId: null }),
    ],
    [
      "renameFolder",
      "rename_archive_folder",
      (storage: TauriArchiveLibraryStorage) =>
        storage.updateFolder("folder:Author/Series", { name: "Renamed" }),
    ],
    [
      "moveFolder",
      "move_archive_folder",
      (storage: TauriArchiveLibraryStorage) =>
        storage.updateFolder("folder:Author/Series", { parentId: null }),
    ],
    [
      "revealFolder",
      "reveal_archive_folder",
      (storage: TauriArchiveLibraryStorage) => storage.revealFolder("folder:Author/Series"),
    ],
    [
      "deleteFolder",
      "delete_archive_folder",
      (storage: TauriArchiveLibraryStorage) => storage.deleteFolder("folder:Author/Series"),
    ],
  ])("sends rootPath for %s", async (_name, command, operation) => {
    const { rootPath, storage } = await scopedStorage();
    await operation(storage).catch(() => undefined);
    expectCommandRootPath(command, rootPath);
  });
});
