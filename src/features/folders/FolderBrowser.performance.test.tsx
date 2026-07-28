// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Folder } from "../../types/folder";
import { FolderBrowser } from "./FolderBrowser";
import { createFolderBrowserEntry } from "./folderBrowserReadModel";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.clearAllMocks();
});

function folder(id: string, name: string): Folder {
  return {
    createdAt: "2026-07-01T00:00:00.000Z",
    id,
    name,
    parentPath: "",
    relativePath: id,
    updatedAt: "2026-07-01T00:00:00.000Z",
  };
}

describe("FolderBrowser rendering", () => {
  it("does not commit an unchanged Folder item when another Folder entry changes", () => {
    let alphaNameReads = 0;
    let betaNameReads = 0;
    const alpha = folder("alpha", "Alpha");
    const beta = folder("beta", "Beta");
    Object.defineProperty(alpha, "name", {
      configurable: true,
      get: () => {
        alphaNameReads += 1;
        return "Alpha";
      },
    });
    Object.defineProperty(beta, "name", {
      configurable: true,
      get: () => {
        betaNameReads += 1;
        return "Beta";
      },
    });
    const alphaEntry = createFolderBrowserEntry(alpha, 1);
    const betaEntry = createFolderBrowserEntry(beta, 1);
    alphaNameReads = 0;
    betaNameReads = 0;
    const onOpen = vi.fn();
    const onSortChange = vi.fn();
    const onViewChange = vi.fn();
    const renderBrowser = (entries: readonly (typeof alphaEntry)[]) => (
      <FolderBrowser
        cardSize="medium"
        entries={entries}
        isLoading={false}
        onOpen={onOpen}
        onSortChange={onSortChange}
        onViewChange={onViewChange}
        sort="name"
        view="cards"
      />
    );

    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(renderBrowser([alphaEntry, betaEntry])));
    const initialAlphaReads = alphaNameReads;
    const initialBetaReads = betaNameReads;

    act(() => root?.render(renderBrowser([alphaEntry, createFolderBrowserEntry(beta, 2)])));

    expect(alphaNameReads).toBe(initialAlphaReads);
    expect(betaNameReads).toBeGreaterThan(initialBetaReads);
  });
});
