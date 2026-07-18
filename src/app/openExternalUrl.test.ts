import { beforeEach, describe, expect, it, vi } from "vitest";

import { openExternalUrl } from "./openExternalUrl";

const invoke = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@tauri-apps/api/core", () => ({ invoke }));

beforeEach(() => {
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
});

describe("openExternalUrl", () => {
  it("uses the approved native external URL command", async () => {
    await openExternalUrl("https://tommymoonn.github.io/archeion/");

    expect(invoke).toHaveBeenCalledWith("open_external_url", {
      url: "https://tommymoonn.github.io/archeion/",
    });
  });
});
