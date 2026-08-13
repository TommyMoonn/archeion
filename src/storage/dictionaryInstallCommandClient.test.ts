import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dictionaryInstallCommandClient } from "./dictionaryInstallCommandClient";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));

const invokeMock = vi.mocked(invoke);

beforeEach(() => {
  invokeMock.mockReset();
  invokeMock.mockResolvedValue(undefined);
});

describe("dictionaryInstallCommandClient", () => {
  it("routes verified catalog and manual StarDict sources through native installation", async () => {
    await dictionaryInstallCommandClient.installCatalog("verified-1-2-3.stardict.zip");
    await dictionaryInstallCommandClient.importStarDict("C:/Dictionaries/source.ifo");

    expect(invokeMock.mock.calls).toEqual([
      [
        "install_catalog_dictionary",
        {
          stagingToken: "verified-1-2-3.stardict.zip",
        },
      ],
      [
        "import_stardict_dictionary",
        {
          ifoPath: "C:/Dictionaries/source.ifo",
        },
      ],
    ]);
  });
});
