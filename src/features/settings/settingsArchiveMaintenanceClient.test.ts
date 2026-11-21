import { describe, expect, it, vi } from "vitest";
import { invoke as exportInvoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";

import type { ArchiveRegistry, KnownArchive } from "../../types/archive";
import {
  ARCHIVE_RECONCILIATION_COMPLETED_EVENT,
  type ArchiveReconciliationCompletion,
} from "../../storage/archiveReconciliation";
import { SettingsArchiveMaintenanceClient } from "./settingsArchiveMaintenanceClient";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));

const archiveA: KnownArchive = {
  id: "archive-a",
  displayName: "Archive A",
  rootPath: "D:\\Archive A",
  createdAt: "1",
  lastOpenedAt: "1",
};
const archiveB: KnownArchive = {
  id: "archive-b",
  displayName: "Archive B",
  rootPath: "E:\\Archive B",
  createdAt: "2",
  lastOpenedAt: "2",
};

function registry(active: KnownArchive | null): ArchiveRegistry {
  return {
    version: 1,
    archives: active ? [archiveA, archiveB] : [],
    lastOpenedArchiveId: active?.id ?? null,
  };
}

function createClient(
  initial: ArchiveRegistry,
  requestIds = ["settings-session-1-request-1"],
  loadRegistry: () => Promise<ArchiveRegistry> = async () => initial,
) {
  let requestIndex = 0;
  const handlers = new Map<string, (event: { payload: unknown }) => void>();
  const unlisten = vi.fn();
  const invoke = vi.fn<(command: string, args?: unknown) => Promise<unknown>>(async (command) => {
    if (command === "load_archive_registry") return loadRegistry();
    return undefined;
  });
  const archiveInvoke = vi.fn<
    (command: string, args?: unknown, rootPath?: string | null) => Promise<unknown>
  >(async () => undefined);
  const client = new SettingsArchiveMaintenanceClient({
    archiveCommands: { invoke: archiveInvoke } as never,
    createRequestId: () => {
      const requestId = requestIds[requestIndex++];
      if (!requestId) throw new Error("No test reconciliation request ID remains.");
      return requestId;
    },
    invoke: invoke as never,
    listen: vi.fn(async (event, handler) => {
      handlers.set(event, handler as (event: { payload: unknown }) => void);
      return unlisten;
    }) as never,
  });
  return {
    archiveInvoke,
    client,
    invoke,
    unlisten,
    publishCompletion: (completion: ArchiveReconciliationCompletion) =>
      handlers.get(ARCHIVE_RECONCILIATION_COMPLETED_EVENT)?.({ payload: completion }),
    publishRegistry: (next: ArchiveRegistry) =>
      handlers.get("archive-registry-changed")?.({ payload: next }),
  };
}

function requestedReconciliation(owner: ReturnType<typeof createClient>) {
  const call = owner.invoke.mock.calls.find(
    ([command]) => command === "request_archive_reconciliation",
  );
  if (!call) throw new Error("Reconciliation request was not invoked.");
  return (call[1] as { request: { archiveId: string; requestId: string; rootPath: string } })
    .request;
}

describe("SettingsArchiveMaintenanceClient", () => {
  describe("archive annotation export", () => {
    const createdAt = "2026-08-01T00:00:00.000Z";
    const bookmark = {
      id: "z",
      type: "bookmark",
      label: "Đọc tiếp",
      createdAt,
      updatedAt: createdAt,
    };
    const highlight = {
      id: "a",
      type: "highlight",
      selectedText: "雪",
      color: "yellow",
      note: "ghi chú",
      anchorStatus: "detached",
      cfiRange: "epubcfi(/6/2!/4/2/1:0)",
      chapterHref: "unopened.xhtml",
      contextBefore: "before text",
      contextAfter: "after text",
      createdAt,
      updatedAt: createdAt,
    };
    const snapshot = {
      activationRevision: 12,
      annotations: {
        version: 1,
        books: {
          z: { annotations: [bookmark, highlight] },
          empty: { annotations: [] },
          a: { annotations: [{ ...bookmark, id: "a" }] },
        },
      },
      library: {
        version: 1,
        books: {
          a: { relativePath: "folder/未読.epub", sourceMetadata: { creator: "Ánh" } },
          z: { relativePath: "missing.epub", sourceMetadata: { title: "Missing book" } },
          empty: { relativePath: "empty.epub" },
        },
      },
    };
    const saveMock = vi.mocked(save);
    const writer = vi.mocked(exportInvoke);

    async function setup(raw: unknown = snapshot) {
      saveMock.mockReset();
      writer.mockReset().mockResolvedValue(undefined);
      const owner = createClient(registry(archiveA));
      owner.archiveInvoke.mockResolvedValue(raw);
      await owner.client.initialize();
      const maintenance = owner.client.maintenance();
      if (!maintenance) throw new Error("Maintenance unavailable");
      return { ...owner, exportAnnotations: maintenance.exportAnnotations };
    }

    it.each(["json", "markdown"] as const)(
      "exports deterministic %s from metadata alone",
      async (format) => {
        const owner = await setup();
        const original = structuredClone(snapshot);
        const fileName =
          format === "json" ? "archeion-annotations.json" : "archeion-annotations.md";
        const path = `C:\\Exports\\${fileName}`;
        saveMock.mockResolvedValue(path);

        await expect(owner.exportAnnotations(format)).resolves.toEqual({
          annotationCount: 3,
          bookCount: 2,
          path,
          status: "saved",
        });
        expect(owner.archiveInvoke.mock.calls).toEqual([
          ["load_archive_annotation_snapshot", { archiveId: archiveA.id }, archiveA.rootPath],
        ]);
        expect(saveMock).toHaveBeenCalledWith(expect.objectContaining({ defaultPath: fileName }));
        expect(writer).toHaveBeenCalledWith("write_annotation_export_file", {
          archiveScope: {
            archiveId: archiveA.id,
            rootPath: archiveA.rootPath,
            activationRevision: 12,
          },
          contents: expect.any(String),
          format,
          path,
        });
        const args = writer.mock.calls[0]?.[1];
        const contents = args && "contents" in args ? args.contents : undefined;
        if (typeof contents !== "string") throw new Error("No export contents");
        if (format === "json") {
          expect(JSON.parse(contents)).toMatchObject({
            schema: "archeion.annotation-export",
            version: 1,
            books: [
              { id: "a", title: "未読", author: "Ánh" },
              {
                id: "z",
                title: "Missing book",
                annotations: [
                  { annotation: highlight, chapterLabel: "Chapter unavailable" },
                  { annotation: bookmark, chapterLabel: "Đọc tiếp" },
                ],
              },
            ],
          });
        } else {
          expect(contents).toContain("## 未読");
          expect(contents.indexOf("## 未読")).toBeLessThan(contents.indexOf("## Missing book"));
          expect(contents).toContain("### Chapter unavailable");
          expect(contents).toContain("### Đọc tiếp");
          expect(contents).toContain("**Detached:** Yes");
          expect(contents).toContain("ghi chú");
          for (const field of [
            "Book ID",
            "Annotation ID",
            "chapterHref",
            "cfiRange",
            "createdAt",
            "updatedAt",
            "color",
            "contextBefore",
            "contextAfter",
          ]) {
            expect(contents).toContain(`**${field}:**`);
          }
        }
        expect(snapshot).toEqual(original);
      },
    );

    it("identifies sidecar-only books with the same unavailable title in Markdown", async () => {
      const owner = await setup({
        ...snapshot,
        library: { version: 1, books: {} },
      });
      saveMock.mockResolvedValue("C:/Exports/annotations.md");
      await expect(owner.exportAnnotations("markdown")).resolves.toMatchObject({ bookCount: 2 });
      expect(writer).toHaveBeenCalledWith(
        "write_annotation_export_file",
        expect.objectContaining({
          contents: expect.stringMatching(
            /## Book details unavailable\n\n\*\*Book ID:\*\* a[\s\S]+## Book details unavailable\n\n\*\*Book ID:\*\* z/,
          ),
        }),
      );
    });

    it("skips the picker for an empty archive and skips the writer on cancellation", async () => {
      const empty = await setup({ ...snapshot, annotations: { version: 1, books: {} } });
      await expect(empty.exportAnnotations("json")).resolves.toEqual({ status: "empty" });
      expect(saveMock).not.toHaveBeenCalled();
      const owner = await setup();
      saveMock.mockResolvedValue(null);
      await expect(owner.exportAnnotations("json")).resolves.toEqual({ status: "cancelled" });
      expect(writer).not.toHaveBeenCalled();
    });

    it("reports a writer failure and permits a retry", async () => {
      const owner = await setup();
      saveMock.mockResolvedValue("C:/Exports/annotations.json");
      writer.mockRejectedValueOnce("The export folder is unavailable.");
      await expect(owner.exportAnnotations("json")).rejects.toBe(
        "The export folder is unavailable.",
      );
      await expect(owner.exportAnnotations("json")).resolves.toMatchObject({ status: "saved" });
    });

    it("rejects a stale snapshot before starting a save dialog", async () => {
      const owner = await setup();
      let finish: (value: unknown) => void = () => {};
      owner.archiveInvoke.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const exportResult = owner.exportAnnotations("json");
      owner.publishRegistry(registry(archiveB));
      finish(snapshot);
      await expect(exportResult).rejects.toThrow("active archive changed");
      expect(saveMock).not.toHaveBeenCalled();
      expect(writer).not.toHaveBeenCalled();
    });

    it("rejects the save path if the archive changes and switches back during the dialog", async () => {
      const owner = await setup();
      saveMock.mockImplementationOnce(async () => {
        owner.publishRegistry(registry(archiveB));
        owner.publishRegistry(registry(archiveA));
        return "C:/Exports/annotations.json";
      });
      await expect(owner.exportAnnotations("json")).rejects.toThrow("active archive changed");
      expect(writer).not.toHaveBeenCalled();
    });
  });

  it.each(["duplicates", "epub-issues"] as const)(
    "requests %s through the scoped main-window command",
    async (destination) => {
      const owner = createClient(registry(archiveA));
      await owner.client.initialize();
      const maintenance = owner.client.maintenance();
      if (!maintenance) throw new Error("Maintenance unavailable");
      await maintenance.openIntegrityResults(destination);
      expect(owner.invoke).toHaveBeenCalledWith("open_archive_integrity_results", {
        request: {
          archiveId: archiveA.id,
          rootPath: archiveA.rootPath,
          requestId: "settings-session-1-request-1",
          destination,
        },
      });
    },
  );
  it.each(["archive switch", "dispose"])(
    "rejects pending diagnostics after %s",
    async (replacement) => {
      const owner = createClient(registry(archiveA));
      await owner.client.initialize();
      let finish: (() => void) | undefined;
      owner.invoke.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
      const maintenance = owner.client.maintenance();
      if (!maintenance) throw new Error("Maintenance unavailable");
      const pending = maintenance.openIntegrityResults("duplicates");
      if (replacement === "dispose") owner.client.dispose();
      else owner.publishRegistry(registry(archiveB));
      if (!finish) throw new Error("Command did not start");
      finish();
      await expect(pending).rejects.toThrow(
        replacement === "dispose" ? "stopped" : "active archive changed",
      );
    },
  );
  it("shares successful initialization and keeps the ready result cached", async () => {
    const loadRegistry = vi.fn(async () => registry(archiveA));
    const owner = createClient(registry(archiveA), undefined, loadRegistry);

    const initialization = owner.client.initialize();
    expect(owner.client.initialize()).toBe(initialization);
    await initialization;

    expect(owner.client.initialize()).toBe(initialization);
    expect(loadRegistry).toHaveBeenCalledTimes(1);
    expect(owner.client.getSnapshot().status).toBe("ready");
  });

  it("cleans up a failed initialization and succeeds on retry", async () => {
    const loadRegistry = vi
      .fn<() => Promise<ArchiveRegistry>>()
      .mockRejectedValueOnce(new Error("registry unavailable"))
      .mockResolvedValueOnce(registry(archiveA));
    const owner = createClient(registry(archiveA), undefined, loadRegistry);

    await expect(owner.client.initialize()).rejects.toThrow("registry unavailable");
    expect(owner.client.getSnapshot().status).toBe("error");
    expect(owner.unlisten).toHaveBeenCalledTimes(2);

    await expect(owner.client.initialize()).resolves.toBeUndefined();

    expect(loadRegistry).toHaveBeenCalledTimes(2);
    expect(owner.client.getSnapshot()).toMatchObject({ archive: archiveA, status: "ready" });
  });

  it("reads active identity and follows archive changes without LibraryStorage", async () => {
    const owner = createClient(registry(archiveA));
    await owner.client.initialize();

    expect(owner.client.getSnapshot()).toMatchObject({
      archive: archiveA,
      generation: 1,
      status: "ready",
    });

    owner.publishRegistry(registry(archiveB));
    expect(owner.client.getSnapshot()).toMatchObject({
      archive: archiveB,
      generation: 2,
      status: "ready",
    });
  });

  it("keeps the boundary usable with no active archive", async () => {
    const owner = createClient(registry(null));
    await owner.client.initialize();

    expect(owner.client.getSnapshot()).toMatchObject({ archive: null, status: "unavailable" });
    expect(owner.client.maintenance()).toBeNull();
  });

  it("rejects an archive A completion after switching to archive B", async () => {
    const owner = createClient(registry(archiveA));
    await owner.client.initialize();

    const operation = owner.client.maintenance()!.rescan();
    await Promise.resolve();
    const request = requestedReconciliation(owner);
    owner.publishRegistry(registry(archiveB));
    owner.publishCompletion({ ...request, succeeded: true });

    await expect(operation).rejects.toThrow("active archive changed");
    expect(owner.invoke).not.toHaveBeenCalledWith("invalidate_archive_view", expect.anything());
  });

  it("waits for acknowledged reconciliation and never performs a duplicate Settings scan", async () => {
    const owner = createClient(registry(archiveA));
    await owner.client.initialize();

    let settled = false;
    const operation = owner.client
      .maintenance()!
      .rescan()
      .then(() => {
        settled = true;
      });
    await Promise.resolve();
    const request = requestedReconciliation(owner);

    expect(settled).toBe(false);
    expect(owner.archiveInvoke).not.toHaveBeenCalledWith(
      "scan_archive",
      expect.anything(),
      expect.anything(),
    );
    expect(owner.invoke).not.toHaveBeenCalledWith("invalidate_archive_view", expect.anything());

    owner.publishCompletion({ ...request, succeeded: true });
    await operation;

    expect(owner.invoke).toHaveBeenCalledWith("invalidate_archive_view", {
      archiveId: archiveA.id,
      rootPath: archiveA.rootPath,
    });
  });

  it("rejects reconciliation failure without publishing completion invalidation", async () => {
    const owner = createClient(registry(archiveA));
    await owner.client.initialize();

    const operation = owner.client.maintenance()!.rescan();
    await Promise.resolve();
    const request = requestedReconciliation(owner);
    owner.publishCompletion({ ...request, error: "persist failed", succeeded: false });

    await expect(operation).rejects.toThrow("persist failed");
    expect(owner.invoke).not.toHaveBeenCalledWith("invalidate_archive_view", expect.anything());
  });

  it("does not let an old Settings instance completion settle a recreated window request", async () => {
    const oldOwner = createClient(registry(archiveA), ["settings-old-request"]);
    await oldOwner.client.initialize();
    const oldOperation = oldOwner.client.maintenance()!.rescan();
    await Promise.resolve();
    const oldRequest = requestedReconciliation(oldOwner);
    const oldOutcome = oldOperation.catch((error: unknown) => error);

    oldOwner.client.dispose();
    const oldError = await oldOutcome;
    expect(oldError).toBeInstanceOf(Error);
    expect((oldError as Error).message).toContain("maintenance stopped");

    const newOwner = createClient(registry(archiveA), ["settings-new-request"]);
    await newOwner.client.initialize();
    let settled = false;
    const newOperation = newOwner.client
      .maintenance()!
      .rescan()
      .then(() => {
        settled = true;
      });
    await Promise.resolve();
    const newRequest = requestedReconciliation(newOwner);

    expect(newRequest.requestId).not.toBe(oldRequest.requestId);
    newOwner.publishCompletion({ ...oldRequest, succeeded: true });
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(newOwner.invoke).not.toHaveBeenCalledWith("invalidate_archive_view", expect.anything());

    newOwner.publishCompletion({ ...newRequest, succeeded: true });
    await newOperation;
    expect(settled).toBe(true);
  });

  it("rejects a matching request token with mismatched archive scope", async () => {
    const owner = createClient(registry(archiveA));
    await owner.client.initialize();

    const operation = owner.client.maintenance()!.rescan();
    await Promise.resolve();
    const request = requestedReconciliation(owner);
    owner.publishCompletion({
      ...request,
      archiveId: archiveB.id,
      rootPath: archiveB.rootPath,
      succeeded: true,
    });

    await expect(operation).rejects.toThrow("did not match its request");
    expect(owner.invoke).not.toHaveBeenCalledWith("invalidate_archive_view", expect.anything());
  });

  it("rejects completion after switching away from and back to the same archive identity", async () => {
    const owner = createClient(registry(archiveA));
    await owner.client.initialize();

    const operation = owner.client.maintenance()!.rescan();
    await Promise.resolve();
    const request = requestedReconciliation(owner);
    owner.publishRegistry(registry(archiveB));
    owner.publishRegistry(registry(archiveA));
    owner.publishCompletion({ ...request, succeeded: true });

    await expect(operation).rejects.toThrow("active archive changed");
    expect(owner.invoke).not.toHaveBeenCalledWith("invalidate_archive_view", expect.anything());
  });

  it("repairs metadata before awaiting the established final reconciliation", async () => {
    const owner = createClient(registry(archiveA));
    owner.archiveInvoke.mockImplementation(async (command: string) => {
      if (command === "cleanup_archive_import_artifacts") return { failures: [] };
      return undefined;
    });
    await owner.client.initialize();

    const operation = owner.client.maintenance()!.repairArchiveMetadata();
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    const request = requestedReconciliation(owner);

    expect(owner.archiveInvoke.mock.calls.map(([command]) => command)).toEqual([
      "initialize_archive_metadata",
      "cleanup_archive_import_artifacts",
      "maintain_cover_cache",
      "clear_scanner_cache",
    ]);
    expect(owner.invoke).not.toHaveBeenCalledWith("invalidate_archive_view", expect.anything());

    owner.publishCompletion({ ...request, succeeded: true });
    await operation;
    expect(owner.invoke).toHaveBeenCalledWith("invalidate_archive_view", {
      archiveId: archiveA.id,
      rootPath: archiveA.rootPath,
    });
  });

  it("rejects a repaired archive A when the archive switches before final reconciliation", async () => {
    const owner = createClient(registry(archiveA));
    owner.archiveInvoke.mockImplementation(async (command: string) => {
      if (command === "cleanup_archive_import_artifacts") return { failures: [] };
      return undefined;
    });
    await owner.client.initialize();

    const operation = owner.client.maintenance()!.repairArchiveMetadata();
    for (let index = 0; index < 8; index += 1) await Promise.resolve();
    const request = requestedReconciliation(owner);
    owner.publishRegistry(registry(archiveB));
    owner.publishCompletion({ ...request, succeeded: true });

    await expect(operation).rejects.toThrow("active archive changed");
    expect(owner.invoke).not.toHaveBeenCalledWith("invalidate_archive_view", expect.anything());
  });
});
