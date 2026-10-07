import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { By, Key } from "selenium-webdriver";

// Uses the existing disposable Tauri session, native Settings owner, and restart lifecycle.
// This smoke records the current display scale, not the owner-run 100/125/150% matrix.
export async function runFontPreferenceFlows({
  driver,
  invoke,
  startSession,
  closeSession,
  waitForIpc,
  closeSecondaryWindow,
  logStep,
  installedFamilies,
  evidenceRoot,
}) {
  const find = (...names) =>
    names
      .map((name) =>
        installedFamilies.find((family) => family.toLowerCase() === name.toLowerCase()),
      )
      .find(Boolean);
  const samples = [
    ["sans", find("Segoe UI", "Arial")],
    ["serif", find("Georgia", "Palatino Linotype")],
    ["narrow", find("Arial Narrow")],
    ["mono", find("Cascadia Code", "Consolas", "Courier New")],
    ["cjk", find("Microsoft YaHei", "Yu Gothic", "MS Gothic")],
  ];
  const sans = samples[0][1];
  const serif = samples[1][1];
  assert.ok(sans && serif, "Windows smoke needs a normal sans and serif family");
  const readStacks = () =>
    driver.executeScript(`
    const style = getComputedStyle(document.documentElement);
    return [style.getPropertyValue('--font-ui'), style.getPropertyValue('--font-display')];
  `);
  const waitStacks = (expected) =>
    driver.wait(
      async () => JSON.stringify(await readStacks()) === JSON.stringify(expected),
      20_000,
      "Font settings did not propagate to this WebView",
    );
  const appearance = async (interfaceFont, displayFont) => {
    const snapshot = await invoke(driver, "load_app_settings_snapshot");
    return invoke(driver, "update_app_settings", {
      mutation: {
        area: "appearance",
        value: { ...snapshot.preferences.appearance, interfaceFont, displayFont },
      },
    });
  };
  const capture = async (name) => {
    await driver.executeAsyncScript(`const done = arguments[arguments.length - 1];
      document.fonts.ready.then(() => requestAnimationFrame(() => requestAnimationFrame(done)));`);
    await writeFile(
      path.join(evidenceRoot, `${name}.png`),
      await driver.takeScreenshot(),
      "base64",
    );
    const state = await driver.executeScript(`return {
      href: location.href, width: innerWidth, height: innerHeight, devicePixelRatio,
      overflow: document.documentElement.scrollWidth > innerWidth,
      text: document.body.innerText,
    }`);
    await writeFile(path.join(evidenceRoot, `${name}.json`), JSON.stringify(state, null, 2));
    assert.equal(state.overflow, false, `${name} has horizontal page overflow`);
  };
  const secondary = async (command, query) => {
    await invoke(driver, command);
    return driver.wait(
      async () => {
        for (const handle of await driver.getAllWindowHandles()) {
          await driver.switchTo().window(handle);
          if ((await driver.executeScript("return location.href")).includes(`window=${query}`))
            return handle;
        }
        return false;
      },
      20_000,
      `${query} WebView did not load`,
    );
  };

  await logStep("real Windows font metrics and application role isolation", async () => {
    const original = await invoke(driver, "load_app_settings_snapshot");
    const readerBefore = original.preferences.reader;
    await driver.wait(
      () => driver.executeScript("return document.body.innerText.includes('Smoke Archive')"),
      20_000,
    );
    await capture("font-default-library");
    for (const [role, family] of samples) {
      if (!family) {
        console.log(`Runtime font sample unavailable: ${role}`);
        continue;
      }
      await appearance({ kind: "system", family }, { kind: "system", family: serif });
      await driver.wait(async () => (await readStacks())[0].includes(`"${family}"`), 20_000);
      const resized = await driver.executeAsyncScript(`const done = arguments[arguments.length - 1];
        (async () => {
          const api = window.__TAURI__.window;
          const current = api.getCurrentWindow();
          if (await current.isMaximized()) await current.toggleMaximize();
          await current.setSize(new api.LogicalSize(900, 600));
          return (await current.innerSize()).toLogical(await current.scaleFactor());
        })().then((size) => done({ ok: true, size }), (error) => done({ ok: false, error: String(error) }));`);
      assert.equal(resized.ok, true, resized.error);
      assert.equal(resized.size.width, 900);
      assert.equal(resized.size.height, 600);
      await driver.wait(
        () => driver.executeScript("return innerWidth <= 900 && innerHeight <= 600"),
        20_000,
        "The WebView did not settle inside the 900x600 logical native window",
      );
      await capture(`font-${role}-minimum-library`);
      const maximized =
        await driver.executeAsyncScript(`const done = arguments[arguments.length - 1];
        const current = window.__TAURI__.window.getCurrentWindow();
        current.maximize().then(() => current.isMaximized()).then(
          (value) => done({ ok: true, maximized: value }),
          (error) => done({ ok: false, error: String(error) }));`);
      assert.equal(maximized.ok, true, maximized.error);
      assert.equal(maximized.maximized, true);
      await driver.wait(
        () => driver.executeScript("return innerWidth > 900 && innerHeight > 600"),
        20_000,
        "The maximized WebView did not resize",
      );
      await capture(`font-${role}-maximized-library`);
      assert.deepEqual(
        (await invoke(driver, "load_app_settings_snapshot")).preferences.reader,
        readerBefore,
      );
      assert.deepEqual(await invoke(driver, "list_installed_font_families"), installedFamilies);
    }
    await writeFile(path.join(evidenceRoot, "font-samples.json"), JSON.stringify(samples, null, 2));
  });

  await logStep("font settings synchronize through real secondary WebViews", async () => {
    await appearance({ kind: "system", family: sans }, { kind: "interface" });
    await driver.wait(async () => (await readStacks())[0].includes(`"${sans}"`), 20_000);
    const main = await driver.getWindowHandle();
    for (const [command, query] of [
      ["open_settings_window", "settings"],
      ["open_archive_manager_window", "archive-manager"],
      ["open_theme_manager_window", "theme-manager"],
      ["open_about_window", "about"],
    ]) {
      const expected = await readStacks();
      await secondary(command, query);
      await waitStacks(expected);
      if (query === "settings") {
        const button = await driver.wait(async () => {
          const buttons = await driver.findElements(
            By.xpath("//button[normalize-space(.)='Appearance']"),
          );
          return buttons[0] || false;
        }, 20_000);
        await button.click();
        const trigger = await driver.wait(
          async () =>
            (await driver.findElements(By.css('button[aria-label^="Interface font:"]')))[0] ||
            false,
          20_000,
        );
        await trigger.sendKeys(Key.ENTER);
        const search = await driver.wait(
          async () =>
            (await driver.findElements(By.css('.font-picker__popover [role="combobox"]')))[0] ||
            false,
          20_000,
        );
        await search.sendKeys(serif, Key.ENTER);
        await driver.wait(async () => (await readStacks())[0].includes(`"${serif}"`), 20_000);
        // The root reflects an optimistic update before the coalesced native save.
        // Do not destroy the Settings WebView before that save commits.
        await driver.wait(
          async () =>
            (await invoke(driver, "load_app_settings_snapshot")).preferences.appearance
              .interfaceFont.family === serif,
          20_000,
          "The Settings font selection did not commit to native persistence",
        );
      }
      const updated = await readStacks();
      await capture(`font-${query}`);
      await closeSecondaryWindow(driver, main);
      await waitStacks(updated);
    }
  });

  await logStep(
    "missing Interface, Display, and Reader selections survive a real restart",
    async () => {
      const missing = "Archeion Runtime Missing Family";
      assert.ok(!installedFamilies.includes(missing));
      await appearance({ kind: "system", family: missing }, { kind: "system", family: missing });
      await invoke(driver, "update_app_settings", {
        mutation: {
          area: "readerField",
          value: { field: "fontFamily", value: { kind: "system", family: missing } },
        },
      });
      await closeSession(driver);
      driver = await startSession();
      await waitForIpc(driver);
      const persisted = await invoke(driver, "load_app_settings_snapshot");
      assert.deepEqual(persisted.preferences.appearance.interfaceFont, {
        kind: "system",
        family: missing,
      });
      assert.deepEqual(persisted.preferences.appearance.displayFont, {
        kind: "system",
        family: missing,
      });
      assert.deepEqual(persisted.preferences.reader.fontFamily, {
        kind: "system",
        family: missing,
      });
      await driver.wait(
        () => driver.executeScript("return document.body.innerText.includes('Smoke Archive')"),
        20_000,
      );
      assert.ok(!(await readStacks()).some((stack) => stack.includes(missing)));
      const main = await driver.getWindowHandle();
      await secondary("open_settings_window", "settings");
      const button = await driver.wait(
        async () =>
          (await driver.findElements(By.xpath("//button[normalize-space(.)='Appearance']")))[0] ||
          false,
        20_000,
      );
      await button.click();
      await driver.wait(
        () =>
          driver.executeScript(
            "return document.body.innerText.includes('Archeion Runtime Missing Family (Unavailable)')",
          ),
        20_000,
      );
      await capture("font-missing-after-restart-settings");
      await closeSecondaryWindow(driver, main);
      await capture("font-missing-after-restart-library");
    },
  );
  await logStep(
    "missing Reader opens and a real installed family changes publication only",
    async () => {
      const mono = samples.find(([role]) => role === "mono")[1];
      assert.ok(mono, "Windows Reader smoke needs an installed monospace family");
      const details = await driver.wait(
        async () =>
          (
            await driver.findElements(By.css('button[aria-label="View details for Runtime Smoke"]'))
          )[0] || false,
        20_000,
        "Imported EPUB did not appear in the Library",
      );
      await details.click();
      const read = await driver.wait(
        async () =>
          (await driver.findElements(By.xpath("//button[normalize-space(.)='Read book']")))[0] ||
          false,
        20_000,
      );
      await read.click();
      const publicationFamily = () =>
        driver.executeScript(`
      const frame = document.querySelector('.reader-page iframe');
      const paragraph = frame?.contentDocument?.querySelector('p');
      return paragraph ? getComputedStyle(paragraph).fontFamily : null;`);
      await driver.wait(publicationFamily, 20_000, "Reader publication did not render");
      assert.ok(!(await publicationFamily()).includes("Archeion Runtime Missing Family"));
      const roots = await readStacks();
      await capture("font-missing-reader-publication");
      await invoke(driver, "update_app_settings", {
        mutation: {
          area: "readerField",
          value: { field: "fontFamily", value: { kind: "system", family: mono } },
        },
      });
      await driver.wait(async () => (await publicationFamily())?.includes(mono), 20_000);
      assert.deepEqual(await readStacks(), roots);
      await capture("font-installed-reader-publication");
    },
  );
  return driver;
}
