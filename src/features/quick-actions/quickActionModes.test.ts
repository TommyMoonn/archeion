import { describe, expect, it, vi } from "vitest";

import { QuickActionChildModeSession, searchQuickActionModeOptions } from "./quickActionModes";

describe("QuickActionChildModeSession", () => {
  it("disposes its owned lifecycle exactly once", () => {
    const onDispose = vi.fn();
    const mode = new QuickActionChildModeSession({
      confirm: () => ({ kind: "close" }),
      id: "test",
      onDispose,
      placeholder: "Search…",
      snapshot: { options: [] },
      title: "Test mode",
    });

    mode.dispose();
    mode.dispose();

    expect(onDispose).toHaveBeenCalledOnce();
  });

  it("publishes replacement options without changing the mode owner", () => {
    const mode = new QuickActionChildModeSession({
      confirm: () => ({ kind: "close" }),
      id: "test",
      placeholder: "Search…",
      snapshot: { options: [{ id: "books", label: "Books" }] },
      title: "Test mode",
    });
    const listener = vi.fn();
    mode.subscribe(listener);

    mode.replaceOptions([{ id: "comics", label: "Comics" }]);

    expect(listener).toHaveBeenCalledOnce();
    expect(mode.getSnapshot().options).toEqual([{ id: "comics", label: "Comics" }]);
  });

  it("searches bounded option labels, keywords, status, and unavailable reasons", () => {
    const options = [
      { id: "books", label: "Books", status: "Current archive" },
      { id: "comics", keywords: ["illustrated"], label: "Comics" },
      {
        availability: { available: false as const, reason: "Folder unavailable" },
        id: "novels",
        label: "Novels",
      },
    ];

    expect(searchQuickActionModeOptions(options, "current").map((option) => option.id)).toEqual([
      "books",
    ]);
    expect(searchQuickActionModeOptions(options, "illustrated").map((option) => option.id)).toEqual(
      ["comics"],
    );
    expect(searchQuickActionModeOptions(options, "unavailable").map((option) => option.id)).toEqual(
      ["novels"],
    );
  });
});
