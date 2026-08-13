import { describe, expect, it, vi } from "vitest";

import type { DictionaryRegistrySnapshot } from "../types/dictionary";
import { createDictionaryRegistryStore } from "./dictionaryRegistryStore";

const emptyRegistry: DictionaryRegistrySnapshot = {
  dictionaries: [],
  recovery: null,
  status: "ready",
};

describe("dictionaryRegistryStore", () => {
  it("shares one current application-level registry projection", async () => {
    const list = vi.fn(async () => emptyRegistry);
    const store = createDictionaryRegistryStore({ list });
    const listener = vi.fn();
    store.subscribe(listener);

    store.ensureLoaded();
    expect(store.getSnapshot().status).toBe("loading");
    await vi.waitFor(() =>
      expect(store.getSnapshot()).toMatchObject({ registry: emptyRegistry, status: "ready" }),
    );
    expect(list).toHaveBeenCalledOnce();

    const recovery: DictionaryRegistrySnapshot = {
      dictionaries: [],
      recovery: { message: "Recovery required", reason: "corrupt-database" },
      status: "recovery-required",
    };
    store.publish(recovery);

    expect(store.getSnapshot()).toMatchObject({ registry: recovery, status: "ready" });
    expect(listener).toHaveBeenCalledTimes(3);
  });
});
