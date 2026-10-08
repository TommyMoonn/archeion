import { afterEach, describe, expect, it, vi } from "vitest";

import { AppUpdateClient } from "./appUpdateClient";
import { APP_UPDATE_CHANGED_EVENT, type AppUpdateSnapshot } from "./appUpdateTypes";

const native = vi.hoisted(() => ({
  desktop: vi.fn(() => true),
  invoke: vi.fn<(command: string, args?: Record<string, unknown>) => Promise<AppUpdateSnapshot>>(),
  listen:
    vi.fn<
      (
        channel: string,
        handler: (event: { payload: AppUpdateSnapshot }) => void,
      ) => Promise<() => void>
    >(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, isTauri: native.desktop }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));

const idle: AppUpdateSnapshot = {
  revision: 0,
  supported: true,
  currentVersion: "1.6.0",
  status: "idle",
  available: null,
  downloadedBytes: 0,
  totalBytes: null,
  error: null,
};

afterEach(() => vi.resetAllMocks());

describe("native app update IPC boundary", () => {
  it("uses only app-owned commands and one app-level snapshot channel", async () => {
    const client = new AppUpdateClient();
    const unlisten = vi.fn();
    native.listen.mockResolvedValue(unlisten);
    native.invoke.mockResolvedValue(idle);
    await client.initialize();
    expect(native.listen).toHaveBeenCalledWith(APP_UPDATE_CHANGED_EVENT, expect.any(Function));
    expect(native.invoke.mock.calls).toEqual([["get_app_update_snapshot"]]);
    await client.check("manual");
    await client.check("automatic");
    await client.download();
    await client.install();
    expect(native.invoke.mock.calls).toEqual([
      ["get_app_update_snapshot"],
      ["check_app_update", { intent: "manual" }],
      ["check_app_update", { intent: "automatic" }],
      ["download_app_update"],
      ["install_app_update"],
    ]);
    native.listen.mock.calls[0][1]({ payload: { ...idle, revision: 1, status: "checking" } });
    expect(client.getSnapshot().update?.status).toBe("checking");
    client.dispose();
    expect(unlisten).toHaveBeenCalledOnce();
  });

  it("performs no native IPC in the default browser backend", async () => {
    native.desktop.mockReturnValue(false);
    const client = new AppUpdateClient();
    await client.initialize();
    expect(client.getSnapshot().status).toBe("unavailable");
    await expect(client.check("manual")).rejects.toThrow("unavailable");
    expect(native.invoke).not.toHaveBeenCalled();
    expect(native.listen).not.toHaveBeenCalled();
  });
});
