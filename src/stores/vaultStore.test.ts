import { invoke, isTauri } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { VaultStore } from "./vaultStore";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(),
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn(),
}));

const invokeMock = vi.mocked(invoke);
const isTauriMock = vi.mocked(isTauri);
const openMock = vi.mocked(open);

describe("VaultStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isTauriMock.mockReturnValue(true);
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_vault_path") {
        return null;
      }
      if (command === "validate_vault_path") {
        return true;
      }
      return undefined;
    });
  });

  it("starts in setup when no folder has been saved", async () => {
    const store = new VaultStore();

    await store.initialize();

    expect(store.getSnapshot()).toEqual({
      status: "setup",
      path: null,
      error: null,
    });
    expect(invokeMock).toHaveBeenCalledWith("load_vault_path");
  });

  it("restores a saved folder after validating it", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_vault_path") {
        return "D:\\Books";
      }
      return true;
    });
    const store = new VaultStore();

    await store.initialize();

    expect(invokeMock).toHaveBeenCalledWith("validate_vault_path", {
      path: "D:\\Books",
    });
    expect(store.getSnapshot()).toEqual({
      status: "ready",
      path: "D:\\Books",
      error: null,
    });
  });

  it("shows recovery when the saved folder is missing", async () => {
    invokeMock.mockImplementation(async (command) => {
      if (command === "load_vault_path") {
        return "E:\\Disconnected";
      }
      return false;
    });
    const store = new VaultStore();

    await store.initialize();

    expect(store.getSnapshot()).toEqual({
      status: "missing",
      path: "E:\\Disconnected",
      error: null,
    });
  });

  it("persists a folder selected with the native picker", async () => {
    openMock.mockResolvedValue("D:\\Novels");
    const store = new VaultStore();
    await store.initialize();

    await expect(store.chooseVault()).resolves.toBe(true);

    expect(invokeMock).toHaveBeenCalledWith("save_vault_path", {
      path: "D:\\Novels",
    });
    expect(store.getSnapshot()).toEqual({
      status: "ready",
      path: "D:\\Novels",
      error: null,
    });
  });

  it("leaves the current state unchanged when selection is canceled", async () => {
    openMock.mockResolvedValue(null);
    const store = new VaultStore();
    await store.initialize();

    await expect(store.chooseVault()).resolves.toBe(false);

    expect(store.getSnapshot()).toEqual({
      status: "setup",
      path: null,
      error: null,
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });
});
