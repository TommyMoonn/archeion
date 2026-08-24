import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { closeThemeManagerWindow, openThemeManagerWindow } from "./themeManagerWindowLifecycle";

const closeMock = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: vi.fn(() => ({ close: closeMock })),
}));

const invokeMock = vi.mocked(invoke);
const isTauriMock = vi.mocked(isTauri);

describe("openThemeManagerWindow", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
    closeMock.mockClear();
  });

  it("invokes the native create-or-focus owner on desktop", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue(undefined);

    await expect(openThemeManagerWindow()).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith("open_theme_manager_window");
  });

  it("leaves the existing dialog as the browser fallback", async () => {
    isTauriMock.mockReturnValue(false);

    await expect(openThemeManagerWindow()).resolves.toBe(false);

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("reports native creation failures to the caller", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockRejectedValue(new Error("window unavailable"));

    await expect(openThemeManagerWindow()).rejects.toThrow("window unavailable");
  });

  it("closes the current Theme Manager window independently", async () => {
    isTauriMock.mockReturnValue(true);

    await expect(closeThemeManagerWindow()).resolves.toBe(true);

    expect(getCurrentWindow).toHaveBeenCalledOnce();
    expect(closeMock).toHaveBeenCalledOnce();
  });
});
