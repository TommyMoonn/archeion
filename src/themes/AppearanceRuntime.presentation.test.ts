// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { defaultAppPreferences, type AppPreferences } from "../types/appSettings";
import { AppearanceRuntime } from "./AppearanceRuntime";
import { ThemeCatalog } from "./ThemeCatalog";
import type { AppearancePresentation } from "./appearancePresentation";
import { resolveBuiltInAppTheme } from "./resolveTheme";

const manifest = JSON.stringify({
  schemaVersion: 1,
  id: "presentation-test",
  name: "Presentation test",
  base: "light",
  app: { main: "#ddecff" },
});
async function settle() {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}
function setup(preparePresentation: (value: AppearancePresentation) => Promise<void>) {
  let preferences: AppPreferences = {
    ...defaultAppPreferences,
    appTheme: { kind: "custom", id: "presentation-test" },
  };
  const listeners = new Set<() => void>();
  const root = document.createElement("html");
  root.dataset.appearancePending = "";
  const runtime = new AppearanceRuntime({
    globalPreferences: {
      getSnapshot: () => preferences,
      getRevisionSnapshot: () => 12,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      update: async (changes) => {
        preferences = { ...preferences, ...changes };
        listeners.forEach((listener) => listener());
        return preferences;
      },
    },
    catalog: new ThemeCatalog(() => ({
      listPackageDirectories: async () => ["presentation-test"],
      readManifest: async () => manifest,
    })),
    getDocumentRoot: () => root,
    preparePresentation,
    onError: vi.fn(),
  });
  return { root, runtime };
}

describe("committed native presentation handoff", () => {
  it("prepares validated custom presentation before revealing tokens, without publishing previews", async () => {
    let acknowledge!: () => void;
    const prepare = vi.fn(() => new Promise<void>((done) => (acknowledge = done)));
    const { runtime, root } = setup(prepare);
    const stop = runtime.start();
    await settle();
    expect(prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        background: "#ddecff",
        settingsRevision: 12,
        manifestSource: manifest,
      }),
    );
    expect(root.dataset.appearancePending).toBe("");
    expect(root.dataset.appTheme).toBeUndefined();
    acknowledge();
    await settle();
    expect(root.style.getPropertyValue("--surface-main")).toBe("#ddecff");
    expect(root.dataset.appearancePending).toBeUndefined();
    const calls = prepare.mock.calls.length;
    runtime.applyPreview(resolveBuiltInAppTheme("dark"));
    runtime.clearPreview();
    expect(prepare).toHaveBeenCalledTimes(calls);
    stop();
  });

  it("does not reveal an old custom acknowledgement after a newer built-in commit", async () => {
    let oldAcknowledgement!: () => void;
    const { runtime, root } = setup((value) =>
      value.selection.kind === "custom"
        ? new Promise<void>((done) => (oldAcknowledgement = done))
        : Promise.resolve(),
    );
    const stop = runtime.start();
    await settle();
    await runtime.updateAppearanceSettings({ appTheme: { kind: "builtin", id: "dark" } });
    await settle();
    oldAcknowledgement();
    await settle();
    expect(root.dataset.appTheme).toBe("dark");
    expect(root.style.getPropertyValue("--surface-main")).toBe("#1b1b1d");
    stop();
  });

  it("retires an outstanding native acknowledgement when the runtime stops", async () => {
    let acknowledge!: () => void;
    const { runtime, root } = setup(() => new Promise<void>((done) => (acknowledge = done)));
    const stop = runtime.start();
    await settle();
    stop();
    acknowledge();
    await settle();
    expect(root.dataset.appTheme).toBeUndefined();
    expect(root.dataset.appearancePending).toBe("");
  });
});
