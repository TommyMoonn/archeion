// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { defaultAppPreferences } from "../../../types/appSettings";
import type { SettingsController } from "../useSettingsController";
import { appearanceSettingsItems } from "./appearanceSettingsItems";

function controller(): SettingsController {
  const preferences = {
    ...defaultAppPreferences,
    appTheme: { kind: "custom" as const, id: "moon-ink" },
    readerTheme: { kind: "custom" as const, id: "moon-ink" },
  };
  return {
    openThemeManager: vi.fn(),
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
    updateAppearance: vi.fn(async () => true),
    updateReader: vi.fn(),
  } as unknown as SettingsController;
}

describe("appearanceSettingsItems", () => {
  it("keeps appearance definitions in one focused registry spread", () => {
    expect(appearanceSettingsItems.map((item) => item.id)).toEqual([
      "reader.theme",
      "appearance.app-themes",
      "appearance.animations",
      "appearance.display-density",
      "appearance.reset-appearance",
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

  it("uses the compact Manage action, app selector, and shared reader selector actions", () => {
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

    const manage = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Manage themes"]',
    )!;
    expect(manage.classList).toContain("settings-theme-control__manage");
    expect(manage.classList).toContain("icon-button--standard");
    expect(manage.textContent).toBe("");
    expect(
      container.querySelector<HTMLButtonElement>('button[aria-label="Open themes folder"]'),
    ).toBeNull();

    const readerSelect = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Reader theme"]',
    )!;
    const appSelect = container.querySelector<HTMLButtonElement>(
      'button[aria-label="App themes"]',
    )!;

    act(() => manage.click());
    act(() => readerSelect.click());
    const lightReader = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Light",
    )!;
    act(() => lightReader.click());
    act(() => appSelect.click());
    const archeionLight = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Archeion Light",
    )!;
    act(() => archeionLight.click());

    expect(context.openThemeManager).toHaveBeenCalledOnce();
    expect(context.refreshThemeCatalog).toHaveBeenCalledTimes(2);
    expect(context.updateAppearance).toHaveBeenNthCalledWith(1, {
      readerTheme: { kind: "builtin", id: "light" },
    });
    expect(context.updateAppearance).toHaveBeenNthCalledWith(2, {
      appTheme: { kind: "builtin", id: "light" },
    });

    act(() => root.unmount());
    container.remove();
  });

  it("keeps global theme management accessible without an active archive", () => {
    const context: SettingsController = {
      ...controller(),
      selectedArchivePath: undefined,
    };
    const appThemes = appearanceSettingsItems.find((item) => item.id === "appearance.app-themes")!;
    const container = document.createElement("div");
    const root = createRoot(container);

    act(() => root.render(appThemes.render(context)));

    const manage = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Manage themes"]',
    )!;
    expect(manage.disabled).toBe(false);

    act(() => root.unmount());
  });

  it("keeps the compact Manage action unavailable while themes load", () => {
    const context: SettingsController = {
      ...controller(),
      themeCatalogLoading: true,
    };
    const appThemes = appearanceSettingsItems.find((item) => item.id === "appearance.app-themes")!;
    const container = document.createElement("div");
    const root = createRoot(container);

    act(() => root.render(appThemes.render(context)));

    const manage = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Manage themes"]',
    )!;
    expect(manage.getAttribute("aria-disabled")).toBe("true");
    expect(container.textContent).toContain("Themes are loading.");
    act(() => manage.click());
    expect(context.openThemeManager).not.toHaveBeenCalled();

    act(() => root.unmount());
  });
});
