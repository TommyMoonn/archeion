// @vitest-environment happy-dom

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import palettes from "./appShellPalettes.json" with { type: "json" };

const source = readFileSync("public/appearance-prepaint.js", "utf8");
const root = document.documentElement;
const snapshot = {
  schemaVersion: 1,
  settingsRevision: 3,
  selection: { kind: "system" },
  base: "dark",
  ...palettes.dark,
  ...palettes,
};
function run(value: unknown) {
  Object.assign(window, { __ARCHEION_APPEARANCE_PREPAINT__: value });
  window.eval(source);
}
beforeEach(() => {
  root.setAttribute("data-appearance-pending", "");
  root.removeAttribute("style");
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn() }));
});
afterEach(() => {
  root.removeAttribute("data-appearance-pending");
  root.removeAttribute("style");
  vi.unstubAllGlobals();
});

describe("read-only prepaint bootstrap", () => {
  it.each([
    { ...snapshot, schemaVersion: 2 },
    { ...snapshot, settingsRevision: -1 },
    { ...snapshot, background: "url(https://invalid.test)" },
    { ...snapshot, base: "invalid" },
    { ...snapshot, selection: { kind: "unknown" } },
  ])("rejects malformed presentation without applying tokens", (value) => {
    run(value);
    expect(root.style.length).toBe(0);
  });

  it("follows system changes only until authoritative token handoff", async () => {
    let change!: () => void;
    const media = {
      matches: false,
      addEventListener: (_: string, callback: () => void) => (change = callback),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("matchMedia", () => media);
    run(snapshot);
    expect(root.style.getPropertyValue("--appearance-startup-background")).toBe(
      palettes.dark.background,
    );
    media.matches = true;
    change();
    expect(root.style.getPropertyValue("--appearance-startup-background")).toBe(
      palettes.light.background,
    );
    root.removeAttribute("data-appearance-pending");
    root.style.setProperty("--surface-main", "#123456");
    media.matches = false;
    change();
    await new Promise((done) => setTimeout(done, 0));
    expect(root.style.getPropertyValue("--surface-main")).toBe("#123456");
    expect(root.style.getPropertyValue("--appearance-startup-background")).toBe(
      palettes.light.background,
    );
    expect(media.removeEventListener).toHaveBeenCalledWith("change", change);
  });
});
