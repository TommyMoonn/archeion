// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ABOUT_MAIN_CONTENT_ID } from "../../components/SkipLink";
import { AboutWindow } from "./AboutWindow";

const mocks = vi.hoisted(() => ({
  initialize: vi.fn<() => Promise<void>>(),
}));

vi.mock("../../components/WindowTitlebar", () => ({
  WindowTitlebar: () => <header data-testid="about-titlebar" />,
}));
vi.mock("../../stores/appPreferencesStore", () => ({
  appPreferencesStore: { initialize: mocks.initialize },
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  mocks.initialize.mockReset();
  mocks.initialize.mockResolvedValue();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("AboutWindow", () => {
  it("mounts the shared About surface with only application-level preferences", async () => {
    await act(async () => root.render(<AboutWindow />));

    expect(container.querySelector('[data-testid="about-titlebar"]')).not.toBeNull();
    expect(container.querySelector("main")?.id).toBe(ABOUT_MAIN_CONTENT_ID);
    expect(mocks.initialize).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("Archeion");
    expect(container.textContent).toContain("Website");
    expect(container.textContent).toContain("Documentation");
    expect(container.textContent).toContain("Source code");
    expect(container.querySelector("dialog")).toBeNull();
  });
});
