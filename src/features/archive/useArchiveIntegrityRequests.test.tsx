// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ActiveArchiveScope } from "../../storage/archiveReconciliation";
import type { ArchiveIntegrityNavigationRequest } from "../../storage/archiveIntegrityNavigation";
import { useArchiveIntegrityRequests } from "./useArchiveIntegrityRequests";

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => true),
  listen: vi.fn(),
  navigate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: mocks.isTauri }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen }));
vi.mock("../../app/router", () => ({ router: { navigate: mocks.navigate } }));

function Harness({ scope }: { scope: ActiveArchiveScope }) {
  useArchiveIntegrityRequests(scope);
  return null;
}

describe("main-window archive integrity requests", () => {
  let container: HTMLDivElement;
  let root: Root;
  let receive: ((event: { payload: ArchiveIntegrityNavigationRequest }) => void) | undefined;
  const scope = { archiveId: "archive-a", rootPath: "D:\\Books" };
  const request: ArchiveIntegrityNavigationRequest = {
    ...scope,
    destination: "duplicates",
    requestId: "first",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    receive = undefined;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function render(activeScope: ActiveArchiveScope) {
    await act(async () => root.render(<Harness scope={activeScope} />));
  }

  function send(payload: ArchiveIntegrityNavigationRequest) {
    if (!receive) throw new Error("Archive integrity listener was not installed");
    receive({ payload });
  }

  it("routes explicit requests using current archive scope and removes its subscription", async () => {
    const stop = vi.fn();
    mocks.listen.mockImplementation(async (_name, handler) => {
      receive = handler;
      return stop;
    });
    await render(scope);
    expect(mocks.navigate).not.toHaveBeenCalled();

    send(request);
    send({ ...request, requestId: "second", destination: "epub-issues" });
    expect(mocks.navigate.mock.calls).toEqual([
      ["/?archiveId=archive-a&view=duplicates&integrityRequest=first"],
      ["/?archiveId=archive-a&view=epub-issues&integrityRequest=second"],
    ]);

    const nextScope = { archiveId: "archive-b", rootPath: "E:\\Books" };
    await render(nextScope);
    send(request);
    send({ ...request, ...nextScope, requestId: "third" });
    expect(mocks.navigate).toHaveBeenCalledTimes(3);
    expect(mocks.navigate).toHaveBeenLastCalledWith(
      "/?archiveId=archive-b&view=duplicates&integrityRequest=third",
    );
    expect(mocks.listen).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    root = createRoot(container);
    send({ ...request, ...nextScope });
    expect(mocks.navigate).toHaveBeenCalledTimes(3);
    expect(stop).toHaveBeenCalledOnce();
  });

  it("disposes a subscription that finishes installing after unmount", async () => {
    let finish: ((stop: () => void) => void) | undefined;
    const stop = vi.fn();
    mocks.listen.mockImplementation((_name, handler) => {
      receive = handler;
      return new Promise<() => void>((resolve) => {
        finish = resolve;
      });
    });
    await render(scope);
    act(() => root.unmount());
    root = createRoot(container);
    send(request);
    expect(mocks.navigate).not.toHaveBeenCalled();
    if (!finish) throw new Error("Archive integrity subscription did not start");
    await act(async () => finish?.(stop));
    expect(stop).toHaveBeenCalledOnce();
  });
});
