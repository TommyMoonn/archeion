// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { shellStressThemes } from "../../../tests/fixtures/themes/shellStressThemes";
import * as resolution from "../../themes/resolveTheme";
import type { ThemeManifestV1 } from "../../themes/domain";
import {
  builtInThemeCatalogEntries,
  emptyThemeCatalogCapabilities,
  type ThemeCatalogEntry,
  type ValidCustomThemeCatalogEntry,
} from "../../themes/themeCatalogReadModel";
import { ThemeCatalogList } from "./ThemeCatalogList";

function customEntry(
  manifest: ThemeManifestV1 = shellStressThemes.distinct,
): ValidCustomThemeCatalogEntry {
  return {
    applicable: true,
    capabilities: { application: true, reader: false },
    diagnostics: [],
    id: manifest.id,
    manifest,
    name: manifest.name,
    origin: "custom",
    packageId: manifest.id,
    status: "valid",
  };
}

describe("ThemeCatalogList compact previews", () => {
  let container: HTMLDivElement;
  let root: Root;
  const onSelect = vi.fn();

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    onSelect.mockClear();
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  function render(
    entries: readonly ThemeCatalogEntry[],
    selectedKey = "builtin:dark",
    busy = false,
  ) {
    act(() =>
      root.render(
        <ThemeCatalogList
          activeThemeKey="builtin:dark"
          busy={busy}
          entries={entries}
          onSelect={onSelect}
          selectedKey={selectedKey}
        />,
      ),
    );
  }

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
    render([entry], "custom:long-theme-package");
    const button = container.querySelector<HTMLButtonElement>("button")!;
    expect(button.textContent).toContain(name);
    expect(button.querySelector(".theme-catalog-list__item-name")?.getAttribute("title")).toBe(
      name,
    );
    act(() => button.click());
    expect(onSelect).toHaveBeenCalledWith("custom:long-theme-package");
  });

  it("renders built-in and custom tokens without adding labels or nested selection targets", () => {
    const entries = [
      ...builtInThemeCatalogEntries.slice(0, 2),
      ...Object.values(shellStressThemes).map(customEntry),
    ];
    render(entries);
    const rows = [...container.querySelectorAll("button")];
    expect(rows).toHaveLength(4);
    for (const [index, entry] of entries.entries()) {
      const theme =
        entry.origin === "builtin"
          ? resolution.resolveBuiltInAppTheme(entry.appBase!)
          : resolution.resolveTheme(entry.manifest).app;
      const graphic = rows[index]!.querySelector<HTMLElement>('[data-preview-size="compact"]');
      expect(graphic).not.toBeNull();
      expect(graphic!.getAttribute("aria-hidden")).toBe("true");
      expect(graphic!.textContent).toBe("");
      expect(graphic!.querySelector("button, a, input, [tabindex], [role]")).toBeNull();
      for (const role of [
        "sidebar",
        "main",
        "surfaceRaised",
        "lineSubtle",
        "textStrong",
        "accent",
      ] as const) {
        const variable = role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
        expect(graphic!.style.getPropertyValue(`--theme-shell-${variable}`)).toBe(
          theme.tokens[role],
        );
      }
    }
    expect(rows[0]!.getAttribute("aria-current")).toBe("true");
    expect(rows[0]!.textContent).toContain("Archeion Dark");
    expect(rows[0]!.textContent).toContain("Selected");
    act(() => rows[2]!.querySelector<HTMLElement>('[data-preview-size="compact"]')!.click());
    expect(onSelect).toHaveBeenCalledWith(`custom:${entries[2]!.id}`);
  });

  it("does not fabricate thumbnails for invalid, unavailable, or non-application entries", () => {
    const resolve = vi.spyOn(resolution, "resolveTheme");
    const invalid: ThemeCatalogEntry = {
      applicable: false,
      capabilities: emptyThemeCatalogCapabilities,
      diagnostics: [],
      id: "unavailable",
      origin: "custom",
      packageId: "unavailable",
      status: "invalid",
    };
    render([
      invalid,
      { ...invalid, id: "invalid", packageId: "invalid" },
      builtInThemeCatalogEntries[2]!,
    ]);
    expect(container.querySelector('[data-preview-size="compact"]')).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Needs attention");
    expect(container.textContent).toContain("Sepia");
  });

  it("resolves a 200-theme catalog once per entry, not per selection or busy transition", () => {
    const entries = Array.from({ length: 200 }, (_, index) =>
      customEntry({
        ...shellStressThemes.distinct,
        id: `theme-${index}`,
        name: `Theme ${index}`,
      }),
    );
    const resolve = vi.spyOn(resolution, "resolveTheme");
    render(entries);
    expect(container.querySelectorAll('[data-preview-size="compact"]')).toHaveLength(200);
    expect(resolve).toHaveBeenCalledTimes(200);
    render([...entries], "custom:theme-199");
    render([...entries], "custom:theme-199", true);
    render([...entries], "custom:theme-0");
    expect(resolve).toHaveBeenCalledTimes(200);
    const revised = customEntry({ ...entries[0]!.manifest, app: { main: "#303030" } });
    render([revised, ...entries.slice(1)]);
    expect(resolve).toHaveBeenCalledTimes(201);
    expect(
      container
        .querySelector<HTMLElement>('[data-preview-size="compact"]')!
        .style.getPropertyValue("--theme-shell-main"),
    ).toBe("#303030");
  });
});
