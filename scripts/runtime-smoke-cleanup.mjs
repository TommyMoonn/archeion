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

export async function listWindowsProcesses() {
  const command =
    '$items = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, ExecutablePath, CommandLine, @{Name="StartedAt"; Expression={if ($_.CreationDate) {$_.CreationDate.ToString("o")}}}); ConvertTo-Json -InputObject $items -Compress';
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", command],
    { windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
  );
  return JSON.parse(stdout.trim().replace(/^\uFEFF/, ""));
}

export async function terminateProcessTree(pid) {
  await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
    windowsHide: true,
  });
}

export async function terminateProcess(pid, execute = execFileAsync) {
  assert.ok(Number.isInteger(pid) && pid > 0, "Invalid owned process ID");
  // Each descendant is verified separately; /T would also follow stale Windows parent PIDs.
  await execute("taskkill.exe", ["/PID", String(pid), "/F"], { windowsHide: true });
}

export async function listOwnedApplications(
  application,
  startedAt,
  snapshot = listWindowsProcesses,
) {
  return (await snapshot()).filter((process) => {
    if (
      !process.ExecutablePath ||
      path.resolve(process.ExecutablePath).toLowerCase() !== path.resolve(application).toLowerCase()
    )
      return false;
    assert.ok(
      process.StartedAt && Number.isFinite(Date.parse(process.StartedAt)),
      "Missing owned application creation time",
    );
    return Date.parse(process.StartedAt) >= startedAt;
  });
}

export async function stopOwnedApplications(
  application,
  startedAt,
  {
    snapshot = listWindowsProcesses,
    terminate = terminateProcessTree,
    wait = pause,
    now = Date.now,
  } = {},
) {
  const captured = await listOwnedApplications(application, startedAt, snapshot);
  for (const process of captured) {
    const current = (await listOwnedApplications(application, startedAt, snapshot)).find(
      (item) => item.ProcessId === process.ProcessId && item.StartedAt === process.StartedAt,
    );
    if (current) await terminate(current.ProcessId);
  }
  const deadline = now() + 10_000;
  while ((await listOwnedApplications(application, startedAt, snapshot)).length) {
    if (now() >= deadline) throw new Error("Owned updater applications did not exit");
    await wait(100);
  }
}

function collectOwnedProcesses(processes, rootPid, owned) {
  const root = processes.find((process) => process.ProcessId === rootPid);
  if (root) {
    assert.equal(
      root.Name.toLowerCase(),
      "tauri-driver.exe",
      `Owned tauri-driver PID ${rootPid} now belongs to ${root.Name}`,
    );
    assert.ok(
      root.StartedAt && Number.isFinite(Date.parse(root.StartedAt)),
      `Missing creation time for owned PID ${rootPid}`,
    );
    const known = owned.get(rootPid);
    if (known && known.StartedAt !== root.StartedAt) {
      throw new Error(`Owned tauri-driver PID ${rootPid} was reused before cleanup`);
    }
    owned.set(rootPid, root);
  }
  let added;
  do {
    added = false;
    for (const process of processes) {
      const parent = owned.get(process.ParentProcessId);
      if (process.ProcessId !== rootPid && parent) {
        assert.ok(
          process.StartedAt && Number.isFinite(Date.parse(process.StartedAt)),
          `Missing creation time for owned PID ${process.ProcessId}`,
        );
        // Win32 retains ParentProcessId after the parent exits. Its PID may now
        // identify our newer driver, but a child cannot predate its actual parent.
        if (Date.parse(process.StartedAt) < Date.parse(parent.StartedAt)) continue;
        if (!owned.has(process.ProcessId)) {
          owned.set(process.ProcessId, process);
          added = true;
        }
      }
    }
  } while (added);
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
  terminate = terminateProcess,
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
      for (const process of running) {
        const current = stillRunning(await snapshot(), owned).find(
          (item) => item.ProcessId === process.ProcessId,
        );
        if (current) await terminate(current.ProcessId).catch(() => {});
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
