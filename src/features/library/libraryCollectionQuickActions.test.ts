import { describe, expect, it, vi } from "vitest";

import type { LibraryCollectionPreferences, LibraryLocation } from "../../types/library";
import { createLibraryCollectionQuickActions } from "./libraryCollectionQuickActions";

const collections: LibraryCollectionPreferences = {
  books: { cardSize: "medium", sortBy: "author", viewMode: "grid" },
  folders: { cardSize: "small", sortBy: "path", viewMode: "cards" },
  series: { cardSize: "large", sortBy: "most-volumes", viewMode: "grid" },
};

function commandsFor(
  location: LibraryLocation,
  update: (collection: string, changes: unknown) => Promise<unknown> = vi.fn(async () => undefined),
) {
  return {
    commands: createLibraryCollectionQuickActions({
      collections,
      location,
      updateCollection: (collection, changes) => update(collection, changes),
    }),
    updateCollection: update,
  };
}

function modeFor(
  location: LibraryLocation,
  label: string,
  updateCollection: (collection: string, changes: unknown) => Promise<unknown> = vi.fn(
    async () => undefined,
  ),
) {
  const { commands, updateCollection: update } = commandsFor(location, updateCollection);
  const outcome = commands.find((command) => command.label === label)?.runInPalette?.();
  expect(outcome).not.toBeInstanceOf(Promise);
  expect(outcome).toMatchObject({ kind: "child-mode" });
  if (!outcome || outcome instanceof Promise || outcome.kind !== "child-mode") {
    throw new Error(`The ${label} mode was not created.`);
  }
  return { mode: outcome.mode, updateCollection: update };
}

describe("collection display Quick Actions", () => {
  it.each([
    [{ type: "library" } as const, ["Change view…", "Change sort…", "Change card size…"]],
    [
      { type: "folder", folderId: "fiction" } as const,
      ["Change view…", "Change sort…", "Change card size…"],
    ],
    [
      { type: "folders" } as const,
      ["Change Folder view…", "Change Folder sort…", "Change Folder card size…"],
    ],
    [
      { type: "series" } as const,
      ["Change Series view…", "Change Series sort…", "Change Series card size…"],
    ],
  ])("resolves %o to its contextual staged commands", (location, labels) => {
    expect(commandsFor(location).commands.map((command) => command.label)).toEqual(labels);
  });

  it("does not expose overview display commands in Series Detail", () => {
    expect(commandsFor({ type: "series-detail", seriesKey: "series:example" }).commands).toEqual(
      [],
    );
  });

  it("marks the current value and persists only the confirmed Books option", async () => {
    const { mode, updateCollection } = modeFor({ type: "library" }, "Change sort…");

    expect(mode.getSnapshot()).toMatchObject({
      committedOptionId: "author",
      initialActiveOptionId: "author",
      options: [
        { id: "title", label: "Title" },
        { id: "author", label: "Author" },
        { id: "recently-opened", label: "Recently opened" },
      ],
    });
    expect(updateCollection).not.toHaveBeenCalled();

    await expect(
      mode.confirm({ id: "recently-opened", label: "Recently opened" }),
    ).resolves.toEqual({ kind: "close" });
    expect(updateCollection).toHaveBeenCalledWith("books", { sortBy: "recently-opened" });
  });

  it("routes books inside a Folder through Books collection preferences", async () => {
    const { mode, updateCollection } = modeFor(
      { type: "folder", folderId: "fiction" },
      "Change view…",
    );

    await mode.confirm({ id: "list", label: "List" });
    expect(updateCollection).toHaveBeenCalledWith("books", { viewMode: "list" });
  });

  it("uses the shared Folder and Series options", () => {
    expect(modeFor({ type: "folders" }, "Change Folder sort…").mode.getSnapshot()).toMatchObject({
      committedOptionId: "path",
      options: [
        { id: "name", label: "Name" },
        { id: "path", label: "Path" },
        { id: "most-books", label: "Most books" },
      ],
    });
    expect(modeFor({ type: "series" }, "Change Series sort…").mode.getSnapshot()).toMatchObject({
      committedOptionId: "most-volumes",
      options: [
        { id: "title", label: "Title" },
        { id: "recently-opened", label: "Recently opened" },
        { id: "most-volumes", label: "Most volumes" },
      ],
    });
  });

  it.each([
    ["books", { ...collections, books: { ...collections.books, viewMode: "list" } }],
    ["folders", { ...collections, folders: { ...collections.folders, viewMode: "list" } }],
    ["series", { ...collections, series: { ...collections.series, viewMode: "list" } }],
  ] as const)(
    "hides %s card size while that collection uses rows",
    (collection, nextCollections) => {
      const location: LibraryLocation =
        collection === "folders"
          ? { type: "folders" }
          : collection === "series"
            ? { type: "series" }
            : { type: "library" };
      const commands = createLibraryCollectionQuickActions({
        collections: nextCollections,
        location,
        updateCollection: vi.fn(async () => undefined),
      });

      expect(commands.some((command) => command.id === "library.change-collection-card-size")).toBe(
        false,
      );
    },
  );

  it("keeps a failed optimistic update active and retries the same option", async () => {
    const attempts: string[] = [];
    const updateCollection = vi.fn(async (_collection: string, changes: unknown) => {
      const cardSize = (changes as { cardSize?: string }).cardSize;
      attempts.push(cardSize ?? "missing");
      if (attempts.length === 1) throw new Error("save failed");
    });
    const { mode } = modeFor({ type: "series" }, "Change Series card size…", updateCollection);
    const selected = { id: "small", label: "Small" };

    await expect(mode.confirm(selected)).resolves.toEqual({
      error:
        "The series card size is Small for this session but could not be saved. Retry to keep this setting after Archeion closes.",
      kind: "keep-open",
    });
    expect(mode.getSnapshot().committedOptionId).toBe("large");

    await expect(mode.confirm(selected)).resolves.toEqual({ kind: "close" });
    expect(attempts).toEqual(["small", "small"]);
  });
});
