import { expect, test, type Page } from "@playwright/test";
import { installCoverReadinessProbe } from "./fixtures/cover-readiness-probe";

async function visibleReady(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() => {
          const host = document.querySelector(".page-shell")!.getBoundingClientRect();
          return [...document.querySelectorAll<HTMLElement>(".book-cover")].filter((cover) => {
            const rect = cover.getBoundingClientRect();
            return (
              rect.bottom > host.top &&
              rect.top < host.bottom &&
              cover.dataset.coverState !== "available"
            );
          }).length;
        }),
      { timeout: 1260, intervals: [16] },
    )
    .toBe(0);
}

// Pairwise layout/scale/workload coverage, plus both delayed and normal
// workloads at 3000 books in each layout to retain the resource ceiling boundary.
const coverCases = [
  ["grid", 50, "normal"],
  ["grid", 500, "delayed"],
  ["grid", 3000, "normal"],
  ["list", 50, "delayed"],
  ["list", 500, "normal"],
  ["list", 3000, "delayed"],
  ["grid", 3000, "delayed"],
  ["list", 3000, "normal"],
] as const;

async function wheelSample(page: Page, delta: number) {
  const before = await page.locator(".page-shell").evaluate(
    (host, distance) => ({
      time: window.coverReadinessProbe.snapshot().time,
      scroll: host.scrollTop,
      target: Math.max(
        0,
        Math.min(host.scrollTop + distance, host.scrollHeight - host.clientHeight),
      ),
    }),
    delta,
  );
  await page.mouse.wheel(0, delta);
  await page.waitForFunction(
    ({ time, scroll, target }) => {
      const frames = window.coverReadinessProbe.snapshot().frames;
      // Two instrumented frames at the destination ensure entry observations have run.
      return (
        frames.length >= 2 &&
        frames
          .slice(-2)
          .every(
            (frame) =>
              frame.time > time &&
              (target > scroll
                ? frame.scroll > scroll
                : target < scroll
                  ? frame.scroll < scroll
                  : frame.scroll === scroll),
          )
      );
    },
    before,
    { timeout: 1260, polling: "raf" },
  );
}

async function travel(page: Page, direction: number, delayed: boolean, initialDistance = 0) {
  const velocity = delayed ? 500 : 1200;
  const distance = 18 * (delayed ? 60 : 120);
  let travelled = initialDistance;
  let previous = await page.evaluate(() => window.coverReadinessProbe.snapshot().time);
  // The original trajectory was 60px/120ms or 120px/100ms. Drive the same
  // speed and distance from observed frames, independently of cover readiness.
  while (travelled < distance) {
    const now = await page.evaluate(
      () =>
        new Promise<number>((resolve) => {
          requestAnimationFrame(() => resolve(performance.now()));
        }),
    );
    // Whole pixels keep a final subpixel remainder from rounding to a zero wheel movement.
    const delta = Math.min(
      distance - travelled,
      Math.max(1, Math.round(((now - previous) * velocity) / 1000)),
    );
    previous = now;
    const atBoundary = await page
      .locator(".page-shell")
      .evaluate(
        (host, sign) =>
          sign > 0 ? host.scrollTop >= host.scrollHeight - host.clientHeight : host.scrollTop <= 0,
        direction,
      );
    if (atBoundary) break;
    await wheelSample(page, direction * delta);
    travelled += delta;
  }
}

test.afterEach(async ({ page }, info) => {
  if (page.isClosed()) return;
  try {
    if (
      info.status !== info.expectedStatus ||
      info.retry > 0 ||
      process.env.ARCHEION_BROWSER_DIAGNOSTICS
    ) {
      const report = await page.evaluate(() => window.coverReadinessProbe?.snapshot());
      if (report)
        await info.attach("all-cover-readiness", {
          body: JSON.stringify(report),
          contentType: "application/json",
        });
    }
  } finally {
    await page.evaluate(() => window.coverReadinessProbe?.stop());
  }
});

for (const [view, count, workload] of coverCases) {
  test(`${view} ${count} ${workload} covers are ready at wheel-driven entry including reversal`, async ({
    page,
  }, info) => {
    const delay = workload === "delayed";
    await page.addInitScript(installCoverReadinessProbe, {
      fileDelay: delay ? 160 : 0,
      decodeDelay: delay ? 80 : 0,
    });
    await page.goto(
      `/tests/browser/fixtures/ui-stability.html?count=${count}&motion=off&covers=artwork&view=${view}&theme=${view === "grid" ? "dark" : "light"}`,
    );
    await expect(page.locator(`.book-${view}`)).toBeVisible();
    await visibleReady(page);
    // Establish the mounted horizon before testing continuous travel; cold entry is retained in metrics.
    await expect
      .poll(
        () =>
          page.evaluate(
            () =>
              window.coverReadinessProbe.snapshot().activeFiles +
              window.coverReadinessProbe.snapshot().activeDecodes,
          ),
        { timeout: 1260, intervals: [16] },
      )
      .toBe(0);
    const host = await page.locator(".page-shell").boundingBox();
    await page.mouse.move(host!.x + host!.width / 2, host!.y + host!.height / 2);
    for (const pass of ["continuous-cold", "continuous-warm"]) {
      await page.evaluate((pass) => window.coverReadinessProbe.phase(pass), pass);
      for (const direction of [1, -1]) {
        const start = await page.locator(".page-shell").evaluate((host) => host.scrollTop);
        let initialDistance = 0;
        if (delay && pass === "continuous-cold" && direction === -1) {
          await page.evaluate(() => window.coverReadinessProbe.holdDecodes());
          await expect
            .poll(() => page.evaluate(() => window.coverReadinessProbe.snapshot().heldDecodes), {
              timeout: 1260,
              intervals: [16],
            })
            .toBeGreaterThan(0);
          const pending = await page.evaluate(() => {
            const report = window.coverReadinessProbe.snapshot();
            return {
              time: report.time,
              activeFiles: report.activeFiles,
              activeDecodes: report.activeDecodes,
            };
          });
          await info.attach("decode-pending-reversal", {
            body: JSON.stringify({
              time: pending.time,
              activeFiles: pending.activeFiles,
              activeDecodes: pending.activeDecodes,
            }),
            contentType: "application/json",
          });
          try {
            await wheelSample(page, -60);
            initialDistance = 60;
          } finally {
            await page.evaluate(() => window.coverReadinessProbe.releaseDecodes());
          }
        }
        await travel(page, direction, delay, initialDistance);
        const end = await page.locator(".page-shell").evaluate((host) => host.scrollTop);
        expect((end - start) * direction, "Real wheel travel in each direction").toBeGreaterThan(0);
      }
      const report = await page.evaluate((pass) => {
        const report = window.coverReadinessProbe.snapshot();
        return {
          entries: report.entries.filter((entry) => entry.phase === pass),
          reverseWhilePending: report.wheels.some(
            (wheel) => wheel.phase === pass && wheel.delta < 0 && wheel.activeDecodes > 0,
          ),
          time: report.time,
        };
      }, pass);
      const entries = report.entries;
      const notReady = entries.filter((entry) => !entry.readyAtEntry);
      if (delay && pass === "continuous-cold") {
        expect(
          report.reverseWhilePending,
          "Reverse wheel input reaches the page while decode work is pending",
        ).toBe(true);
      }
      expect(entries.length).toBeGreaterThan(10);
      expect(
        notReady.map((entry) => ({
          id: entry.id,
          lead: entry.entered - (entry.horizon ?? entry.mounted),
          visibleLoading: Math.max(0, (entry.ready ?? entry.exited ?? report.time) - entry.entered),
        })),
      ).toEqual([]);
    }
    const report = await page.evaluate(() => {
      const report = window.coverReadinessProbe.snapshot();
      return {
        peakFiles: report.peakFiles,
        peakDecodes: report.peakDecodes,
        liveUrls: report.liveUrls,
        mounted: report.frames.at(-1)!.mounted,
      };
    });
    expect(report.peakFiles).toBeLessThanOrEqual(4);
    expect(report.peakDecodes).toBeLessThanOrEqual(4);
    expect(report.liveUrls).toBeLessThanOrEqual(48 + report.mounted);
    await page.screenshot({ path: info.outputPath("populated-artwork.png") });
  });
}

test("abrupt jumps beyond the horizon report transient loading without relaxing readiness", async ({
  page,
}, info) => {
  await page.addInitScript(installCoverReadinessProbe, { fileDelay: 160, decodeDelay: 80 });
  await page.goto("/tests/browser/fixtures/ui-stability.html?count=3000&motion=off");
  await expect(page.locator(".book-grid")).toBeVisible();
  await visibleReady(page);
  const host = await page.locator(".page-shell").boundingBox();
  await page.mouse.move(host!.x + 100, host!.y + 100);
  await page.evaluate(() => window.coverReadinessProbe.holdDecodes());
  await expect
    .poll(() => page.evaluate(() => window.coverReadinessProbe.snapshot().heldDecodes), {
      timeout: 1260,
      intervals: [16],
    })
    .toBeGreaterThan(0);
  await page.evaluate(() => window.coverReadinessProbe.phase("abrupt-jump"));
  try {
    await wheelSample(page, 30000);
    await wheelSample(page, -12000);
  } finally {
    await page.evaluate(() => window.coverReadinessProbe.releaseDecodes());
  }
  await visibleReady(page);
  const report = await page.evaluate(() => {
    const report = window.coverReadinessProbe.snapshot();
    return {
      transientLoading: report.entries.some(
        (entry) => entry.phase === "abrupt-jump" && !entry.readyAtEntry,
      ),
      retiredPendingDecode: report.decodes.some((decode) => decode.failed),
      peakFiles: report.peakFiles,
      peakDecodes: report.peakDecodes,
      liveUrls: report.liveUrls,
      mounted: report.frames.at(-1)!.mounted,
    };
  });
  expect(report.transientLoading).toBe(true);
  expect(report.retiredPendingDecode, "Offscreen pending decodes are retired").toBe(true);
  expect(report.peakFiles).toBeLessThanOrEqual(4);
  expect(report.peakDecodes).toBeLessThanOrEqual(4);
  expect(report.liveUrls).toBeLessThanOrEqual(48 + report.mounted);
  await info.attach("jump-limit", {
    body: JSON.stringify(report),
    contentType: "application/json",
  });
});
