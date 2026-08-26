// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AboutSurface } from "./AboutSurface";

const resolveApplicationVersion = vi.hoisted(() => vi.fn(async () => "9.9.9"));
const openExternalUrl = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("../../app/appVersion", () => ({
  APPLICATION_VERSION_FALLBACK: "0.6.0",
  resolveApplicationVersion,
}));

vi.mock("../../app/openExternalUrl", () => ({ openExternalUrl }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const roots: Root[] = [];

function renderSurface() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(<AboutSurface />));
  return container;
}

beforeEach(() => {
  resolveApplicationVersion.mockReset();
  resolveApplicationVersion.mockResolvedValue("9.9.9");
  openExternalUrl.mockReset();
  openExternalUrl.mockResolvedValue(undefined);
});

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("AboutSurface", () => {
  it("shows the centralized fallback while resolving the runtime version", async () => {
    let resolveVersion!: (version: string) => void;
    resolveApplicationVersion.mockReturnValue(
      new Promise((resolve) => {
        resolveVersion = resolve;
      }),
    );
    const container = renderSurface();

    expect(container.textContent).toContain("Version 0.6.0");

    await act(async () => resolveVersion("9.9.9"));
    expect(container.textContent).toContain("Version 9.9.9");
  });

  it("renders branding and opens every project destination through the approved owner", async () => {
    const container = renderSurface();
    const links = Array.from(container.querySelectorAll<HTMLAnchorElement>(".about-window__link"));

    expect(container.querySelector('img[alt=""]')).not.toBeNull();
    expect(links.map((link) => link.textContent)).toEqual([
      "Websitetommymoonn.github.io/archeion",
      "Documentationtommymoonn.github.io/archeion/documentation",
      "Source codegithub.com/TommyMoonn/archeion",
    ]);

    for (const link of links) {
      await act(async () => link.click());
      expect(link.target).toBe("_blank");
      expect(link.rel).toBe("noreferrer");
    }

    expect(openExternalUrl.mock.calls).toEqual([
      ["https://tommymoonn.github.io/archeion/"],
      ["https://tommymoonn.github.io/archeion/documentation/"],
      ["https://github.com/TommyMoonn/archeion"],
    ]);
  });

  it("reports an external-open failure inside the surface", async () => {
    openExternalUrl.mockRejectedValueOnce(new Error("unavailable"));
    const container = renderSurface();

    await act(async () =>
      container.querySelector<HTMLAnchorElement>(".about-window__link")?.click(),
    );

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      "Archeion could not open that link.",
    );
  });
});
