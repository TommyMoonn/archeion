// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { defaultAppPreferences } from "../../../types/appSettings";
import type { SettingsController } from "../useSettingsController";
import { appearanceSettingsItems } from "./appearanceSettingsItems";

const fontRenders: Array<{ root: Root; container: HTMLDivElement }> = [];
afterEach(() => {
  act(() =>
    fontRenders.splice(0).forEach(({ root, container }) => {
      root.unmount();
      container.remove();
    }),
  );
});

function renderFontRole(
  id: "appearance.interface-font" | "appearance.display-font",
  context = controller(),
) {
  const item = appearanceSettingsItems.find((candidate) => candidate.id === id)!;
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  fontRenders.push({ root, container });
  act(() => root.render(item.render(context)));
  const trigger = () => container.querySelector<HTMLButtonElement>(".app-select__trigger")!;
  const options = () =>
    Array.from(container.querySelectorAll<HTMLButtonElement>('[role="option"]'));
  const open = () => act(() => trigger().click());
  const query = (value: string) =>
    act(() => {
      const input = container.querySelector<HTMLInputElement>('input[role="combobox"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  return { container, context, open, options, query, root, trigger };
}

function controller(): SettingsController {
  const preferences = {
    ...defaultAppPreferences,
    appTheme: { kind: "custom" as const, id: "moon-ink" },
    readerTheme: { kind: "custom" as const, id: "moon-ink" },
  };
  return {
    installedFontFamilies: ["Zulu", "Arial", "Georgia"],
    installedFontsLoading: false,
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
  it.each([
    ["appearance.interface-font", ["Inter (Default)", "Arial", "Georgia", "Zulu"]],
    [
      "appearance.display-font",
      ["Use interface font", "Archeion Default", "Arial", "Georgia", "Zulu"],
    ],
  ] as const)("%s places pinned entries before plain sorted installed families", (id, expected) => {
    const rendered = renderFontRole(id);
    rendered.open();
    expect(rendered.options().map((option) => option.textContent)).toEqual(expected);
    expect(rendered.container.querySelector("h3")).toBeNull();
    expect(rendered.container.textContent).not.toMatch(/font source|category|preview|advanced/i);
    expect(rendered.context.updateAppPreferences).not.toHaveBeenCalled();
  });

  it.each(["appearance.interface-font", "appearance.display-font"] as const)(
    "%s searches installed and pinned labels, then persists a system choice immediately",
    (id) => {
      const rendered = renderFontRole(id);
      rendered.open();
      rendered.query(id === "appearance.interface-font" ? "inter" : "Archeion");
      expect(rendered.options().map((option) => option.textContent)).toEqual([
        id === "appearance.interface-font" ? "Inter (Default)" : "Archeion Default",
      ]);
      rendered.query("aRiAl");
      expect(rendered.options().map((option) => option.textContent)).toEqual(["Arial"]);
      act(() => rendered.options()[0].click());
      expect(rendered.context.updateAppPreferences).toHaveBeenCalledOnce();
      expect(rendered.context.updateAppPreferences).toHaveBeenCalledWith({
        appearance:
          id === "appearance.interface-font"
            ? { interfaceFont: { kind: "system", family: "Arial" } }
            : { displayFont: { kind: "system", family: "Arial" } },
      });
      expect(rendered.container.querySelector('[role="listbox"]')).toBeNull();
    },
  );

  it("maps both Display pinned entries to their persisted semantic kinds", () => {
    const rendered = renderFontRole("appearance.display-font");
    rendered.open();
    act(() => rendered.options()[0].click());
    rendered.open();
    act(() => rendered.options()[1].click());
    expect(rendered.context.updateAppPreferences).toHaveBeenNthCalledWith(1, {
      appearance: { displayFont: { kind: "interface" } },
    });
    expect(rendered.context.updateAppPreferences).toHaveBeenNthCalledWith(2, {
      appearance: { displayFont: { kind: "default" } },
    });
  });

  it.each(["appearance.interface-font", "appearance.display-font"] as const)(
    "%s retains unavailable context without changing preferences on open",
    (id) => {
      const context = controller();
      context.preferences = {
        ...context.preferences,
        appearance: {
          ...context.preferences.appearance,
          interfaceFont: { kind: "system", family: "Missing UI" },
          displayFont: { kind: "system", family: "Missing Display" },
        },
      };
      const rendered = renderFontRole(id, context);
      const name = id === "appearance.interface-font" ? "Missing UI" : "Missing Display";
      expect(rendered.trigger().textContent).toBe(`${name} (Unavailable)`);
      rendered.open();
      const unavailable = rendered
        .options()
        .find((option) => option.textContent === `${name} (Unavailable)`)!;
      expect(unavailable.disabled).toBe(true);
      expect(unavailable.getAttribute("aria-selected")).toBe("true");
      expect(context.updateAppPreferences).not.toHaveBeenCalled();
      expect(context.preferences.appearance.interfaceFont).toEqual({
        kind: "system",
        family: "Missing UI",
      });
      expect(context.preferences.appearance.displayFont).toEqual({
        kind: "system",
        family: "Missing Display",
      });
    },
  );
  it("keeps appearance definitions in one focused registry spread", () => {
    expect(appearanceSettingsItems.map((item) => item.id)).toEqual([
      "reader.theme",
      "appearance.app-themes",
      "appearance.interface-font",
      "appearance.display-font",
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
