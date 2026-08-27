// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";
import { ThemeCatalogList } from "./ThemeCatalogList";

let root: ReturnType<typeof createRoot> | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("ThemeCatalogList", () => {
  it("keeps a truncated long theme name complete and selectable", () => {
    const name =
      "A high-contrast reading theme for exceptionally long translated publication names";
    const entry: ThemeCatalogEntry = {
      applicable: false,
      capabilities: { application: false, reader: false },
      diagnostics: [],
      id: "long-theme",
      name,
      origin: "custom",
      packageId: "long-theme-package",
      status: "invalid",
    };
    const onSelect = vi.fn();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => {
      root?.render(
        <ThemeCatalogList
          activeThemeKey={null}
          busy={false}
          entries={[entry]}
          onSelect={onSelect}
          selectedKey="custom:long-theme-package"
        />,
      );
    });

    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toContain(name);
    expect(button?.querySelector(".theme-catalog-list__item-name")?.getAttribute("title")).toBe(
      name,
    );

    act(() => button?.click());
    expect(onSelect).toHaveBeenCalledWith("custom:long-theme-package");
  });
});
