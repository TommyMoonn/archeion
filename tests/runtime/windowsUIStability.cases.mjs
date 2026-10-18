// Run with: node --test tests/runtime/windowsUIStability.cases.mjs
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { error } from "selenium-webdriver";
import { runWindowsUIStability } from "./windowsUIStability.mjs";

// A confirm-required driver, not a DOM snapshot. Only the confirm action scans files.
function confirmRequiredDriver(archiveRoot, fault) {
  const events = [];
  let dialog = false;
  let details = false;
  let confirmed = false;
  let total = 1;
  let toolbarPolls = 0;
  let confirmPolls = 0;
  let pending = 0;
  let overlayPolls = 0;
  const toolbar = {
    isDisplayed: async () => true,
    isEnabled: async () => true, // IconButton uses aria-disabled while scanning.
    getAttribute: async (name) => {
      if (name !== "aria-disabled") return null;
      toolbarPolls++;
      if (fault === "stale-toolbar" && toolbarPolls === 1) {
        throw new error.StaleElementReferenceError("control replaced during polling");
      }
      if (
        fault === "toolbar-disabled" ||
        (fault === "scan-pending" && confirmed) ||
        toolbarPolls < 2 ||
        pending-- > 0
      )
        return "true";
      return null;
    },
    click: async () => {
      events.push("open-confirmation");
      confirmed = false;
      confirmPolls = 0;
      dialog = fault !== "missing-dialog";
      // A watcher may have refreshed already. It still cannot authorize skipping confirmation.
      if (fault === "watcher") total = (await readdir(archiveRoot)).length;
    },
  };
  const confirm = {
    isDisplayed: async () => true,
    isEnabled: async () => fault !== "confirm-disabled" && ++confirmPolls > 1,
    getAttribute: async () => null,
    click: async () => {
      events.push("confirm-rescan");
      if (fault === "confirm-click-failed")
        throw new error.ElementClickInterceptedError("blocked action");
      confirmed = true;
      pending = 1;
      if (fault !== "dialog-stuck") dialog = false;
      if (fault !== "count-stuck" && fault !== "scan-failed") {
        total = (await readdir(archiveRoot)).length;
      }
    },
  };
  const confirmation = {
    isDisplayed: async () => dialog,
    findElements: async (locator) => {
      assert.equal(locator.using, "xpath");
      assert.match(locator.value, /button.*Rescan archive/);
      return fault === "missing-confirm" ? [] : [confirm];
    },
  };
  const driver = {
    events,
    async findElements(locator) {
      if (locator.value === ".library-header .library-rescan-button") return [toolbar];
      if (locator.using === "xpath" && locator.value.includes("Rescan archive?")) {
        return dialog ? [confirmation] : [];
      }
      if (locator.value.includes(".library-feedback")) {
        return fault === "scan-failed" && confirmed
          ? [{ getText: async () => "The archive could not be scanned." }]
          : [];
      }
      assert.fail(`Unexpected elements locator: ${locator}`);
    },
    async findElement(locator) {
      // Retain the old toolbar locator so RED reaches the actual missing-confirm defect.
      if (locator.value === '[aria-label="Rescan archive"]') return toolbar;
      if (locator.value === ".book-card__select") {
        return {
          click: async () => {
            assert.equal(confirmed, true, "Book selection must follow a confirmed rescan");
            assert.equal(dialog, false, "Rescan dialog must close before selecting a book");
            events.push("book-click");
            details = true;
          },
        };
      }
      if (locator.value.includes("Close book details"))
        return {
          click: async () => {
            details = false;
            if (fault === "feedback-overlay") overlayPolls = 2;
          },
        };
      assert.fail(`Unexpected element locator: ${locator}`);
    },
    async executeScript(script, count) {
      if (script.includes("elementFromPoint")) {
        let visible = fault !== "toolbar-scrolled";
        const blocked = fault === "toolbar-obscured" || overlayPolls-- > 0;
        const button = {
          scrollIntoView: () => {
            visible = true;
          },
          getBoundingClientRect: () => ({
            left: 20,
            right: 40,
            top: visible ? 20 : -200,
            bottom: visible ? 40 : -180,
            width: 20,
            height: 20,
          }),
          contains: (target) => target === button,
        };
        const document = {
          elementFromPoint: (x, y) => (x >= 0 && y >= 0 && !blocked ? button : null),
        };
        // Execute the actual hit-test against a minimal viewport, including offscreen controls.
        return new Function(
          "document",
          "innerWidth",
          "innerHeight",
          "button",
          `return (function () { ${script} }).call(null, button);`,
        )(document, 900, 800, button);
      }
      if (script === "return devicePixelRatio") return 1;
      if (script.includes(".reader-page")) return false;
      if (script.includes("data-window-total")) {
        assert.equal(
          confirmed,
          true,
          "Catalog readiness must not be checked before confirming rescan",
        );
        assert.equal(dialog, false, "Catalog readiness must follow confirmation dialog closure");
        events.push(`count-${count}`);
        return total === count;
      }
      if (script.includes("--font-ui")) return { theme: "dark" };
      if (script.includes("return !document.querySelector('dialog[open]')")) return !details;
      if (script.includes("Boolean(document.querySelector('dialog[open]'))")) return details;
      if (script === "return window.uiStabilityProbe.stop()") return { frames: [] };
      return true;
    },
    async wait(predicate, timeout, message) {
      assert.ok(timeout > 0);
      // Deterministic polling without waiting 30 seconds for each failure case.
      for (let poll = 0; poll < 6; poll++) {
        const result = await predicate();
        if (result) return result;
      }
      throw new error.TimeoutError(message || "Fake driver condition timed out");
    },
    manage: () => ({
      window: () => ({ setRect: async (rect) => events.push(`width-${rect.width}`) }),
    }),
    takeScreenshot: async () => "",
    getCapabilities: async () => new Map([["browserVersion", "fake-driver-not-native"]]),
  };
  return driver;
}

async function workload(t, fault, counts = null) {
  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "archeion-rescan-test-"));
  t.after(() => rm(fixtureRoot, { recursive: true, force: true }));
  const archiveRoot = path.join(fixtureRoot, "archive");
  await mkdir(archiveRoot);
  const sourcePath = path.join(fixtureRoot, "source.epub");
  await writeFile(sourcePath, "synthetic driver test fixture");
  await writeFile(path.join(archiveRoot, "original.epub"), "synthetic driver test fixture");
  const driver = confirmRequiredDriver(archiveRoot, fault);
  const before = Object.fromEntries(
    ["ARCHEION_UI_NATIVE_SCALE", "ARCHEION_UI_NATIVE_COUNTS"].map((key) => [key, process.env[key]]),
  );
  process.env.ARCHEION_UI_NATIVE_SCALE = "100";
  if (counts === null) delete process.env.ARCHEION_UI_NATIVE_COUNTS;
  else process.env.ARCHEION_UI_NATIVE_COUNTS = counts;
  t.after(() => {
    for (const [key, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  return {
    driver,
    fixtureRoot,
    archiveRoot,
    run: () =>
      runWindowsUIStability({
        driver,
        archiveRoot,
        fixtureRoot,
        sourcePath,
        evidenceRoot: fixtureRoot,
      }),
  };
}

for (const fault of [
  undefined,
  "watcher",
  "stale-toolbar",
  "feedback-overlay",
  "toolbar-scrolled",
]) {
  test(`confirms each default 50/500 catalog before measurement: ${fault ?? "no watcher"}`, async (t) => {
    const { driver, run, fixtureRoot } = await workload(t, fault);
    await run();
    const report = JSON.parse(
      await readFile(path.join(fixtureRoot, "ui-stability/native-100.json"), "utf8"),
    );
    assert.deepEqual(report.counts, [50, 500]);
    assert.deepEqual(report.capacityGaps, [3000]);
    assert.equal(report.records.length, 8);
    assert.deepEqual(
      driver.events.filter((event) => !event.startsWith("width-")),
      [
        "open-confirmation",
        "confirm-rescan",
        "count-50",
        ...Array(4).fill("book-click"),
        "open-confirmation",
        "confirm-rescan",
        "count-500",
        ...Array(4).fill("book-click"),
      ],
    );
    assert.deepEqual(
      driver.events.filter((event) => event.startsWith("width-")),
      ["width-1280", "width-900", "width-1280", "width-900"],
    );
  });
}

for (const [fault, expected] of [
  ["toolbar-disabled", /50.*toolbar.*enabled/i],
  ["toolbar-obscured", /50.*toolbar.*unobscured/i],
  ["missing-dialog", /50.*confirmation dialog/i],
  ["missing-confirm", /50.*confirm action.*enabled/i],
  ["confirm-disabled", /50.*confirm action.*enabled/i],
  ["confirm-click-failed", /50.*confirm action.*blocked action/i],
  ["dialog-stuck", /50.*confirmation dialog.*close/i],
  ["scan-pending", /50.*catalog count.*50/i],
  ["count-stuck", /50.*catalog count.*50/i],
  ["scan-failed", /50.*archive could not be scanned/i],
]) {
  test(`stops the workload with an actionable error: ${fault}`, async (t) => {
    const { driver, run } = await workload(t, fault);
    await assert.rejects(run(), expected);
    assert.ok(!driver.events.includes("book-click"));
    assert.ok(!driver.events.includes("count-500"));
    if (
      [
        "missing-dialog",
        "missing-confirm",
        "confirm-disabled",
        "confirm-click-failed",
        "dialog-stuck",
      ].includes(fault)
    ) {
      assert.ok(!driver.events.some((event) => event.startsWith("count-")));
    }
  });
}

test("keeps the disposable archive boundary before any driver interaction", async (t) => {
  const fixture = await workload(t);
  await assert.rejects(
    runWindowsUIStability({
      driver: fixture.driver,
      fixtureRoot: fixture.fixtureRoot,
      archiveRoot: path.join(fixture.archiveRoot, "nested"),
    }),
    { code: "ERR_ASSERTION" },
  );
  assert.deepEqual(fixture.driver.events, []);
});

test("retains the explicit optional 3,000-book workload", async (t) => {
  const { driver, run, fixtureRoot } = await workload(t, undefined, "3000");
  await run();
  const report = JSON.parse(
    await readFile(path.join(fixtureRoot, "ui-stability/native-100.json"), "utf8"),
  );
  assert.deepEqual(report.counts, [3000]);
  assert.deepEqual(report.capacityGaps, [50, 500]);
  assert.equal(report.records.length, 4);
  assert.ok(driver.events.includes("count-3000"));
});

test("preserves exclusive fixture copies instead of overwriting a collision", async (t) => {
  const { driver, archiveRoot, run } = await workload(t);
  const collision = path.join(archiveRoot, "synthetic-0001.epub");
  await writeFile(collision, "existing disposable fixture");
  await assert.rejects(run(), { code: "EEXIST" });
  assert.equal(await readFile(collision, "utf8"), "existing disposable fixture");
  assert.deepEqual(driver.events, []);
});

for (const scale of ["99", "125"]) {
  test(`rejects invalid or mismatched display scale ${scale} before rescan`, async (t) => {
    const { driver, run } = await workload(t);
    process.env.ARCHEION_UI_NATIVE_SCALE = scale;
    await assert.rejects(
      run(),
      scale === "99" ? /actual Windows display scaling/ : /devicePixelRatio/,
    );
    assert.deepEqual(driver.events, []);
  });
}
