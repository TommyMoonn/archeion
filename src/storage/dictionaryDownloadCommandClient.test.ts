import { Channel, invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { dictionaryDownloadCommandClient } from "./dictionaryDownloadCommandClient";

vi.mock("@tauri-apps/api/core", () => ({
  Channel: vi.fn(function MockChannel(this: { onmessage: unknown }, onmessage) {
    this.onmessage = onmessage;
  }),
  invoke: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const ChannelMock = vi.mocked(Channel);

beforeEach(() => {
  invokeMock.mockReset();
  ChannelMock.mockClear();
});

describe("dictionaryDownloadCommandClient", () => {
  it("keeps download bytes native while forwarding bounded progress and staging cleanup", async () => {
    invokeMock.mockResolvedValue(undefined);
    const onProgress = vi.fn();

    await dictionaryDownloadCommandClient.download("english", onProgress);
    await dictionaryDownloadCommandClient.cancel();
    await dictionaryDownloadCommandClient.cleanup("verified-1-2-3.dictionary-package");

    expect(ChannelMock).toHaveBeenCalledWith(onProgress);
    const channel = ChannelMock.mock.instances[0];
    expect(invokeMock.mock.calls).toEqual([
      ["download_dictionary_catalog_package", { catalogId: "english", onProgress: channel }],
      ["cancel_dictionary_download"],
      [
        "cleanup_verified_dictionary_download",
        {
          stagingToken: "verified-1-2-3.dictionary-package",
        },
      ],
    ]);
  });
});
