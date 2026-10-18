import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import type { Page, TestInfo } from "@playwright/test";
import { distribution } from "./reader-performance-collector.mjs";
import { installUIStabilityProbe } from "./fixtures/ui-stability-probe";

export async function startUIStabilityCapture(page: Page, testInfo: TestInfo) {
  await page.addInitScript(installUIStabilityProbe);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  let sequence = 0;
  const pending: Promise<unknown>[] = [];
  const screenshots: { time: number; file: string }[] = [];
  const screenshotLimit = 1200;
  const filmstrip = process.env.ARCHEION_UI_FILMSTRIP === "1";
  if (filmstrip) {
    cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
      pending.push(cdp.send("Page.screencastFrameAck", { sessionId }));
      if (sequence >= screenshotLimit) return;
      const file = `frame-${String(sequence++).padStart(4, "0")}.jpg`;
      screenshots.push({ time: metadata.timestamp ?? 0, file });
      pending.push(writeFile(testInfo.outputPath(file), data, "base64"));
    });
    await cdp.send("Page.startScreencast", { format: "jpeg", quality: 75, everyNthFrame: 1 });
  }
  return async (conditions: Record<string, unknown>) => {
    if (filmstrip) await cdp.send("Page.stopScreencast");
    await Promise.all(pending);
    const probe = await page.evaluate(() => window.uiStabilityProbe.stop());
    const metrics = await cdp.send("Performance.getMetrics");
    await cdp.detach();
    const intervals = probe.frames.slice(1).map((frame, i) => frame.time - probe.frames[i]!.time);
    const fixture = await readFile("tests/fixtures/reader/readerFixtures.ts");
    const harnessFiles = [
      "tests/browser/fixtures/ui-stability-backend.ts",
      "tests/browser/fixtures/ui-stability-main.tsx",
      "tests/browser/fixtures/ui-stability-probe.ts",
      "tests/browser/ui-stability-capture.ts",
      "tests/browser/ui-stability.pw.ts",
      "tests/browser/ui-stability.config.ts",
    ];
    const harnessHashes = Object.fromEntries(
      await Promise.all(
        harnessFiles.map(async (file) => [
          file,
          createHash("sha256")
            .update(await readFile(file))
            .digest("hex"),
        ]),
      ),
    );
    const report = {
      schemaVersion: 1,
      environment: {
        source: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
        machine: createHash("sha256").update(os.hostname()).digest("hex").slice(0, 12),
        os: `${os.platform()} ${os.release()}`,
        node: process.version,
        browser: page.context().browser()?.version(),
        fixtureSha256: createHash("sha256").update(fixture).digest("hex"),
        harnessHashes,
        runtime: "Chromium with synthetic IPC; not native WebView2",
        ...conditions,
      },
      summary: {
        frameIntervalMs: distribution(intervals),
        framesOver33ms: intervals.filter((value) => value > 33.34).length,
        longTaskMs: distribution(probe.longTasks.map((task) => task.duration)),
        // These are observation costs too, not a production performance budget.
        metrics: Object.fromEntries(
          metrics.metrics
            .filter(({ name }) =>
              [
                "LayoutCount",
                "RecalcStyleCount",
                "LayoutDuration",
                "TaskDuration",
                "JSHeapUsedSize",
              ].includes(name),
            )
            .map(({ name, value }) => [name, value]),
        ),
      },
      screenshotCapture: {
        enabled: filmstrip,
        limit: screenshotLimit,
        capped: sequence === screenshotLimit,
        alignment:
          "screenshot time is epoch seconds; subtract probe.timeOrigin from time * 1000 to align with probe performance.now()",
        cadence:
          "Every compositor frame offered by CDP, timestamps retained; not guaranteed 60 fps",
        frames: screenshots,
      },
      gaps: [
        "native first-visible paint",
        "physical input and monitor DPI",
        "GPU/layer counters",
        "screen-reader speech",
      ],
      probe,
    };
    const file = testInfo.outputPath("ui-stability.json");
    await writeFile(file, JSON.stringify(report, null, 2));
    await testInfo.attach("ui-stability", { path: file, contentType: "application/json" });
    if (filmstrip && screenshots.length === 0)
      throw new Error("Filmstrip was requested but Chromium delivered no frames");
    return report;
  };
}
