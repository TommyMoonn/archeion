// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GlobalAppearancePreferences } from "../../themes/AppearanceRuntime";
import { ThemeCatalog } from "../../themes/ThemeCatalog";
import { ThemeManagerSurface } from "./ThemeManagerSurface";
import type { ThemeManagerControllerOptions } from "./useThemeManagerController";

const customManifest = {
  schemaVersion: 1 as const,
  id: "moon-ink",
  name: "Moon Ink",
  base: "dark" as const,
  app: { accent: "#8fc1e3" as const },
};

function createServices() {
  const catalog = new ThemeCatalog(() => ({
    listPackageDirectories: vi.fn(async () => ["moon-ink"]),
    readManifest: vi.fn(async () => JSON.stringify(customManifest)),
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
});
