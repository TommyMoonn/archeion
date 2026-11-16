import { describe, expect, it, vi } from "vitest";
import type { ActiveArchiveScope } from "./archiveReconciliation";
import {
  ARCHIVE_INTEGRITY_REQUESTED_EVENT,
  archiveIntegrityNavigationPath,
  listenForArchiveIntegrityRequests,
  type ArchiveIntegrityNavigationRequest,
} from "./archiveIntegrityNavigation";

const scope = { archiveId: "archive-a", rootPath: "D:\\Books" };
const request: ArchiveIntegrityNavigationRequest = {
  ...scope,
  destination: "duplicates",
  requestId: "request-1",
};

describe("archive maintenance navigation", () => {
  it.each(["duplicates", "epub-issues"] as const)(
    "creates an archive-scoped %s request",
    (destination) => {
      expect(archiveIntegrityNavigationPath({ ...request, destination }, scope)).toBe(
        `/?archiveId=archive-a&view=${destination}&integrityRequest=request-1`,
      );
    },
  );
  it("uses current archive ownership and preserves each explicit request", async () => {
    let active: ActiveArchiveScope = scope;
    let receive: ((event: { payload: ArchiveIntegrityNavigationRequest }) => void) | undefined;
    const stop = vi.fn();
    const subscribe = vi.fn(async (_event, handler) => {
      receive = handler;
      return stop;
    });
    const navigate = vi.fn();
    const unlisten = await listenForArchiveIntegrityRequests(
      () => active,
      navigate,
      subscribe as never,
    );
    expect(subscribe).toHaveBeenCalledWith(ARCHIVE_INTEGRITY_REQUESTED_EVENT, expect.any(Function));
    if (!receive) throw new Error("Listener was not installed");
    receive({ payload: request });
    receive({ payload: { ...request, requestId: "request-2" } });
    expect(navigate.mock.calls.map(([path]) => path)).toEqual([
      "/?archiveId=archive-a&view=duplicates&integrityRequest=request-1",
      "/?archiveId=archive-a&view=duplicates&integrityRequest=request-2",
    ]);
    active = { ...scope, archiveId: "archive-b" };
    receive({ payload: request });
    active = null;
    receive({ payload: request });
    expect(navigate).toHaveBeenCalledTimes(2);
    unlisten();
    expect(stop).toHaveBeenCalledOnce();
  });
});
