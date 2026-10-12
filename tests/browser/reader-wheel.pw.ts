import { expect, test, type Page } from "@playwright/test";
import { ReaderRuntimeDriver } from "./reader-runtime-driver";
import { startPerformanceCapture } from "./reader-performance-collector.mjs";

async function frames(page: Page, count = 8) {
  await page.evaluate(async (count) => {
    for (let i = 0; i < count; i++)
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, count);
}

for (const kind of [
  "search",
  "annotations",
  "footnote",
  "illustration",
  "illustration-loading",
] as const) {
  test(`${kind} surface owns wheel input without scrolling the EPUB`, async ({ page }) => {
    const driver = new ReaderRuntimeDriver(page);
    await driver.open({ fixture: "long-spine", mode: "continuous", profile: "archeion" });
    const before = (await driver.snapshot()).scrollTop;
    await page.evaluate((kind) => window.readerFixture.showWheelOverlay(kind), kind);
    const target = page.locator(
      kind === "footnote"
        ? ".reader-footnote__content"
        : kind.startsWith("illustration")
          ? ".reader-illustration-viewer__viewport"
          : ".reader-panel-scroll",
    );
    await expect(target).toBeVisible();
    const image = page.locator(".reader-illustration-viewer img");
    const imageWidth = kind === "illustration" ? (await image.boundingBox())!.width : null;
    await target.hover();
    await page.mouse.wheel(0, 95);
    if (!kind.startsWith("illustration")) {
      await expect.poll(() => target.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
      await target.evaluate((node) => {
        node.scrollTop = node.scrollHeight;
      });
      await page.mouse.wheel(0, 95);
      await frames(page);
    } else await frames(page);
    if (imageWidth !== null) expect((await image.boundingBox())!.width).not.toBe(imageWidth);
    expect((await driver.snapshot()).scrollTop).toBe(before);
    if (kind === "search" || kind === "annotations") {
      await page.mouse.move(30, 300);
      await page.mouse.wheel(0, 95);
      await frames(page);
      expect((await driver.snapshot()).scrollTop).toBe(before);
    }
    await page.evaluate(() => window.readerFixture.closeWheelOverlay());
    await driver.wheel(95);
    await expect.poll(async () => (await driver.snapshot()).scrollTop).toBeGreaterThan(before);
  });
}

for (const target of ["body", "text", "illustration", "stage"] as const) {
  test(`native and historical forwarded pixel input over ${target}`, async ({ page }, info) => {
    const driver = new ReaderRuntimeDriver(page);
    const measurements = [];
    for (const legacyWheelForwarding of [true, false]) {
      await driver.open({
        fixture: target === "illustration" ? "short-cover" : "long-spine",
        mode: "continuous",
        profile: "archeion",
        legacyWheelForwarding,
      });
      const frame = page.frameLocator("#publication iframe").first();
      if (target === "stage") {
        // Expose a parent-scroller gutter so the actual hit is outside the iframe.
        await page.locator(".epub-container").evaluate((node) => {
          (node as HTMLElement).style.paddingLeft = "24px";
        });
        await page.mouse.move(5, 180);
      } else if (target === "body") {
        await frame.locator("body").hover({ position: { x: 4, y: 180 } });
      } else {
        await frame
          .locator(target === "text" ? "p" : "img")
          .first()
          .hover();
      }
      const capture = await startPerformanceCapture(page, { stageSelector: "#publication" });
      const before = (await driver.snapshot()).scrollTop;
      await page.mouse.wheel(0, 95);
      await expect
        .poll(async () => (await driver.snapshot()).scrollTop - before)
        .toBeCloseTo(95, 0);
      const singleDelta = (await driver.snapshot()).scrollTop - before;
      // Small fractional inputs followed by diminishing reverse deltas model a
      // high-resolution sequence. This is automated input, not physical momentum.
      const sequence = [4.5, 7.25, 12.5, 18.75, 12.5, 7.25, 4.5, -12.5, -7.25, -4.5];
      for (const delta of sequence) {
        await page.mouse.wheel(0, delta);
        await frames(page, 2);
      }
      await frames(page);
      const after = (await driver.snapshot()).scrollTop;
      const report = await capture.stop();
      // scrollTop is integer-quantized in the synchronous historical path.
      // Each fractional input can round by up to half a CSS pixel.
      expect(Math.abs(after - before - 95 - sequence.reduce((a, b) => a + b))).toBeLessThanOrEqual(
        sequence.length / 2,
      );
      expect(report.probe.wheels.length).toBe(11);
      expect(report.probe.wheels.every((wheel) => wheel.trusted)).toBe(true);
      expect(
        report.probe.wheels.every(
          (wheel) => wheel.surface === (target === "stage" ? "stage" : "iframe"),
        ),
      ).toBe(true);
      expect(
        report.probe.wheels.every(
          (wheel) => wheel.cancelled === (legacyWheelForwarding && target !== "stage"),
        ),
      ).toBe(true);
      expect(report.summary.eventToObservedScrollMs.count).toBeGreaterThan(0);
      measurements.push({
        legacyWheelForwarding,
        singleDelta,
        effectiveDelta: after - before,
        report,
      });
    }
    expect(
      Math.abs(measurements[0].effectiveDelta - measurements[1].effectiveDelta),
    ).toBeLessThanOrEqual(5);
    await info.attach("wheel-ab", {
      body: JSON.stringify(measurements),
      contentType: "application/json",
    });
  });
}

test("nested scroll areas and focused inputs retain native wheel ownership", async ({ page }) => {
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({ fixture: "long-spine", mode: "continuous", profile: "archeion" });
  const frame = page.frameLocator("#publication iframe").first();
  await frame.locator("body").evaluate((body) => {
    const doc = body.ownerDocument;
    const nested = doc.createElement("div");
    nested.id = "nested-scroll";
    nested.style.cssText =
      "position:absolute;top:180px;left:100px;width:220px;height:120px;overflow:auto;overscroll-behavior:contain;background:white";
    const content = doc.createElement("div");
    content.style.height = "800px";
    nested.append(content);
    const input = doc.createElement("textarea");
    input.id = "focused-input";
    input.style.cssText =
      "position:absolute;top:320px;left:100px;width:220px;height:100px;overflow:auto;overscroll-behavior:contain";
    input.value = Array.from({ length: 50 }, (_, i) => `Original input line ${i}`).join("\n");
    body.append(nested, input);
  });
  await driver.settle();
  const before = (await driver.snapshot()).scrollTop;
  for (const selector of ["#nested-scroll", "#focused-input"]) {
    const target = frame.locator(selector);
    if (selector === "#focused-input") await target.focus();
    await target.hover();
    await page.mouse.wheel(0, 95);
    await expect.poll(() => target.evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
    expect((await driver.snapshot()).scrollTop).toBe(before);
    await target.evaluate((node) => {
      node.scrollTop = node.scrollHeight;
    });
    await page.mouse.wheel(0, 95);
    await frames(page);
    expect((await driver.snapshot()).scrollTop).toBe(before);
  }
});

for (const key of ["Shift", "Control", "Alt", "Meta"]) {
  test(`${key} wheel is left to the browser`, async ({ page }) => {
    const driver = new ReaderRuntimeDriver(page);
    await driver.open({ fixture: "long-spine", mode: "continuous", profile: "archeion" });
    await page.mouse.move(400, 180);
    await page.keyboard.down(key);
    try {
      await page.mouse.wheel(0, 4);
    } finally {
      await page.keyboard.up(key);
    }
    await frames(page);
    const wheels = await page.evaluate(() =>
      window.readerFixture.events().filter((event) => event.type === "iframe-wheel"),
    );
    expect(wheels.length).toBeGreaterThan(0);
    expect(wheels.every((wheel) => !wheel.cancelled)).toBe(true);
  });
}

test("horizontal input and active selection remain uncancelled, then Reader retires", async ({
  page,
}) => {
  const driver = new ReaderRuntimeDriver(page);
  await driver.open({ fixture: "long-spine", mode: "continuous", profile: "archeion" });
  await page.mouse.move(400, 180);
  await page.mouse.wheel(40, 0);
  const paragraph = page.frameLocator("#publication iframe").first().locator("p").first();
  await paragraph.selectText();
  await paragraph.hover();
  await page.mouse.wheel(0, 15);
  await frames(page);
  const wheels = await page.evaluate(() =>
    window.readerFixture.events().filter((event) => event.type === "iframe-wheel"),
  );
  expect(wheels.length).toBeGreaterThanOrEqual(2);
  expect(wheels.every((wheel) => !wheel.cancelled)).toBe(true);
  expect(await paragraph.evaluate((node) => node.ownerDocument.getSelection()?.isCollapsed)).toBe(
    false,
  );
  const beforeClose = (await driver.snapshot()).scrollTop;
  expect(beforeClose).toBeGreaterThan(0);
  await page.evaluate(() => window.readerFixture.dispose());
  await page.mouse.wheel(0, 95);
  await expect(page.locator("#publication iframe")).toHaveCount(0);
  await expect(page.locator("#publication .epub-container")).toHaveCount(0);
});

test.describe("opt-in pointer selection diagnostic", () => {
  test.skip(
    process.env.ARCHEION_READER_SELECTION_DRAG !== "1",
    "Windows Chromium mouse.move times out in stock and Archeion EPUB iframes; physical selection acceptance remains open",
  );
  for (const profile of ["stock", "archeion"] as const) {
    test(`${profile} pointer drag selects text and leaves wheel uncancelled`, async ({ page }) => {
      const driver = new ReaderRuntimeDriver(page);
      await driver.open({ fixture: "long-spine", mode: "continuous", profile });
      const paragraph = page.frameLocator("iframe").first().locator("p").first();
      const box = (await paragraph.boundingBox())!;
      await page.mouse.move(box.x + 5, box.y + 10);
      await page.mouse.down();
      await page.mouse.move(box.x + 120, box.y + 10);
      await page.mouse.wheel(0, 15);
      await page.mouse.up();
      await frames(page);
      expect(
        await paragraph.evaluate((node) => node.ownerDocument.getSelection()?.isCollapsed),
      ).toBe(false);
      const wheels = await page.evaluate(() =>
        window.readerFixture.events().filter((event) => event.type === "iframe-wheel"),
      );
      expect(wheels.length).toBeGreaterThan(0);
      expect(wheels.every((wheel) => !wheel.cancelled)).toBe(true);
    });
  }
});
