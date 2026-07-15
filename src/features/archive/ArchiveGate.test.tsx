// @vitest-environment happy-dom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ArchiveState } from "../../stores/archiveStore";
import { ArchiveGate } from "./ArchiveGate";

const routerMock = vi.hoisted(() => ({
  navigate: vi.fn(),
  state: { location: { pathname: "/reader/shared-book" } },
}));
const storageMock = vi.hoisted(() => ({
  rescan: vi.fn(async () => undefined),
  reset: vi.fn(),
}));
const appearanceRuntimeMock = vi.hoisted(() => ({
  activateArchive: vi.fn(async () => undefined),
  deactivateArchive: vi.fn(),
}));

let archiveState: ArchiveState;

vi.mock("../../app/router", () => ({ router: routerMock }));
vi.mock("../../storage/useLibraryStorage", () => ({ useLibraryStorage: () => storageMock }));
vi.mock("../../stores/appPreferencesStore", () => ({
  useFilesAndMetadataPreferences: () => ({ liveWatcherEnabled: false, scanOnStartup: false }),
}));
vi.mock("../../themes/appearanceRuntimeInstance", () => ({
  appearanceRuntime: appearanceRuntimeMock,
}));
vi.mock("./useArchive", () => ({ useArchive: () => archiveState }));

function readyArchive(id: string): ArchiveState {
  return {
    archive: {
      createdAt: "2026-07-14T00:00:00.000Z",
      displayName: id,
      id,
      lastOpenedAt: "2026-07-14T00:00:00.000Z",
      rootPath: `D:\\${id}`,
    },
    archives: [],
    error: null,
    path: `D:\\${id}`,
    status: "ready",
    watcherError: null,
  };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(children: ReactNode = <div data-testid="reader">Reader</div>) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  await act(async () => root?.render(<ArchiveGate>{children}</ArchiveGate>));
  return container;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  routerMock.navigate.mockReset();
  routerMock.state.location.pathname = "/reader/shared-book";
  storageMock.reset.mockReset();
  storageMock.rescan.mockReset();
  appearanceRuntimeMock.activateArchive.mockReset();
  appearanceRuntimeMock.deactivateArchive.mockReset();
});

describe("ArchiveGate ready archive replacement", () => {
  it("hands the reset archive scope to the appearance runtime", async () => {
    archiveState = readyArchive("archive-a");
    await render();

    expect(storageMock.reset).toHaveBeenCalledWith("D:\\archive-a");
    expect(appearanceRuntimeMock.activateArchive).toHaveBeenCalledWith(
      { id: "archive-a", rootPath: "D:\\archive-a" },
      storageMock,
    );
    expect(storageMock.reset.mock.invocationCallOrder[0]).toBeLessThan(
      appearanceRuntimeMock.activateArchive.mock.invocationCallOrder[0]!,
    );
  });

  it("unmounts the reader and replaces it with the new archive Library route", async () => {
    archiveState = readyArchive("archive-a");
    const rendered = await render();
    expect(rendered.querySelector('[data-testid="reader"]')).toBeInstanceOf(HTMLElement);

    const navigation = deferred();
    routerMock.navigate.mockImplementation(() => navigation.promise);
    archiveState = readyArchive("archive-b");
    await render();

    expect(rendered.querySelector('[data-testid="reader"]')).toBeNull();
    expect(rendered.textContent).toContain("Opening archive");
    expect(routerMock.navigate).toHaveBeenCalledWith(
      {
        pathname: "/",
        search: "archiveId=archive-b&view=library",
      },
      { replace: true },
    );

    await act(async () => {
      routerMock.state.location.pathname = "/";
      navigation.resolve();
      await navigation.promise;
    });
    expect(rendered.querySelector('[data-testid="reader"]')).toBeInstanceOf(HTMLElement);
  });

  it("does not issue another navigation when the archive switch already reached Library", async () => {
    archiveState = readyArchive("archive-a");
    await render();
    routerMock.state.location.pathname = "/";
    archiveState = readyArchive("archive-b");
    await render();
    await act(async () => Promise.resolve());

    expect(routerMock.navigate).not.toHaveBeenCalled();
    expect(container?.querySelector('[data-testid="reader"]')).toBeInstanceOf(HTMLElement);
  });
});
