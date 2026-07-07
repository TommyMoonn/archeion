// @vitest-environment happy-dom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { vaultStore } from "../../stores/vaultStore";
import type { KnownArchive } from "../../types/archive";
import { VaultSetupPage } from "./VaultSetupPage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const savedArchive: KnownArchive = {
  id: "archive-books",
  displayName: "Books",
  rootPath: "D:\\Books",
  createdAt: "1",
  lastOpenedAt: "1",
};

const setupState = {
  status: "setup" as const,
  path: null,
  error: null,
  archives: [],
};

const missingState = {
  status: "missing" as const,
  path: savedArchive.rootPath,
  archive: savedArchive,
  error: null,
  archives: [savedArchive],
};

function renderInteractive() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  act(() => {
    root.render(<VaultSetupPage state={setupState} />);
  });

  return { container, root };
}

describe("VaultSetupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders the first-run launcher actions", () => {
    const markup = renderToStaticMarkup(<VaultSetupPage state={setupState} />);

    expect(markup).toContain("No archive open");
    expect(markup).toContain("Choose a folder that contains your EPUBs.");
    expect(markup).toContain("Create empty archive");
    expect(markup).toContain("Open folder as archive");
    expect(markup).not.toContain("Open another archive");
  });

  it("shows saved archives in the left column", () => {
    const markup = renderToStaticMarkup(
      <VaultSetupPage state={{ ...setupState, archives: [savedArchive] }} />,
    );

    expect(markup).toContain("Archives");
    expect(markup).toContain("Books");
    expect(markup).toContain("D:\\Books");
  });

  it("calls the folder picker flow from Open folder as archive", async () => {
    const chooseVault = vi.spyOn(vaultStore, "chooseVault").mockResolvedValue(true);
    const createArchive = vi.spyOn(vaultStore, "createArchive").mockResolvedValue(true);
    const { container, root } = renderInteractive();
    const button = Array.from(container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Open folder as archive"),
    );

    expect(button).toBeDefined();
    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(chooseVault).toHaveBeenCalledTimes(1);
    expect(createArchive).not.toHaveBeenCalled();

    act(() => root.unmount());
  });

  it("shows the missing remembered archive recovery state", () => {
    const markup = renderToStaticMarkup(<VaultSetupPage state={missingState} />);

    expect(markup).toContain("Archive folder not found");
    expect(markup).toContain(
      "The saved folder may have been moved, renamed, or disconnected.",
    );
    expect(markup).toContain("Try again");
    expect(markup).toContain("Forget missing archive");
  });

  it("shows the actual open failure message", () => {
    const markup = renderToStaticMarkup(
      <VaultSetupPage
        state={{
          status: "error",
          path: "D:\\Broken",
          error: "Selected folder is inside .archeion.",
          archives: [],
        }}
      />,
    );

    expect(markup).toContain("Archive could not open");
    expect(markup).toContain("Selected folder is inside .archeion.");
  });
});
