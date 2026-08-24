import { invoke, isTauri } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { openThemeManagerWindow } from "./themeManagerWindowLifecycle";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const isTauriMock = vi.mocked(isTauri);

describe("openThemeManagerWindow", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    isTauriMock.mockReset();
  });

  it("invokes the native create-or-focus owner on desktop", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockResolvedValue(undefined);

    await expect(openThemeManagerWindow()).resolves.toBeUndefined();

    expect(invokeMock).toHaveBeenCalledOnce();
    expect(invokeMock).toHaveBeenCalledWith("open_theme_manager_window");
  });

  it("is a no-op outside the desktop runtime", async () => {
    isTauriMock.mockReturnValue(false);

    await expect(openThemeManagerWindow()).resolves.toBeUndefined();

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("reports native creation failures to the caller", async () => {
    isTauriMock.mockReturnValue(true);
    invokeMock.mockRejectedValue(new Error("window unavailable"));

    await expect(openThemeManagerWindow()).rejects.toThrow("window unavailable");
  });
});
