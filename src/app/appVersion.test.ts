import { beforeEach, describe, expect, it, vi } from "vitest";

import packageMetadata from "../../package.json";
import tauriConfig from "../../src-tauri/tauri.conf.json";
import { APPLICATION_VERSION_FALLBACK, resolveApplicationVersion } from "./appVersion";

const getVersion = vi.hoisted(() => vi.fn(async () => "9.9.9"));
const isTauri = vi.hoisted(() => vi.fn(() => false));

vi.mock("@tauri-apps/api/app", () => ({ getVersion }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri }));

beforeEach(() => {
  getVersion.mockReset();
  getVersion.mockResolvedValue("9.9.9");
  isTauri.mockReset();
  isTauri.mockReturnValue(false);
});

describe("application version", () => {
  it("derives the frontend fallback from the package version aligned with Tauri", () => {
    expect(APPLICATION_VERSION_FALLBACK).toBe(packageMetadata.version);
    expect(APPLICATION_VERSION_FALLBACK).toBe(tauriConfig.version);
  });

  it("uses the runtime Tauri version when available", async () => {
    isTauri.mockReturnValue(true);

    await expect(resolveApplicationVersion()).resolves.toBe("9.9.9");
    expect(getVersion).toHaveBeenCalledTimes(1);
  });

  it("keeps the centralized fallback outside Tauri and after runtime lookup failure", async () => {
    await expect(resolveApplicationVersion()).resolves.toBe(APPLICATION_VERSION_FALLBACK);
    expect(getVersion).not.toHaveBeenCalled();

    isTauri.mockReturnValue(true);
    getVersion.mockRejectedValueOnce(new Error("unavailable"));
    await expect(resolveApplicationVersion()).resolves.toBe(APPLICATION_VERSION_FALLBACK);
  });
});
