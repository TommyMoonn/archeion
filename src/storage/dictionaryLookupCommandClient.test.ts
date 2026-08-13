import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dictionaryLookupCommandClient } from "./dictionaryLookupCommandClient";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

describe("dictionaryLookupCommandClient", () => {
  it("keeps exact dictionary lookup on its local native command", async () => {
    await dictionaryLookupCommandClient.lookup("  example  ");

    expect(invokeMock).toHaveBeenCalledWith("lookup_dictionary_term", {
      term: "  example  ",
    });
  });
});
