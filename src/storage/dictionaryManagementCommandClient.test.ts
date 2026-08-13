import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dictionaryManagementCommandClient } from "./dictionaryManagementCommandClient";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

describe("dictionaryManagementCommandClient", () => {
  it("routes installed dictionary management through the native registry owner", async () => {
    await dictionaryManagementCommandClient.list();
    await dictionaryManagementCommandClient.setEnabled("dict-a", false);
    await dictionaryManagementCommandClient.setOrder(["dict-b", "dict-a"]);
    await dictionaryManagementCommandClient.rebuildIndex("dict-a");
    await dictionaryManagementCommandClient.remove("dict-a");

    expect(invokeMock.mock.calls).toEqual([
      ["list_installed_dictionaries"],
      ["set_dictionary_enabled", { dictionaryId: "dict-a", enabled: false }],
      ["set_dictionary_order", { dictionaryIds: ["dict-b", "dict-a"] }],
      ["rebuild_dictionary_index", { dictionaryId: "dict-a" }],
      ["remove_dictionary", { dictionaryId: "dict-a" }],
    ]);
  });
});
