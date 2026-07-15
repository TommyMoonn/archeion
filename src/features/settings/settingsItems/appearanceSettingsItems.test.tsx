import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { defaultAppPreferences } from "../../../types/appSettings";
import type { SettingsDialogController } from "../useSettingsDialogController";
import { appearanceSettingsItems } from "./appearanceSettingsItems";

function controller(): SettingsDialogController {
  const preferences = defaultAppPreferences;
  return {
    archiveAppearance: {
      appTheme: { kind: "custom", id: "moon-ink" },
      readerTheme: { kind: "inherit" },
    },
    openThemeManager: vi.fn(),
    preferences,
    reader: preferences.reader,
    selectedArchivePath: "D:\\Archive",
    themeCatalogEntries: [
      {
        applicable: true,
        capabilities: { application: true, reader: true },
        diagnostics: [],
        id: "moon-ink",
        manifest: {
          schemaVersion: 1,
          id: "moon-ink",
          name: "Moon Ink",
          base: "dark",
          app: { accent: "#8fc1e3" },
          reader: { base: "sepia", link: "#765b34" },
        },
        name: "Moon Ink",
        origin: "custom",
        packageId: "moon-ink",
        status: "valid",
      },
    ],
    updateAppPreferences: vi.fn(async () => true),
    updateArchiveAppearance: vi.fn(async () => true),
    updateReader: vi.fn(),
  } as unknown as SettingsDialogController;
}

describe("appearanceSettingsItems", () => {
  it("keeps appearance definitions in one focused registry spread", () => {
    expect(appearanceSettingsItems.map((item) => item.id)).toEqual([
      "reader.theme",
      "reader.archive-theme",
      "appearance.app-theme-preset",
      "appearance.animations",
      "appearance.display-density",
      "appearance.archive-app-theme",
      "appearance.manage-archive-themes",
      "appearance.window-frame-style",
      "appearance.remember-window-state",
      "appearance.reset-appearance",
      "appearance.reset-window",
    ]);
  });

  it("presents archive selections and explains global fallback ownership", () => {
    const context = controller();
    const readerDefault = appearanceSettingsItems.find((item) => item.id === "reader.theme")!;
    const readerArchive = appearanceSettingsItems.find(
      (item) => item.id === "reader.archive-theme",
    )!;
    const appDefault = appearanceSettingsItems.find(
      (item) => item.id === "appearance.app-theme-preset",
    )!;
    const appArchive = appearanceSettingsItems.find(
      (item) => item.id === "appearance.archive-app-theme",
    )!;

    const markup = renderToStaticMarkup(
      <>
        {readerDefault.render(context)}
        {readerArchive.render(context)}
        {appDefault.render(context)}
        {appArchive.render(context)}
      </>,
    );

    expect(markup).toContain("active archive uses this default");
    expect(markup).toContain("active archive currently overrides this default");
    expect(markup).toContain("Use reader default");
    expect(markup).toContain("Moon Ink");
  });
});
