import { rm, mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { cleanupOwnedRuntime, removeOwnedDirectory } from "../scripts/runtime-smoke-cleanup.mjs";

function ownedProcesses() {
  return new Map([
    [
      41,
      {
        ProcessId: 41,
        ParentProcessId: 1,
        Name: "tauri-driver.exe",
        ExecutablePath: "C:\\tools\\tauri-driver.exe",
        StartedAt: "2026-09-30T00:00:00.0000000Z",
      },
    ],
    [
      42,
      {
        ProcessId: 42,
        ParentProcessId: 41,
        Name: "msedgedriver.exe",
        ExecutablePath: "C:\\scratch\\msedgedriver.exe",
        StartedAt: "2026-09-30T00:00:01.0000000Z",
      },
    ],
  ]);
}

describe("Windows runtime smoke cleanup", () => {
  it("closes the session and all owned driver processes before deleting scratch state", async () => {
    const processes = ownedProcesses();
    const events: string[] = [];
    await cleanupOwnedRuntime({
      session: {},
      closeSession: async () => {
        events.push("quit session");
      },
      processHandle: { pid: 41 },
      closed: Promise.resolve({}),
      snapshot: async () => [...processes.values()],
      terminate: async (pid: number) => {
        events.push(`stop ${pid}`);
        processes.delete(pid);
      },
      directories: [{ target: "C:\\scratch\\run-1", parent: "C:\\scratch" }],
      remove: async () => {
        expect(processes.size).toBe(0);
        events.push("delete scratch");
      },
    });
    expect(events).toEqual(["quit session", "stop 41", "stop 42", "delete scratch"]);
  });

  it("removes owned directories after session shutdown fails when every owned process exited", async () => {
    const processes = ownedProcesses();
    const events: string[] = [];
    let failure: unknown;
    try {
      await cleanupOwnedRuntime({
        session: {},
        closeSession: async () => {
          events.push("quit session");
          throw new Error("session close failed");
        },
        processHandle: { pid: 41 },
        closed: Promise.resolve({}),
        snapshot: async () => [...processes.values()],
        terminate: async (pid: number) => {
          events.push(`stop ${pid}`);
          processes.delete(pid);
        },
        directories: [
          { target: "C:\\scratch\\run-1", parent: "C:\\scratch" },
          { target: "C:\\settings\\smoke-1", parent: "C:\\settings" },
        ],
        remove: async (target: string) => {
          expect(processes.size).toBe(0);
          events.push(`delete ${target}`);
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(events).toEqual([
      "quit session",
      "stop 41",
      "stop 42",
      "delete C:\\scratch\\run-1",
      "delete C:\\settings\\smoke-1",
    ]);
    expect(failure).toBeInstanceOf(AggregateError);
    const [sessionFailure] = (failure as AggregateError).errors;
    expect(sessionFailure.message).toBe("WebDriver session shutdown failed");
    expect(sessionFailure.cause.message).toBe("session close failed");
  });

  it("preserves stream and directory failures together after process exit", async () => {
    const processes = ownedProcesses();
    let removalAttempted = false;
    let failure: unknown;
    try {
      await cleanupOwnedRuntime({
        processHandle: { pid: 41 },
        closed: Promise.resolve({ error: new Error("driver stream failed") }),
        snapshot: async () => [...processes.values()],
        terminate: async (pid: number) => {
          processes.delete(pid);
        },
        directories: [{ target: "C:\\scratch\\run-1", parent: "C:\\scratch" }],
        remove: async () => {
          expect(processes.size).toBe(0);
          removalAttempted = true;
          throw new Error("C:\\scratch\\run-1 remains locked");
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(removalAttempted).toBe(true);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors.map((error: Error) => error.message)).toEqual([
      "driver stream failed",
      "C:\\scratch\\run-1 remains locked",
    ]);
  });

  it("fails closed and retains scratch when an owned driver process will not exit", async () => {
    const processes = ownedProcesses();
    const events: string[] = [];
    let clock = 0;
    let failure: unknown;
    try {
      await cleanupOwnedRuntime({
        session: {},
        closeSession: async () => {
          throw new Error("session close failed");
        },
        processHandle: { pid: 41 },
        closed: Promise.resolve({}),
        snapshot: async () => [...processes.values()],
        terminate: async () => {
          throw new Error("process could not be stopped");
        },
        wait: async () => {},
        now: () => (clock += 5_000),
        directories: [{ target: "C:\\scratch\\run-1", parent: "C:\\scratch" }],
        remove: async () => {
          events.push("delete scratch");
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors.map((error: Error) => error.message)).toEqual([
      "WebDriver session shutdown failed",
      expect.stringMatching(/tauri-driver\.exe PID 41.*msedgedriver\.exe PID 42/),
    ]);
    expect(events).toEqual([]);
  });

  it("does not delete directories when process ownership cannot be established", async () => {
    const events: string[] = [];
    await expect(
      cleanupOwnedRuntime({
        processHandle: { pid: 41 },
        closed: Promise.resolve({}),
        snapshot: async () => {
          throw new Error("process inventory unavailable");
        },
        directories: [{ target: "C:\\scratch\\run-1", parent: "C:\\scratch" }],
        remove: async () => {
          events.push("delete scratch");
        },
      }),
    ).rejects.toThrow("process inventory unavailable");
    expect(events).toEqual([]);
  });

  it("does not treat a missing live driver PID as proof that cleanup is safe", async () => {
    let removalAttempted = false;
    await expect(
      cleanupOwnedRuntime({
        processHandle: { pid: 41, exitCode: null, signalCode: null },
        closed: Promise.resolve({}),
        snapshot: async () => [],
        directories: [{ target: "C:\\scratch\\run-1", parent: "C:\\scratch" }],
        remove: async () => {
          removalAttempted = true;
        },
      }),
    ).rejects.toThrow("Cannot verify shutdown of owned tauri-driver PID 41");
    expect(removalAttempted).toBe(false);
  });

  it("retries a transient executable lock, but reports a persistent lock with its path", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "archeion-runtime-cleanup-"));
    const target = path.join(parent, "run-1");
    const executable = path.join(target, "msedgedriver.exe");
    try {
      await mkdir(target);
      await writeFile(executable, "fixture");
      const waits: number[] = [];
      let attempts = 0;
      await removeOwnedDirectory(target, parent, {
        remove: async (directory: string, options: { recursive: boolean }) => {
          attempts += 1;
          if (attempts === 1) {
            throw Object.assign(new Error(`locked: ${executable}`), { code: "EPERM" });
          }
          await rm(directory, options);
        },
        wait: async (milliseconds: number) => {
          waits.push(milliseconds);
        },
      });
      expect(attempts).toBe(2);
      expect(waits).toEqual([100]);

      await mkdir(target);
      await writeFile(executable, "fixture");
      attempts = 0;
      await expect(
        removeOwnedDirectory(target, parent, {
          remove: async () => {
            attempts += 1;
            throw Object.assign(new Error(`locked: ${executable}`), { code: "EBUSY" });
          },
          wait: async () => {},
        }),
      ).rejects.toThrow(/Could not remove owned runtime directory.*run-1.*msedgedriver\.exe/);
      expect(attempts).toBe(6);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
