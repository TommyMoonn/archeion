// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { getUpdateToastClient } from "./devUpdateToastPreview";

const sessions: string[] = [];

afterEach(() => {
  const previous = sessions.pop();
  if (previous !== undefined) window.history.replaceState(null, "", previous);
  window.localStorage.removeItem("archeion:dev-update-toast");
  vi.useRealTimers();
});

function selectPreview(mode: string) {
  sessions.push(`${window.location.pathname}${window.location.search}`);
  window.history.replaceState(null, "", `/?dev-update-toast=${mode}`);
  return getUpdateToastClient();
}

describe("development update toast preview", () => {
  it.each([
    ["available", "available"],
    ["downloading", "downloading"],
    ["ready", "ready"],
    ["installing", "installing"],
    ["error", "idle"],
    ["completed", "idle"],
    ["flow", "available"],
  ] as const)("provides the %s state", async (mode, status) => {
    const client = selectPreview(mode);
    await client.initialize();

    expect(client.getSnapshot().update).toMatchObject({
      supported: true,
      status,
      currentVersion: mode === "completed" ? "1.8.0" : "1.7.0",
    });
  });

  it.each(["available", "flow"] as const)(
    "simulates download progress, restart, completion, and acknowledgement from %s",
    async (mode) => {
      vi.useFakeTimers();
      const client = selectPreview(mode);
      await client.initialize();
      expect(getUpdateToastClient()).toBe(client);
      const observed: string[] = [];
      const unsubscribe = client.subscribe(() => {
        const update = client.getSnapshot().update;
        if (update) observed.push(`${update.status}:${update.downloadedBytes}`);
      });

      const download = client.download();
      await Promise.resolve();
      await vi.runAllTimersAsync();
      await expect(download).resolves.toMatchObject({
        status: "ready",
        downloadedBytes: 100_000_000,
      });
      expect(observed.some((state) => state === "downloading:12000000")).toBe(true);
      expect(observed.at(-1)).toBe("ready:100000000");

      const install = client.install();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(0);
      expect(client.getSnapshot().update).toMatchObject({ status: "installing" });
      await vi.runAllTimersAsync();
      await expect(install).resolves.toMatchObject({
        status: "idle",
        currentVersion: "1.8.0",
        available: null,
        prompt: { completedVersion: "1.8.0" },
      });

      await client.acknowledgeCompleted("1.8.0");
      expect(client.getSnapshot().update?.prompt.completedVersion).toBeNull();
      unsubscribe();
    },
  );
});

describe("development update toast preview storage", () => {
  it("supports selecting a preview state from Tauri webview devtools", async () => {
    window.localStorage.setItem("archeion:dev-update-toast", "ready");

    const client = getUpdateToastClient();
    await client.initialize();

    expect(client.getSnapshot().update).toMatchObject({
      supported: true,
      status: "ready",
    });
  });
});
