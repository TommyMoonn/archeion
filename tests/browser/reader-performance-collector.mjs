import { readFile } from "node:fs/promises";
import ts from "typescript";

export function distribution(values) {
  const ordered = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!ordered.length)
    return { count: 0, min: null, median: null, p95: null, p99: null, max: null };
  const at = (p) => ordered[Math.max(0, Math.ceil(ordered.length * p) - 1)];
  return {
    count: ordered.length,
    min: ordered[0],
    median: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: ordered.at(-1),
  };
}

/** Keep only numeric duration fields. Trace args may contain private paths or text. */
export function createTimelineSummary() {
  const durations = { wheelHandler: [], layout: [], style: [], paint: [] };
  const buckets = new Map();
  let dropped = 0;
  return {
    consume(events) {
      for (const event of events) {
        const kind =
          event.name === "EventDispatch" && event.args?.data?.type === "wheel"
            ? "wheelHandler"
            : { Layout: "layout", UpdateLayoutTree: "style", Paint: "paint" }[event.name];
        if (!kind || event.ph !== "X" || !Number.isFinite(event.dur)) continue;
        if (durations[kind].length < 200_000) durations[kind].push(event.dur / 1_000);
        else dropped += 1;
        const bucket = Math.floor(event.ts / 100_000);
        const counts = buckets.get(bucket) ?? { layout: 0, style: 0, paint: 0 };
        if (kind !== "wheelHandler") counts[kind] += 1;
        if (buckets.size < 20_000 || buckets.has(bucket)) buckets.set(bucket, counts);
        else dropped += 1;
      }
    },
    finish() {
      return {
        durations: Object.fromEntries(
          Object.entries(durations).map(([key, values]) => [key, distribution(values)]),
        ),
        burstsPer100ms: Object.fromEntries(
          ["layout", "style", "paint"].map((key) => [
            key,
            distribution([...buckets.values()].map((value) => value[key])),
          ]),
        ),
        dropped,
      };
    },
  };
}

export function summarizeProbe(probe) {
  const cadence = distribution(probe.frameIntervals).median;
  return {
    durationMs: probe.durationMs,
    frameIntervalMs: distribution(probe.frameIntervals),
    scrollingFrameIntervalMs: distribution(probe.scrollingFrameIntervals),
    eventToObservedScrollMs: distribution(probe.scrollLatencyMs),
    mountDetectionToReadyMs: distribution(probe.mountReadyMs),
    longTaskMs: distribution(probe.longTasks),
    longTasksPerMinute: (probe.longTasks.length * 60_000) / probe.durationMs,
    missedRafSlotsEstimate: cadence
      ? probe.scrollingFrameIntervals.reduce(
          (count, gap) => count + Math.max(0, Math.round(gap / cadence) - 1),
          0,
        )
      : null,
    mountedIframeCount: distribution(probe.samples.map((sample) => sample.frames)),
    mounts: probe.mounts,
    unmounts: probe.unmounts,
    stageResizes: probe.stageResizes,
    scrollerReplacements: probe.scrollerReplacements,
    progressPublicationHz: (probe.progressPublications * 1_000) / probe.durationMs,
    hiddenIntervals: probe.hiddenIntervals,
    dropped: probe.dropped,
    longTaskSupported: probe.longTaskSupported,
  };
}

/** Derive a repeatability envelope without inventing unmeasured limits. */
export function regressionBudget(values) {
  if (values.length < 5 || values.some((value) => !Number.isFinite(value) || value < 0))
    return { status: "blocked", reason: "Five valid comparable repetitions required" };
  const stats = distribution(values);
  const spread = stats.max - stats.min;
  if (spread > Math.max(stats.median * 0.2, 0.5))
    return {
      status: "blocked",
      reason: "Baseline noise exceeds 20% or 0.5 units; repeat under controlled conditions",
      baseline: stats,
    };
  const noise = Math.max(spread, stats.median * 0.1, 0.5);
  return { status: "provisional", baseline: stats, noise, upperLimit: stats.median + noise };
}

export async function startPerformanceCapture(
  page,
  options = { stageSelector: ".epub-viewer__stage" },
) {
  const source = await readFile(
    new URL("./fixtures/reader-performance-probe.ts", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const { installReaderPerformanceProbe } = await import(
    `data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`
  );
  const cdp = await page.context().newCDPSession(page);
  const timeline = createTimelineSummary();
  const metrics = [];
  let tracing = false;
  let traceBufferPeak = 0;
  let traceDataLoss = false;
  let traceSegments = 0;
  let stopped = false;
  let sampling = Promise.resolve();
  let interval;
  const sample = async (gc = false) => {
    if (gc) await cdp.send("HeapProfiler.collectGarbage");
    const [performance, counters, geometry] = await Promise.all([
      cdp.send("Performance.getMetrics"),
      cdp.send("Memory.getDOMCounters"),
      page.evaluate(() => {
        const geometry = window.__readerPerformance.sample();
        return {
          ...geometry,
          runtime: window.readerFixture?.ready ? window.readerFixture.metrics() : null,
        };
      }),
    ]);
    const numeric = Object.fromEntries(performance.metrics.map(({ name, value }) => [name, value]));
    const entry = {
      time: geometry.time,
      afterGc: gc,
      jsHeapBytes: numeric.JSHeapUsedSize,
      taskSeconds: numeric.TaskDuration,
      layoutSeconds: numeric.LayoutDuration,
      styleSeconds: numeric.RecalcStyleDuration,
      documents: counters.documents,
      nodes: counters.nodes,
      rendererListeners: counters.jsEventListeners,
      observerListeners: geometry.observerListeners,
      frames: geometry.frames,
      renditionEventCounts: geometry.runtime?.counts ?? null,
    };
    metrics.push(entry);
    return entry;
  };
  const startTrace = async () => {
    await cdp.send("Tracing.start", {
      categories: "devtools.timeline",
      transferMode: "ReportEvents",
      bufferUsageReportingInterval: 1_000,
    });
    tracing = true;
  };
  const finishTrace = async () => {
    if (!tracing) return;
    const complete = new Promise((resolve) => cdp.once("Tracing.tracingComplete", resolve));
    await cdp.send("Tracing.end");
    tracing = false;
    const status = await Promise.race([
      complete,
      new Promise((_, reject) => {
        const timeout = setTimeout(() => reject(new Error("Trace completion timed out")), 10_000);
        complete.finally(() => clearTimeout(timeout));
      }),
    ]);
    traceDataLoss ||= status?.dataLossOccurred ?? false;
    traceSegments += 1;
  };
  const checkpoint = (gc = false) => {
    sampling = sampling.then(async () => {
      // Flush bounded timeline segments at idle GC checkpoints and omit forced
      // collector GC work from input dispatch/layout/paint timing aggregates.
      if (gc) await finishTrace();
      const entry = await sample(gc);
      if (gc) await startTrace();
      return entry;
    });
    return sampling;
  };
  const cleanup = async () => {
    clearInterval(interval);
    if (tracing) await finishTrace().catch(() => {});
    await page.evaluate(() => window.__readerPerformance?.stop()).catch(() => {});
    await cdp.send("Performance.disable").catch(() => {});
    await cdp.detach();
  };
  try {
    await cdp.send("Performance.enable");
    cdp.on("Tracing.dataCollected", ({ value }) => timeline.consume(value));
    cdp.on("Tracing.bufferUsage", ({ percentFull }) => {
      traceBufferPeak = Math.max(traceBufferPeak, percentFull ?? 0);
    });
    await startTrace();
    await page.evaluate(installReaderPerformanceProbe, options);
    await checkpoint();
    interval = setInterval(() => {
      checkpoint().catch(() => {});
    }, 1_000);
  } catch (error) {
    await cleanup();
    throw error;
  }
  return {
    checkpoint,
    async stop() {
      if (stopped) throw new Error("Capture already stopped");
      stopped = true;
      clearInterval(interval);
      try {
        await sampling;
        await checkpoint();
        const probe = await page.evaluate(() => window.__readerPerformance.stop());
        const renditionObservation = await page.evaluate(() =>
          window.readerFixture?.ready ? window.readerFixture.metrics() : null,
        );
        await finishTrace();
        const first = metrics[0],
          last = metrics.at(-1);
        const taskDelta = last.taskSeconds - first.taskSeconds;
        const initialLocations = first.renditionEventCounts?.relocated;
        const finalLocations = last.renditionEventCounts?.relocated;
        const locationUpdateHz =
          initialLocations !== undefined && finalLocations >= initialLocations
            ? ((finalLocations - initialLocations) * 1_000) / probe.durationMs
            : null;
        return {
          probe,
          renditionObservation,
          metrics,
          summary: {
            ...summarizeProbe(probe),
            renditionRenderTailMs: distribution(renditionObservation?.renderHookToRenderedMs ?? []),
            locationUpdateHz,
          },
          timeline: timeline.finish(),
          traceBufferPeak,
          traceDataLoss,
          traceSegments,
          mainThreadBusyPercent: (taskDelta * 100_000) / (last.time - first.time),
          limitations: [
            "rAF observes main-thread offset changes, not physical input-to-compositor presentation",
            "Wheel correlation uses the latest input within 250ms; boundary corrections can affect effective delta",
            "Mount detection-to-ready is a DOM lifecycle surrogate, not full epub.js render duration",
            "Progress publication counts aria-valuenow mutations, not private relocation callbacks",
            "Renderer listener/heap counters include app and observer overhead; not total process or GPU memory",
            "Main-thread busy percentage is TaskDuration/wall time, not whole-system CPU",
            "Trace durations and bursts combine renderer threads; burst distribution excludes empty 100ms buckets",
          ],
        };
      } finally {
        await cleanup();
      }
    },
  };
}
