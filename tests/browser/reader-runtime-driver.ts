import { expect, type Page, type TestInfo } from "@playwright/test";
import type { RuntimeOptions } from "./fixtures/reader-epub-main";
import type { RuntimeAnchor, RuntimeSnapshot } from "./fixtures/reader-runtime-observer";

export class ReaderRuntimeDriver {
  constructor(readonly page: Page) {}

  async open(options: RuntimeOptions) {
    if (!this.page.url().includes("reader-epub.html")) {
      await this.page.goto("/tests/browser/fixtures/reader-epub.html?fixture=nested-prose");
      await expect.poll(() => this.page.evaluate(() => window.readerFixture?.ready)).toBe(true);
    }
    await this.page.evaluate((input) => window.readerFixture.open(input), options);
    await expect.poll(() => this.page.evaluate(() => window.readerFixture.ready)).toBe(true);
    await this.settle();
  }

  snapshot() {
    return this.page.evaluate(() => window.readerFixture.snapshot());
  }

  async sampleFrames(action: () => Promise<void>) {
    const recording = this.page.evaluate(async () => {
      const samples: RuntimeSnapshot[] = [];
      for (let frame = 0; frame < 30; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        samples.push(window.readerFixture.snapshot());
      }
      return samples;
    });
    await action();
    return recording;
  }

  async settle() {
    let previous = "";
    let stable = 0;
    await expect
      .poll(
        async () => {
          const sample = await this.snapshot();
          const signature = JSON.stringify([
            sample.scrollTop,
            sample.scrollHeight,
            sample.sections,
            sample.anchors,
          ]);
          stable = signature === previous ? stable + 1 : 0;
          previous = signature;
          return stable;
        },
        { timeout: 8000, intervals: [100] },
      )
      .toBeGreaterThanOrEqual(4);
  }

  async wheel(deltaY: number) {
    const sample = await this.snapshot();
    // The pointer is inside the real chapter iframe, not the parent stage.
    await this.page.mouse.move(
      sample.viewportLeft + sample.viewportWidth / 2,
      sample.viewportTop + 200,
    );
    await this.page.mouse.wheel(0, deltaY);
  }

  async key(key: "PageDown" | "PageUp" | "Home" | "End") {
    await this.page.locator("#publication .epub-container").focus();
    await this.page.keyboard.press(key);
  }

  async dragScrollbar(fraction: number) {
    const outer = this.page.locator("#publication .epub-container");
    const geometry = await outer.evaluate((element) => {
      const box = element.getBoundingClientRect();
      const height = element.clientHeight;
      const thumbHeight = Math.max(20, (height * height) / element.scrollHeight);
      return {
        x: box.left + element.clientWidth + (box.width - element.clientWidth) / 2,
        top: box.top,
        height,
        thumbHeight,
        thumbTop:
          (element.scrollTop / Math.max(1, element.scrollHeight - height)) * (height - thumbHeight),
        scrollbarWidth: box.width - element.clientWidth,
      };
    });
    expect(
      geometry.scrollbarWidth,
      "A real scrollbar must be available for this input path",
    ).toBeGreaterThan(0);
    const from = geometry.top + geometry.thumbTop + geometry.thumbHeight / 2;
    const to =
      geometry.top + geometry.thumbHeight / 2 + fraction * (geometry.height - geometry.thumbHeight);
    await this.page.mouse.move(geometry.x, from);
    await this.page.mouse.down();
    await this.page.mouse.move(geometry.x, to, { steps: 12 });
    await this.page.mouse.up();
  }

  async attach(testInfo: TestInfo, label: string, extra: object = {}) {
    const evidence = await this.page.evaluate(() => ({
      snapshot: window.readerFixture.snapshot(),
      events: window.readerFixture.events(),
    }));
    await testInfo.attach(label, {
      body: JSON.stringify({ ...extra, ...evidence }, null, 2),
      contentType: "application/json",
    });
    return evidence;
  }
}

export function findAnchor(snapshot: RuntimeSnapshot, id: string): RuntimeAnchor {
  const anchor = snapshot.anchors.find((candidate) => candidate.id === id);
  expect(anchor, `Mounted authored anchor ${id}`).toBeDefined();
  return anchor!;
}

export async function assertVisibleAnchorStable(
  driver: ReaderRuntimeDriver,
  before: RuntimeAnchor,
  tolerance = 2,
) {
  await driver.settle();
  const after = findAnchor(await driver.snapshot(), before.id);
  expect(after.visible, "The same passage remains visible").toBe(true);
  expect(
    Math.abs(after.top - before.top),
    "Screen Y error, independent of required scrollTop compensation",
  ).toBeLessThanOrEqual(tolerance);
}

export async function assertNextSectionReachable(driver: ReaderRuntimeDriver, section: string) {
  await expect
    .poll(
      async () =>
        (await driver.snapshot()).anchors.some(
          (anchor) => anchor.section === section && anchor.visible,
        ),
      {
        timeout: 2500,
      },
    )
    .toBe(true);
}

export async function assertImageCentered(driver: ReaderRuntimeDriver, id: string, tolerance = 1) {
  const sample = await driver.snapshot();
  const image = findAnchor(sample, id);
  expect(image.visible).toBe(true);
  const error = image.left + image.width / 2 - (sample.viewportLeft + sample.viewportWidth / 2);
  expect(Math.abs(error), "Measured image center error in CSS pixels").toBeLessThanOrEqual(
    tolerance,
  );
}

export function assertNoBlankReverse(samples: RuntimeSnapshot[]) {
  expect(samples.length).toBeGreaterThan(1);
  for (const sample of samples) {
    expect(
      sample.sections.some(
        (section) =>
          section.height > 0 &&
          section.top < sample.viewportTop + sample.clientHeight &&
          section.top + section.height > sample.viewportTop,
      ),
      "A mounted chapter covers the visible viewport",
    ).toBe(true);
    expect(
      sample.anchors.some((anchor) => anchor.visible),
      "Authored text/media is actually visible",
    ).toBe(true);
  }
}

export function assertSectionResidencyBounded(samples: RuntimeSnapshot[], maximum: number) {
  expect(samples.length).toBeGreaterThan(1);
  expect(
    new Set(samples.flatMap((sample) => sample.sections.map((section) => section.id))).size,
    "Residency evidence must include traversal, not one unchanged chapter",
  ).toBeGreaterThan(1);
  for (const sample of samples) expect(sample.viewCount).toBeLessThanOrEqual(maximum);
}
