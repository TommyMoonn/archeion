import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";

async function native(driver, source, ...args) {
  const result = await driver.executeAsyncScript(
    `const done = arguments[arguments.length - 1];
     const args = Array.from(arguments).slice(0, -1);
     (async () => { const api = window.__TAURI__.window;
       const current = api.getCurrentWindow(); ${source}
     })().then(value => done({ok: true, value}), error => done({ok: false, error: String(error)}));`,
    ...args,
  );
  assert.equal(result?.ok, true, result?.error);
  return result.value;
}

async function geometry(driver) {
  return native(
    driver,
    `return { position: await current.outerPosition(), size: await current.outerSize(),
      scale: await current.scaleFactor(), label: current.label };`,
  );
}

async function open(driver, main, command, label) {
  await driver.switchTo().window(main);
  await native(driver, "await window.__TAURI__.core.invoke(args[0]);", command);
  return driver.wait(async () => {
    for (const handle of await driver.getAllWindowHandles()) {
      await driver.switchTo().window(handle);
      if (
        await driver.executeScript(
          "return location.search.includes(arguments[0])",
          `window=${label}`,
        )
      ) {
        return handle;
      }
    }
    return false;
  }, 20_000);
}

function assertPlacement(rect, work) {
  const expectedX = work.position.x + Math.max(0, work.size.width - rect.size.width) / 2;
  const expectedY = work.position.y + Math.max(0, work.size.height - rect.size.height) / 2;
  assert.ok(Math.abs(rect.position.x - expectedX) <= 2, JSON.stringify({ rect, work, expectedX }));
  assert.ok(Math.abs(rect.position.y - expectedY) <= 2, JSON.stringify({ rect, work, expectedY }));
}

export async function runWindowPlacementFlows({
  startSession,
  closeSession,
  logStep,
  evidenceRoot,
  fixtureRoot,
}) {
  const driver = await startSession();
  await driver.wait(() => driver.executeScript("return Boolean(window.__TAURI__?.core)"), 20_000);
  const main = await driver.getWindowHandle();
  // Use the runner's disposable archive so closing Archive Manager cannot
  // trigger the intentional no-archive application-exit contract.
  await native(
    driver,
    `const registry = await window.__TAURI__.core.invoke("create_empty_archive",
    {parentPath: args[0], archiveName: "Placement Archive"});
    await window.__TAURI__.core.invoke("open_archive", {path: registry.archives[0].rootPath});`,
    fixtureRoot,
  );
  // Archive startup may already have opened its own manager before the fixture
  // selected the disposable archive. Retire that instance before testing new
  // window placement, then use handle identity rather than global window count.
  for (const handle of await driver.getAllWindowHandles()) {
    if (handle === main) continue;
    await driver.switchTo().window(handle);
    await driver.wait(
      () => driver.executeScript("return Boolean(window.__TAURI__?.window)"),
      20_000,
      "Startup utility WebView did not initialize before fixture cleanup",
    );
    await driver.executeScript("void window.__TAURI__.window.getCurrentWindow().close()");
    await driver.switchTo().window(main);
    await driver.wait(async () => !(await driver.getAllWindowHandles()).includes(handle), 10_000);
  }
  await driver.switchTo().window(main);
  const monitors = await native(driver, "return api.availableMonitors();");
  assert.ok(monitors.length > 0, "At least one native display is required");
  const samples = {
    monitors,
    windows: [],
    limitations: ["Physical display disconnect/reconnect requires manual verification."],
  };
  try {
    for (const monitor of monitors) {
      await driver.switchTo().window(main);
      await native(
        driver,
        `if (await current.isMaximized()) await current.unmaximize();
        await current.setPosition(new api.PhysicalPosition(args[0], args[1]));`,
        monitor.workArea.position.x + 20,
        monitor.workArea.position.y + 20,
      );
      for (const [command, label] of [
        ["open_settings_window", "settings"],
        ["open_about_window", "about"],
        ["open_theme_manager_window", "theme-manager"],
        ["open_archive_manager_window", "archive-manager"],
      ]) {
        await logStep(
          `native placement and retained position: ${label} at ${monitor.scaleFactor} scale`,
          async () => {
            const handle = await open(driver, main, command, label);
            await driver.switchTo().window(handle);
            const created = await geometry(driver);
            assertPlacement(created, monitor.workArea);
            assert.ok(Math.abs(created.scale - monitor.scaleFactor) < 0.01);
            // Granted only by the runner's disposable placement configuration.
            await native(
              driver,
              "await current.setPosition(new api.PhysicalPosition(args[0], args[1]));",
              monitor.workArea.position.x + 30,
              monitor.workArea.position.y + 50,
            );
            const moved = await geometry(driver);
            assert.notDeepEqual(
              moved.position,
              created.position,
              "The native window must actually move",
            );
            const reopened = await open(driver, main, command, label);
            assert.equal(reopened, handle, "Reopen must retain the same native instance");
            await driver.switchTo().window(handle);
            const retained = await geometry(driver);
            assert.deepEqual(
              retained.position,
              moved.position,
              "Reopen must preserve the user's position",
            );
            assert.deepEqual(retained.size, moved.size, "Reopen must preserve the user's size");
            await native(driver, "await current.minimize();");
            assert.equal(await open(driver, main, command, label), handle);
            await driver.switchTo().window(handle);
            assert.equal(await native(driver, "return current.isMinimized();"), false);
            const restored = await geometry(driver);
            assert.deepEqual(restored.position, retained.position);
            if (label === "settings" || label === "theme-manager") {
              await native(driver, "await current.toggleMaximize();");
              assert.equal(
                await native(driver, "return current.isMaximized();"),
                true,
                "The native window must actually maximize before reopen",
              );
              assert.equal(await open(driver, main, command, label), handle);
              await driver.switchTo().window(handle);
              assert.equal(await native(driver, "return current.isMaximized();"), true);
              await native(driver, "await current.toggleMaximize();");
            }
            const verticalEdges = [];
            const stripHeight = Math.round(32 * monitor.scaleFactor);
            const minimumVisible = Math.round(16 * monitor.scaleFactor);
            const workTop = monitor.workArea.position.y;
            const workBottom = workTop + monitor.workArea.size.height;
            for (const [edge, y, shouldRetain] of [
              ["top clipped by one pixel", workTop - 1, true],
              ["top clipped by three pixels", workTop - 3, true],
              ["bottom clipped by one pixel", workBottom - stripHeight + 1, true],
              ["bottom clipped by three pixels", workBottom - stripHeight + 3, true],
              ["top below usable threshold", workTop - stripHeight + minimumVisible - 1, false],
              ["bottom below usable threshold", workBottom - minimumVisible + 1, false],
            ]) {
              await native(
                driver,
                "await current.setPosition(new api.PhysicalPosition(args[0], args[1]));",
                monitor.workArea.position.x + 30,
                y,
              );
              const before = await geometry(driver);
              assert.equal(before.position.y, y, `Native setup must reach ${edge}`);
              assert.equal(await open(driver, main, command, label), handle);
              await driver.switchTo().window(handle);
              const after = await geometry(driver);
              assert.deepEqual(after.size, before.size, `${edge}: reopening must preserve size`);
              if (shouldRetain) {
                assert.deepEqual(
                  after.position,
                  before.position,
                  `${edge}: reachable titlebar must stay put`,
                );
              } else {
                assert.notDeepEqual(
                  after.position,
                  before.position,
                  `${edge}: insufficient drag region must recover`,
                );
                assertPlacement(after, monitor.workArea);
              }
              verticalEdges.push({ edge, shouldRetain, before, after });
            }
            // Simulate an unavailable previous location without changing the
            // machine's display topology. Recovery must retain the same instance.
            const outsideX = Math.max(...monitors.map((m) => m.position.x + m.size.width)) + 500;
            await native(
              driver,
              "await current.setPosition(new api.PhysicalPosition(args[0], args[1]));",
              outsideX,
              monitor.workArea.position.y + 50,
            );
            const stranded = await geometry(driver);
            assert.ok(
              stranded.position.x >= outsideX - 2,
              "The native window must actually be off-screen",
            );
            assert.equal(await open(driver, main, command, label), handle);
            await driver.switchTo().window(handle);
            const recovered = await geometry(driver);
            assertPlacement(recovered, monitor.workArea);
            assert.notDeepEqual(recovered.position, stranded.position);
            assert.deepEqual(recovered.size, stranded.size);
            samples.windows.push({
              label,
              monitor,
              created,
              moved,
              retained,
              restored,
              verticalEdges,
              stranded,
              recovered,
            });
            await driver.executeScript("void window.__TAURI__.window.getCurrentWindow().close()");
            await driver.switchTo().window(main);
            await driver.wait(
              async () => !(await driver.getAllWindowHandles()).includes(handle),
              10_000,
            );
          },
        );
      }
    }
    await logStep("new About window uses minimized main window's display", async () => {
      await driver.switchTo().window(main);
      await native(driver, "await current.minimize();");
      const handle = await open(driver, main, "open_about_window", "about");
      await driver.switchTo().window(handle);
      const created = await geometry(driver);
      assertPlacement(created, monitors.at(-1).workArea);
      samples.minimizedMain = created;
      await driver.executeScript("void window.__TAURI__.window.getCurrentWindow().close()");
    });
  } finally {
    await writeFile(path.join(evidenceRoot, "placement.json"), JSON.stringify(samples, null, 2));
  }
  // On failure leave the live session to the runner for screenshot capture and
  // its existing centralized cleanup. Close explicitly after successful flows.
  await closeSession(driver);
}
