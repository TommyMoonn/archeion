import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dictionaryCatalogCommandClient } from "./dictionaryCatalogCommandClient";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
});

describe("dictionaryCatalogCommandClient", () => {
  it("keeps cache loading, explicit refresh, and cancellation on their native commands", async () => {
    invokeMock.mockResolvedValue(undefined);

    await dictionaryCatalogCommandClient.loadCached();
    await dictionaryCatalogCommandClient.refresh();
    await dictionaryCatalogCommandClient.cancelRefresh();

    expect(invokeMock.mock.calls).toEqual([
      ["load_cached_dictionary_catalog"],
      ["refresh_dictionary_catalog"],
      ["cancel_dictionary_catalog_refresh"],
    ]);
  });
});
