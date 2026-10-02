import { beforeEach, describe, expect, it } from "vitest";

import type { MetadataBundle } from "../metadataFiles";
import { invokeMock, metadata, mockStorageCommands } from "./storageTestSupport";

describe("archive storage command fixtures", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    mockStorageCommands();
  });

  it("loads independent metadata snapshots", async () => {
    const loaded = await invokeMock<MetadataBundle>("load_archive_metadata");
    loaded.library.books["book-1"].isFavorite = false;

    await expect(invokeMock("load_archive_metadata")).resolves.toEqual(metadata);
  });

  it("replaces handlers without clearing recorded calls", async () => {
    const args = { name: "First", rootPath: "C:/ArchiveA" };
    mockStorageCommands({ create_archive_folder: ({ name }) => name });
    await expect(invokeMock("create_archive_folder", args)).resolves.toBe("First");

    mockStorageCommands({ create_archive_folder: async () => "Second" });
    await expect(invokeMock("create_archive_folder", args)).resolves.toBe("Second");

    expect(invokeMock).toHaveBeenCalledTimes(2);
    expect(invokeMock).toHaveBeenNthCalledWith(1, "create_archive_folder", args);
    expect(invokeMock).toHaveBeenNthCalledWith(2, "create_archive_folder", args);
  });

  it.each(["write_epub_metadata", "unknown_archive_command", "toString"])(
    "reports an unconfigured %s invocation by name",
    async (command) => {
      await expect(invokeMock(command)).rejects.toThrow(
        `Unexpected archive command "${command}". Configure a storage test handler.`,
      );
    },
  );
});
