import { expect, test } from "@playwright/test";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import os from "node:os";
import { buildReaderFixture } from "../fixtures/reader/readerFixtures";
import { startPerformanceCapture, regressionBudget } from "./reader-performance-collector.mjs";
import type { CaptureResult } from "./reader-performance-collector.mjs";

test("performance observation distinguishes iframe input and overlay input, then disposes", async ({
  page,
}) => {
  await page.goto(
    "/tests/browser/fixtures/reader-epub.html?fixture=long-spine&flow=continuous&profile=archeion",
  );
  await page.waitForFunction(() => window.readerFixture?.ready);
  await expect(startPerformanceCapture(page, { stageSelector: "[" })).rejects.toThrow();
  const capture = await startPerformanceCapture(page, { stageSelector: "#publication" });
  let stopped = false;
  try {
    const before = await page.evaluate(() => window.readerFixture.snapshot().scrollTop);
    await page.mouse.move(500, 350);
    await page.mouse.wheel(0, 95);
    await expect
      .poll(() => page.evaluate(() => window.readerFixture.snapshot().scrollTop))
      .not.toBe(before);
    await page.evaluate(() => {
      const backdrop = document.createElement("div");
      backdrop.className = "reader-side-surface-layer";
      backdrop.style.cssText = "position:fixed;inset:0;background:white";
      const panel = document.createElement("div");
      panel.className = "reader-side-panel";
      panel.style.cssText =
        "position:absolute;right:0;top:0;width:300px;height:700px;overflow:auto";
      const content = document.createElement("div");
      content.style.height = "2000px";
      panel.append(content);
      backdrop.append(panel);
      document.body.append(backdrop);
    });
    const bookOffset = await page.evaluate(() => window.readerFixture.snapshot().scrollTop);
    await page.mouse.move(1_000, 200);
    await page.mouse.wheel(0, 95);
    await expect
      .poll(() => page.locator(".reader-side-panel").evaluate((node) => node.scrollTop))
      .toBeGreaterThan(0);
    await page.mouse.move(300, 200);
    await page.mouse.wheel(0, 95);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(await page.evaluate(() => window.readerFixture.snapshot().scrollTop)).toBe(bookOffset);
    const checkpoint = await capture.checkpoint(true);
    expect(checkpoint.rendererListeners).toBeGreaterThan(checkpoint.observerListeners);
    expect(checkpoint.jsHeapBytes).toBeGreaterThan(0);
    await page.evaluate(() => {
      document.querySelector(".reader-side-surface-layer")?.remove();
      window.readerFixture.dispose();
    });
    const retired = await capture.checkpoint();
    expect(retired.frames).toBe(0);
    expect(retired.observerListeners).toBe(3);
    const report = await capture.stop();
    stopped = true;
    const iframe = report.probe.wheels.find((wheel) => wheel.surface === "iframe");
    expect(iframe?.trusted).toBe(true);
    expect(iframe?.cancelled).toBe(true);
    expect(iframe?.effectiveDelta).not.toBe(0);
    expect(report.probe.wheels.some((wheel) => wheel.surface === "panel")).toBe(true);
    expect(report.probe.wheels.some((wheel) => wheel.surface === "backdrop")).toBe(true);
    expect(report.summary.eventToObservedScrollMs.count).toBeGreaterThan(0);
    expect(report.summary.frameIntervalMs.count).toBeGreaterThan(0);
    expect(report.timeline.durations.wheelHandler.count).toBeGreaterThan(0);
    expect(report.probe.unmounts).toBeGreaterThan(0);
    expect(JSON.stringify(report)).not.toMatch(/Synthetic passage|file:\/\/|blob:http/);
    const count = report.probe.frameIntervals.length;
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    expect(
      await page.evaluate(() => window.__readerPerformance!.stop().frameIntervals.length),
    ).toBe(count);
  } finally {
    if (!stopped) await capture.stop();
  }
});

test("native wheel observation sees uncancelled browser chaining", async ({ page }) => {
  await page.goto("/tests/browser/fixtures/reader-epub.html?fixture=long-spine&flow=continuous");
  await page.waitForFunction(() => window.readerFixture?.ready);
  const capture = await startPerformanceCapture(page, { stageSelector: "#publication" });
  let report: CaptureResult;
  try {
    await page.mouse.move(500, 350);
    await page.mouse.wheel(0, 95);
    await expect
      .poll(() => page.evaluate(() => window.readerFixture.snapshot().scrollTop))
      .toBeGreaterThan(0);
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  } finally {
    report = await capture.stop();
  }
  expect(report.probe.wheels[0]?.cancelled).toBe(false);
  expect(report.probe.wheels[0]?.effectiveDelta).toBeGreaterThan(0);
});

test("opt-in Chromium performance baseline repetitions", async ({ page, browser }, testInfo) => {
  test.skip(process.env.ARCHEION_READER_PERFORMANCE !== "1", "Local numeric baseline only");
  test.setTimeout(120_000);
  const runs: CaptureResult[] = [];
  let warmup: CaptureResult | undefined;
  for (let repetition = 0; repetition < 6; repetition += 1) {
    await page.goto(
      "/tests/browser/fixtures/reader-epub.html?fixture=long-spine&flow=continuous&profile=archeion",
    );
    await page.waitForFunction(() => window.readerFixture?.ready);
    const capture = await startPerformanceCapture(page, { stageSelector: "#publication" });
    try {
      await page.mouse.move(500, 350);
      for (let input = 0; input < 20; input += 1) {
        await page.mouse.wheel(0, input < 12 ? 95 : -95);
        await page.evaluate(
          () =>
            new Promise<void>((resolve) => {
              let frames = 0;
              const step = () => {
                if (++frames === 8) resolve();
                else requestAnimationFrame(step);
              };
              requestAnimationFrame(step);
            }),
        );
      }
      await capture.checkpoint(true);
    } finally {
      const run = await capture.stop();
      expect(run.renditionObservation?.counts.relocated).toBeGreaterThan(0);
      expect(run.renditionObservation?.renderHookToRenderedMs.length).toBeGreaterThan(0);
      if (repetition === 0) warmup = run;
      else runs.push(run);
    }
  }
  const budget = (select: (run: CaptureResult) => number | null) =>
    regressionBudget(runs.map(select).filter((value): value is number => value !== null));
  const report = {
    schema: 1,
    platform: "chromium",
    input: "playwright-wheel",
    physicalInput: "not run",
    build: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    fixture: "long-spine",
    profile: "archeion",
    scenario: "20-wheel-forward-reverse",
    fixtureSource: "tests/fixtures/reader/readerFixtures.ts",
    fixtureSha256: createHash("sha256")
      .update(await buildReaderFixture("long-spine"))
      .digest("hex"),
    probeSha256: createHash("sha256")
      .update(await readFile("tests/browser/fixtures/reader-performance-probe.ts"))
      .digest("hex"),
    collectorSha256: createHash("sha256")
      .update(await readFile("tests/browser/reader-performance-collector.mjs"))
      .digest("hex"),
    browserVersion: browser.version(),
    environment: await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      dpr: devicePixelRatio,
    })),
    runs,
    warmup,
    host: {
      osVersion: os.version(),
      osRelease: os.release(),
      cpu: os.cpus()[0]?.model,
      headless: true,
    },
    provisionalBudgets: {
      frameP95Ms: budget((run) => run.summary.scrollingFrameIntervalMs.p95),
      frameP99Ms: budget((run) => run.summary.scrollingFrameIntervalMs.p99),
      latencyP95Ms: budget((run) => run.summary.eventToObservedScrollMs.p95),
      wheelHandlerP95Ms: budget((run) => run.timeline.durations.wheelHandler.p95),
      longTasksPerMinute: budget((run) => run.summary.longTasksPerMinute),
    },
    nativeGate:
      "blocked: physical WebView2 mouse/touchpad, scale matrix and sustained session not run",
    packageVersion: JSON.parse(await readFile("package.json", "utf8")).version,
  };
  const directory =
    process.env.ARCHEION_READER_PERFORMANCE_OUTPUT ??
    ".project/reviews/reader-performance/1.7.0.3/chromium";
  await mkdir(directory, { recursive: true });
  const filename = `${directory}/${Date.now()}-baseline.json`;
  await writeFile(filename, JSON.stringify(report, null, 2));
  await testInfo.attach("chromium-numeric-baseline", {
    body: JSON.stringify(report),
    contentType: "application/json",
  });
  console.log(`Chromium baseline: ${filename}`);
});
