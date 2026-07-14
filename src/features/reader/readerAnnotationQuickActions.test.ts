import { describe, expect, it, vi } from "vitest";

import { readerAnnotationQuickActions } from "./readerAnnotationQuickActions";

describe("readerAnnotationQuickActions", () => {
  it("defines the annotation command declaratively and executes its injected action", () => {
    const openAnnotations = vi.fn();
    const commands = readerAnnotationQuickActions(openAnnotations);

    expect(commands).toEqual([
      expect.objectContaining({
        group: "Reader",
        id: "reader.open-annotations",
        keywords: ["bookmarks", "highlights", "notes"],
        label: "Open annotations",
        order: 81,
      }),
    ]);
    commands[0]?.execute();
    expect(openAnnotations).toHaveBeenCalledOnce();
  });
});
