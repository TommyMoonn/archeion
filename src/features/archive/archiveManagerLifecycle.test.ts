import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ARCHIVE_MANAGER_CLOSED_EVENT,
  hideMainWindowForStartup,
  listenForArchiveManagerClosed,
  quitFromStartup,
} from "./archiveManagerLifecycle";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: vi.fn() }));

const isTauriMock = vi.mocked(isTauri);
const listenMock = vi.mocked(listen);
const getCurrentWindowMock = vi.mocked(getCurrentWindow);

describe("Archive Manager lifecycle helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(true);
  });

  it("listens for the backend manager-close event", async () => {
    const listener = vi.fn();
    const unlisten = vi.fn();
    listenMock.mockResolvedValue(unlisten);

    await expect(listenForArchiveManagerClosed(listener)).resolves.toBe(unlisten);
    expect(listenMock).toHaveBeenCalledWith(ARCHIVE_MANAGER_CLOSED_EVENT, listener);
  });

  it("hides the main window before retrying manager startup", async () => {
    const hide = vi.fn().mockResolvedValue(undefined);
    getCurrentWindowMock.mockReturnValue({ hide } as unknown as ReturnType<
      typeof getCurrentWindow
    >);

    await expect(hideMainWindowForStartup()).resolves.toBe(true);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it("reports a failed startup hide without throwing", async () => {
    const error = new Error("hide failed");
    const hide = vi.fn().mockRejectedValue(error);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    getCurrentWindowMock.mockReturnValue({ hide } as unknown as ReturnType<
      typeof getCurrentWindow
    >);

    await expect(hideMainWindowForStartup()).resolves.toBe(false);
    expect(consoleError).toHaveBeenCalledWith("main window could not be hidden for startup", error);
  });

  it("closes the hidden main window when quitting failed startup", async () => {
    const close = vi.fn().mockResolvedValue(undefined);
    getCurrentWindowMock.mockReturnValue({ close } as unknown as ReturnType<
      typeof getCurrentWindow
    >);

    await quitFromStartup();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
