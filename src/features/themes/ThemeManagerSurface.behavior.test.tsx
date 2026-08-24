// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GlobalAppearancePreferences } from "../../themes/AppearanceRuntime";
import { ThemeCatalog } from "../../themes/ThemeCatalog";
import { resolveBuiltInAppTheme, resolveBuiltInReaderTheme } from "../../themes/resolveTheme";
import { ThemePreviewSession } from "../../themes/ThemePreviewSession";
import { ThemeManagerSurface } from "./ThemeManagerSurface";
import type { ThemeManagerControllerOptions } from "./useThemeManagerController";

const customManifest = {
  schemaVersion: 1 as const,
  id: "moon-ink",
  name: "Moon Ink",
  base: "dark" as const,
  app: { accent: "#8fc1e3" as const },
  reader: { base: "sepia" as const, link: "#765b34" as const },
};

type DialogElementWithOpen = HTMLDialogElement & { open: boolean };

function installDialogPolyfill() {
  HTMLDialogElement.prototype.showModal = function showModal() {
    (this as DialogElementWithOpen).open = true;
  };
  HTMLDialogElement.prototype.close = function close() {
    (this as DialogElementWithOpen).open = false;
  };
}

function createServices() {
  const catalog = new ThemeCatalog(() => ({
    listPackageDirectories: vi.fn(async () => ["moon-ink"]),
    readManifest: vi.fn(async () => JSON.stringify(customManifest)),
  }));
  let settings: GlobalAppearancePreferences = {
    appTheme: { kind: "custom", id: "moon-ink" },
    readerTheme: { kind: "builtin", id: "sepia" },
  };
  let appearanceContext = { settings };
  const runtimeListeners = new Set<() => void>();
  const clearPreview = vi.fn(() => true);
  const runtime = {
    getPreviewContext: () => appearanceContext,
    refreshAppearance: vi.fn(async () => {
      await catalog.refreshPackages();
    }),
    subscribe: (listener: () => void) => {
      runtimeListeners.add(listener);
      return () => runtimeListeners.delete(listener);
    },
    updateAppearanceSettings: vi.fn(
      async (changes: Pick<GlobalAppearancePreferences, "appTheme">) => {
        settings = { ...settings, ...changes };
        appearanceContext = { settings };
        return settings;
      },
    ),
  } satisfies ThemeManagerControllerOptions["runtime"];
  const previewSession = new ThemePreviewSession({
    applyPreview: vi.fn(() => true),
    clearPreview,
    getPreviewContext: runtime.getPreviewContext,
    getSnapshot: () => ({
      app: resolveBuiltInAppTheme("dark"),
      reader: resolveBuiltInReaderTheme("sepia"),
    }),
    keepPreview: vi.fn(async () => undefined),
    subscribe: (listener) => {
      runtimeListeners.add(listener);
      return () => runtimeListeners.delete(listener);
    },
  });
  let catalogRevision = 0;
  const nextCatalogRevision = () => ({ revision: (catalogRevision += 1) });
  return {
    catalog,
    clearPreview,
    previewSession,
    repository: {
      deletePackage: vi.fn(async () => nextCatalogRevision()),
      replaceManifest: vi.fn(async () => nextCatalogRevision()),
      revealThemesRoot: vi.fn(),
      storeManifest: vi.fn(async () => nextCatalogRevision()),
    },
    runtime,
  };
}

function button(container: HTMLElement, label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find((candidate) =>
    candidate.textContent?.trim().startsWith(label),
  );
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}

async function settle() {
  await act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
  });
}

describe("ThemeManagerSurface behavior", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    installDialogPolyfill();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it("presents the shared app-theme management workflow", async () => {
    const services = createServices();
    await act(async () => root.render(<ThemeManagerSurface services={services} />));
    await settle();

    expect(container.textContent).toContain("Import");
    expect(container.textContent).not.toContain("Import Themes");
    expect(container.querySelector('button[aria-label="Reload themes"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Open themes folder"]')).not.toBeNull();
    expect(
      container.querySelector<HTMLInputElement>('input[type="file"]')?.getAttribute("aria-label"),
    ).toBe("Import theme file");
    expect(container.textContent).toContain("Theme guide");
    expect(container.textContent).toContain("Public schema");
    expect(container.textContent).not.toContain("Browse, preview, and manage application themes.");
    expect(container.querySelector('button[aria-label="Close Theme Manager"]')).toBeNull();
    expect(container.querySelector(".theme-manager-surface h1")?.textContent).toBe("Theme Manager");

    const toolbar = container.querySelector(".theme-manager__toolbar")!;
    const links = toolbar.querySelector(".theme-manager__toolbar-links")!;
    const actions = toolbar.querySelector(".theme-manager__toolbar-actions")!;
    expect(toolbar.firstElementChild).toBe(actions);
    expect(toolbar.lastElementChild).toBe(links);
    expect(actions.firstElementChild?.textContent).toContain("Import");
    expect(links.getAttribute("aria-label")).toBe("Theme resources");
    const catalog = container.querySelector(".theme-catalog-list")!;
    expect(catalog.getAttribute("aria-label")).toBe("Themes");
    expect(container.querySelector(".theme-details h2")?.textContent).toBe("Moon Ink");
    expect(container.textContent).toContain("Archeion Dark");
    expect(container.textContent).toContain("Archeion Light");
    expect(container.textContent).toContain("Moon Ink");
    expect(container.textContent).toContain("Selected");

    act(() => button(container, "Archeion Dark").click());
    expect(container.textContent).toContain(
      "A minimal, intuitive dark theme designed for focused reading.",
    );
    act(() => button(container, "Archeion Light").click());
    expect(container.textContent).toContain(
      "A minimal, intuitive light theme designed for clear daytime reading.",
    );
    expect(button(container, "Use theme").classList).toContain("button--compact");

    expect(container.textContent).not.toMatch(
      /Built in|This archive|Sepia|Create starter|Reader colors|capabilit/i,
    );
    expect(container.querySelector("textarea")).toBeNull();
  });

  it("uses an explicit Update theme confirmation for duplicate imports", async () => {
    const services = createServices();
    await act(async () => root.render(<ThemeManagerSurface services={services} />));
    await settle();

    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const replacement = { ...customManifest, name: "Moon Ink Revised" };
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [
        new File([JSON.stringify(replacement)], "moon-ink.json", {
          type: "application/json",
        }),
      ],
    });
    act(() => input.dispatchEvent(new Event("change", { bubbles: true })));
    await settle();

    const dialogs = container.querySelectorAll("dialog");
    expect(dialogs).toHaveLength(1);
    expect(dialogs[0]?.textContent).toContain("A theme with this ID already exists.");
    expect(button(dialogs[0]!, "Update theme")).not.toBeNull();
    expect(dialogs[0]?.textContent).not.toContain("Replace theme");
    expect(services.repository.replaceManifest).not.toHaveBeenCalled();

    act(() => button(dialogs[0]!, "Update theme").click());
    await settle();
    expect(services.repository.replaceManifest).toHaveBeenCalledWith(replacement);
  });

  it("owns preview controls in the surface and reverts them on unmount", async () => {
    const services = createServices();
    await act(async () => root.render(<ThemeManagerSurface services={services} />));
    await settle();

    const readerSelection = services.runtime.getPreviewContext()?.settings.readerTheme;
    act(() => button(container, "Moon Ink").click());
    act(() => button(container, "Preview").click());

    expect(services.runtime.getPreviewContext()?.settings.readerTheme).toEqual(readerSelection);
    const controls = container.querySelector<HTMLElement>(".theme-preview-controls");
    expect(container.querySelector(".theme-manager-surface")?.contains(controls ?? null)).toBe(
      true,
    );
    expect(document.activeElement?.textContent).toContain("Revert");
    expect(
      [...container.querySelectorAll("button")].filter((candidate) =>
        candidate.textContent?.includes("Use theme"),
      ),
    ).toHaveLength(1);

    act(() => root.render(null));
    expect(services.clearPreview).toHaveBeenCalledOnce();
    expect(services.runtime.getPreviewContext()?.settings.readerTheme).toEqual(readerSelection);
  });

  it("keeps package deletion confirmation in the manager surface", async () => {
    const services = createServices();
    await act(async () => root.render(<ThemeManagerSurface services={services} />));
    await settle();

    act(() => button(container, "Moon Ink").click());
    act(() => button(container, "Remove").click());

    const dialogs = container.querySelectorAll("dialog");
    expect(dialogs).toHaveLength(1);
    expect(container.querySelector(".theme-manager-surface")?.contains(dialogs[0] ?? null)).toBe(
      true,
    );
    expect(dialogs[0]?.textContent).toContain("Remove “Moon Ink” theme?");
    expect(dialogs[0]?.textContent).toContain("from Archeion");
  });
});
