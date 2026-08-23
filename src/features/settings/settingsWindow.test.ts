import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { closeSettingsWindow, openSettingsWindow } from "./settingsWindow";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const isTauriMock = vi.mocked(isTauri);
const getCurrentWindowMock = vi.mocked(getCurrentWindow);

describe("openSettingsWindow", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
    getCurrentWindowMock.mockReset();
  });

  it("closes only the current Settings webview", async () => {
    const close = vi.fn(async () => undefined);
    isTauriMock.mockReturnValue(true);
    getCurrentWindowMock.mockReturnValue({
      close,
    } as unknown as ReturnType<typeof getCurrentWindow>);

    await expect(closeSettingsWindow()).resolves.toBe(true);

    expect(close).toHaveBeenCalledOnce();
  });

  it("does not touch a desktop window in browser fallback mode", async () => {
    isTauriMock.mockReturnValue(false);

    await expect(closeSettingsWindow()).resolves.toBe(false);

    expect(getCurrentWindowMock).not.toHaveBeenCalled();
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
