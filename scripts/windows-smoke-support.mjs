import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { promisify } from "node:util";
import JSZip from "jszip";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(import.meta.dirname, "..");

export async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", resolve),
  );
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

export async function runWindowsCommand(command, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: projectRoot,
    timeout: 90_000,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    ...options,
  });
  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
  return stdout;
}

export async function webViewRuntimeVersion() {
  const runtimeId = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
  const machineKey = `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${runtimeId}`;
  const userKey = `HKCU\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${runtimeId}`;
  let output;
  try {
    output = await runWindowsCommand("reg.exe", ["query", machineKey, "/v", "pv"]);
  } catch {
    output = await runWindowsCommand("reg.exe", ["query", userKey, "/v", "pv"]);
  }
  const version = /\bpv\s+REG_SZ\s+(\d+\.\d+\.\d+\.\d+)/i.exec(output)?.[1];
  assert.ok(
    version,
    "Could not determine installed WebView2 Runtime version for matching EdgeDriver",
  );
  return version;
}

export async function installMatchingEdgeDriver(runRoot) {
  const version = await webViewRuntimeVersion();
  const driverPath = path.join(runRoot, "msedgedriver.exe");
  const archivePath = path.join(runRoot, "edgedriver.zip");
  await runWindowsCommand("curl.exe", [
    "--fail",
    "--location",
    "--silent",
    "--show-error",
    "--max-time",
    "90",
    "--output",
    archivePath,
    `https://msedgedriver.microsoft.com/${version}/edgedriver_win64.zip`,
  ]);
  const archive = await JSZip.loadAsync(await readFile(archivePath));
  const executable = archive.file("msedgedriver.exe");
  assert.ok(executable, "Microsoft EdgeDriver archive did not contain msedgedriver.exe");
  await writeFile(driverPath, await executable.async("nodebuffer"));
  const reported = await runWindowsCommand(driverPath, ["--version"]);
  assert.ok(
    reported.includes(version),
    `EdgeDriver version does not match installed WebView2 Runtime ${version}`,
  );
  return driverPath;
}

export async function awaitDriver(port, processHandle) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null || processHandle.signalCode !== null)
      throw new Error(`tauri-driver exited: ${processHandle.exitCode ?? processHandle.signalCode}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/status`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) return;
    } catch {
      // The driver is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("tauri-driver did not start within 20 seconds");
}
