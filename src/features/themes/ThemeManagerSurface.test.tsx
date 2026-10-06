// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GlobalAppearancePreferences } from "../../themes/AppearanceRuntime";
import { ThemeCatalog } from "../../themes/ThemeCatalog";
import * as themeResolution from "../../themes/resolveTheme";
import type { ResolvedAppTheme } from "../../themes/domain";
import { shellStressThemes } from "../../../tests/fixtures/themes/shellStressThemes";
import { ThemeManagerSurface } from "./ThemeManagerSurface";
import type { ThemeManagerControllerOptions } from "./useThemeManagerController";

const customManifest = {
  schemaVersion: 1 as const,
  id: "moon-ink",
  name: "Moon Ink",
  base: "dark" as const,
  app: { accent: "#8fc1e3" as const },
};

function createServices(
  packages: Readonly<Record<string, string | Error>> = {
    "moon-ink": JSON.stringify(customManifest),
  },
) {
  const catalog = new ThemeCatalog(() => ({
    listPackageDirectories: vi.fn(async () => Object.keys(packages)),
    readManifest: vi.fn(async (id: string) => {
      const source = packages[id];
      if (source instanceof Error) throw source;
      if (source === undefined) throw new Error("Missing fixture package.");
      return source;
    }),
  }));
  const settings: GlobalAppearancePreferences = {
    appTheme: { kind: "builtin", id: "dark" },
    readerTheme: { kind: "builtin", id: "sepia" },
  };
  const appearanceContext = { settings };
  const runtime = {
    getPreviewContext: () => appearanceContext,
    refreshAppearance: vi.fn(async () => {
      await catalog.refreshPackages();
    }),
    subscribe: () => () => undefined,
    updateAppearanceSettings: vi.fn(async () => settings),
  } satisfies ThemeManagerControllerOptions["runtime"];
  return {
    catalog,
    repository: {
      deletePackage: vi.fn(async () => ({ revision: 1 })),
      replaceManifest: vi.fn(async () => ({ revision: 1 })),
      revealThemesRoot: vi.fn(async () => undefined),
      storeManifest: vi.fn(async () => ({ revision: 1 })),
    },
    runtime,
  };
}

function button(scope: Element, label: string): HTMLButtonElement {
  const match = [...scope.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.trim().startsWith(label),
  );
  if (!match) throw new Error(`Button not found: ${label}`);
  return match;
}

async function settle() {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

function expectShellPreview(container: HTMLElement, app: ResolvedAppTheme) {
  const graphic = container.querySelector<HTMLElement>('.theme-shell-preview__graphic[role="img"]');
  expect(graphic).not.toBeNull();
  expect(document.getElementById(graphic!.getAttribute("aria-labelledby")!)?.textContent).toBe(
    "Application shell preview",
  );
  expect(
    document.getElementById(graphic!.getAttribute("aria-describedby")!)?.textContent,
  ).toContain("navigation and workspace");
  for (const role of [
    "canvas",
    "frame",
    "sidebar",
    "main",
    "surfaceRaised",
    "lineSubtle",
    "text",
    "textStrong",
    "muted",
    "accent",
  ] as const) {
    const variable = role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
    expect(graphic!.style.getPropertyValue(`--theme-shell-${variable}`), role).toBe(
      app.tokens[role],
    );
  }
  expect(graphic!.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  expect(graphic!.querySelector("button, a, input, [tabindex], nav, main, header")).toBeNull();
  const compact = container.querySelector<HTMLElement>(
    '.theme-catalog-list__item[aria-current="true"] [data-preview-size="compact"]',
  );
  expect(compact).not.toBeNull();
  expect(compact!.getAttribute("style")).toBe(graphic!.getAttribute("style"));
  expect(container.querySelector(".theme-details__swatches")?.textContent).toContain("Main");
  expect(container.querySelector(".theme-details__swatches")?.textContent).toContain("Accent");
  expect(container.querySelector(".theme-details__swatches")?.textContent).toContain("Text");
}

describe("ThemeManagerSurface preview ownership", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    document.documentElement.removeAttribute("style");
    vi.restoreAllMocks();
  });

  it("keeps preview state within the manager surface that started it", async () => {
    const services = createServices();
    await act(async () =>
      root.render(
        <>
          <ThemeManagerSurface services={services} />
          <ThemeManagerSurface services={services} />
        </>,
      ),
    );
    await settle();

    const surfaces = container.querySelectorAll(".theme-manager-surface");
    act(() => button(surfaces[0]!, "Moon Ink").click());
    act(() => button(surfaces[0]!, "Preview").click());

    expect(surfaces[0]?.querySelector(".theme-preview-controls")).not.toBeNull();
    expect(surfaces[1]?.querySelector(".theme-preview-controls")).toBeNull();
  });

  it.each(["dark", "light"] as const)(
    "shows the resolved %s built-in shell without starting a temporary preview",
    async (base) => {
      const services = createServices();
      await act(async () => root.render(<ThemeManagerSurface services={services} />));
      await settle();
      const beforeStyle = document.documentElement.getAttribute("style");
      act(() => button(container, base === "dark" ? "Archeion Dark" : "Archeion Light").click());
      expectShellPreview(container, themeResolution.resolveBuiltInAppTheme(base));
      expect(document.documentElement.getAttribute("style")).toBe(beforeStyle);
      expect(container.querySelector(".theme-preview-controls")).toBeNull();
      expect(services.runtime.updateAppearanceSettings).not.toHaveBeenCalled();
    },
  );

  it.each(Object.values(shellStressThemes))(
    "shows resolved custom shell $id without normalizing or applying it",
    async (manifest) => {
      const services = createServices({ [manifest.id]: JSON.stringify(manifest) });
      await act(async () => root.render(<ThemeManagerSurface services={services} />));
      await settle();
      const beforeStyle = document.documentElement.getAttribute("style");
      act(() => button(container, manifest.name).click());
      expectShellPreview(container, themeResolution.resolveTheme(manifest).app);
      expect(document.documentElement.getAttribute("style")).toBe(beforeStyle);
      expect(container.querySelector(".theme-preview-controls")).toBeNull();
      expect(services.runtime.updateAppearanceSettings).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["invalid", JSON.stringify({ ...customManifest, app: { accent: "invalid" } })],
    ["unavailable", new Error("Package is unreadable.")],
  ] as const)("does not resolve a shell for an %s package", async (_status, source) => {
    const resolve = vi.spyOn(themeResolution, "resolveTheme");
    const services = createServices({ "moon-ink": source });
    await act(async () => root.render(<ThemeManagerSurface services={services} />));
    await settle();
    act(() => button(container, "moon-ink").click());
    expect(container.querySelector(".theme-details__diagnostics")).not.toBeNull();
    expect(container.querySelector(".theme-shell-preview")).toBeNull();
    expect(container.querySelector(".theme-details__swatches")).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
  });

  it("refreshes the selected shell from reloaded packages and removes it when the package becomes invalid", async () => {
    const packages = { "moon-ink": JSON.stringify(customManifest) };
    const services = createServices(packages);
    await act(async () => root.render(<ThemeManagerSurface services={services} />));
    await settle();
    act(() => button(container, "Moon Ink").click());
    const revised = { ...customManifest, app: { main: "#303030" as const } };
    packages["moon-ink"] = JSON.stringify(revised);
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Reload themes"]')!.click());
    await settle();
    expectShellPreview(container, themeResolution.resolveTheme(revised).app);
    packages["moon-ink"] = JSON.stringify({ ...revised, schemaVersion: 2 });
    act(() => container.querySelector<HTMLButtonElement>('[aria-label="Reload themes"]')!.click());
    await settle();
    expect(container.querySelector(".theme-shell-preview")).toBeNull();
    expect(container.querySelector(".theme-details__diagnostics")).not.toBeNull();
  });
});
