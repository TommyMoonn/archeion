import type { Page } from "@playwright/test";
import type {
  PerformanceProbeOptions,
  PerformanceProbeResult,
} from "./fixtures/reader-performance-probe";
export type Distribution = {
  count: number;
  min: number | null;
  median: number | null;
  p95: number | null;
  p99: number | null;
  max: number | null;
};
export type CaptureResult = {
  probe: PerformanceProbeResult;
  renditionObservation: { counts: Record<string, number>; renderHookToRenderedMs: number[] } | null;
  metrics: {
    time: number;
    afterGc: boolean;
    jsHeapBytes: number;
    taskSeconds: number;
    rendererListeners: number;
    observerListeners: number;
    frames: number;
  }[];
  summary: {
    durationMs: number;
    frameIntervalMs: Distribution;
    scrollingFrameIntervalMs: Distribution;
    eventToObservedScrollMs: Distribution;
    mountDetectionToReadyMs: Distribution;
    longTaskMs: Distribution;
    longTasksPerMinute: number;
    missedRafSlotsEstimate: number | null;
    mountedIframeCount: Distribution;
    mounts: number;
    unmounts: number;
    stageResizes: number;
    scrollerReplacements: number;
    progressPublicationHz: number;
    hiddenIntervals: number;
    dropped: number;
    longTaskSupported: boolean;
    renditionRenderTailMs?: Distribution;
    locationUpdateHz?: number | null;
  };
  timeline: {
    durations: Record<string, Distribution>;
    burstsPer100ms: Record<string, Distribution>;
    dropped: number;
  };
  mainThreadBusyPercent: number;
  traceBufferPeak: number;
  traceDataLoss: boolean;
  traceSegments: number;
  limitations: string[];
};
export function startPerformanceCapture(
  page: Page,
  options?: PerformanceProbeOptions,
): Promise<{
  checkpoint(gc?: boolean): Promise<CaptureResult["metrics"][number]>;
  stop(): Promise<CaptureResult>;
}>;
export function distribution(values: number[]): Distribution;
export function summarizeProbe(probe: PerformanceProbeResult): CaptureResult["summary"];
export function regressionBudget(values: number[]): {
  status: string;
  reason?: string;
  upperLimit?: number;
  noise?: number;
  baseline?: Distribution;
};
export function createTimelineSummary(): {
  consume(events: unknown[]): void;
  finish(): CaptureResult["timeline"];
};
