// @vitest-environment happy-dom

import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ThemeCatalogSnapshot } from "../../themes/themeCatalogReadModel";
import { builtInThemeCatalogEntries } from "../../themes/themeCatalogReadModel";
import { useThemeCatalogEntries } from "./useThemeCatalogEntries";

const services = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let snapshot: ThemeCatalogSnapshot = {
    entries: [],
    fullyEnumerated: false,
    revision: 0,
  };
  return {
    catalog: {
      enumeratePackages: vi.fn(async () => snapshot),
      getSnapshot: vi.fn(() => snapshot),
      subscribe: vi.fn((listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      }),
    },
    runtime: { refreshAppearance: vi.fn(async () => undefined) },
    reset() {
      snapshot = { entries: [], fullyEnumerated: false, revision: 0 };
      listeners.clear();
    },
    setSnapshot(next: ThemeCatalogSnapshot) {
      snapshot = next;
      listeners.forEach((listener) => listener());
    },
  };
});

vi.mock("../../themes/appearanceRuntimeInstance", () => ({
  appearanceRuntime: services.runtime,
  themeCatalog: services.catalog,
}));

let root: Root | null = null;
let latest: ReturnType<typeof useThemeCatalogEntries> | null = null;

function Harness({ enabled = true }: Readonly<{ enabled?: boolean }>) {
  const value = useThemeCatalogEntries(enabled);
  useEffect(() => {
    latest = value;
  }, [value]);
  return null;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  latest = null;
  services.catalog.enumeratePackages.mockReset();
  services.runtime.refreshAppearance.mockReset();
  services.runtime.refreshAppearance.mockResolvedValue(undefined);
  services.reset();
});

function render(enabled = true) {
  const container = document.createElement("div");
  root = createRoot(container);
  act(() => root?.render(<Harness enabled={enabled} />));
}

describe("global theme catalog hook", () => {
  it("enumerates global packages when enabled", async () => {
    services.catalog.enumeratePackages.mockImplementation(async () => {
      const next = {
        entries: builtInThemeCatalogEntries,
        fullyEnumerated: true,
        revision: 0,
      };
      services.setSnapshot(next);
      return next;
    });

    render();
    await act(async () => Promise.resolve());

    expect(services.catalog.enumeratePackages).toHaveBeenCalledOnce();
    expect(latest?.entries).toEqual(builtInThemeCatalogEntries);
  });

  it("does not enumerate while disabled", () => {
    render(false);
    expect(services.catalog.enumeratePackages).not.toHaveBeenCalled();
    expect(latest?.loading).toBe(false);
  });

  it("refreshes catalog and committed appearance through the runtime owner", async () => {
    services.setSnapshot({
      entries: builtInThemeCatalogEntries,
      fullyEnumerated: true,
      revision: 1,
    });
    render();

    await act(async () => expect(latest?.refresh()).resolves.toBe(true));

    expect(services.runtime.refreshAppearance).toHaveBeenCalledOnce();
  });

  it("reports and retires refresh failures", async () => {
    services.setSnapshot({
      entries: builtInThemeCatalogEntries,
      fullyEnumerated: true,
      revision: 1,
    });
    services.runtime.refreshAppearance.mockRejectedValueOnce(new Error("unavailable"));
    render();

    await act(async () => expect(latest?.refresh()).resolves.toBe(false));
    expect(latest?.error).toContain("could not be refreshed");
    act(() => latest?.retireRefreshFailure());
    expect(latest?.error).toBeNull();
  });
});
