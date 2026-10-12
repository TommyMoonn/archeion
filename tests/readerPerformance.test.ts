import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createTimelineSummary,
  distribution,
  regressionBudget,
} from "./browser/reader-performance-collector.mjs";
import { validateMetadata } from "../scripts/trace-reader-performance.mjs";
import { deriveNativeBudgets } from "../scripts/reader-performance-budgets.mjs";

// Synthetic validation inputs only. These objects are not captured WebView2 evidence.
function completeNativeReports() {
  const measured = () => distribution([10, 10, 10, 10, 10]);
  return Array.from({ length: 5 }, (_, index) => ({
    platform: "windows-webview2",
    metadata: {
      repetition: index + 1,
      deviceModel: "synthetic A",
      appArtifactSha256: "app",
      fixtureSha256: "fixture",
      inputDevice: "physical-mouse",
      scenario: "traverse-40",
    },
    environment: { dpr: 1 },
    probeSha256: "probe",
    collectorSha256: "collector",
    measurements: {
      summary: {
        hiddenIntervals: 0,
        dropped: 0,
        longTaskSupported: true,
        scrollingFrameIntervalMs: measured(),
        eventToObservedScrollMs: measured(),
        longTasksPerMinute: 0,
      },
      timeline: {
        dropped: 0,
        durations: {
          wheelHandler: measured(),
          layout: measured(),
          style: measured(),
          paint: measured(),
        },
        burstsPer100ms: { layout: measured(), paint: measured() },
      },
      mainThreadBusyPercent: 10,
      traceDataLoss: false,
      traceBufferPeak: 0,
    },
  }));
}

type NativeReports = ReturnType<typeof completeNativeReports>;
const controlsRoot = mkdtempSync(path.join(os.tmpdir(), "archeion-performance-budget-controls-"));
afterAll(() => {
  expect(path.resolve(controlsRoot).startsWith(path.resolve(os.tmpdir()) + path.sep)).toBe(true);
  expect(path.basename(controlsRoot).startsWith("archeion-performance-budget-controls-")).toBe(
    true,
  );
  rmSync(controlsRoot, { recursive: true });
});

function runBudgetCli(reports: NativeReports) {
  const files = reports.map((report, index) => {
    const file = path.join(controlsRoot, `run-${index + 1}.json`);
    writeFileSync(file, JSON.stringify(report));
    return file;
  });
  const processResult = spawnSync(
    process.execPath,
    ["scripts/reader-performance-budgets.mjs", ...files],
    {
      encoding: "utf8",
      windowsHide: true,
    },
  );
  return {
    ...processResult,
    budget: processResult.stdout ? JSON.parse(processResult.stdout) : null,
  };
}

describe("Native budget aggregate acceptance", () => {
  it("does not treat an empty distribution or unsupported long-task observation as measured zero", () => {
    const empty = completeNativeReports();
    for (const report of empty)
      report.measurements.timeline.durations.paint = {
        count: 0,
        min: 0,
        median: 0,
        p95: 0,
        p99: 0,
        max: 0,
      };
    expect(deriveNativeBudgets(empty)).toMatchObject({
      approvable: false,
      blockedMetrics: [{ metric: "paintP95Ms" }],
    });
    expect(runBudgetCli(empty).status).toBe(1);
    const unsupported = completeNativeReports();
    unsupported[0].measurements.summary.longTaskSupported = false;
    expect(deriveNativeBudgets(unsupported)).toMatchObject({
      approvable: false,
      blockedMetrics: [{ metric: "longTasksPerMinute" }],
    });
    expect(runBudgetCli(unsupported).status).toBe(1);
  });

  it.each(["keyboard", "scrollbar", "precision-touchpad"])(
    "does not infer missing-wheel exemptions from %s input labels",
    (inputDevice) => {
      const reports = completeNativeReports();
      for (const report of reports) {
        report.metadata.inputDevice = inputDevice;
        report.metadata.scenario = "appearance-panel";
        report.measurements.timeline.durations.wheelHandler = distribution([]);
      }
      expect(deriveNativeBudgets(reports)).toMatchObject({
        approvable: false,
        blockedMetrics: [{ metric: "wheelHandlerP95Ms" }],
      });
      expect(runBudgetCli(reports).status).toBe(1);
    },
  );

  it("blocks wholly missing performance data in both the API and CLI", () => {
    const reports = completeNativeReports();
    for (const report of reports) {
      report.measurements.summary.scrollingFrameIntervalMs = distribution([]);
      report.measurements.summary.eventToObservedScrollMs = distribution([]);
      report.measurements.summary.longTasksPerMinute = Number.NaN;
      report.measurements.mainThreadBusyPercent = Number.NaN;
      for (const key of Object.keys(report.measurements.timeline.durations))
        report.measurements.timeline.durations[
          key as keyof typeof report.measurements.timeline.durations
        ] = distribution([]);
      for (const key of Object.keys(report.measurements.timeline.burstsPer100ms))
        report.measurements.timeline.burstsPer100ms[
          key as keyof typeof report.measurements.timeline.burstsPer100ms
        ] = distribution([]);
    }
    expect(deriveNativeBudgets(reports)).toMatchObject({ approvable: false });
    const result = runBudgetCli(reports);
    expect(result.status).toBe(1);
    expect(result.budget.status).toMatch(/^blocked/);
    expect(result.budget.blockedMetrics).toHaveLength(11);
  });

  it.each(["absent", "invalid", "noisy"] as const)(
    "blocks exactly one %s required metric and fails the CLI",
    (defect) => {
      const reports = completeNativeReports();
      reports[0].measurements.summary.eventToObservedScrollMs.p95 =
        defect === "absent" ? null : defect === "invalid" ? -1 : 100;
      const budget = deriveNativeBudgets(reports);
      expect(budget).toMatchObject({ approvable: false });
      expect(budget.blockedMetrics.map((entry: { metric: string }) => entry.metric)).toEqual([
        "latencyP95Ms",
      ]);
      const result = runBudgetCli(reports);
      expect(result.status).toBe(1);
      expect(result.budget.status).toMatch(/^blocked/);
      expect(result.stderr).toContain("latencyP95Ms");
    },
  );

  it("keeps complete comparable runs provisional and eligible only for owner review", () => {
    const reports = completeNativeReports();
    const result = runBudgetCli(reports);
    expect(result.status).toBe(0);
    expect(result.budget).toMatchObject({
      status: "provisional: owner review required before behavior fixes",
      approvable: true,
      blockedMetrics: [],
      limits: { latencyP95Ms: { status: "provisional", upperLimit: 11 } },
    });
    expect(
      Object.values(result.budget.limits).every(
        (limit) => (limit as { status: string }).status === "provisional",
      ),
    ).toBe(true);
  });

  it.each([
    [
      "browser data",
      (reports: NativeReports) => {
        reports[1].platform = "chromium";
      },
    ],
    [
      "hardware",
      (reports: NativeReports) => {
        reports[1].metadata.deviceModel = "synthetic B";
      },
    ],
    [
      "app",
      (reports: NativeReports) => {
        reports[1].metadata.appArtifactSha256 = "different";
      },
    ],
    [
      "fixture",
      (reports: NativeReports) => {
        reports[1].metadata.fixtureSha256 = "different";
      },
    ],
    [
      "probe",
      (reports: NativeReports) => {
        reports[1].probeSha256 = "different";
      },
    ],
    [
      "collector",
      (reports: NativeReports) => {
        reports[1].collectorSha256 = "different";
      },
    ],
    [
      "duplicate repetition",
      (reports: NativeReports) => {
        reports[1].metadata.repetition = 1;
      },
    ],
    [
      "trace loss",
      (reports: NativeReports) => {
        reports[1].measurements.traceDataLoss = true;
      },
    ],
    [
      "hidden interval",
      (reports: NativeReports) => {
        reports[1].measurements.summary.hiddenIntervals = 1;
      },
    ],
    [
      "dropped observation",
      (reports: NativeReports) => {
        reports[1].measurements.summary.dropped = 1;
      },
    ],
    [
      "dropped trace",
      (reports: NativeReports) => {
        reports[1].measurements.timeline.dropped = 1;
      },
    ],
    [
      "full buffer",
      (reports: NativeReports) => {
        reports[1].measurements.traceBufferPeak = 0.95;
      },
    ],
  ] as const)("preserves rejection of %s", (_, invalidate) => {
    const reports = completeNativeReports();
    invalidate(reports);
    expect(() => deriveNativeBudgets(reports)).toThrow();
    expect(runBudgetCli(reports).status).toBe(1);
  });
});

describe("Reader performance evidence", () => {
  it("refuses to use browser runs or mixed machines for native limits", () => {
    expect(() => deriveNativeBudgets([])).toThrow("Exactly five");
    expect(() =>
      deriveNativeBudgets(Array.from({ length: 5 }, () => ({ platform: "chromium" }))),
    ).toThrow("Chromium cannot");
    const report = (repetition: number) => ({
      platform: "windows-webview2",
      metadata: { repetition, deviceModel: "A" },
      environment: { dpr: 1 },
      probeSha256: "probe",
      measurements: {
        summary: { hiddenIntervals: 0, dropped: 0 },
        timeline: { dropped: 0 },
        traceDataLoss: false,
        traceBufferPeak: 0,
      },
    });
    const mixed = Array.from({ length: 5 }, (_, index) => report(index + 1));
    mixed[1].metadata.deviceModel = "B";
    expect(() => deriveNativeBudgets(mixed)).toThrow("identity mismatch");
  });
  it("rejects incomplete native evidence and short sustained-session captures", () => {
    expect(() => validateMetadata({}, 120)).toThrow("Missing deviceModel");
    const metadata = {
      deviceModel: "test device",
      osBuild: "test build",
      webView2Runtime: "test runtime",
      inputDevice: "physical-mouse",
      powerMode: "AC",
      scalingPercent: 100,
      appVersion: "1.6.0",
      appArtifactSha256: "a".repeat(64),
      fixture: "long-spine",
      fixtureSha256: "b".repeat(64),
      scenario: "continuous-20m",
      repetition: 1,
    };
    expect(() => validateMetadata(metadata, 120)).toThrow("at least 1200");
    expect(
      validateMetadata({ ...metadata, ignoredPrivatePath: "private" }, 1200),
    ).not.toHaveProperty("ignoredPrivatePath");
  });
  it("uses nearest-rank percentiles and never fabricates an empty measurement", () => {
    expect(distribution([])).toMatchObject({ count: 0, median: null, p99: null });
    expect(distribution([4, 2, 1, 3, Number.NaN])).toEqual({
      count: 4,
      min: 1,
      median: 2,
      p95: 4,
      p99: 4,
      max: 4,
    });
  });
  it("blocks incomplete/noisy baselines and calculates the exact repeated-sample envelope", () => {
    expect(regressionBudget([1, 1])).toMatchObject({ status: "blocked" });
    expect(regressionBudget([1, 1, 1, 1, 20])).toMatchObject({ status: "blocked" });
    expect(regressionBudget([10, 10.2, 9.8, 10, 10.1])).toMatchObject({
      status: "provisional",
      upperLimit: 11,
      noise: 1,
    });
    expect(regressionBudget([0, 0, 0, 0, 0])).toMatchObject({ upperLimit: 0.5 });
  });
  it("aggregates dispatch/layout/paint duration without preserving sensitive trace arguments", () => {
    const summary = createTimelineSummary();
    summary.consume([
      {
        name: "EventDispatch",
        ph: "X",
        dur: 2_500,
        ts: 100_000,
        args: { data: { type: "wheel", text: "private book", url: "private path" } },
      },
      {
        name: "Layout",
        ph: "X",
        dur: 4_000,
        ts: 100_010,
        args: { data: { nodes: "private book" } },
      },
      { name: "Paint", ph: "X", dur: 1_000, ts: 100_030 },
      { name: "Layout", ph: "B", ts: 100_030 },
    ]);
    const result = summary.finish();
    expect(result.durations.wheelHandler.p95).toBe(2.5);
    expect(result.durations.layout.count).toBe(1);
    expect(result.burstsPer100ms.paint.max).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/private|url|nodes/);
  });
});
