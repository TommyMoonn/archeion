import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { Builder, Capabilities } from "selenium-webdriver";
import {
  cleanupOwnedRuntime,
  listOwnedApplications,
  stopOwnedApplications,
  removeOwnedDirectory,
  requireContained,
} from "./runtime-smoke-cleanup.mjs";
import {
  awaitDriver,
  freePort,
  installMatchingEdgeDriver,
  runWindowsCommand,
} from "./windows-smoke-support.mjs";
import {
  assertBundlePrivileges,
  createSmokeOverlay,
  selectSmokeBundleFiles,
  startUpdateFixture,
} from "./windows-updater-fixture.mjs";

const execFileAsync = promisify(execFile);
const root = path.resolve(import.meta.dirname, "..");
const cli = path.join(root, "node_modules/@tauri-apps/cli/tauri.js");
const scratch = path.join(root, ".scratch/updater-smoke");
const evidence = path.join(root, "test-results/updater-smoke");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function assertAbsent(target) {
  try {
    await lstat(target);
    throw new Error(`Refusing pre-existing updater smoke state: ${target}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function ownedBundleFiles(nonce) {
  const files = [];
  for (const family of ["nsis", "msi"]) {
    const directory = path.join(root, "src-tauri/target/release/bundle", family);
    let names;
    try {
      names = await readdir(directory);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    files.push(...selectSmokeBundleFiles(names, nonce).map((name) => path.join(directory, name)));
  }
  return files;
}

async function until(description, predicate, timeout = 60_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    await pause(200);
  }
  throw new Error(`Timed out: ${description}`);
}

async function invoke(driver, command, args = {}) {
  return driver.executeAsyncScript(
    `const done = arguments[arguments.length - 1];
     window.__TAURI__.core.invoke(arguments[0], arguments[1])
       .then(value => done({ok: true, value}))
       .catch(error => done({ok: false, error: String(error)}));`,
    command,
    args,
  );
}

async function snapshot(driver) {
  const result = await invoke(driver, "get_app_update_snapshot");
  assert.equal(result.ok, true, result.error);
  return result.value;
}

async function main() {
  assert.equal(process.platform, "win32", "Windows updater smoke requires Windows");
  assert.ok(process.env.APPDATA && process.env.LOCALAPPDATA);
  const requested = process.argv.slice(2);
  assert.ok(requested.length === 0 || (requested.length === 2 && requested[0] === "--bundle"));
  const families = requested.length ? [requested[1]] : ["nsis", "msi"];
  assert.ok(families.every((family) => ["nsis", "msi"].includes(family)));
  if (families.includes("msi")) {
    const { stdout } = await execFileAsync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$identity = [Security.Principal.WindowsIdentity]::GetCurrent(); " +
          "$principal = New-Object Security.Principal.WindowsPrincipal($identity); " +
          "$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
      ],
      { windowsHide: true, timeout: 10_000 },
    );
    assertBundlePrivileges(families, stdout.trim() === "True");
  }
  const nonce = randomBytes(8).toString("hex");
  const runRoot = path.join(scratch, `run-${nonce}`);
  const installDirectory = path.join(runRoot, "installed");
  const application = path.join(installDirectory, "ArcheionUpdaterSmoke.exe");
  const identifier = `com.archeion.desktop.updatersmoke.r${nonce}`;
  const appData = path.join(process.env.APPDATA, identifier);
  const localData = path.join(process.env.LOCALAPPDATA, identifier);
  requireContained(runRoot, scratch);
  requireContained(appData, process.env.APPDATA);
  requireContained(localData, process.env.LOCALAPPDATA);
  for (const target of [runRoot, appData, localData]) await assertAbsent(target);
  await mkdir(runRoot, { recursive: true });
  const evidenceRoot = path.join(evidence, `run-${nonce}`);
  await mkdir(evidenceRoot, { recursive: true });
  await mkdir(path.join(runRoot, "temp"));
  const startedAt = Date.now();
  const report = {
    nonce,
    sourceVersion: "1.6.0",
    targetVersion: "1.6.1",
    families: [],
    cleanup: false,
  };
  let ownsBundleFiles = false;
  let fixture;
  let driverProcess;
  let driverClosed;
  let driver;
  let activeFamily;
  let primaryError;
  const production = JSON.parse(
    await readFile(path.join(root, "src-tauri/tauri.conf.json"), "utf8"),
  );
  const buildEnv = { ...process.env };
  for (const variable of Object.keys(buildEnv)) {
    if (variable.startsWith("TAURI_SIGNING_") || variable === "TAURI_CONFIG")
      delete buildEnv[variable];
  }
  try {
    assert.equal((await ownedBundleFiles(nonce)).length, 0, "Pre-existing smoke bundles");
    ownsBundleFiles = true;
    fixture = await startUpdateFixture();
    // Establish the external automation prerequisite before generating keys or
    // spending time building four installers. Network failure remains a hard error.
    const nativeDriver = await installMatchingEdgeDriver(runRoot);
    const keyPath = path.join(runRoot, "ephemeral.key");
    const password = randomBytes(24).toString("hex");
    // Signer output includes key material. Intentionally neither print nor retain its stdout.
    await execFileAsync(
      process.execPath,
      [cli, "signer", "generate", "--ci", "--password", password, "--write-keys", keyPath],
      {
        cwd: root,
        env: buildEnv,
        windowsHide: true,
        timeout: 30_000,
      },
    ).catch(() => {
      // Child-process errors include stdout and command arguments. Neither key
      // material nor the ephemeral password belongs in retained diagnostics.
      throw new Error("Ephemeral updater signing key generation failed");
    });
    const publicKey = (await readFile(`${keyPath}.pub`, "utf8")).trim();
    assert.notEqual(publicKey, production.plugins.updater.pubkey);
    buildEnv.TAURI_SIGNING_PRIVATE_KEY = keyPath;
    buildEnv.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = password;
    const upgradeCode = randomUUID();
    console.log("Updater smoke: building frontend and two signed synthetic versions");
    await runWindowsCommand(process.execPath, [
      path.join(root, "node_modules/typescript/bin/tsc"),
      "-b",
    ]);
    await runWindowsCommand(process.execPath, [
      path.join(root, "node_modules/vite/bin/vite.js"),
      "build",
    ]);
    const artifacts = {};
    for (const version of ["1.6.0", "1.6.1"]) {
      artifacts[version] = {};
      for (const family of ["nsis", "msi"]) {
        const overlayPath = path.join(runRoot, `tauri-${version}-${family}.json`);
        const overlay = createSmokeOverlay({
          nonce,
          publicKey,
          version,
          upgradeCode,
          endpoint: `${fixture.origin}/manifest/{{bundle_type}}`,
          windows: production.app.windows,
        });
        if (family === "msi") {
          // Log only the MSI fixture, without forwarding MSI switches to NSIS
          // or changing the production installer context or passive mode.
          overlay.plugins.updater.windows.installerArgs = [
            "/L*v",
            `"${path.join(evidenceRoot, "msi-updater.log")}"`,
          ];
        }
        await writeFile(overlayPath, JSON.stringify(overlay));
        await runWindowsCommand(
          process.execPath,
          [cli, "build", "--bundles", family, "--config", overlayPath, "--", "--locked"],
          {
            env: buildEnv,
            maxBuffer: 64 * 1024 * 1024,
            timeout: 25 * 60_000,
          },
        );
        const directory = path.join(root, "src-tauri/target/release/bundle", family);
        const matches = (await readdir(directory)).filter(
          (name) =>
            name.includes(nonce) &&
            name.includes(`_${version}_`) &&
            name.endsWith(family === "nsis" ? ".exe" : ".msi"),
        );
        assert.equal(matches.length, 1, `Ambiguous ${family} installer for ${version}`);
        const destination = path.join(
          runRoot,
          `${version}-${family}${family === "nsis" ? ".exe" : ".msi"}`,
        );
        for (const suffix of ["", ".sig"]) {
          const source = path.join(directory, matches[0] + suffix);
          await copyFile(source, destination + suffix);
        }
        artifacts[version][family] = {
          path: destination,
          bytes: await readFile(destination),
          signature: (await readFile(`${destination}.sig`, "utf8")).trim(),
        };
      }
    }
    fixture.setArtifacts(artifacts["1.6.1"]);
    const runtimeEnv = { ...buildEnv };
    for (const variable of Object.keys(runtimeEnv)) {
      if (variable.startsWith("TAURI_SIGNING_")) delete runtimeEnv[variable];
    }
    const tauriDriver = path.join(root, ".scratch/runtime-smoke-tools/bin/tauri-driver.exe");
    await stat(tauriDriver);
    const port = await freePort();
    let nativePort = await freePort();
    while (port === nativePort) nativePort = await freePort();
    driverProcess = spawn(
      tauriDriver,
      [
        "--port",
        String(port),
        "--native-port",
        String(nativePort),
        "--native-driver",
        nativeDriver,
      ],
      {
        cwd: root,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...runtimeEnv, TEMP: path.join(runRoot, "temp"), TMP: path.join(runRoot, "temp") },
      },
    );
    driverClosed = new Promise((resolve) => {
      driverProcess.once("close", () => resolve({}));
      driverProcess.once("error", (error) => resolve({ error }));
    });
    const log = createWriteStream(path.join(evidenceRoot, "tauri-driver.log"));
    driverProcess.stdout.pipe(log, { end: false });
    driverProcess.stderr.pipe(log, { end: false });
    driverProcess.once("close", () => log.end());
    await awaitDriver(port, driverProcess);
    const install = (operation, family, version) =>
      runWindowsCommand(
        "pwsh",
        [
          "-NoProfile",
          "-File",
          path.join(root, "scripts/windows-updater-install.ps1"),
          "-Operation",
          operation,
          "-Bundle",
          family,
          "-Nonce",
          nonce,
          "-RunRoot",
          runRoot,
          "-InstallDirectory",
          installDirectory,
          ...(version ? ["-Version", version] : []),
          ...(operation === "Install" ? ["-Installer", artifacts["1.6.0"][family].path] : []),
        ],
        { timeout: 150_000 },
      );
    for (const family of families) {
      console.log(
        `Updater smoke: isolated ${family} install, invalid fixtures, download and restart`,
      );
      await install("Preflight", family);
      activeFamily = family;
      const requestStart = fixture.requests.length;
      fixture.setMode("valid");
      await install("Install", family, "1.6.0");
      const capabilities = new Capabilities();
      capabilities.setBrowserName("wry");
      capabilities.set("tauri:options", {
        application,
        // This is also Tauri's native default profile. Elevated WebView2 ignores
        // WEBVIEW2_USER_DATA_FOLDER, so driver and API configuration must agree.
        webviewOptions: { userDataFolder: localData },
      });
      driver = await new Builder()
        .withCapabilities(capabilities)
        .usingServer(`http://127.0.0.1:${port}`)
        .build();
      await driver.manage().setTimeouts({ script: 90_000 });
      await driver.wait(
        () => driver.executeScript("return Boolean(window.__TAURI__?.core?.invoke)"),
        20_000,
      );
      assert.equal((await snapshot(driver)).currentVersion, "1.6.0");
      assert.equal((await snapshot(driver)).supported, true);
      const rejected = [];
      for (const mode of ["bad-signature", "wrong-version"]) {
        fixture.setMode(mode);
        const check = await invoke(driver, "check_app_update", { intent: "manual" });
        assert.equal(check.ok, true, check.error);
        assert.equal(check.value.status, "available");
        const download = await invoke(driver, "download_app_update");
        assert.equal(download.ok, false, `${family} accepted ${mode}`);
        const current = await snapshot(driver);
        assert.equal(current.status, "available");
        assert.equal(current.error.operation, "download");
        assert.equal((await invoke(driver, "install_app_update")).ok, false);
        await install("Verify", family, "1.6.0");
        rejected.push(mode);
      }
      fixture.setMode("valid");
      assert.equal((await invoke(driver, "check_app_update", { intent: "manual" })).ok, true);
      const download = await invoke(driver, "download_app_update");
      assert.equal(download.ok, true, download.error);
      assert.equal(download.value.status, "ready");
      await install("Verify", family, "1.6.0");
      const oldProcesses = await listOwnedApplications(application, startedAt);
      assert.equal(oldProcesses.length, 1, "Expected exactly one old installed application");
      const promptPath = path.join(appData, "app-update-prompts.json");
      await driver.executeScript("void window.__TAURI__.core.invoke('install_app_update')");
      const newProcesses = await until(
        "target version to relaunch",
        async () => {
          const processes = await listOwnedApplications(application, startedAt);
          if (processes.length !== 1 || processes[0].ProcessId === oldProcesses[0].ProcessId)
            return false;
          try {
            const metadata = JSON.parse(await readFile(promptPath, "utf8"));
            if (metadata.completedVersion !== "1.6.1" || metadata.pendingTransition !== null)
              return false;
          } catch {
            return false;
          }
          return processes;
        },
        10 * 60_000,
      );
      await install("Verify", family, "1.6.1");
      const requests = fixture.requests.filter((request) => request.path.startsWith("/artifact/"));
      assert.ok(requests.some((request) => request.path === `/artifact/valid/${family}`));
      assert.ok(fixture.requests.some((request) => request.path === `/manifest/${family}`));
      assert.ok(
        fixture.requests
          .slice(requestStart)
          .every((request) => request.path.endsWith(`/${family}`)),
        "An installed bundle selected another installer family",
      );
      report.families.push({
        family,
        rejected,
        readyBeforeInstall: true,
        sourcePid: oldProcesses[0].ProcessId,
        targetPid: newProcesses[0].ProcessId,
        sourceStartedAt: oldProcesses[0].StartedAt,
        targetStartedAt: newProcesses[0].StartedAt,
        completedVersion: "1.6.1",
      });
      // The original WebView closed during installation; quit the stale session without
      // depending on it for target-process ownership or proof of the new version.
      await driver.quit().catch(() => {});
      driver = undefined;
      await stopOwnedApplications(application, startedAt);
      await install("Uninstall", family);
      activeFamily = undefined;
      await removeOwnedDirectory(appData, process.env.APPDATA);
      await removeOwnedDirectory(localData, process.env.LOCALAPPDATA);
    }
  } catch (error) {
    primaryError = error;
    await writeFile(path.join(evidenceRoot, "failure.txt"), error.stack ?? String(error));
    if (driver)
      await driver
        .takeScreenshot()
        .then((image) => writeFile(path.join(evidenceRoot, "failure.png"), image, "base64"))
        .catch(() => {});
  } finally {
    const failures = [];
    const cleanup = async (action) => {
      try {
        await action();
      } catch (error) {
        failures.push(error);
      }
    };
    // Preserve useful installation diagnostics before owned temporary files go.
    await cleanup(async () => {
      try {
        await copyFile(
          path.join(runRoot, "msi-install.log"),
          path.join(evidenceRoot, "msi-install.log"),
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    });
    await cleanup(() => fixture?.close());
    await cleanup(() =>
      cleanupOwnedRuntime({
        session: driver,
        closeSession: (session) => session.quit(),
        processHandle: driverProcess,
        closed: driverClosed,
        directories: [],
      }),
    );
    await cleanup(() => stopOwnedApplications(application, startedAt));
    if (activeFamily) {
      await cleanup(() =>
        runWindowsCommand(
          "pwsh",
          [
            "-NoProfile",
            "-File",
            path.join(root, "scripts/windows-updater-install.ps1"),
            "-Operation",
            "Uninstall",
            "-Bundle",
            activeFamily,
            "-Nonce",
            nonce,
            "-RunRoot",
            runRoot,
            "-InstallDirectory",
            installDirectory,
          ],
          { timeout: 150_000 },
        ),
      );
    }
    // Discover exact nonce-owned names even if a build failed before copying its
    // outputs. Never delete a prior run or ordinary Archeion bundle.
    if (ownsBundleFiles)
      await cleanup(async () => {
        for (const file of await ownedBundleFiles(nonce)) {
          requireContained(file, path.join(root, "src-tauri/target/release/bundle"));
          assert.ok(path.basename(file).includes(nonce));
          await unlink(file);
        }
      });
    // Diagnostics may retain a failed install directory, but never its signing key.
    for (const name of ["ephemeral.key", "ephemeral.key.pub"]) {
      await cleanup(async () => {
        try {
          await unlink(path.join(runRoot, name));
        } catch (error) {
          if (error.code !== "ENOENT") throw error;
        }
      });
    }
    if (failures.length === 0) {
      for (const [target, parent] of [
        [appData, process.env.APPDATA],
        [localData, process.env.LOCALAPPDATA],
        [runRoot, scratch],
      ]) {
        await cleanup(() => removeOwnedDirectory(target, parent));
      }
    }
    report.cleanup = failures.length === 0;
    report.requests = fixture?.requests ?? [];
    await writeFile(path.join(evidenceRoot, "report.json"), JSON.stringify(report, null, 2));
    if (primaryError || failures.length)
      throw new AggregateError(
        [primaryError, ...failures].filter(Boolean),
        "Windows updater smoke failed",
      );
  }
  console.log(`Windows updater smoke passed: ${families.join(", ")}. Evidence: ${evidenceRoot}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
