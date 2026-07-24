import { describe, expect, it, vi } from "vitest";

import {
  createQuickActionIndex,
  QuickActionsRegistry,
  searchQuickActions,
  type QuickActionRegistration,
} from "./quickActions";

function command(
  overrides: Partial<QuickActionRegistration> & Pick<QuickActionRegistration, "id" | "label">,
) {
  return {
    configuration: "unbound" as const,
    execute: vi.fn(),
    group: "Library" as const,
    scope: "global" as const,
    ...overrides,
  };
}

describe("QuickActionsRegistry", () => {
  it("replaces registrations by source without stale cleanup removing the new commands", () => {
    const registry = new QuickActionsRegistry();
    const stopFirst = registry.register("surface", [command({ id: "first", label: "First" })]);
    registry.register("surface", [command({ id: "second", label: "Second" })]);

    stopFirst();

    expect(registry.getSnapshot().commands.map((item) => item.id)).toEqual(["second"]);
  });

  it("keeps recent ranking in memory only and removes stale recent ids", () => {
    const registry = new QuickActionsRegistry();
    const stop = registry.register("surface", [
      command({ id: "first", label: "First", order: 1 }),
      command({ id: "second", label: "Second", order: 2 }),
    ]);
    registry.recordRecent("second");

    const ranked = searchQuickActions(
      createQuickActionIndex(registry.getSnapshot().commands),
      "",
      registry.getSnapshot().recentCommandIds,
    );
    expect(ranked.map((item) => item.id)).toEqual(["second", "first"]);

    stop();
    expect(registry.getSnapshot().recentCommandIds).toEqual([]);
  });

  it("rejects duplicate command identities across active sources", () => {
    const registry = new QuickActionsRegistry();
    registry.register("first", [command({ id: "same", label: "First" })]);

    expect(() => registry.register("second", [command({ id: "same", label: "Second" })])).toThrow(
      "Duplicate command registration: same:global",
    );
    expect(registry.getSnapshot().commands.map((item) => item.label)).toEqual(["First"]);
  });
});

describe("Quick Actions search", () => {
  const commands = [
    command({
      id: "search",
      keywords: ["find books", "library"],
      label: "Search books",
      order: 2,
    }),
    command({
      availability: { available: false, reason: "Select a book first." },
      group: "Reader",
      id: "toc",
      keywords: ["chapters"],
      label: "Open reader TOC",
      order: 1,
    }),
  ];
  const index = createQuickActionIndex(commands);

  it("matches compact labels, keywords, groups, and disabled reasons", () => {
    expect(searchQuickActions(index, "searchbooks", []).map((item) => item.id)).toEqual(["search"]);
    expect(searchQuickActions(index, "chapters", []).map((item) => item.id)).toEqual(["toc"]);
    expect(searchQuickActions(index, "open a book", []).map((item) => item.id)).toEqual(["toc"]);
  });
});
