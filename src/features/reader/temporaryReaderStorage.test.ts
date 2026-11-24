import { describe, expect, it, vi } from "vitest";

import {
  createTemporaryReaderPresentationController,
  temporaryReaderStorage,
} from "./temporaryReaderStorage";

describe("temporary Reader persistence boundary", () => {
  it("has no books or archive and rejects writes instead of creating sidecars", () => {
    const snapshot = temporaryReaderStorage.getLibrarySnapshot();
    expect(snapshot.archiveRootPath).toBeNull();
    expect(snapshot.books).toEqual([]);
    expect(() => temporaryReaderStorage.updateBook("book", {})).toThrow(
      "Temporary Reader cannot access archive storage",
    );
    expect(() => temporaryReaderStorage.createAnnotation("book", {} as never)).toThrow(
      "Temporary Reader cannot access archive storage",
    );
  });

  it("changes layout in memory without touching library storage", async () => {
    const controller = createTemporaryReaderPresentationController();
    const changed = vi.fn();
    const unsubscribe = controller.subscribe(changed);
    expect(controller.getSnapshot().presentation).toBe("archeion");
    expect(await controller.commit("publisher")).toBe(true);
    expect(controller.getSnapshot().presentation).toBe("publisher");
    expect(changed).toHaveBeenCalledOnce();
    unsubscribe();
    controller.teardown();
  });
});
