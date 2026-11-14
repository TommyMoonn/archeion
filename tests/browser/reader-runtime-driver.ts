import { expect, test as base, type Page, type TestInfo } from "@playwright/test";
import type { RuntimeOptions } from "./fixtures/reader-epub-main";
import type {
  RuntimeAnchor,
  RuntimeSnapshot,
  RuntimeFrame,
} from "./fixtures/reader-runtime-observer";

const recordings = new WeakMap<Page, RuntimeFrame[]>();

export const test = base.extend({
  page: async ({ page }, runTest, info) => {
    try {
      await runTest(page);
    } finally {
      if (!page.isClosed()) {
        try {
          if (
            info.status !== info.expectedStatus ||
            info.retry > 0 ||
            process.env.ARCHEION_BROWSER_DIAGNOSTICS
          ) {
            const evidence = await page.evaluate(() =>
              window.readerFixture?.ready
                ? {
                    snapshot: window.readerFixture.snapshot(),
                    events: window.readerFixture.events(),
                  }
                : { ready: window.readerFixture?.ready, error: window.readerFixture?.error },
            );
            await info.attach("reader-failure-evidence", {
              body: JSON.stringify({ ...evidence, frames: recordings.get(page) }),
              contentType: "application/json",
            });
          }
        } finally {
          recordings.delete(page);
          await page.evaluate(() => {
            if (window.readerFixture) window.readerFixture.dispose();
          });
        }
      }
    }
  },
});

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

  async sampleFrames(action: () => Promise<void>, trackedIds: string[] = []) {
    // Begin in the browser before input and retain every painted transition through
    // quiescence, including asynchronous prepend/recovery after input completes.
    const recorder = await this.page.evaluateHandle((trackedIds) => {
      const samples = [window.readerFixture.sampleFrame(trackedIds)];
      let raf = 0;
      const deadline = performance.now() + 8000;
      const state = { samples, expired: false, signature: "", stableSince: performance.now() };
      const tick = () => {
        if (performance.now() >= deadline) {
          state.expired = true;
          return;
        }
        const sample = window.readerFixture.sampleFrame(trackedIds);
        samples.push(sample);
        const signature = JSON.stringify([
          sample.scrollTop,
          sample.scrollHeight,
          sample.sections,
          sample.anchors,
        ]);
        if (signature !== state.signature) state.stableSince = performance.now();
        state.signature = signature;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return { state, stop: () => cancelAnimationFrame(raf) };
    }, trackedIds);
    try {
      await action();
      const frames = await recorder.evaluate(async (recording) => {
        // Require the full existing quiet window after input finishes, even if
        // the browser had already been idle while the action was being prepared.
        recording.state.stableSince = performance.now();
        while (!recording.state.expired) {
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
          if (recording.state.expired) break;
          if (performance.now() - recording.state.stableSince >= 400)
            return recording.state.samples;
        }
        throw new Error("Reader frame recording exceeded 8000ms before settlement");
      });
      recordings.set(this.page, frames);
      return frames;
    } catch (error) {
      recordings.set(this.page, await recorder.evaluate((recording) => recording.state.samples));
      throw error;
    } finally {
      await recorder.evaluate((recording) => recording.stop());
      await recorder.dispose();
    }
  }

  async settle() {
    // Keep the existing 400ms geometry stability window, but sample in-browser
    // instead of serializing every anchor over the automation connection.
    await this.page.evaluate(async () => {
      let previous = "";
      let stableSince = performance.now();
      const deadline = performance.now() + 8000;
      while (performance.now() < deadline) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const sample = window.readerFixture.snapshot();
        const signature = JSON.stringify([
          sample.scrollTop,
          sample.scrollHeight,
          sample.sections,
          sample.anchors,
        ]);
        if (signature !== previous) stableSince = performance.now();
        previous = signature;
        if (performance.now() - stableSince >= 400) return;
      }
      throw new Error("Reader geometry did not settle within 8000ms");
    });
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
      body: JSON.stringify(
        testInfo.status !== testInfo.expectedStatus ||
          testInfo.retry > 0 ||
          process.env.ARCHEION_BROWSER_DIAGNOSTICS
          ? { ...extra, ...evidence }
          : {
              viewCount: evidence.snapshot.viewCount,
              sections: evidence.snapshot.sections.map((section) => section.index),
              eventCount: evidence.events.length,
              checkpoints: Object.keys(extra),
            },
      ),
      contentType: "application/json",
    });
    return evidence;
  }
}

export function findAnchor(snapshot: Pick<RuntimeSnapshot, "anchors">, id: string): RuntimeAnchor {
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

export function assertNoBlankReverse(samples: (RuntimeSnapshot | RuntimeFrame)[]) {
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
      "authoredContentVisible" in sample
        ? sample.authoredContentVisible
        : sample.anchors.some((anchor) => anchor.visible),
      "Authored text/media is actually visible",
    ).toBe(true);
    expect(
      sample.readiness.some(
        (view) =>
          view.inViewport &&
          view.displayed &&
          view.readyState === "complete" &&
          view.visibility === "visible" &&
          view.hit,
      ),
      "A loaded, shown chapter is hit-testable inside the viewport",
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
