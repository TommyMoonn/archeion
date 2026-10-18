import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { By, error } from "selenium-webdriver";

async function actionable(driver, element) {
  return (
    (await element.isDisplayed()) &&
    (await element.isEnabled()) &&
    (await element.getAttribute("aria-disabled")) !== "true" &&
    (await element.getAttribute("aria-busy")) !== "true" &&
    (await driver.executeScript(
      `
      const button = arguments[0];
      // The preceding card workload scrolls the Library header out of view.
      button.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const rect = button.getBoundingClientRect();
      const x = (Math.max(0, rect.left) + Math.min(innerWidth, rect.right)) / 2;
      const y = (Math.max(0, rect.top) + Math.min(innerHeight, rect.bottom)) / 2;
      return rect.width > 0 && rect.height > 0 && button.contains(document.elementFromPoint(x, y));
    `,
      element,
    ))
  );
}

async function rescanNativeCatalog(driver, count) {
  const toolbarLocator = By.css(".library-header .library-rescan-button");
  const dialogLocator = By.xpath("//dialog[@open][.//h2[normalize-space(.)='Rescan archive?']]");
  const confirmLocator = By.xpath(".//button[normalize-space(.)='Rescan archive']");
  let stage;
  const wait = async (description, condition) => {
    stage = description;
    return driver.wait(
      async () => {
        try {
          return await condition();
        } catch (cause) {
          // React may replace a control between lookup and inspection. Re-locate on the next poll.
          if (cause instanceof error.StaleElementReferenceError) return false;
          throw cause;
        }
      },
      30000,
      description,
    );
  };
  const readyToolbar = async () => {
    const [button] = await driver.findElements(toolbarLocator);
    return button && (await actionable(driver, button)) ? button : false;
  };
  try {
    const toolbar = await wait(
      "waiting for the Library rescan toolbar to be enabled and unobscured",
      readyToolbar,
    );
    stage = "opening the rescan confirmation dialog";
    await toolbar.click();
    await wait("waiting for the rescan confirmation dialog", async () => {
      const [dialog] = await driver.findElements(dialogLocator);
      return dialog && (await dialog.isDisplayed());
    });
    const confirm = await wait(
      "waiting for the rescan confirm action to be enabled and unobscured",
      async () => {
        const [dialog] = await driver.findElements(dialogLocator);
        if (!dialog) return false;
        const [button] = await dialog.findElements(confirmLocator);
        return button && (await actionable(driver, button)) ? button : false;
      },
    );
    stage = "activating the rescan confirm action";
    await confirm.click();
    await wait("waiting for the rescan confirmation dialog to close", async () => {
      for (const dialog of await driver.findElements(dialogLocator)) {
        if (await dialog.isDisplayed()) return false;
      }
      return true;
    });
    // Closing the dialog starts the scan, but does not mean it completed successfully.
    await wait(
      `waiting for the active Library catalog count to reach ${count} after rescan`,
      async () => {
        for (const alert of await driver.findElements(
          By.css('.page-shell .library-feedback [role="alert"]'),
        )) {
          const message = await alert.getText();
          if (message.includes("The archive could not be scanned.")) throw new Error(message);
        }
        if (!(await readyToolbar())) return false;
        return driver.executeScript(
          "return Number(document.querySelector('.page-shell [data-window-total]')?.dataset.windowTotal) === arguments[0]",
          count,
        );
      },
    );
  } catch (cause) {
    throw new Error(`Native UI catalog ${count}: ${stage}: ${cause.message}`, { cause });
  }
}

/** Runs only in the existing nonce-scoped runtime smoke archive, never a user's library. */
export async function runWindowsUIStability({
  driver,
  archiveRoot,
  fixtureRoot,
  sourcePath,
  evidenceRoot,
}) {
  const scale = Number(process.env.ARCHEION_UI_NATIVE_SCALE);
  assert.ok(
    [100, 125, 150].includes(scale),
    "Set ARCHEION_UI_NATIVE_SCALE to the actual Windows display scaling (100/125/150)",
  );
  assert.equal(path.dirname(path.resolve(archiveRoot)), path.resolve(fixtureRoot));
  const actualDpr = await driver.executeScript("return devicePixelRatio");
  assert.ok(
    Math.abs(actualDpr - scale / 100) < 0.02,
    `Actual devicePixelRatio ${actualDpr} disagrees with requested scale ${scale}`,
  );
  // The preceding font smoke deliberately finishes in Reader. Leave through its save owner.
  if (await driver.executeScript("return Boolean(document.querySelector('.reader-page'))")) {
    await (await driver.findElement(By.css(".reader-toolbar__back"))).click();
  }
  await driver.wait(
    () => driver.executeScript("return Boolean(document.querySelector('.page-shell'))"),
    20000,
  );
  const appearance = await driver.executeScript(`return {
    interfaceFont: getComputedStyle(document.documentElement).getPropertyValue('--font-ui'),
    displayFont: getComputedStyle(document.documentElement).getPropertyValue('--font-display'),
    motion: document.documentElement.dataset.motion,
    theme: document.documentElement.dataset.appTheme
  }`);
  const sizes = (process.env.ARCHEION_UI_NATIVE_COUNTS ?? "50,500").split(",").map(Number);
  assert.ok(sizes.length && sizes.every((size) => [50, 500, 3000].includes(size)));
  const source = await readFile(
    new URL("../browser/fixtures/ui-stability-probe.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const { installUIStabilityProbe } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );
  const destination = path.join(evidenceRoot, "ui-stability");
  await mkdir(destination, { recursive: true });
  const records = [];
  let previousCount = 1;
  for (const count of sizes) {
    assert.ok(
      count >= previousCount,
      "Native counts must be ascending to avoid deleting fixture files",
    );
    for (let index = previousCount; index < count; index++) {
      await copyFile(
        sourcePath,
        path.join(archiveRoot, `synthetic-${String(index).padStart(4, "0")}.epub`),
        constants.COPYFILE_EXCL,
      );
    }
    previousCount = count;
    await rescanNativeCatalog(driver, count);
    for (const width of [1280, 900]) {
      await driver.manage().window().setRect({ width, height: 800 });
      for (const codePath of ["first-open", "reopen"]) {
        await driver.executeScript(
          `return (${installUIStabilityProbe.toString()})({limit:1200}) && true`,
        );
        let probe;
        try {
          await driver.executeScript(
            "document.querySelector('.page-shell').scrollTop = 500; window.uiStabilityProbe.mark('scroll-forward')",
          );
          await (await driver.findElement(By.css(".book-card__select"))).click();
          await driver.wait(
            () => driver.executeScript("return Boolean(document.querySelector('dialog[open]'))"),
            15000,
          );
          await writeFile(
            path.join(destination, `${count}-${width}-${codePath}.png`),
            await driver.takeScreenshot(),
            "base64",
          );
          await (
            await driver.findElement(By.css('dialog[open] [aria-label="Close book details"]'))
          ).click();
          await driver.wait(
            () => driver.executeScript("return !document.querySelector('dialog[open]')"),
            15000,
          );
        } finally {
          probe = await driver.executeScript("return window.uiStabilityProbe.stop()");
        }
        records.push({
          count,
          requestedWidth: width,
          codePath,
          cache:
            "same process; first-open is first at this catalog/width, not necessarily a cold module",
          probe,
        });
      }
    }
  }
  const report = {
    schemaVersion: 1,
    source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    fixtureSha256: createHash("sha256")
      .update(await readFile(sourcePath))
      .digest("hex"),
    probeSha256: createHash("sha256").update(source).digest("hex"),
    appearance,
    machine: createHash("sha256").update(os.hostname()).digest("hex").slice(0, 12),
    os: `${os.platform()} ${os.release()}`,
    scale,
    actualDpr,
    browser: await driver.getCapabilities().then((caps) => caps.get("browserVersion")),
    counts: sizes,
    capacityGaps: [50, 500, 3000].filter((size) => !sizes.includes(size)),
    gaps: [
      "Probe attaches after startup; first-visible palette needs external desktop recording",
      "Screenshots are checkpoints, not 60 fps",
      "Process/OS cold start not measured",
      "GPU counters, physical input and speech not measured",
      "560px native width is below the supported 900px minimum; use browser responsive workload",
    ],
    records,
  };
  await writeFile(path.join(destination, `native-${scale}.json`), JSON.stringify(report, null, 2));
}
