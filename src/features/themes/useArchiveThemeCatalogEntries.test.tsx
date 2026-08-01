// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  ArchiveThemeCatalogSnapshot,
  ThemeCatalogEntry,
} from "../../themes/themeCatalogReadModel";
import { AppearanceRuntimeSettingsChangedError } from "../../themes/AppearanceRuntime";
import { useArchiveThemeCatalogEntries } from "./useArchiveThemeCatalogEntries";

const services = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  const initialSnapshot: ArchiveThemeCatalogSnapshot = {
    archive: { generation: 1, rootPath: "C:/ArchiveA" },
    entries: [],
    fullyEnumerated: true,
  };
  let snapshot: ArchiveThemeCatalogSnapshot = initialSnapshot;
  const catalog = {
    enumeratePackages: vi.fn(async () => snapshot),
    getSnapshot: vi.fn(() => snapshot),
    refreshPackages: vi.fn(async () => snapshot),
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
  const runtime = {
    getSnapshot: vi.fn(() => ({
      archive: { generation: 1, id: "archive-a", rootPath: "C:/ArchiveA" },
    })),
    refreshArchiveAppearance: vi.fn(async () => undefined),
  };
  return {
    catalog,
    initialSnapshot,
    runtime,
    setSnapshot(next: ArchiveThemeCatalogSnapshot) {
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
  };
});

let archiveState = { path: "C:/ArchiveA" };

vi.mock("../archive/useArchive", () => ({ useArchive: () => archiveState }));
vi.mock("../../themes/appearanceRuntimeInstance", () => ({
  appearanceRuntime: services.runtime,
  archiveThemeCatalog: services.catalog,
}));

let root: Root | null = null;
let latest: ReturnType<typeof useArchiveThemeCatalogEntries> | null = null;

function themeEntry(id: "dark" | "light"): ThemeCatalogEntry {
  return {
    applicable: true,
    appBase: "dark",
    capabilities: { application: true, reader: true },
    id,
    name: id,
    origin: "builtin",
    readerBase: "dark",
    status: "valid",
  };
}

function Harness({
  foregroundError = null,
  reportRefreshFailure = true,
}: Readonly<{ foregroundError?: string | null; reportRefreshFailure?: boolean }>) {
  const value = useArchiveThemeCatalogEntries(true, { reportRefreshFailure });
  useEffect(() => {
    latest = value;
  }, [value]);
  return (
    <>
      {value.error ? <p role="alert">{value.error}</p> : null}
      {foregroundError ? <p role="alert">{foregroundError}</p> : null}
    </>
  );
}

function renderHarness(
  props: Readonly<{ foregroundError?: string | null; reportRefreshFailure?: boolean }> = {},
): void {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() => root?.render(<Harness {...props} />));
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  latest = null;
  archiveState = { path: "C:/ArchiveA" };
  services.setSnapshot(services.initialSnapshot);
  services.catalog.enumeratePackages.mockClear();
  services.catalog.refreshPackages.mockReset();
  services.catalog.refreshPackages.mockImplementation(async () => services.catalog.getSnapshot());
  services.runtime.getSnapshot.mockReset();
  services.runtime.getSnapshot.mockReturnValue({
    archive: { generation: 1, id: "archive-a", rootPath: "C:/ArchiveA" },
  });
  services.runtime.refreshArchiveAppearance.mockReset();
  services.runtime.refreshArchiveAppearance.mockResolvedValue(undefined);
  document.body.replaceChildren();
});

describe("useArchiveThemeCatalogEntries", () => {
  it("coalesces rapid requests, keeps prior entries while pending, and reconciles refreshed appearance", async () => {
    const previousEntry = themeEntry("dark");
    const nextEntry = themeEntry("light");
    services.setSnapshot({ ...services.initialSnapshot, entries: [previousEntry] });
    let resolveRefresh: ((snapshot: ArchiveThemeCatalogSnapshot) => void) | null = null;
    services.catalog.refreshPackages.mockImplementationOnce(
      () =>
        new Promise<ArchiveThemeCatalogSnapshot>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    renderHarness();

    let first!: Promise<boolean>;
    let shared!: Promise<boolean>;
    act(() => {
      first = latest!.refresh();
      shared = latest!.refresh();
    });

    expect(shared).toBe(first);
    expect(services.catalog.refreshPackages).toHaveBeenCalledOnce();
    expect(latest?.entries).toEqual([previousEntry]);

    const refreshed = { ...services.initialSnapshot, entries: [previousEntry, nextEntry] };
    await act(async () => {
      services.setSnapshot(refreshed);
      resolveRefresh?.(refreshed);
      await first;
    });

    expect(latest?.entries).toEqual([previousEntry, nextEntry]);
    expect(services.runtime.refreshArchiveAppearance).toHaveBeenCalledOnce();
  });

  it("preserves entries and selection inputs when refresh fails", async () => {
    const previousEntry = themeEntry("dark");
    services.setSnapshot({ ...services.initialSnapshot, entries: [previousEntry] });
    services.catalog.refreshPackages.mockRejectedValueOnce(new Error("filesystem unavailable"));
    renderHarness();

    await act(async () => expect(await latest!.refresh()).toBe(false));

    expect(latest?.entries).toEqual([previousEntry]);
    expect(latest?.error).toBe("Themes could not be refreshed. Reload themes to try again.");
    expect(services.runtime.refreshArchiveAppearance).not.toHaveBeenCalled();
  });

  it("keeps refreshed entries and distinguishes runtime reconciliation failure", async () => {
    const previousEntry = themeEntry("dark");
    const refreshedEntry = themeEntry("light");
    services.setSnapshot({ ...services.initialSnapshot, entries: [previousEntry] });
    services.catalog.refreshPackages.mockImplementationOnce(async () => {
      const refreshed = { ...services.initialSnapshot, entries: [previousEntry, refreshedEntry] };
      services.setSnapshot(refreshed);
      return refreshed;
    });
    services.runtime.refreshArchiveAppearance.mockRejectedValueOnce(
      new Error("runtime reconciliation failed"),
    );
    renderHarness();

    await act(async () => expect(await latest!.refresh()).toBe(false));

    expect(latest?.entries).toEqual([previousEntry, refreshedEntry]);
    expect(latest?.error).toBe(
      "Themes were refreshed, but the active appearance could not be updated. Reload themes to try again.",
    );
  });

  it("treats a newer appearance write as successful refresh supersession", async () => {
    const previousEntry = themeEntry("dark");
    const refreshedEntry = themeEntry("light");
    services.setSnapshot({ ...services.initialSnapshot, entries: [previousEntry] });
    services.catalog.refreshPackages.mockImplementationOnce(async () => {
      const refreshed = { ...services.initialSnapshot, entries: [previousEntry, refreshedEntry] };
      services.setSnapshot(refreshed);
      return refreshed;
    });
    services.runtime.refreshArchiveAppearance.mockRejectedValueOnce(
      new AppearanceRuntimeSettingsChangedError(),
    );
    renderHarness();

    await act(async () => expect(await latest!.refresh()).toBe(true));

    expect(latest?.entries).toEqual([previousEntry, refreshedEntry]);
    expect(latest?.error).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("retires selector feedback during foreground ownership and requires a new failure afterward", async () => {
    const refreshedEntry = themeEntry("light");
    services.catalog.refreshPackages.mockImplementation(async () => {
      const refreshed = { ...services.initialSnapshot, entries: [refreshedEntry] };
      services.setSnapshot(refreshed);
      return refreshed;
    });
    services.runtime.refreshArchiveAppearance.mockRejectedValueOnce(
      new Error("earlier selector reconciliation failed"),
    );
    renderHarness();

    await act(async () => expect(await latest!.refresh()).toBe(false));
    expect(latest?.error).toBe(
      "Themes were refreshed, but the active appearance could not be updated. Reload themes to try again.",
    );

    act(() => {
      latest!.retireRefreshFailure();
      root?.render(
        <Harness
          foregroundError="Theme Manager could not update the active appearance."
          reportRefreshFailure={false}
        />,
      );
    });
    services.runtime.refreshArchiveAppearance.mockRejectedValueOnce(
      new Error("shared runtime reconciliation failed"),
    );

    await act(async () => expect(await latest!.refresh()).toBe(false));

    expect(latest?.entries).toEqual([refreshedEntry]);
    expect(latest?.error).toBeNull();
    expect(
      [...document.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent),
    ).toEqual(["Theme Manager could not update the active appearance."]);

    await act(async () => {
      root?.render(<Harness />);
    });
    expect(latest?.error).toBeNull();
    expect(document.querySelector('[role="alert"]')).toBeNull();

    services.runtime.refreshArchiveAppearance.mockRejectedValueOnce(
      new Error("later independent runtime reconciliation failed"),
    );
    await act(async () => expect(await latest!.refresh()).toBe(false));

    expect(document.querySelector('[role="alert"]')?.textContent).toBe(
      "Themes were refreshed, but the active appearance could not be updated. Reload themes to try again.",
    );
  });

  it("does not publish stale refresh state or reconcile appearance after generation replacement", async () => {
    let resolveRefresh: ((snapshot: ArchiveThemeCatalogSnapshot) => void) | null = null;
    services.catalog.refreshPackages.mockImplementationOnce(
      () =>
        new Promise<ArchiveThemeCatalogSnapshot>((resolve) => {
          resolveRefresh = resolve;
        }),
    );
    renderHarness();
    let refreshing!: Promise<boolean>;
    act(() => {
      refreshing = latest!.refresh();
    });
    const replacement = {
      archive: { generation: 2, rootPath: "C:/ArchiveA" },
      entries: [themeEntry("light")],
      fullyEnumerated: true,
    };

    await act(async () => {
      services.setSnapshot(replacement);
      resolveRefresh?.(replacement);
      expect(await refreshing).toBe(false);
    });

    expect(latest?.entries).toEqual(replacement.entries);
    expect(latest?.error).toBeNull();
    expect(services.runtime.refreshArchiveAppearance).not.toHaveBeenCalled();
  });
});
