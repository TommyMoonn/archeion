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
    appTheme: { kind: "inherit" },
    readerTheme: { kind: "inherit" },
  };
  const runtimeListeners = new Set<() => void>();
  const clearPreview = vi.fn(() => true);
  const runtime = {
    getPreviewContext: () => ({ archive, settings }),
    refreshArchiveAppearance: vi.fn(async () => settings),
    saveArchiveAppearanceSettings: vi.fn(async (_archive, next) => {
      settings = next;
      return settings;
    }),
  } satisfies ThemeManagerControllerOptions["runtime"];
  const previewSession = new ThemePreviewSession({
    applyPreview: vi.fn(() => true),
    clearPreview,
    getPreviewContext: runtime.getPreviewContext,
    getSnapshot: () => ({
      app: resolveBuiltInAppTheme("dark"),
      archive,
      reader: resolveBuiltInReaderTheme("dark"),
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
      createStarterPackage: vi.fn(),
      deletePackage: vi.fn(),
      replaceManifest: vi.fn(),
      revealPackage: vi.fn(),
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

  it("exposes the complete archive package workflow without an in-app editor", async () => {
    const services = createServices();
    await act(async () => root.render(<Owner services={services} />));
    await settle();

    expect(container.textContent).toContain("Theme Manager");
    expect(container.textContent).toContain("Import JSON");
    expect(container.textContent).toContain("Create starter");
    expect(container.textContent).toContain("Reload");
    expect(container.textContent).toContain("Reveal themes folder");
    expect(container.textContent).toContain("Theme guide");
    expect(container.textContent).toContain("Public schema");
    expect(container.querySelector("textarea")).toBeNull();

    act(() => button(container, "Create starter").click());
    expect(container.textContent).toContain("Theme ID");
    expect(container.textContent).toContain("Application base");
    expect(container.textContent).toContain("Reader base");
  });

  it("owns preview controls inside its native dialog and reverts them when the manager closes", async () => {
    const services = createServices();
    await act(async () => root.render(<Owner services={services} />));
    await settle();

    act(() => button(container, "Moon Ink").click());
    act(() => button(container, "Preview").click());

    const dialog = container.querySelector("dialog");
    const controls = container.querySelector<HTMLElement>(".theme-preview-controls");
    expect(dialog).not.toBeNull();
    expect(controls).not.toBeNull();
    expect(dialog?.contains(controls ?? null)).toBe(true);
    expect(document.activeElement?.textContent).toContain("Revert");

    act(() => button(container, "Close").click());

    expect(container.querySelector("dialog")).toBeNull();
    expect(services.clearPreview).toHaveBeenCalledOnce();
    expect(services.previewSession.getSnapshot()).toEqual({ status: "idle" });
  });

  it("keeps destructive package confirmation inside the manager's native modal subtree", async () => {
    const services = createServices();
    await act(async () => root.render(<Owner services={services} />));
    await settle();

    act(() => button(container, "Moon Ink").click());
    act(() => button(container, "Delete").click());

    const dialogs = container.querySelectorAll("dialog");
    expect(dialogs).toHaveLength(2);
    expect(dialogs[0]?.contains(dialogs[1] ?? null)).toBe(true);
    expect(dialogs[1]?.textContent).toContain("Delete theme package?");
    expect(dialogs[1]?.textContent).toContain("safely falls back");

    act(() => button(container, "Cancel").click());
    expect(container.querySelectorAll("dialog")).toHaveLength(1);
  });
});
