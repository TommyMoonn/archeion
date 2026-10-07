// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInstalledFontCatalog, type InstalledFontCatalog } from "./installedFontCatalog";
import { useInstalledFontFamilies } from "./useInstalledFontFamilies";

const mounted: Root[] = [];
afterEach(() => {
  act(() => mounted.splice(0).forEach((root) => root.unmount()));
});

function Probe({ catalog, enabled }: { catalog: InstalledFontCatalog; enabled: boolean }) {
  const { families, loading } = useInstalledFontFamilies(enabled, catalog);
  return <output data-loading={loading}>{families.join(",")}</output>;
}

function mount(catalog: InstalledFontCatalog, enabled = false) {
  const container = document.createElement("div");
  const root = createRoot(container);
  mounted.push(root);
  act(() => root.render(<Probe catalog={catalog} enabled={enabled} />));
  return { container, root };
}

describe("installed-font React projection", () => {
  it("loads only when enabled, shares the provider across consumers, and reuses it after remount", async () => {
    const provider = vi.fn(async () => ["Arial", "Georgia"]);
    const catalog = createInstalledFontCatalog(provider);
    const first = mount(catalog);
    expect(provider).not.toHaveBeenCalled();
    expect(first.container.querySelector("output")?.dataset.loading).toBe("true");
    const second = mount(catalog, true);
    await act(async () => {
      first.root.render(<Probe catalog={catalog} enabled />);
      await catalog.load();
    });
    expect(provider).toHaveBeenCalledOnce();
    expect(first.container.textContent).toBe("Arial,Georgia");
    expect(second.container.textContent).toBe("Arial,Georgia");
    act(() => first.root.render(<Probe catalog={catalog} enabled={false} />));
    expect(first.container.textContent).toBe("Arial,Georgia");
    const third = mount(catalog, true);
    await act(async () => {
      await catalog.load();
    });
    expect(third.container.textContent).toBe("Arial,Georgia");
    expect(provider).toHaveBeenCalledOnce();
  });

  it("ignores an obsolete catalog completion after replacement and unmount", async () => {
    let resolveOld!: (families: string[]) => void;
    const oldCatalog = createInstalledFontCatalog(
      () =>
        new Promise<string[]>((resolve) => {
          resolveOld = resolve;
        }),
    );
    const currentCatalog = createInstalledFontCatalog(async () => ["Current Family"]);
    const first = mount(oldCatalog, true);
    const second = mount(oldCatalog, true);
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      first.root.render(<Probe catalog={currentCatalog} enabled />);
      second.root.render(null);
    });
    await act(async () => {
      await currentCatalog.load();
      resolveOld(["Obsolete Family"]);
      await oldCatalog.load();
    });
    expect(first.container.textContent).toBe("Current Family");
    expect(second.container.textContent).toBe("");
  });

  it("settles a failed provider to a known empty catalog rather than remaining busy", async () => {
    const catalog = createInstalledFontCatalog(async () => {
      throw new Error("Unavailable");
    });
    const { container } = mount(catalog, true);
    await act(async () => {
      await catalog.load();
    });
    expect(container.querySelector("output")?.dataset.loading).toBe("false");
    expect(container.textContent).toBe("");
  });
});
