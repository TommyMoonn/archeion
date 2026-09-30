import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { lstat, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function requireContained(target, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  assert.ok(
    relative &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
    `Refusing to clean a path outside ${parent}: ${target}`,
  );
}

export async function removeOwnedDirectory(target, parent, { remove = rm, wait = pause } = {}) {
  let entry;
  try {
    entry = await lstat(target);
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  assert.ok(
    entry.isDirectory() && !entry.isSymbolicLink(),
    `Refusing to remove unexpected path: ${target}`,
  );
  requireContained(await realpath(target), await realpath(parent));

  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await remove(target, { recursive: true });
      return;
    } catch (error) {
      if (error.code === "ENOENT") return;
      if (!["EPERM", "EBUSY"].includes(error.code) || attempt === 5) {
        throw new Error(`Could not remove owned runtime directory ${target}: ${error.message}`, {
          cause: error,
        });
      }
      await wait(Math.min(100 * 2 ** attempt, 1_000));
    }
  }
}

async function listWindowsProcesses() {
  const command =
    '$items = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, @{Name="StartedAt"; Expression={if ($_.CreationDate) {$_.CreationDate.ToString("o")}}}); ConvertTo-Json -InputObject $items -Compress';
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  return JSON.parse(stdout.trim().replace(/^\uFEFF/, ""));
}

async function terminateProcessTree(pid) {
  await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    windowsHide: true,
  });
}

function collectOwnedProcesses(processes, rootPid, owned) {
  const root = processes.find((process) => process.ProcessId === rootPid);
  if (root) {
    assert.equal(
      root.Name.toLowerCase(),
      "tauri-driver.exe",
      `Owned tauri-driver PID ${rootPid} now belongs to ${root.Name}`,
    );
  }
  const parentIds = new Set([rootPid, ...owned.keys()]);
  let added;
  do {
    added = false;
    for (const process of processes) {
      if (process.ProcessId !== rootPid && parentIds.has(process.ParentProcessId)) {
        if (!owned.has(process.ProcessId)) {
          assert.ok(process.StartedAt, `Missing creation time for owned PID ${process.ProcessId}`);
          owned.set(process.ProcessId, process);
          added = true;
        }
        parentIds.add(process.ProcessId);
      }
    }
  } while (added);
  if (root) {
    assert.ok(root.StartedAt, `Missing creation time for owned PID ${rootPid}`);
    const known = owned.get(rootPid);
    if (known && known.StartedAt !== root.StartedAt) {
      throw new Error(`Owned tauri-driver PID ${rootPid} was reused before cleanup`);
    }
    owned.set(rootPid, root);
  }
}

function stillRunning(processes, owned) {
  return processes.filter((process) => {
    const known = owned.get(process.ProcessId);
    return known && known.StartedAt === process.StartedAt;
  });
}

async function within(promise, milliseconds, message) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export async function shutdownOwnedDriver({
  session,
  closeSession,
  processHandle,
  closed,
  snapshot = listWindowsProcesses,
  terminate = terminateProcessTree,
  wait = pause,
  now = Date.now,
}) {
  const failures = [];
  if (!processHandle) {
    if (session) {
      try {
        await within(closeSession(session), 10_000, "WebDriver session did not close");
      } catch (error) {
        failures.push(new Error("WebDriver session shutdown failed", { cause: error }));
      }
      failures.push(new Error("Cannot verify owned driver processes without a process handle"));
    }
    return { processesStopped: !session, failures };
  }

  const owned = new Map();
  let ownershipEstablished = false;
  try {
    collectOwnedProcesses(await snapshot(), processHandle.pid, owned);
    ownershipEstablished = true;
  } catch (error) {
    failures.push(error);
  }
  if (session) {
    try {
      await within(closeSession(session), 10_000, "WebDriver session did not close");
    } catch (error) {
      failures.push(new Error("WebDriver session shutdown failed", { cause: error }));
    }
  }

  let processesStopped = false;
  if (ownershipEstablished) {
    try {
      let processes = await snapshot();
      let running = stillRunning(processes, owned);
      const rootRunning = running.some((process) => process.ProcessId === processHandle.pid);
      if (rootRunning) {
        await terminate(processHandle.pid).catch(() => {});
        processes = await snapshot();
        running = stillRunning(processes, owned);
      }
      for (const process of running.filter((item) => item.ProcessId !== processHandle.pid)) {
        await terminate(process.ProcessId).catch(() => {});
      }

      const deadline = now() + 10_000;
      while (true) {
        processes = await snapshot();
        running = stillRunning(processes, owned);
        if (running.length === 0) break;
        if (now() >= deadline) {
          throw new Error(
            `Owned runtime processes did not exit: ${running.map((process) => `${process.Name} PID ${process.ProcessId} (${process.ExecutablePath ?? "unknown path"})`).join(", ")}`,
          );
        }
        await wait(100);
      }
      processesStopped = true;
    } catch (error) {
      failures.push(error);
    }
  }
  if (closed) {
    try {
      const result = await within(closed, 10_000, "tauri-driver streams did not close");
      if (result?.error) throw result.error;
    } catch (error) {
      failures.push(error);
    }
  }
  if (
    processesStopped &&
    owned.size === 0 &&
    processHandle.exitCode == null &&
    processHandle.signalCode == null
  ) {
    processesStopped = false;
    failures.push(
      new Error(`Cannot verify shutdown of owned tauri-driver PID ${processHandle.pid}`),
    );
  }
  return { processesStopped, failures };
}

export async function cleanupOwnedRuntime({
  directories,
  remove = removeOwnedDirectory,
  ...driver
}) {
  const { processesStopped, failures } = await shutdownOwnedDriver(driver);
  if (processesStopped) {
    const results = await Promise.allSettled(
      directories.map(({ target, parent }) => remove(target, parent)),
    );
    failures.push(
      ...results.flatMap((result) => (result.status === "rejected" ? [result.reason] : [])),
    );
  }
  if (failures.length) {
    throw new AggregateError(
      failures,
      `Runtime smoke cleanup failed: ${failures.map((error) => error.message).join("; ")}`,
    );
  }
}
