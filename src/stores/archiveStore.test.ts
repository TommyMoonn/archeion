import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ArchiveRegistry } from "../types/archive";
import { ArchiveStore } from "./archiveStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const isTauriMock = vi.mocked(isTauri);
const listenMock = vi.mocked(listen);
const openMock = vi.mocked(open);

type ArchiveRegistryEvent = { payload: ArchiveRegistry & { mutationId?: string } };
let registryEventHandler: ((event: ArchiveRegistryEvent) => void) | undefined;

const emptyRegistry: ArchiveRegistry = {
  version: 1,
  archives: [],
  lastOpenedArchiveId: null,
};

const booksArchive = {
  id: "archive-books",
  displayName: "Books",
  rootPath: "D:\\Books",
  createdAt: "1",
  lastOpenedAt: "1",
};

const comicsArchive = {
  id: "archive-comics",
  displayName: "Comics",
  rootPath: "E:\\Comics",
  createdAt: "2",
  lastOpenedAt: "2",
};

function registry(activeId: string | null, archives = [booksArchive]): ArchiveRegistry {
  return {
    version: 1,
    archives,
    lastOpenedArchiveId: activeId,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("ArchiveStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    registryEventHandler = undefined;
    isTauriMock.mockReturnValue(true);
    listenMock.mockImplementation(async (_event, handler) => {
      registryEventHandler = handler as (event: ArchiveRegistryEvent) => void;
      return () => undefined;
    });
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return emptyRegistry;
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });
  });

  it("starts in setup when no archive has been saved", async () => {
    const store = new ArchiveStore();

    await store.initialize();

    expect(store.getSnapshot()).toEqual({
      status: "setup",
      path: null,
      error: null,
      archives: [],
    });
    expect(invokeMock).toHaveBeenCalledWith("load_archive_registry");
  });

  it("restores the last archive after validating it", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id);
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });
    const store = new ArchiveStore();

    await store.initialize();

    expect(invokeMock).toHaveBeenCalledWith("initialize_archive_metadata", {
      rootPath: "D:\\Books",
    });
    expect(store.getSnapshot()).toEqual({
      status: "ready",
      path: "D:\\Books",
      archive: booksArchive,
      error: null,
      watcherError: null,
      archives: [booksArchive],
    });
  });

  it("shows recovery when the last archive is missing", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id);
      }
      if (command === "validate_archive_path") {
        return false;
      }
      return undefined;
    });
    const store = new ArchiveStore();

    await store.initialize();

    expect(store.getSnapshot()).toEqual({
      status: "missing",
      path: "D:\\Books",
      archive: booksArchive,
      error: null,
      archives: [booksArchive],
    });
  });

  it("opens an archive selected with the native picker", async () => {
    openMock.mockResolvedValue("D:\\Novels");
    const novels = {
      id: "archive-novels",
      displayName: "Novels",
      rootPath: "D:\\Novels",
      createdAt: "3",
      lastOpenedAt: "3",
    };
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return emptyRegistry;
      }
      if (command === "open_archive") {
        return registry(novels.id, [novels]);
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.chooseArchive()).resolves.toBe(true);

    expect(openMock).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "Open folder as archive",
    });
    expect(invokeMock).toHaveBeenCalledWith(
      "open_archive",
      expect.objectContaining({ path: "D:\\Novels", mutationId: expect.any(String) }),
    );
    expect(invokeMock).toHaveBeenCalledWith("initialize_archive_metadata", {
      rootPath: "D:\\Novels",
    });
    expect(store.getSnapshot()).toEqual({
      status: "ready",
      path: "D:\\Novels",
      archive: novels,
      error: null,
      watcherError: null,
      archives: [novels],
    });
  });

  it("switches between registered archives without reopening the app", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "activate_archive") {
        return registry(comicsArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.switchArchive(comicsArchive.id)).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledWith("initialize_archive_metadata", {
      rootPath: "E:\\Comics",
    });
    expect(store.getSnapshot()).toEqual({
      status: "ready",
      path: "E:\\Comics",
      archive: comicsArchive,
      error: null,
      watcherError: null,
      archives: [booksArchive, comicsArchive],
    });
  });

  it("waits for transition guards before changing archive state or activating a target", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "activate_archive") {
        return registry(comicsArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();
    const settlement = deferred<boolean>();
    const guard = vi.fn(() => settlement.promise);
    store.registerTransitionGuard(guard);

    const switching = store.switchArchive(comicsArchive.id);
    await Promise.resolve();

    expect(guard).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: booksArchive });
    expect(invokeMock).not.toHaveBeenCalledWith("activate_archive", expect.anything());

    settlement.resolve(true);
    await expect(switching).resolves.toBe(true);
    expect(invokeMock).toHaveBeenCalledWith(
      "activate_archive",
      expect.objectContaining({ archiveId: comicsArchive.id, mutationId: expect.any(String) }),
    );
    expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: comicsArchive });
  });

  it("aborts an archive switch when a transition guard cannot settle", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();
    store.registerTransitionGuard(async () => false);

    await expect(store.switchArchive(comicsArchive.id)).resolves.toBe(false);

    expect(invokeMock).not.toHaveBeenCalledWith("activate_archive", expect.anything());
    expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: booksArchive });
  });

  it("guards archive-registry activation before publishing the new archive", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();
    const settlement = deferred<boolean>();
    store.registerTransitionGuard(() => settlement.promise);

    registryEventHandler?.({
      payload: registry(comicsArchive.id, [booksArchive, comicsArchive]),
    });
    await Promise.resolve();
    expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: booksArchive });

    settlement.resolve(true);
    await vi.waitFor(() => {
      expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: comicsArchive });
    });
  });

  it("keeps the current archive when a registry transition guard fails", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();
    store.registerTransitionGuard(async () => false);

    registryEventHandler?.({
      payload: registry(comicsArchive.id, [booksArchive, comicsArchive]),
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: booksArchive });
    expect(invokeMock).not.toHaveBeenCalledWith("initialize_archive_metadata", {
      rootPath: comicsArchive.rootPath,
    });
  });

  it("removes transition guards without affecting later archive changes", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "activate_archive") {
        return registry(comicsArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();
    const staleGuard = vi.fn(async () => false);
    const unregister = store.registerTransitionGuard(staleGuard);
    unregister();

    await expect(store.switchArchive(comicsArchive.id)).resolves.toBe(true);

    expect(staleGuard).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: comicsArchive });
  });

  it("settles multiple transition guards in registration order", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "activate_archive") {
        return registry(comicsArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();
    const firstSettlement = deferred<boolean>();
    const order: string[] = [];
    store.registerTransitionGuard(async () => {
      order.push("first:start");
      const settled = await firstSettlement.promise;
      order.push("first:end");
      return settled;
    });
    store.registerTransitionGuard(async () => {
      order.push("second");
      return true;
    });

    const switching = store.switchArchive(comicsArchive.id);
    await Promise.resolve();
    expect(order).toEqual(["first:start"]);

    firstSettlement.resolve(true);
    await expect(switching).resolves.toBe(true);
    expect(order).toEqual(["first:start", "first:end", "second"]);
  });

  it("supersedes an older request while its guard is settling", async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "load_archive_registry")
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      if (command === "activate_archive")
        return registry((args as { archiveId: string }).archiveId, [booksArchive, comicsArchive]);
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();
    const firstGuard = deferred<boolean>();
    const secondGuard = deferred<boolean>();
    const guard = vi
      .fn()
      .mockReturnValueOnce(firstGuard.promise)
      .mockReturnValueOnce(secondGuard.promise);
    store.registerTransitionGuard(guard);

    const first = store.switchArchive(comicsArchive.id);
    const second = store.switchArchive(booksArchive.id);
    firstGuard.resolve(true);
    await expect(first).resolves.toBe(false);
    expect(invokeMock).not.toHaveBeenCalledWith(
      "activate_archive",
      expect.objectContaining({ archiveId: comicsArchive.id }),
    );
    secondGuard.resolve(true);
    await expect(second).resolves.toBe(true);
    expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: booksArchive });
  });

  it("serializes native activation so the latest requested archive remains active", async () => {
    const firstActivation = deferred<ArchiveRegistry>();
    const secondActivation = deferred<ArchiveRegistry>();
    let nativeActiveId = booksArchive.id;
    const activations: string[] = [];
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "load_archive_registry")
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      if (command === "activate_archive") {
        const id = (args as { archiveId: string }).archiveId;
        activations.push(id);
        const result = await (id === comicsArchive.id
          ? firstActivation.promise
          : secondActivation.promise);
        nativeActiveId = id;
        return result;
      }
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    const first = store.switchArchive(comicsArchive.id);
    await vi.waitFor(() => expect(activations).toEqual([comicsArchive.id]));
    const second = store.switchArchive(booksArchive.id);
    await Promise.resolve();
    expect(activations).toEqual([comicsArchive.id]);

    firstActivation.resolve(registry(comicsArchive.id, [booksArchive, comicsArchive]));
    await expect(first).resolves.toBe(false);
    await vi.waitFor(() => expect(activations).toEqual([comicsArchive.id, booksArchive.id]));
    secondActivation.resolve(registry(booksArchive.id, [booksArchive, comicsArchive]));
    await expect(second).resolves.toBe(true);
    expect(nativeActiveId).toBe(booksArchive.id);
    expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: booksArchive });
  });

  it("does not treat its own native registry event as a newer transition", async () => {
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "load_archive_registry")
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      if (command === "activate_archive") {
        const changed = registry(comicsArchive.id, [booksArchive, comicsArchive]);
        registryEventHandler?.({
          payload: { ...changed, mutationId: (args as { mutationId: string }).mutationId },
        });
        return changed;
      }
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.switchArchive(comicsArchive.id)).resolves.toBe(true);
    expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: comicsArchive });
  });

  it("ignores a delayed first activation echo while a newer native activation is in flight", async () => {
    const firstActivation = deferred<ArchiveRegistry>();
    const secondActivation = deferred<ArchiveRegistry>();
    let firstMutationId: string | undefined;
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "load_archive_registry")
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      if (command === "activate_archive") {
        const activation = args as { archiveId: string; mutationId?: string };
        if (activation.archiveId === comicsArchive.id) {
          firstMutationId = activation.mutationId;
          return firstActivation.promise;
        }
        return secondActivation.promise;
      }
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();
    invokeMock.mockClear();

    const first = store.switchArchive(comicsArchive.id);
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "activate_archive",
        expect.objectContaining({ archiveId: comicsArchive.id }),
      ),
    );
    const second = store.switchArchive(booksArchive.id);
    firstActivation.resolve(registry(comicsArchive.id, [booksArchive, comicsArchive]));
    await expect(first).resolves.toBe(false);
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "activate_archive",
        expect.objectContaining({ archiveId: booksArchive.id }),
      ),
    );

    registryEventHandler?.({
      payload: {
        ...registry(comicsArchive.id, [booksArchive, comicsArchive]),
        mutationId: firstMutationId,
      },
    });
    secondActivation.resolve(registry(booksArchive.id, [booksArchive, comicsArchive]));
    await expect(second).resolves.toBe(true);
    expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: booksArchive });
    expect(invokeMock).not.toHaveBeenCalledWith("validate_archive_path", {
      path: comicsArchive.rootPath,
    });
    expect(invokeMock).not.toHaveBeenCalledWith("initialize_archive_metadata", {
      rootPath: comicsArchive.rootPath,
    });
  });

  it.each([undefined, "another-window:mutation"])(
    "processes an external registry event with mutation ID %s even when its contents match a local result",
    async (mutationId) => {
      invokeMock.mockImplementation(async (command, args) => {
        if (command === "load_archive_registry")
          return registry(booksArchive.id, [booksArchive, comicsArchive]);
        if (command === "activate_archive")
          return registry((args as { archiveId: string }).archiveId, [booksArchive, comicsArchive]);
        if (command === "validate_archive_path") return true;
        return undefined;
      });
      const store = new ArchiveStore();
      await store.initialize();
      await store.switchArchive(comicsArchive.id);
      invokeMock.mockClear();

      registryEventHandler?.({
        payload: { ...registry(comicsArchive.id, [booksArchive, comicsArchive]), mutationId },
      });
      await vi.waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith("validate_archive_path", {
          path: comicsArchive.rootPath,
        }),
      );
    },
  );

  it.each(["validate_archive_path", "initialize_archive_metadata"])(
    "ignores an older transition that finishes during %s",
    async (delayedCommand) => {
      const oldWork = deferred<boolean>();
      invokeMock.mockImplementation(async (command, args) => {
        if (command === "load_archive_registry")
          return registry(booksArchive.id, [booksArchive, comicsArchive]);
        if (command === "activate_archive")
          return registry((args as { archiveId: string }).archiveId, [booksArchive, comicsArchive]);
        const target =
          (args as { path?: string; rootPath?: string } | undefined)?.path ??
          (args as { rootPath?: string } | undefined)?.rootPath;
        if (command === delayedCommand && target === comicsArchive.rootPath) {
          return oldWork.promise;
        }
        if (command === "validate_archive_path") return true;
        return undefined;
      });
      const store = new ArchiveStore();
      await store.initialize();

      const first = store.switchArchive(comicsArchive.id);
      await vi.waitFor(() =>
        expect(invokeMock).toHaveBeenCalledWith(
          delayedCommand,
          delayedCommand === "validate_archive_path"
            ? { path: comicsArchive.rootPath }
            : { rootPath: comicsArchive.rootPath },
        ),
      );
      const second = store.switchArchive(booksArchive.id);
      await expect(second).resolves.toBe(true);
      oldWork.resolve(true);
      await expect(first).resolves.toBe(false);
      expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: booksArchive });
    },
  );

  it("does not let an older failure replace a newer ready state", async () => {
    const oldMetadata = deferred<void>();
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "load_archive_registry")
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      if (command === "activate_archive")
        return registry((args as { archiveId: string }).archiveId, [booksArchive, comicsArchive]);
      if (
        command === "initialize_archive_metadata" &&
        (args as { rootPath: string }).rootPath === comicsArchive.rootPath
      )
        return oldMetadata.promise;
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();
    const first = store.switchArchive(comicsArchive.id);
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("initialize_archive_metadata", {
        rootPath: comicsArchive.rootPath,
      }),
    );
    const second = store.switchArchive(booksArchive.id);
    await expect(second).resolves.toBe(true);
    oldMetadata.reject(new Error("stale metadata failure"));
    await expect(first).resolves.toBe(false);
    expect(store.getSnapshot()).toMatchObject({
      status: "ready",
      archive: booksArchive,
      error: null,
    });
  });

  it("does not let an older native failure clear a newer request", async () => {
    const oldActivation = deferred<ArchiveRegistry>();
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "load_archive_registry")
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      if (command === "activate_archive") {
        return (args as { archiveId: string }).archiveId === comicsArchive.id
          ? oldActivation.promise
          : registry(booksArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();
    const first = store.switchArchive(comicsArchive.id);
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "activate_archive",
        expect.objectContaining({ archiveId: comicsArchive.id }),
      ),
    );
    const second = store.switchArchive(booksArchive.id);
    oldActivation.reject(new Error("old activation failed"));
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      status: "ready",
      archive: booksArchive,
      error: null,
    });
  });

  it("does not let an older native failure event supersede a newer switch", async () => {
    const oldActivation = deferred<ArchiveRegistry>();
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "load_archive_registry")
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      if (command === "activate_archive") {
        const id = (args as { archiveId: string }).archiveId;
        if (id === comicsArchive.id) {
          await oldActivation.promise;
          registryEventHandler?.({
            payload: {
              ...registry(comicsArchive.id, [booksArchive, comicsArchive]),
              mutationId: (args as { mutationId: string }).mutationId,
            },
          });
          throw new Error("old activation failed");
        }
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();
    const first = store.switchArchive(comicsArchive.id);
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith(
        "activate_archive",
        expect.objectContaining({ archiveId: comicsArchive.id }),
      ),
    );
    const second = store.switchArchive(booksArchive.id);
    oldActivation.resolve(registry(comicsArchive.id, [booksArchive, comicsArchive]));
    await expect(first).resolves.toBe(false);
    await expect(second).resolves.toBe(true);
    expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: booksArchive });
  });

  it("keeps a registry-driven no-active transition ahead of stale validation", async () => {
    const oldValidation = deferred<boolean>();
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "load_archive_registry") return emptyRegistry;
      if (
        command === "validate_archive_path" &&
        (args as { path: string }).path === booksArchive.rootPath
      )
        return oldValidation.promise;
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();
    registryEventHandler?.({ payload: registry(booksArchive.id) });
    await vi.waitFor(() =>
      expect(invokeMock).toHaveBeenCalledWith("validate_archive_path", {
        path: booksArchive.rootPath,
      }),
    );
    registryEventHandler?.({ payload: emptyRegistry });
    await vi.waitFor(() => expect(store.getSnapshot()).toMatchObject({ status: "setup" }));
    oldValidation.resolve(true);
    await Promise.resolve();
    expect(store.getSnapshot()).toMatchObject({ status: "setup" });
  });

  it("does not let a delayed startup registry load replace a later archive request", async () => {
    const startup = deferred<ArchiveRegistry>();
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "load_archive_registry") return startup.promise;
      if (command === "activate_archive")
        return registry((args as { archiveId: string }).archiveId, [booksArchive, comicsArchive]);
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    const initializing = store.initialize();
    await expect(store.switchArchive(comicsArchive.id)).resolves.toBe(true);
    startup.resolve(registry(booksArchive.id, [booksArchive, comicsArchive]));
    await initializing;
    expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: comicsArchive });
  });

  it("renames an archive display name without changing its root path", async () => {
    const renamed = { ...booksArchive, displayName: "Novels" };
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id);
      }
      if (command === "rename_archive") {
        return registry(renamed.id, [renamed]);
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.renameArchive(booksArchive.id, "Novels")).resolves.toBe(true);

    expect(store.getSnapshot()).toMatchObject({
      status: "ready",
      path: "D:\\Books",
      archive: renamed,
      archives: [renamed],
    });
  });

  it("does not treat a native rename echo as a competing archive transition", async () => {
    const renamed = { ...booksArchive, displayName: "Novels" };
    invokeMock.mockImplementation(async (command, args) => {
      if (command === "load_archive_registry") return registry(booksArchive.id);
      if (command === "rename_archive") {
        const changed = registry(renamed.id, [renamed]);
        registryEventHandler?.({
          payload: { ...changed, mutationId: (args as { mutationId?: string }).mutationId },
        });
        return changed;
      }
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();
    invokeMock.mockClear();

    await expect(store.renameArchive(booksArchive.id, "Novels")).resolves.toBe(true);
    expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: renamed });
    expect(invokeMock).not.toHaveBeenCalledWith("validate_archive_path", expect.anything());
    expect(invokeMock).not.toHaveBeenCalledWith("initialize_archive_metadata", expect.anything());
  });

  it("forgets the active archive without deleting local files", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id);
      }
      if (command === "forget_archive") {
        return emptyRegistry;
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.forgetArchive(booksArchive.id)).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledWith(
      "forget_archive",
      expect.objectContaining({ archiveId: booksArchive.id, mutationId: expect.any(String) }),
    );
    expect(store.getSnapshot()).toEqual({
      status: "setup",
      path: null,
      error: null,
      archives: [],
    });
  });

  it("reveals only the archive identity that is currently active", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") return registry(booksArchive.id);
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.revealActiveArchive(booksArchive)).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledWith("reveal_archive", {
      archiveId: booksArchive.id,
    });
  });

  it.each([
    ["archive ID", comicsArchive],
    ["archive root", { ...booksArchive, rootPath: "E:\\Moved Books" }],
  ])("rejects a stale reveal after the active %s is replaced", async (_identity, replacement) => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") return registry(booksArchive.id);
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    registryEventHandler?.({
      payload: registry(replacement.id, [replacement]),
    });
    await vi.waitFor(() => {
      expect(store.getSnapshot()).toMatchObject({
        status: "ready",
        archive: replacement,
      });
    });
    invokeMock.mockClear();

    await expect(store.revealActiveArchive(booksArchive)).resolves.toBe(false);

    expect(invokeMock).not.toHaveBeenCalledWith("reveal_archive", expect.anything());
  });

  it("does not invoke native reveal for an unavailable active root", async () => {
    const unavailableArchive = { ...booksArchive, rootPath: " " };
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(unavailableArchive.id, [unavailableArchive]);
      }
      if (command === "validate_archive_path") return true;
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();
    invokeMock.mockClear();

    await expect(store.revealActiveArchive(unavailableArchive)).resolves.toBe(false);

    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("opens the separate archive manager window through Tauri", async () => {
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.openArchiveManagerWindow()).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledWith("open_archive_manager_window");
  });

  it("does not change archive state when the manager window command fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return emptyRegistry;
      }
      if (command === "open_archive_manager_window") {
        throw new Error("window failed");
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.openArchiveManagerWindow()).resolves.toBe(false);

    expect(store.getSnapshot()).toEqual({
      status: "setup",
      path: null,
      error: null,
      archives: [],
    });
    expect(consoleError).toHaveBeenCalledWith(
      "open_archive_manager_window failed",
      expect.any(Error),
    );
    consoleError.mockRestore();
  });

  it("focuses the main window through Tauri", async () => {
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.focusMainWindow()).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledWith("focus_main_window");
  });

  it("refreshes the active archive after the startup manager closes", async () => {
    const store = new ArchiveStore();
    await store.initialize();

    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id);
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });

    await expect(store.refreshActiveArchive()).resolves.toBe(true);
    expect(store.getSnapshot()).toMatchObject({
      status: "ready",
      archive: booksArchive,
      path: booksArchive.rootPath,
    });
  });

  it("applies archive registry events from another window", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id, [booksArchive, comicsArchive]);
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    registryEventHandler?.({
      payload: registry(comicsArchive.id, [booksArchive, comicsArchive]),
    });

    await vi.waitFor(() => {
      expect(store.getSnapshot()).toMatchObject({
        status: "ready",
        path: "E:\\Comics",
        archive: comicsArchive,
        archives: [booksArchive, comicsArchive],
      });
    });
    expect(invokeMock).toHaveBeenCalledWith("initialize_archive_metadata", {
      rootPath: "E:\\Comics",
    });
  });

  it("stores recoverable watcher errors without changing the active archive", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id);
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    store.setWatcherError("Live refresh paused.");

    expect(store.getSnapshot()).toMatchObject({
      status: "ready",
      path: "D:\\Books",
      watcherError: "Live refresh paused.",
    });

    store.setWatcherError(null);

    expect(store.getSnapshot()).toMatchObject({
      status: "ready",
      path: "D:\\Books",
      watcherError: null,
    });
  });

  it("leaves the current state unchanged when selection is canceled", async () => {
    openMock.mockResolvedValue(null);
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.chooseArchive()).resolves.toBe(false);

    expect(store.getSnapshot()).toEqual({
      status: "setup",
      path: null,
      error: null,
      archives: [],
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("chooses an archive parent location without opening or activating it", async () => {
    openMock.mockResolvedValue("D:\\Books");
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.chooseArchiveParentLocation()).resolves.toBe("D:\\Books");

    expect(openMock).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "Choose archive location",
    });
    expect(invokeMock).not.toHaveBeenCalledWith("open_archive", expect.anything());
    expect(store.getSnapshot()).toEqual({
      status: "setup",
      path: null,
      error: null,
      archives: [],
    });
  });

  it("keeps archive state unchanged when parent location selection is canceled", async () => {
    openMock.mockResolvedValue(null);
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.chooseArchiveParentLocation()).resolves.toBe(null);

    expect(store.getSnapshot()).toEqual({
      status: "setup",
      path: null,
      error: null,
      archives: [],
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("creates an empty archive from separate name and parent path", async () => {
    const emptyArchive = {
      id: "archive-empty",
      displayName: "Light Novels",
      rootPath: "D:\\Books\\Light Novels",
      createdAt: "4",
      lastOpenedAt: "4",
    };
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return emptyRegistry;
      }
      if (command === "create_empty_archive") {
        return registry(emptyArchive.id, [emptyArchive]);
      }
      if (command === "validate_archive_path") {
        return true;
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    await expect(
      store.createEmptyArchive({
        archiveName: "Light Novels",
        parentPath: "D:\\Books",
      }),
    ).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledWith(
      "create_empty_archive",
      expect.objectContaining({
        archiveName: "Light Novels",
        parentPath: "D:\\Books",
        mutationId: expect.any(String),
      }),
    );
    expect(invokeMock).toHaveBeenCalledWith("initialize_archive_metadata", {
      rootPath: "D:\\Books\\Light Novels",
    });
    expect(store.getSnapshot()).toMatchObject({
      status: "ready",
      path: "D:\\Books\\Light Novels",
      archive: emptyArchive,
      archives: [emptyArchive],
    });
  });

  it("preserves current archive state when guided creation fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return registry(booksArchive.id);
      }
      if (command === "validate_archive_path") {
        return true;
      }
      if (command === "create_empty_archive") {
        throw "Archive folder already exists.";
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    await expect(
      store.createEmptyArchive({
        archiveName: "Books",
        parentPath: "D:\\",
      }),
    ).resolves.toBe(false);

    expect(store.getLastOperationError()).toBe("Archive folder already exists.");
    expect(store.getSnapshot()).toMatchObject({
      status: "ready",
      path: "D:\\Books",
      archive: booksArchive,
      archives: [booksArchive],
    });
    expect(consoleError).toHaveBeenCalledWith(
      "create_empty_archive failed",
      "Archive folder already exists.",
    );
    consoleError.mockRestore();
  });

  it("surfaces the actual open_archive error message", async () => {
    const openError = "Choose the archive folder, not an .archeion metadata folder.";
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    openMock.mockResolvedValue("D:\\Books\\.archeion");
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_archive_registry") {
        return emptyRegistry;
      }
      if (command === "open_archive") {
        throw openError;
      }
      return undefined;
    });
    const store = new ArchiveStore();
    await store.initialize();

    await expect(store.chooseArchive()).resolves.toBe(false);

    expect(store.getSnapshot()).toEqual({
      status: "error",
      path: "D:\\Books\\.archeion",
      error: openError,
      archives: [],
    });
    expect(consoleError).toHaveBeenCalledWith("open_archive failed", openError);
    consoleError.mockRestore();
  });

  describe("registry event connection", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.spyOn(console, "error").mockImplementation(() => undefined);
    });

    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    it("retries a failed subscription without repeating archive initialization", async () => {
      const unlisten = vi.fn();
      listenMock
        .mockRejectedValueOnce(new Error("event bridge unavailable"))
        .mockResolvedValueOnce(unlisten);
      const store = new ArchiveStore();

      await store.initialize();
      expect(store.getSnapshot().status).toBe("setup");
      expect(listenMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(249);
      expect(listenMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(listenMock).toHaveBeenCalledTimes(2);
      await store.initialize();
      expect(invokeMock).toHaveBeenCalledTimes(1);
      expect(listenMock).toHaveBeenCalledTimes(2);
      store.dispose();
      expect(unlisten).toHaveBeenCalledOnce();
    });

    it("backs off repeated failures and never overlaps subscription attempts", async () => {
      const attempts: ReturnType<typeof deferred<() => void>>[] = [];
      listenMock.mockImplementation(() => {
        const attempt = deferred<() => void>();
        attempts.push(attempt);
        return attempt.promise;
      });
      const store = new ArchiveStore();

      await store.initialize();
      await store.initialize();
      expect(attempts).toHaveLength(1);
      attempts[0].reject(new Error("first failure"));
      await vi.advanceTimersByTimeAsync(249);
      expect(attempts).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(attempts).toHaveLength(2);
      await store.initialize();
      expect(attempts).toHaveLength(2);
      attempts[1].reject(new Error("second failure"));
      await vi.advanceTimersByTimeAsync(499);
      expect(attempts).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(attempts).toHaveLength(3);
      attempts[2].resolve(() => undefined);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(attempts).toHaveLength(3);
      store.dispose();
    });

    it("caps retry backoff while continuing to recover from transient failures", async () => {
      listenMock.mockRejectedValue(new Error("event bridge unavailable"));
      const store = new ArchiveStore();
      await store.initialize();

      for (const delay of [250, 500, 1_000, 2_000, 4_000, 8_000, 16_000]) {
        await vi.advanceTimersByTimeAsync(delay);
      }
      expect(listenMock).toHaveBeenCalledTimes(8);
      await vi.advanceTimersByTimeAsync(29_999);
      expect(listenMock).toHaveBeenCalledTimes(8);
      await vi.advanceTimersByTimeAsync(1);
      expect(listenMock).toHaveBeenCalledTimes(9);
      store.dispose();
    });

    it("cancels a pending reconnect when disposed", async () => {
      listenMock.mockRejectedValueOnce(new Error("event bridge unavailable"));
      const store = new ArchiveStore();
      await store.initialize();

      store.dispose();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(listenMock).toHaveBeenCalledTimes(1);
    });

    it("unsubscribes a listener that resolves after disposal", async () => {
      const pending = deferred<() => void>();
      const unlisten = vi.fn();
      listenMock.mockImplementationOnce(() => pending.promise);
      const store = new ArchiveStore();
      await store.initialize();

      store.dispose();
      pending.resolve(unlisten);
      await vi.advanceTimersByTimeAsync(0);
      expect(unlisten).toHaveBeenCalledOnce();
      expect(listenMock).toHaveBeenCalledTimes(1);
    });

    it("waits for subscription success before applying an early registry event", async () => {
      const pending = deferred<() => void>();
      let earlyHandler: ((event: ArchiveRegistryEvent) => void) | undefined;
      listenMock.mockImplementationOnce((_event, handler) => {
        earlyHandler = handler as (event: ArchiveRegistryEvent) => void;
        return pending.promise;
      });
      invokeMock.mockImplementation(async (command) => {
        if (command === "load_archive_registry") return registry(booksArchive.id);
        if (command === "validate_archive_path") return true;
        return undefined;
      });
      const store = new ArchiveStore();
      await store.initialize();

      earlyHandler?.({ payload: registry(comicsArchive.id, [booksArchive, comicsArchive]) });
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: booksArchive });
      pending.resolve(() => undefined);
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: comicsArchive });
      store.dispose();
    });

    it("does not publish a registry transition still validating when disposed", async () => {
      const validation = deferred<boolean>();
      invokeMock.mockImplementation(async (command, args) => {
        if (command === "load_archive_registry") return registry(booksArchive.id);
        if (command === "validate_archive_path") {
          return (args as { path: string }).path === comicsArchive.rootPath
            ? validation.promise
            : true;
        }
        return undefined;
      });
      const unlisten = vi.fn();
      listenMock.mockImplementationOnce(async (_event, handler) => {
        registryEventHandler = handler as (event: ArchiveRegistryEvent) => void;
        return unlisten;
      });
      const store = new ArchiveStore();
      await store.initialize();

      registryEventHandler?.({
        payload: registry(comicsArchive.id, [booksArchive, comicsArchive]),
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(invokeMock).toHaveBeenCalledWith("validate_archive_path", {
        path: comicsArchive.rootPath,
      });
      store.dispose();
      validation.resolve(true);
      await vi.advanceTimersByTimeAsync(0);
      expect(unlisten).toHaveBeenCalledOnce();
      expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: booksArchive });
      expect(invokeMock).not.toHaveBeenCalledWith("initialize_archive_metadata", {
        rootPath: comicsArchive.rootPath,
      });
    });

    it("ignores callbacks from an older failed subscription after reconnect", async () => {
      invokeMock.mockImplementation(async (command) => {
        if (command === "load_archive_registry") return registry(booksArchive.id);
        if (command === "validate_archive_path") return true;
        return undefined;
      });
      let oldHandler: ((event: ArchiveRegistryEvent) => void) | undefined;
      listenMock.mockImplementationOnce(async (_event, handler) => {
        oldHandler = handler as (event: ArchiveRegistryEvent) => void;
        throw new Error("event bridge unavailable");
      });
      const store = new ArchiveStore();
      await store.initialize();
      await vi.advanceTimersByTimeAsync(250);

      oldHandler?.({ payload: registry(comicsArchive.id, [booksArchive, comicsArchive]) });
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: booksArchive });
      expect(invokeMock).not.toHaveBeenCalledWith("validate_archive_path", {
        path: comicsArchive.rootPath,
      });

      registryEventHandler?.({
        payload: registry(comicsArchive.id, [booksArchive, comicsArchive]),
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: comicsArchive });
    });

    it("reconciles cross-window create, activate, rename, and forget after retry", async () => {
      invokeMock.mockImplementation(async (command) => {
        if (command === "load_archive_registry") return registry(booksArchive.id);
        if (command === "validate_archive_path") return true;
        return undefined;
      });
      listenMock.mockRejectedValueOnce(new Error("event bridge unavailable"));
      const store = new ArchiveStore();
      await store.initialize();
      await vi.advanceTimersByTimeAsync(250);

      registryEventHandler?.({ payload: registry(booksArchive.id, [booksArchive, comicsArchive]) });
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getSnapshot()).toMatchObject({
        status: "ready",
        archive: booksArchive,
        archives: [booksArchive, comicsArchive],
      });

      registryEventHandler?.({
        payload: registry(comicsArchive.id, [booksArchive, comicsArchive]),
      });
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: comicsArchive });

      const renamed = { ...comicsArchive, displayName: "Graphic Novels" };
      registryEventHandler?.({ payload: registry(renamed.id, [booksArchive, renamed]) });
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getSnapshot()).toMatchObject({ status: "ready", archive: renamed });

      registryEventHandler?.({ payload: registry(booksArchive.id) });
      await vi.advanceTimersByTimeAsync(0);
      expect(store.getSnapshot()).toMatchObject({
        status: "ready",
        archive: booksArchive,
        archives: [booksArchive],
      });
    });
  });
});
