import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

function readJson<T>(relativePath: string): T {
  return JSON.parse(read(relativePath)) as T;
}

function rustStringConstant(source: string, name: string): string {
  const match = source.match(
    new RegExp(`\\b(?:pub\\s+)?const\\s+${name}:\\s*&str\\s*=\\s*"([^"]+)";`),
  );
  if (!match) throw new Error(`Rust string constant not found: ${name}`);
  return match[1];
}

type Capability = {
  permissions: string[];
  windows: string[];
};

function expectPermissions(capability: Capability, permissions: string[]): void {
  expect(new Set(capability.permissions)).toEqual(new Set(permissions));
}

function expectWindowScope(capability: Capability, labels: string[]): void {
  expect(new Set(capability.windows)).toEqual(new Set(labels));
}

const archiveCommands = read("src-tauri/src/commands/archive.rs");
const managedWindowCommands = read("src-tauri/src/commands/window/mod.rs");
const windowLabels = {
  about: rustStringConstant(managedWindowCommands, "ABOUT_WINDOW_LABEL"),
  archiveManager: rustStringConstant(archiveCommands, "ARCHIVE_MANAGER_WINDOW_LABEL"),
  main: rustStringConstant(archiveCommands, "MAIN_WINDOW_LABEL"),
  settings: rustStringConstant(managedWindowCommands, "SETTINGS_WINDOW_LABEL"),
  themeManager: rustStringConstant(managedWindowCommands, "THEME_MANAGER_WINDOW_LABEL"),
};

describe("Native window runtime contracts", () => {
  it("keeps the main window frameless, resizable, and bounded", () => {
    const config = readJson<{
      app: {
        windows: Array<{
          closable?: boolean;
          decorations?: boolean;
          height?: number;
          maximizable?: boolean;
          minimizable?: boolean;
          minHeight?: number;
          minWidth?: number;
          resizable?: boolean;
          visible?: boolean;
          width?: number;
        }>;
      };
    }>("src-tauri/tauri.conf.json");

    expect(config.app.windows).toHaveLength(1);
    expect(config.app.windows[0]).toMatchObject({
      closable: true,
      decorations: false,
      height: 800,
      maximizable: true,
      minimizable: true,
      minHeight: 600,
      minWidth: 900,
      resizable: true,
      visible: false,
      width: 1280,
    });
  });

  it("keeps Archive Manager fixed, frameless, and non-maximizable", () => {
    for (const requirement of [
      ".inner_size(ARCHIVE_MANAGER_WIDTH, ARCHIVE_MANAGER_HEIGHT)",
      ".min_inner_size(ARCHIVE_MANAGER_WIDTH, ARCHIVE_MANAGER_HEIGHT)",
      ".max_inner_size(ARCHIVE_MANAGER_WIDTH, ARCHIVE_MANAGER_HEIGHT)",
      ".resizable(false)",
      ".minimizable(true)",
      ".maximizable(false)",
      ".decorations(false)",
      ".closable(true)",
    ]) {
      expect(archiveCommands).toContain(requirement);
    }
  });

  it("keeps capability scopes bound to the native window labels", () => {
    expect(windowLabels).toEqual({
      about: "about",
      archiveManager: "archive-manager",
      main: "main",
      settings: "settings",
      themeManager: "theme-manager",
    });
  });

  it("scopes About to its required window and event controls", () => {
    const about = readJson<Capability>("src-tauri/capabilities/about-window.json");

    expectWindowScope(about, [windowLabels.about]);
    expectPermissions(about, [
      "core:default",
      "core:event:allow-listen",
      "core:event:allow-unlisten",
      "core:window:allow-close",
      "core:window:allow-minimize",
      "core:window:allow-start-dragging",
    ]);
  });

  it("grants shared main and Archive Manager permissions required by their window lifecycle", () => {
    const shared = readJson<Capability>("src-tauri/capabilities/default.json");

    expectWindowScope(shared, [windowLabels.main, windowLabels.archiveManager]);
    expectPermissions(shared, [
      "core:default",
      "core:window:allow-close",
      "core:window:allow-destroy",
      "core:window:allow-minimize",
      "core:window:allow-start-dragging",
      "core:event:allow-listen",
      "core:event:allow-unlisten",
      "dialog:allow-open",
      "dialog:allow-save",
    ]);
  });

  it("scopes main-window geometry permissions to the main window", () => {
    const main = readJson<Capability>("src-tauri/capabilities/main-window-state.json");

    expectWindowScope(main, [windowLabels.main]);
    expectPermissions(main, [
      "core:window:allow-available-monitors",
      "core:window:allow-hide",
      "core:window:allow-is-maximized",
      "core:window:allow-maximize",
      "core:window:allow-outer-position",
      "core:window:allow-outer-size",
      "core:window:allow-set-position",
      "core:window:allow-set-size",
      "core:window:allow-toggle-maximize",
    ]);
  });

  it("scopes the Settings picker and window controls to the Settings window", () => {
    const settings = readJson<Capability>("src-tauri/capabilities/settings-window.json");

    expectWindowScope(settings, [windowLabels.settings]);
    expectPermissions(settings, [
      "core:default",
      "core:window:allow-close",
      "core:window:allow-minimize",
      "core:window:allow-start-dragging",
      "core:window:allow-toggle-maximize",
      "core:event:allow-listen",
      "core:event:allow-unlisten",
      "dialog:allow-open",
    ]);
  });

  it("scopes Theme Manager window controls without granting dialog access", () => {
    const themeManager = readJson<Capability>("src-tauri/capabilities/theme-manager-window.json");

    expectWindowScope(themeManager, [windowLabels.themeManager]);
    expectPermissions(themeManager, [
      "core:default",
      "core:event:allow-listen",
      "core:event:allow-unlisten",
      "core:window:allow-close",
      "core:window:allow-minimize",
      "core:window:allow-start-dragging",
      "core:window:allow-toggle-maximize",
    ]);
  });
});
