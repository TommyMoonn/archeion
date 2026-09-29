import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import JSZip from "jszip";
import { Builder, Capabilities } from "selenium-webdriver";

import { runRuntimeFlows } from "../tests/runtime/windowsRuntimeSmoke.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratchRoot = path.join(projectRoot, ".scratch", "runtime-smoke");
const evidenceRoot = path.join(projectRoot, "test-results", "runtime-smoke");
const tauriDriverPath = path.join(
  projectRoot,
  ".scratch",
  "runtime-smoke-tools",
  "bin",
  "tauri-driver.exe",
);
const binaryPath = path.join(
  projectRoot,
  "src-tauri",
  "target",
  "release",
  "ArcheionRuntimeSmoke.exe",
);

function requireContained(target, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(target));
  assert.ok(
    relative &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative),
    `Refusing to clean a path outside ${parent}: ${target}`,
  );
}

async function assertAbsent(target) {
  try {
    await lstat(target);
    throw new Error(`Refusing to use pre-existing test state: ${target}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function removeOwnedDirectory(target, parent) {
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
  await rm(target, { recursive: true });
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) =>
    server.once("error", reject).listen(0, "127.0.0.1", resolve),
  );
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function run(command, args, options = {}) {
  const { stdout, stderr } = await execFileAsync(command, args, {
    cwd: projectRoot,
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    ...options,
  });
  if (stdout.trim()) process.stdout.write(stdout);
  if (stderr.trim()) process.stderr.write(stderr);
  return stdout;
}

async function webViewRuntimeVersion() {
  const runtimeId = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}";
  const machineKey = `HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\EdgeUpdate\\Clients\\${runtimeId}`;
  const userKey = `HKCU\\SOFTWARE\\Microsoft\\EdgeUpdate\\Clients\\${runtimeId}`;
  let output;
  try {
    output = await run("reg.exe", ["query", machineKey, "/v", "pv"]);
  } catch {
    output = await run("reg.exe", ["query", userKey, "/v", "pv"]);
  }
  const version = /\bpv\s+REG_SZ\s+(\d+\.\d+\.\d+\.\d+)/i.exec(output)?.[1];
  assert.ok(
    version,
    "Could not determine installed WebView2 Runtime version for matching EdgeDriver",
  );
  return version;
}

async function installMatchingEdgeDriver(runRoot) {
  const version = await webViewRuntimeVersion();
  const driverPath = path.join(runRoot, "msedgedriver.exe");
  const archivePath = path.join(runRoot, "edgedriver.zip");
  await run("curl.exe", [
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
  const reported = await run(driverPath, ["--version"]);
  assert.ok(
    reported.includes(version),
    `EdgeDriver version does not match installed WebView2 Runtime ${version}`,
  );
  return driverPath;
}

async function awaitDriver(port, processHandle) {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null)
      throw new Error(`tauri-driver exited: ${processHandle.exitCode}`);
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

async function captureFailure(driver, label) {
  if (!driver) return;
  try {
    const screenshot = await driver.takeScreenshot();
    await writeFile(path.join(evidenceRoot, `${label}.png`), screenshot, "base64");
  } catch (error) {
    console.error(`Could not capture screenshot: ${error}`);
  }
  try {
    await writeFile(path.join(evidenceRoot, `${label}.html`), await driver.getPageSource());
  } catch (error) {
    console.error(`Could not capture page source: ${error}`);
  }
}

async function main() {
  assert.equal(process.platform, "win32", "The runtime smoke requires Windows and WebView2");
  assert.ok(process.env.APPDATA, "APPDATA is required to isolate test app settings");
  assert.ok(process.env.LOCALAPPDATA, "LOCALAPPDATA is required to isolate WebView2 state");
  await mkdir(scratchRoot, { recursive: true });
  await mkdir(evidenceRoot, { recursive: true });
  const nonce = randomBytes(8).toString("hex");
  const runRoot = path.join(scratchRoot, `run-${nonce}`);
  const appIdentifier = `com.archeion.desktop.smoke.r${nonce}`;
  const appConfigPath = path.join(process.env.APPDATA, appIdentifier);
  const webViewDataPath = path.join(process.env.LOCALAPPDATA, appIdentifier);
  requireContained(runRoot, scratchRoot);
  requireContained(appConfigPath, process.env.APPDATA);
  requireContained(webViewDataPath, process.env.LOCALAPPDATA);
  await assertAbsent(appConfigPath);
  await assertAbsent(webViewDataPath);
  assert.equal(
    await readFile(path.join(projectRoot, "src-tauri", "tauri.conf.json"), "utf8").then(
      (contents) => JSON.parse(contents).identifier,
    ),
    "com.archeion.desktop",
  );
  await mkdir(runRoot);

  let driverProcess;
  let driverClosed;
  let activeSession;
  let primaryError;
  let currentStep = "setup";
  const logStep = async (name, action) => {
    currentStep = name;
    console.log(`Runtime smoke: ${name}`);
    try {
      await action();
    } catch (error) {
      await captureFailure(activeSession, "failure");
      throw error;
    }
  };

  try {
    const overridePath = path.join(runRoot, "tauri.smoke.conf.json");
    await writeFile(
      overridePath,
      JSON.stringify({
        productName: "Archeion Runtime Smoke",
        identifier: appIdentifier,
        mainBinaryName: "ArcheionRuntimeSmoke",
        app: { withGlobalTauri: true },
      }),
    );
    await mkdir(path.join(runRoot, "fixtures"));
    const nativeDriver = await installMatchingEdgeDriver(runRoot);
    await stat(tauriDriverPath);
    await run(
      process.execPath,
      [
        path.join(projectRoot, "node_modules", "@tauri-apps", "cli", "tauri.js"),
        "build",
        "--no-bundle",
        "--config",
        overridePath,
      ],
      { maxBuffer: 64 * 1024 * 1024, timeout: 25 * 60_000 },
    );
    await stat(binaryPath);

    const [port, nativePort] = await Promise.all([freePort(), freePort()]);
    assert.notEqual(port, nativePort);
    driverProcess = spawn(
      tauriDriverPath,
      [
        "--port",
        String(port),
        "--native-port",
        String(nativePort),
        "--native-driver",
        nativeDriver,
      ],
      { cwd: projectRoot, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    driverClosed = new Promise((resolve) => {
      driverProcess.once("close", resolve);
      driverProcess.once("error", resolve);
    });
    const driverLog = createWriteStream(path.join(evidenceRoot, "tauri-driver.log"));
    driverProcess.stdout.pipe(driverLog, { end: false });
    driverProcess.stderr.pipe(driverLog, { end: false });
    await awaitDriver(port, driverProcess);

    const startSession = async () => {
      const capabilities = new Capabilities();
      capabilities.setBrowserName("wry");
      capabilities.set("tauri:options", {
        application: binaryPath,
        webviewOptions: { userDataFolder: path.join(runRoot, "webview-data") },
      });
      activeSession = await new Builder()
        .withCapabilities(capabilities)
        .usingServer(`http://127.0.0.1:${port}`)
        .build();
      await activeSession.manage().setTimeouts({ script: 30_000 });
      return activeSession;
    };
    await runRuntimeFlows({
      startSession,
      fixtureRoot: path.join(runRoot, "fixtures"),
      logStep,
    });
    console.log("Windows Tauri runtime smoke passed.");
  } catch (error) {
    primaryError = error;
    await captureFailure(activeSession, "failure");
    await writeFile(
      path.join(evidenceRoot, "failure.txt"),
      `Step: ${currentStep}\n${error?.stack ?? error}\n`,
    );
    throw error;
  } finally {
    await activeSession?.quit().catch(() => {});
    let shutdownFailure;
    if (driverProcess?.pid && driverProcess.exitCode === null) {
      await execFileAsync("taskkill.exe", ["/PID", String(driverProcess.pid), "/T", "/F"], {
        windowsHide: true,
      }).catch((error) => console.error(`Could not stop owned tauri-driver tree: ${error}`));
    }
    if (driverClosed) {
      let timer;
      try {
        await Promise.race([
          driverClosed,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("tauri-driver did not close after shutdown")),
              10_000,
            );
          }),
        ]);
      } catch (error) {
        shutdownFailure = error;
      } finally {
        clearTimeout(timer);
      }
    }
    const cleanup = await Promise.allSettled([
      removeOwnedDirectory(runRoot, scratchRoot),
      removeOwnedDirectory(appConfigPath, process.env.APPDATA),
      removeOwnedDirectory(webViewDataPath, process.env.LOCALAPPDATA),
    ]);
    const failures = cleanup.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (shutdownFailure) failures.unshift(shutdownFailure);
    if (failures.length > 0) {
      throw new AggregateError(
        primaryError ? [primaryError, ...failures] : failures,
        "Runtime smoke cleanup failed",
      );
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
