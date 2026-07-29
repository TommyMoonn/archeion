// @vitest-environment happy-dom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArchiveAppearanceSettings } from "../../types/settings";
import { ArchiveThemeCatalog } from "../../themes/ArchiveThemeCatalog";
import { resolveBuiltInAppTheme, resolveBuiltInReaderTheme } from "../../themes/resolveTheme";
import { ThemePreviewSession } from "../../themes/ThemePreviewSession";
import { ThemeManagerDialog } from "./ThemeManagerDialog";
import type { ThemeManagerControllerOptions } from "./useThemeManagerController";

const archive = Object.freeze({ generation: 2, id: "archive-a", rootPath: "D:\\Archive" });
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
  const catalog = new ArchiveThemeCatalog(() => ({
    listPackageDirectories: vi.fn(async () => ["moon-ink"]),
    readManifest: vi.fn(async () => JSON.stringify(customManifest)),
  }));
  catalog.activateArchive(archive);
  let settings: ArchiveAppearanceSettings = {
    appTheme: { kind: "custom", id: "moon-ink" },
    readerTheme: { kind: "builtin", id: "sepia" },
  };
  const runtimeListeners = new Set<() => void>();
  const clearPreview = vi.fn(() => true);
  const runtime = {
    getPreviewContext: () => ({ archive, settings }),
    refreshArchiveAppearance: vi.fn(async () => settings),
    updateArchiveAppearanceSettings: vi.fn(
      async (_archive, changes: Partial<ArchiveAppearanceSettings>) => {
        settings = { ...settings, ...changes };
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
      archive,
      reader: resolveBuiltInReaderTheme("sepia"),
    }),
    keepPreview: vi.fn(async () => undefined),
    subscribe: (listener) => {
      runtimeListeners.add(listener);
      return () => runtimeListeners.delete(listener);
    },
  });
  return {
    catalog,
    clearPreview,
    previewSession,
    repository: {
      deletePackage: vi.fn(),
      replaceManifest: vi.fn(),
      revealThemesRoot: vi.fn(),
      storeManifest: vi.fn(),
    },
    runtime,
  };
}

function Owner({ services }: Readonly<{ services: ReturnType<typeof createServices> }>) {
  const [open, setOpen] = useState(true);
  return open ? (
    <ThemeManagerDialog
      archiveRootPath={archive.rootPath}
      onClose={() => setOpen(false)}
      services={services}
    />
  ) : null;
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

describe("ThemeManagerDialog", () => {
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

  it("presents the final app-only flat manager workflow", async () => {
    const services = createServices();
    await act(async () => root.render(<Owner services={services} />));
    await settle();

    expect(container.textContent).toContain("Import");
    expect(container.textContent).not.toContain("Import Themes");
    expect(container.querySelector('button[aria-label="Reload themes"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Open themes folder"]')).not.toBeNull();
    expect(container.textContent).toContain("Theme guide");
    expect(container.textContent).toContain("Public schema");
    expect(container.textContent).not.toContain("Browse, preview, and manage application themes.");
    expect(container.querySelector('button[aria-label="Close Theme Manager"]')).not.toBeNull();

    const toolbar = container.querySelector(".theme-manager__toolbar")!;
    const links = toolbar.querySelector(".theme-manager__toolbar-links")!;
    const actions = toolbar.querySelector(".theme-manager__toolbar-actions")!;
    expect(toolbar.firstElementChild).toBe(links);
    expect(toolbar.lastElementChild).toBe(actions);
    expect(actions.lastElementChild?.textContent).toContain("Import");
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
    await act(async () => root.render(<Owner services={services} />));
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
    expect(dialogs).toHaveLength(2);
    expect(dialogs[1]?.textContent).toContain("A theme with this ID already exists.");
    expect(button(dialogs[1]!, "Update theme")).not.toBeNull();
    expect(dialogs[1]?.textContent).not.toContain("Replace theme");
    expect(services.repository.replaceManifest).not.toHaveBeenCalled();

    act(() => button(dialogs[1]!, "Update theme").click());
    await settle();
    expect(services.repository.replaceManifest).toHaveBeenCalledWith(replacement);
  });

  it("owns preview controls inside its native dialog and reverts them on close", async () => {
    const services = createServices();
    await act(async () => root.render(<Owner services={services} />));
    await settle();

    const readerSelection = services.runtime.getPreviewContext()?.settings.readerTheme;
    act(() => button(container, "Moon Ink").click());
    act(() => button(container, "Preview").click());

    expect(services.runtime.getPreviewContext()?.settings.readerTheme).toEqual(readerSelection);
    const dialog = container.querySelector("dialog");
    const controls = container.querySelector<HTMLElement>(".theme-preview-controls");
    expect(dialog?.contains(controls ?? null)).toBe(true);
    expect(document.activeElement?.textContent).toContain("Revert");

    act(() =>
      container
        .querySelector<HTMLButtonElement>('button[aria-label="Close Theme Manager"]')!
        .click(),
    );
    expect(container.querySelector("dialog")).toBeNull();
    expect(services.clearPreview).toHaveBeenCalledOnce();
    expect(services.runtime.getPreviewContext()?.settings.readerTheme).toEqual(readerSelection);
  });

  it("keeps package deletion confirmation in the manager modal subtree", async () => {
    const services = createServices();
    await act(async () => root.render(<Owner services={services} />));
    await settle();

    act(() => button(container, "Moon Ink").click());
    act(() => button(container, "Remove").click());

    const dialogs = container.querySelectorAll("dialog");
    expect(dialogs).toHaveLength(2);
    expect(dialogs[0]?.contains(dialogs[1] ?? null)).toBe(true);
    expect(dialogs[1]?.textContent).toContain("Remove “Moon Ink” theme?");
    expect(dialogs[1]?.textContent).toContain("active archive");
  });
});
