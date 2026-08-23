import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

const projectRoot = process.cwd();

function source(relativePath: string): string {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

describe("Phase 0.5.0.11 legacy theme removal", () => {
  it("keeps the production preview boundary application-only", () => {
    const runtime = source("src/themes/AppearanceRuntime.ts");
    const runtimeTests = source("src/themes/AppearanceRuntime.test.ts");

    expect(runtime).toContain("applyPreview(appTheme: ResolvedAppTheme)");
    expect(runtime).not.toContain("AppearancePreviewPalette");
    expect(runtime).not.toContain("preview.reader");
    expect(runtimeTests).not.toContain("reader-only preview");
    expect(runtimeTests).not.toMatch(/applyPreview\([^\n]+\{\s*reader:/);
    expect(runtimeTests).not.toMatch(/applyPreview\([^\n]+\{\s*app:[^}]+reader:/);
  });

  it("keeps manual Settings synchronization and close-time catalog refresh removed", () => {
    const managerController = source("src/features/themes/useThemeManagerController.ts");
    const managerDialog = source("src/features/themes/ThemeManagerDialog.tsx");
    const settingsDialog = source("src/features/settings/SettingsDialog.tsx");
    const settingsController = source("src/features/settings/useSettingsDialogController.ts");
    const catalogHook = source("src/features/themes/useThemeCatalogEntries.ts");

    for (const productionSource of [managerController, managerDialog]) {
      expect(productionSource).not.toContain("onAppearanceChanged");
    }
    expect(settingsDialog).toContain("refreshThemeCatalog: themeCatalog.refresh");
    expect(settingsDialog).toContain("onClose={() => setThemeManagerOpen(false)}");
    expect(settingsDialog).not.toMatch(/onClose=\{\(\) =>\s*\{[^}]*themeCatalog\.refresh/s);
    expect(settingsController).not.toContain("themeCatalogError");
    expect(catalogHook).toContain("appearanceRuntime.refreshAppearance()");
    expect(catalogHook).not.toContain("onAppearanceChanged");
  });

  it("keeps removed starter and package-reveal paths absent", () => {
    expect(
      fs.existsSync(path.join(projectRoot, "src/features/themes/CreateStarterThemePanel.tsx")),
    ).toBe(false);
    expect(fs.existsSync(path.join(projectRoot, "src/themes/starterTheme.ts"))).toBe(false);

    const nativeCommands = source("src-tauri/src/commands/themes.rs");
    const invokeHandler = source("src-tauri/src/lib.rs");
    const repository = source("src/themes/ThemeRepository.ts");
    for (const productionSource of [nativeCommands, invokeHandler, repository]) {
      expect(productionSource).not.toContain("create_archive_theme_starter");
      expect(productionSource).not.toContain("reveal_archive_theme_package");
    }
  });

  it("documents the real examples path without reader-manager or starter instructions", () => {
    const guidePath = path.join(projectRoot, "docs/custom-themes.md");
    const guide = fs.readFileSync(guidePath, "utf8");

    expect(guide).toContain("[examples](examples/themes/)");
    expect(fs.existsSync(path.resolve(path.dirname(guidePath), "examples/themes"))).toBe(true);
    expect(guide).not.toMatch(/create starter|starter button/i);
    expect(guide).not.toMatch(/Theme Manager[^\n]*(preview|appl)[^\n]*reader/i);
  });
});
