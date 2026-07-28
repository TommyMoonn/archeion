import { afterEach, describe, expect, it, vi } from "vitest";

import type { Folder } from "../../types/folder";
import {
  createFolderBrowserEntries,
  filterFolderBrowserEntries,
  sortFolderBrowserEntries,
} from "./folderBrowserReadModel";

function folder(id: string, name: string, relativePath: string): Folder {
  const separator = relativePath.lastIndexOf("/");
  return {
    id,
    name,
    relativePath,
    parentId: separator >= 0 ? "parent" : null,
    parentPath: separator >= 0 ? relativePath.slice(0, separator) : null,
    createdAt: "1",
    updatedAt: "1",
  };
}

const folders = [
  folder("zeta", "Alpha", "Zeta/Alpha"),
  folder("alpha", "Alpha", "Alpha/Alpha"),
  folder("beta", "Beta", "Alpha/Beta"),
  folder("gamma", "Gamma", "Gamma"),
];
const counts = new Map([
  ["zeta", 4],
  ["alpha", 4],
  ["beta", 7],
  ["gamma", 1],
]);

afterEach(() => {
  vi.restoreAllMocks();
});

describe("folder browser read model", () => {
  it("sorts by name with path and id tie-breakers", () => {
    const sorted = sortFolderBrowserEntries(createFolderBrowserEntries(folders, counts), "name");
    expect(sorted.map((entry) => entry.folder.id)).toEqual(["alpha", "zeta", "beta", "gamma"]);
  });

  it("sorts by path with name and id tie-breakers", () => {
    const samePathFolders = [
      folder("same-path-zulu", "Zulu", "Shared"),
      folder("same-path-alpha", "Alpha", "Shared"),
      ...folders,
    ];
    const sorted = sortFolderBrowserEntries(
      createFolderBrowserEntries(samePathFolders, counts),
      "path",
    );
    expect(sorted.map((entry) => entry.folder.id)).toEqual([
      "alpha",
      "beta",
      "gamma",
      "same-path-alpha",
      "same-path-zulu",
      "zeta",
    ]);
  });

  it("sorts most books by count, then path without using folder name", () => {
    const tiedFolders = [
      folder("path-first", "Zulu", "Alpha/Zulu"),
      folder("name-first", "Alpha", "Zulu/Alpha"),
    ];
    const tiedCounts = new Map([
      ["path-first", 4],
      ["name-first", 4],
    ]);
    const sorted = sortFolderBrowserEntries(
      createFolderBrowserEntries(tiedFolders, tiedCounts),
      "most-books",
    );
    expect(sorted.map((entry) => entry.folder.id)).toEqual(["path-first", "name-first"]);
  });

  it.each(["name", "path", "most-books"] as const)(
    "uses exact folder ids as the final %s tie-breaker",
    (sort) => {
      const localeEquivalentIds = [
        folder("résumé", "Same", "Same"),
        folder("resume", "Same", "Same"),
      ];
      const equalCounts = new Map([
        ["résumé", 2],
        ["resume", 2],
      ]);

      const forward = sortFolderBrowserEntries(
        createFolderBrowserEntries(localeEquivalentIds, equalCounts),
        sort,
      );
      const reversed = sortFolderBrowserEntries(
        createFolderBrowserEntries([...localeEquivalentIds].reverse(), equalCounts),
        sort,
      );

      expect(forward.map((entry) => entry.folder.id)).toEqual(["resume", "résumé"]);
      expect(reversed.map((entry) => entry.folder.id)).toEqual(["resume", "résumé"]);
    },
  );

  it("retains the documented name and path tie-break sequences", () => {
    const nameSorted = sortFolderBrowserEntries(
      createFolderBrowserEntries(
        [folder("z-path", "Same", "Zulu/Same"), folder("a-path", "Same", "Alpha/Same")],
        new Map(),
      ),
      "name",
    );
    const pathSorted = sortFolderBrowserEntries(
      createFolderBrowserEntries(
        [folder("z-name", "Zulu", "Shared"), folder("a-name", "Alpha", "Shared")],
        new Map(),
      ),
      "path",
    );

    expect(nameSorted.map((entry) => entry.folder.id)).toEqual(["a-path", "z-path"]);
    expect(pathSorted.map((entry) => entry.folder.id)).toEqual(["a-name", "z-name"]);
  });

  it("filters the derived entries before sorting", () => {
    const entries = createFolderBrowserEntries(folders, counts);
    const filtered = filterFolderBrowserEntries(entries, "zeta");
    const sorted = sortFolderBrowserEntries(filtered, "most-books");

    expect(sorted.map((entry) => entry.folder.id)).toEqual(["zeta"]);
  });

  it("scans the canonical Folder entries once before sorting search matches", () => {
    const entries = createFolderBrowserEntries(folders, counts);
    let entryReads = 0;
    const observedEntries = new Proxy(entries, {
      get(target, property, receiver) {
        if (typeof property === "string" && /^\d+$/u.test(property)) entryReads += 1;
        return Reflect.get(target, property, receiver);
      },
    });

    const filtered = filterFolderBrowserEntries(observedEntries, "alpha");
    const sorted = sortFolderBrowserEntries(filtered, "most-books");

    expect(entryReads).toBe(entries.length);
    expect(filtered.map((entry) => entry.folder.id)).toEqual(["zeta", "alpha", "beta"]);
    expect(filtered[0]).toBe(entries[0]);
    expect(filtered[1]).toBe(entries[1]);
    expect(filtered[2]).toBe(entries[2]);
    expect(sorted.map((entry) => entry.folder.id)).toEqual(["beta", "alpha", "zeta"]);
  });

  it("filters a non-empty query without sorting relevance matches", () => {
    const entries = createFolderBrowserEntries(folders, counts);
    const sort = vi.spyOn(Array.prototype, "sort");

    const filtered = filterFolderBrowserEntries(entries, "alpha");

    expect(filtered.map((entry) => entry.folder.id)).toEqual(["zeta", "alpha", "beta"]);
    expect(sort).not.toHaveBeenCalled();
  });

  it("performs exactly one result sort for the complete non-empty browser derivation", () => {
    const entries = createFolderBrowserEntries(folders, counts);
    const sort = vi.spyOn(Array.prototype, "sort");

    const visibleEntries = sortFolderBrowserEntries(
      filterFolderBrowserEntries(entries, "alpha"),
      "most-books",
    );

    expect(visibleEntries.map((entry) => entry.folder.id)).toEqual(["beta", "alpha", "zeta"]);
    expect(sort).toHaveBeenCalledTimes(1);
  });

  it("reuses the canonical Folder entry array when search is empty", () => {
    const entries = createFolderBrowserEntries(folders, counts);

    expect(filterFolderBrowserEntries(entries, "")).toBe(entries);
  });
});
