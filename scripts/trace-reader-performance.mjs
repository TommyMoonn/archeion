import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { startPerformanceCapture } from "../tests/browser/reader-performance-collector.mjs";

const root = path.resolve(import.meta.dirname, "..");
const scenarios = [
  "audit-volume-3-cold",
  "audit-volume-10-cold",
  "audit-volume-11-cold",
  "short-cover",
  "reverse-prepend",
  "traverse-40",
  "rapid-reverse",
  "continuous-20m",
  "paged-turns",
  "navigation-panel",
  "annotations-panel",
  "search-panel",
  "appearance-panel",
  "appearance-changes",
  "window-resize",
  "scale-100",
  "scale-200",
  "scale-300",
];
const fields = [
  "deviceModel",
  "osBuild",
  "webView2Runtime",
  "inputDevice",
  "powerMode",
  "scalingPercent",
  "appVersion",
  "appArtifactSha256",
  "fixture",
  "fixtureSha256",
  "scenario",
  "repetition",
];

export function validateMetadata(metadata, seconds) {
  for (const field of fields)
    assert.ok(metadata[field] !== undefined && metadata[field] !== "", `Missing ${field}`);
  assert.ok(scenarios.includes(metadata.scenario), "Unknown scenario");
  assert.ok(
    ["physical-mouse", "precision-touchpad", "keyboard", "scrollbar"].includes(
      metadata.inputDevice,
    ),
    "Unknown inputDevice",
  );
  assert.ok(
    [
      "short-cover",
      "reverse-prepend",
      "long-spine",
      "image-only",
      "nested-prose",
      "fixed-layout",
      "audit-volume-3",
      "audit-volume-10",
      "audit-volume-11",
    ].includes(metadata.fixture),
    "Use a safe fixture identifier",
  );
  for (const key of ["appArtifactSha256", "fixtureSha256"])
    assert.match(metadata[key], /^[a-f0-9]{64}$/i, `${key} must identify exact bytes`);
  assert.ok(
    Number.isInteger(metadata.repetition) && metadata.repetition > 0,
    "Positive repetition required",
  );
  assert.ok(
    Number.isFinite(metadata.scalingPercent) && metadata.scalingPercent > 0,
    "Positive scalingPercent required",
  );
  assert.ok(seconds >= 10 && seconds <= 1_800, "Duration must be 10..1800 seconds");
  if (metadata.scenario === "continuous-20m")
    assert.ok(seconds >= 1_200, "Sustained session requires at least 1200 seconds");
  return Object.fromEntries(fields.map((field) => [field, metadata[field]]));
}

async function main() {
  const { values } = parseArgs({
    options: {
      metadata: { type: "string" },
      port: { type: "string", default: "9223" },
      seconds: { type: "string", default: "120" },
      "gc-checkpoint-seconds": { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "node scripts/trace-reader-performance.mjs --metadata <local.json> [--port 9223] [--seconds 120]\nAttach only to your opt-in Tauri/WebView2 test session. See tests/browser/reader-performance.md.",
    );
    return;
  }
  assert.equal(process.platform, "win32", "Native collection requires Windows WebView2");
  assert.ok(values.metadata, "--metadata is required");
  const seconds = Number(values.seconds),
    port = Number(values.port);
  const gcInterval = values["gc-checkpoint-seconds"]
    ? Number(values["gc-checkpoint-seconds"])
    : null;
  if (gcInterval !== null)
    assert.ok(
      Number.isInteger(gcInterval) && gcInterval >= 60 && gcInterval % 30 === 0,
      "GC interval must be a multiple of 30 seconds, at least 60",
    );
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, "Invalid debugging port");
  const metadata = validateMetadata(JSON.parse(await readFile(values.metadata, "utf8")), seconds);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  let capture;
  try {
    const candidates = [];
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        if (await page.evaluate(() => Boolean(window.__TAURI_INTERNALS__)).catch(() => false))
          candidates.push(page);
      }
    }
    assert.equal(
      candidates.length,
      1,
      "Require exactly one Tauri app page on the selected test endpoint",
    );
    const page = candidates[0];
    const environment = await page.evaluate(() => ({
      dpr: devicePixelRatio,
      width: innerWidth,
      height: innerHeight,
    }));
    capture = await startPerformanceCapture(page);
    // GC is outside input windows. No forced GC during scrolling or panel motion.
    await capture.checkpoint(true);
    console.log(
      `Recording ${metadata.scenario} repetition ${metadata.repetition} for ${seconds}s. Perform the documented physical input sequence now.`,
    );
    for (let elapsed = 0; elapsed < seconds; elapsed += Math.min(30, seconds - elapsed)) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(30, seconds - elapsed) * 1_000));
      console.log(`Capture ${Math.min(elapsed + 30, seconds)}/${seconds}s`);
      const capturedSeconds = Math.min(elapsed + 30, seconds);
      if (gcInterval && capturedSeconds < seconds) {
        if ((capturedSeconds + 30) % gcInterval === 0)
          console.log(
            "GC checkpoint in 30s: pause input five seconds before the checkpoint, resume after its completion message.",
          );
        if (capturedSeconds % gcInterval === 0) {
          await capture.checkpoint(true);
          console.log("Idle GC checkpoint complete; resume the documented input sequence.");
        }
      }
    }
    await capture.checkpoint(true);
    const measurements = await capture.stop();
    capture = undefined;
    const report = {
      schema: 1,
      platform: "windows-webview2",
      status: "recorded, pending review",
      metadata,
      environment: {
        ...environment,
        osRelease: os.release(),
        osVersion: os.version(),
        runtimeProduct: browser.version(),
      },
      collectorRevision: execFileSync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }).trim(),
      probeSha256: createHash("sha256")
        .update(
          await readFile(
            new URL("../tests/browser/fixtures/reader-performance-probe.ts", import.meta.url),
          ),
        )
        .digest("hex"),
      collectorSha256: createHash("sha256")
        .update(
          await readFile(
            new URL("../tests/browser/reader-performance-collector.mjs", import.meta.url),
          ),
        )
        .digest("hex"),
      measurements,
      scenarioMatrix: scenarios.map((scenario) => ({
        scenario,
        status: scenario === metadata.scenario ? "recorded, pending review" : "not run",
      })),
      signoff:
        "blocked until the complete same-machine physical input/scale matrix and repeated-sample budget review",
    };
    const directory = path.join(
      root,
      ".project",
      "reviews",
      "reader-performance",
      "1.7.0.3",
      "windows-webview2",
    );
    await mkdir(directory, { recursive: true });
    const destination = path.join(
      directory,
      `${Date.now()}-${metadata.scenario}-r${metadata.repetition}.json`,
    );
    await writeFile(destination, JSON.stringify(report, null, 2), { flag: "wx" });
    console.log(`Numeric report: ${destination}`);
  } finally {
    if (capture) await capture.stop().catch(() => {});
    // connectOverCDP close disconnects this client; it does not own the app process.
    await browser.close();
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === path.join(import.meta.dirname, "trace-reader-performance.mjs")
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
