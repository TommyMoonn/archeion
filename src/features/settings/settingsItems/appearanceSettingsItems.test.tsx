// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
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
    openThemesFolder: vi.fn(async () => true),
    preferences,
    refreshThemeCatalog: vi.fn(async () => true),
    reader: preferences.reader,
    selectedArchivePath: "D:\\Archive",
    themeCatalogLoading: false,
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
      "appearance.app-themes",
      "appearance.animations",
      "appearance.display-density",
      "appearance.remember-window-state",
      "appearance.reset-appearance",
      "appearance.reset-window",
    ]);
  });

  it("presents one application and one reader theme selector without fallback language", () => {
    const context = controller();
    const readerTheme = appearanceSettingsItems.find((item) => item.id === "reader.theme")!;
    const appThemes = appearanceSettingsItems.find((item) => item.id === "appearance.app-themes")!;

    const markup = renderToStaticMarkup(
      <>
        {readerTheme.render(context)}
        {appThemes.render(context)}
      </>,
    );

    expect(markup).toContain("Reader theme");
    expect(markup).toContain("App themes");
    expect(markup).toContain("Choose the theme used across Archeion.");
    expect(markup).toContain("Moon Ink");
    expect(markup).not.toMatch(/fallback|override|inherit/i);
  });

  it("uses the folder, Manage, app selector, and shared reader selector actions", () => {
    const context = controller();
    const readerTheme = appearanceSettingsItems.find((item) => item.id === "reader.theme")!;
    const appThemes = appearanceSettingsItems.find((item) => item.id === "appearance.app-themes")!;
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <>
          {readerTheme.render(context)}
          {appThemes.render(context)}
        </>,
      );
    });

    const folder = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open themes folder"]',
    )!;
    const manage = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Manage themes",
    )!;
    expect(manage.classList).toContain("settings-theme-control__manage");
    expect(manage.classList).toContain("button--standard");

    const readerSelect = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Reader theme"]',
    )!;
    const appSelect = container.querySelector<HTMLButtonElement>(
      'button[aria-label="App themes"]',
    )!;

    act(() => folder.click());
    act(() => manage.click());
    act(() => readerSelect.click());
    const customReader = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Moon Ink",
    )!;
    act(() => customReader.click());
    act(() => appSelect.click());
    const archeionLight = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Archeion Light",
    )!;
    act(() => archeionLight.click());

    expect(context.openThemesFolder).toHaveBeenCalledOnce();
    expect(context.openThemeManager).toHaveBeenCalledOnce();
    expect(context.refreshThemeCatalog).toHaveBeenCalledTimes(2);
    expect(context.updateArchiveAppearance).toHaveBeenNthCalledWith(1, {
      readerTheme: { kind: "custom", id: "moon-ink" },
    });
    expect(context.updateArchiveAppearance).toHaveBeenNthCalledWith(2, {
      appTheme: { kind: "builtin", id: "light" },
    });

    act(() => root.unmount());
    container.remove();
  });

  it("keeps global theme storage accessible without an active archive", () => {
    const context: SettingsDialogController = {
      ...controller(),
      archiveAppearance: null,
      selectedArchivePath: undefined,
    };
    const appThemes = appearanceSettingsItems.find((item) => item.id === "appearance.app-themes")!;
    const container = document.createElement("div");
    const root = createRoot(container);

    act(() => root.render(appThemes.render(context)));

    const folder = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Open themes folder"]',
    )!;
    const manage = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Manage themes",
    )!;
    expect(folder.disabled).toBe(false);
    expect(manage.disabled).toBe(true);

    act(() => root.unmount());
  });
});
