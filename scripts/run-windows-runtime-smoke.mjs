import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";

import { Builder, Capabilities } from "selenium-webdriver";

import {
  awaitDriver,
  freePort,
  installMatchingEdgeDriver,
  runWindowsCommand,
} from "./windows-smoke-support.mjs";

import { cleanupOwnedRuntime, requireContained } from "./runtime-smoke-cleanup.mjs";
import { runRuntimeFlows } from "../tests/runtime/windowsRuntimeSmoke.mjs";

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

async function assertAbsent(target) {
  try {
    await lstat(target);
    throw new Error(`Refusing to use pre-existing test state: ${target}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
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
  const closeSession = async (session) => {
    await session.quit();
    if (activeSession === session) activeSession = undefined;
  };
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
        // Runtime flows do not exercise the updater. Never let this test build
        // inherit the production endpoint, including after preference resets.
        plugins: { updater: { endpoints: [] } },
      }),
    );
    await mkdir(path.join(runRoot, "fixtures"));
    const nativeDriver = await installMatchingEdgeDriver(runRoot);
    await stat(tauriDriverPath);
    await runWindowsCommand(
      process.execPath,
      [
        path.join(projectRoot, "node_modules", "@tauri-apps", "cli", "tauri.js"),
        "build",
        "--no-bundle",
        "--config",
        overridePath,
        "--",
        "--locked",
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
      driverProcess.once("close", () => resolve({}));
      driverProcess.once("error", (error) => resolve({ error }));
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
      closeSession,
      fixtureRoot: path.join(runRoot, "fixtures"),
      logStep,
      evidenceRoot,
    });
  } catch (error) {
    primaryError = error;
    await captureFailure(activeSession, "failure");
    await writeFile(
      path.join(evidenceRoot, "failure.txt"),
      `Step: ${currentStep}\n${error?.stack ?? error}\n`,
    );
    throw error;
  } finally {
    try {
      await cleanupOwnedRuntime({
        session: activeSession,
        closeSession,
        processHandle: driverProcess,
        closed: driverClosed,
        directories: [
          { target: runRoot, parent: scratchRoot },
          { target: appConfigPath, parent: process.env.APPDATA },
          { target: webViewDataPath, parent: process.env.LOCALAPPDATA },
        ],
      });
    } catch (cleanupError) {
      let evidenceError;
      try {
        await writeFile(
          path.join(evidenceRoot, "cleanup-failure.txt"),
          `Step: cleanup\n${inspect(cleanupError, { depth: 4 })}\n`,
        );
      } catch (error) {
        evidenceError = error;
      }
      throw new AggregateError(
        [primaryError, cleanupError, evidenceError].filter(Boolean),
        "Runtime smoke cleanup failed",
      );
    }
  }
  console.log("Windows Tauri runtime smoke passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
