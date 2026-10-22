import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

// Run after the benchmark. No timing budget determines the winning variant.
const [input, output] = process.argv.slice(2);
if (!input || !output)
  throw new Error("Usage: node library-layout-summary.mjs <results-dir> <summary.json>");
const files = await readdir(input, { recursive: true });
const groups = new Map();
const timelines = [];
for (const file of files.filter((file) => file.endsWith("layout-comparison.json"))) {
  const { view, count, scale, records } = JSON.parse(
    await readFile(path.join(input, file), "utf8"),
  );
  for (const record of records) {
    const key = JSON.stringify([view, count, scale, record.density, record.cardSize, record.auto]);
    const group = groups.get(key) ?? [];
    group.push(record);
    groups.set(key, group);
  }
}
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    min: sorted[0],
    median: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    max: sorted.at(-1),
  };
}
for (const file of files.filter((file) => file.endsWith("devtools-timeline.json"))) {
  const trace = JSON.parse(await readFile(path.join(input, file), "utf8"));
  const layouts = trace.traceEvents.filter((event) => event.name === "Layout" && event.ph === "X");
  const synchronous = layouts.filter(
    (event) => event.args?.beginData?.stackTrace?.length || event.args?.data?.stackTrace?.length,
  );
  timelines.push({
    file,
    layoutEvents: layouts.length,
    layoutMs: layouts.reduce((sum, event) => sum + (event.dur ?? 0) / 1000, 0),
    layoutsWithJSStack: synchronous.length,
    layoutWithJSStackMs: synchronous.reduce((sum, event) => sum + (event.dur ?? 0) / 1000, 0),
    attribution:
      "JS-stack subset is diagnostic, not a complete count of forced layouts. Raw traces include fixture/probe work and navigation outside measured trials.",
  });
}
const summary = {
  comparisons: [...groups].map(([key, records]) => {
    const [view, count, scale, density, cardSize, auto] = JSON.parse(key);
    return {
      view,
      count,
      scale,
      density,
      cardSize,
      auto,
      trials: records.length,
      layoutMs: stats(records.map((record) => record.durations.LayoutDuration * 1000)),
      styleMs: stats(records.map((record) => record.durations.RecalcStyleDuration * 1000)),
      slowFramesOver33ms: stats(
        records.map(
          (record) => record.geometry.frames.filter((frame) => frame.dt > 1000 / 30).length,
        ),
      ),
      longFramesOver50ms: stats(
        records.map((record) => record.geometry.frames.filter((frame) => frame.dt > 50).length),
      ),
      frameMs: stats(records.flatMap((record) => record.geometry.frames.map((frame) => frame.dt))),
      mounts: stats(records.map((record) => record.geometry.mounts)),
      retained: stats(records.map((record) => record.geometry.retained)),
      maxSpacerErrorPx: Math.max(
        ...records.flatMap((record) => [
          Math.abs(record.geometry.topSpacerError),
          Math.abs(record.geometry.bottomSpacerError),
        ]),
      ),
      maxAnchorDriftPx: Math.max(
        ...records.map((record) => {
          const ys = record.geometry.anchor.map((frame) => frame.y);
          return Math.max(...ys) - Math.min(...ys);
        }),
      ),
      focusStable: records.every((record) =>
        record.geometry.anchor.every((frame) => frame.focused),
      ),
    };
  }),
  timelines,
};
if (
  groups.size !== 144 ||
  [...groups.values()].some((records) => records.length !== 3) ||
  timelines.length !== 18
)
  throw new Error(
    `Incomplete matrix: expected 144 groups of 3 trials and 18 timelines; found ${groups.size} groups and ${timelines.length} timelines`,
  );
await writeFile(output, JSON.stringify(summary, null, 2) + "\n");
console.log(
  `${summary.comparisons.length} comparison groups, ${timelines.length} timelines written to ${output}`,
);
