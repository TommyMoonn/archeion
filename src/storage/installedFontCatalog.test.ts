import { invoke, isTauri } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createInstalledFontCatalog, installedFontCatalog } from "./installedFontCatalog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: vi.fn() }));

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(isTauri).mockReturnValue(true);
});

describe("installedFontCatalog", () => {
  it("shares a single in-flight provider result and caches it for later consumers", async () => {
    let finish!: (families: string[]) => void;
    const provider = vi.fn(
      () =>
        new Promise<string[]>((resolve) => {
          finish = resolve;
        }),
    );
    const catalog = createInstalledFontCatalog(provider);
    const first = catalog.load();
    const second = catalog.load();
    expect(second).toBe(first);
    await Promise.resolve();
    finish(["Arial", "Georgia", "Noto Sans 日本語"]);
    const families = await first;
    expect(await second).toBe(families);
    expect(await catalog.load()).toBe(families);
    expect(provider).toHaveBeenCalledTimes(1);
    expect(families).toEqual(["Arial", "Georgia", "Noto Sans 日本語"]);
  });

  it("exposes only immutable family labels without retaining provider-owned arrays", async () => {
    const source = ["Arial", "Georgia"];
    const catalog = createInstalledFontCatalog(async () => source);
    const families = await catalog.load();
    source.push("Changed after load");
    expect(families).toEqual(["Arial", "Georgia"]);
    expect(Object.isFrozen(families)).toBe(true);
  });

  it("keeps injected sessions independent without changing the production provider", async () => {
    const first = createInstalledFontCatalog(async () => ["Test Sans"]);
    const second = createInstalledFontCatalog(async () => ["Test Serif"]);
    expect(await first.load()).toEqual(["Test Sans"]);
    expect(await second.load()).toEqual(["Test Serif"]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("degrades browser execution to no installed families without calling native IPC", async () => {
    vi.mocked(isTauri).mockReturnValue(false);
    expect(await createInstalledFontCatalog().load()).toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("uses the registered native command and shares the production service", async () => {
    vi.mocked(invoke).mockResolvedValue(["Arial"]);
    expect(await installedFontCatalog.load()).toEqual(["Arial"]);
    expect(await installedFontCatalog.load()).toEqual(["Arial"]);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("list_installed_font_families");
  });

  it("caches native failure as an empty installed list, preserving caller-owned synthetic entries", async () => {
    vi.mocked(invoke).mockRejectedValue(new Error("native catalog unavailable"));
    const catalog = createInstalledFontCatalog();
    const pinned = ["Guaranteed default"];
    expect([...pinned, ...(await catalog.load())]).toEqual(pinned);
    expect(await catalog.load()).toEqual([]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("handles synchronous provider failure and empty catalogs once per session", async () => {
    const unavailable = vi.fn(() => {
      throw new Error("unavailable");
    });
    const catalog = createInstalledFontCatalog(unavailable);
    expect(await catalog.load()).toEqual([]);
    expect(await catalog.load()).toEqual([]);
    expect(unavailable).toHaveBeenCalledTimes(1);
    const empty = vi.fn(async () => []);
    const emptyCatalog = createInstalledFontCatalog(empty);
    expect(await emptyCatalog.load()).toEqual([]);
    expect(await emptyCatalog.load()).toEqual([]);
    expect(empty).toHaveBeenCalledTimes(1);
  });
});
