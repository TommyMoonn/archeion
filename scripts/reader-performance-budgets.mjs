import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { regressionBudget } from "../tests/browser/reader-performance-collector.mjs";

/** Input is five reviewed runs of one native scenario, never mixed browser/hardware data. */
export function deriveNativeBudgets(reports) {
  assert.equal(reports.length, 5, "Exactly five measured native repetitions required");
  const identity = (report) =>
    JSON.stringify({
      platform: report.platform,
      metadata: { ...report.metadata, repetition: undefined },
      environment: report.environment,
      probeSha256: report.probeSha256,
      collectorSha256: report.collectorSha256,
    });
  const repetitions = new Set();
  for (const report of reports) {
    assert.equal(report.platform, "windows-webview2", "Chromium cannot approve native budgets");
    assert.equal(
      identity(report),
      identity(reports[0]),
      "Baseline hardware/input/scale/app/fixture/probe identity mismatch",
    );
    assert.ok(!repetitions.has(report.metadata.repetition), "Duplicate repetition");
    repetitions.add(report.metadata.repetition);
    const capture = report.measurements;
    assert.equal(capture.summary.hiddenIntervals, 0, "Hidden app invalidates pacing");
    assert.equal(capture.summary.dropped, 0, "Truncated observation");
    assert.equal(capture.timeline.dropped, 0, "Truncated timeline");
    assert.equal(capture.traceDataLoss, false, "Lost or unverified native timeline data");
    assert.ok(capture.traceBufferPeak < 0.95, "Trace buffer near capacity; use shorter segments");
  }
  const budget = (select) => regressionBudget(reports.map((report) => select(report.measurements)));
  const percentileBudget = (select, percentile = "p95") =>
    budget((run) => {
      const measured = select(run);
      return Number.isInteger(measured?.count) && measured.count > 0
        ? measured[percentile]
        : undefined;
    });
  // This tool derives a complete scrolling envelope. Supplementary captures
  // receive no implicit metric exemptions based on scenario or input labels.
  const limits = {
    frameP95Ms: percentileBudget((run) => run.summary.scrollingFrameIntervalMs),
    frameP99Ms: percentileBudget((run) => run.summary.scrollingFrameIntervalMs, "p99"),
    latencyP95Ms: percentileBudget((run) => run.summary.eventToObservedScrollMs),
    wheelHandlerP95Ms: percentileBudget((run) => run.timeline.durations?.wheelHandler),
    layoutP95Ms: percentileBudget((run) => run.timeline.durations?.layout),
    styleP95Ms: percentileBudget((run) => run.timeline.durations?.style),
    paintP95Ms: percentileBudget((run) => run.timeline.durations?.paint),
    layoutBurstP95: percentileBudget((run) => run.timeline.burstsPer100ms?.layout),
    paintBurstP95: percentileBudget((run) => run.timeline.burstsPer100ms?.paint),
    longTasksPerMinute: budget((run) =>
      run.summary.longTaskSupported === true ? run.summary.longTasksPerMinute : undefined,
    ),
    mainThreadBusyPercent: budget((run) => run.mainThreadBusyPercent),
  };
  const blockedMetrics = Object.entries(limits)
    .filter(([, limit]) => limit.status !== "provisional")
    .map(([metric, limit]) => ({ metric, reason: limit.reason }));
  const approvable = blockedMetrics.length === 0;
  return {
    schema: 1,
    platform: "windows-webview2",
    status: approvable
      ? "provisional: owner review required before behavior fixes"
      : "blocked: required performance evidence is incomplete or invalid",
    approvable,
    blockedMetrics,
    identity: JSON.parse(identity(reports[0])),
    limits,
    finalRule:
      "Five comparable final repetitions: median and at least four individual runs meet each reviewed limit; missing metrics stay blocked",
    memoryGate:
      "Five post-GC idle checkpoints over 20 minutes; final working set and listeners must stabilize. Baseline unbounded retention is not an accepted ceiling.",
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.join(import.meta.dirname, "reader-performance-budgets.mjs")
) {
  Promise.all(process.argv.slice(2).map(async (file) => JSON.parse(await readFile(file, "utf8"))))
    .then((reports) => {
      const result = deriveNativeBudgets(reports);
      console.log(JSON.stringify(result, null, 2));
      if (!result.approvable) {
        console.error(
          `Native performance budget blocked: ${result.blockedMetrics.map(({ metric }) => metric).join(", ")}`,
        );
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}
