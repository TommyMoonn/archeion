import { invoke, isTauri } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { openSettingsWindow } from "./settingsWindow";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const isTauriMock = vi.mocked(isTauri);

describe("openSettingsWindow", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("invokes the native create-or-focus owner on desktop", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue(undefined);

    await expect(openSettingsWindow()).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith("open_settings_window");
  });

  it("leaves the existing dialog as the browser fallback", async () => {
    isTauriMock.mockReturnValue(false);

    await expect(openSettingsWindow()).resolves.toBe(false);

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("reports native creation failures to the caller", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockRejectedValue(new Error("window unavailable"));

    await expect(openSettingsWindow()).rejects.toThrow("window unavailable");
  });
});
