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

function collectProductionSource(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectProductionSource(entryPath);
    if (!entry.isFile() || !/\.(?:ts|tsx)$/.test(entry.name) || /\.test\./.test(entry.name)) {
      return [];
    }
    return [entryPath];
  });
}

describe("single frameless window contract", () => {
  it("keeps frame-style configuration out of the supported frontend model", () => {
    const source = collectProductionSource(path.join(projectRoot, "src"))
      .map((filePath) => fs.readFileSync(filePath, "utf8"))
      .join("\n");

    expect(source).not.toMatch(
      /\b(?:WindowFrameStyle|windowFrameStyle|useWindowFrameStylePreference|frameOptions|setDecorations)\b/,
    );
    expect(read("src/features/settings/settingsItems/appearanceSettingsItems.tsx")).not.toMatch(
      /window frame|native frame|hidden frame/i,
    );
  });

  it("creates both native windows undecorated without exposing decoration switching", () => {
    const config = readJson<{
      app: {
        windows: Array<{
          closable?: boolean;
          decorations?: boolean;
          maximizable?: boolean;
          minimizable?: boolean;
        }>;
      };
    }>("src-tauri/tauri.conf.json");
    const archiveCommands = read("src-tauri/src/commands/archive.rs");
    const sharedCapabilities = readJson<{ permissions: string[] }>(
      "src-tauri/capabilities/default.json",
    );
    const mainCapabilities = readJson<{ permissions: string[] }>(
      "src-tauri/capabilities/main-window-state.json",
    );

    expect(config.app.windows).not.toHaveLength(0);
    expect(config.app.windows.every((window) => window.decorations === false)).toBe(true);
    expect(config.app.windows[0]).toMatchObject({
      closable: true,
      maximizable: true,
      minimizable: true,
    });
    expect(archiveCommands).toMatch(
      /WebviewWindowBuilder::new\([\s\S]*?\.minimizable\(true\)[\s\S]*?\.maximizable\(false\)[\s\S]*?\.decorations\(false\)[\s\S]*?\.closable\(true\)/,
    );
    expect(sharedCapabilities.permissions).not.toContain("core:window:allow-set-decorations");
    expect(sharedCapabilities.permissions).not.toContain("core:window:allow-toggle-maximize");
    expect(mainCapabilities.permissions).toContain("core:window:allow-toggle-maximize");
  });

  it("uses one fixed titlebar composition without selectable render branches", () => {
    const app = read("src/app/App.tsx");
    const titlebar = read("src/components/WindowTitlebar.tsx");
    const styles = read("src/styles/layout/window-frame.css");

    expect(app).toContain("<WindowTitlebar canMaximize={false} />");
    expect(app.match(/<WindowTitlebar canMaximize \/>/g)).toHaveLength(2);
    expect(titlebar).toContain("if (!isTauri())");
    expect(titlebar).toContain("data-tauri-drag-region");
    expect(titlebar).not.toMatch(/\bonDoubleClick\s*=/);
    expect(titlebar.match(/appWindow\.toggleMaximize\(\)/g)).toHaveLength(1);
    expect(titlebar).not.toMatch(/data-mode|setDecorations|window frame style/i);
    expect(titlebar).not.toMatch(/archeion-icon|window-titlebar__identity/);
    expect(styles).toMatch(
      /\.window-titlebar__controls button\s*\{[^}]*height:\s*var\(--window-titlebar-height\);/s,
    );
    expect(styles).not.toMatch(/\[data-mode=|window-titlebar__identity|window-titlebar__icon/);
  });
});
