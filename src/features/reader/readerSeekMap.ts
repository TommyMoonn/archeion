import type { Book as EpubBook } from "epubjs";

import { normalizeReaderSeekPercentage } from "./readerLocation";
import type { ReaderNavigationModel } from "./readerNavigationModel";

export const READER_SEEK_LOCATION_BREAK = 1600;

type ReaderSeekLocations = Pick<
  EpubBook["locations"],
  "cfiFromPercentage" | "generate" | "percentageFromCfi"
> & { q?: { clear: () => void } };

export type ReaderSeekMapPendingState = Readonly<{
  status: "pending";
}>;

export type ReaderSeekMapUnavailableState = Readonly<{
  status: "unavailable";
}>;

export type ReaderSeekMapReadyState = Readonly<{
  resolveCfi: (percentage: number) => string | undefined;
  resolveChapterLabel: (cfi: string) => string | undefined;
  resolvePercentage: (cfi: string) => number | undefined;
  status: "ready";
}>;

export type ReaderSeekMapState =
  ReaderSeekMapPendingState | ReaderSeekMapReadyState | ReaderSeekMapUnavailableState;

export type ReaderSeekMap = Readonly<{
  generate: () => Promise<void>;
  getState: () => ReaderSeekMapState;
  retire: () => Promise<void> | undefined;
  subscribe: (listener: () => void) => () => void;
}>;

export const PENDING_READER_SEEK_MAP_STATE: ReaderSeekMapPendingState = Object.freeze({
  status: "pending",
});

const UNAVAILABLE_READER_SEEK_MAP_STATE: ReaderSeekMapUnavailableState = Object.freeze({
  status: "unavailable",
});

export function createReaderSeekMap(
  initialLocations: ReaderSeekLocations,
  getNavigationModel: () => ReaderNavigationModel,
): ReaderSeekMap {
  let locations: ReaderSeekLocations | null = initialLocations;
  let state: ReaderSeekMapState = PENDING_READER_SEEK_MAP_STATE;
  let generationPromise: Promise<void> | null = null;
  let retired = false;
  const listeners = new Set<() => void>();

  const setState = (nextState: ReaderSeekMapState) => {
    if (state === nextState) return;
    state = nextState;
    for (const listener of listeners) listener();
  };

  const resolveCfi = (percentage: number): string | undefined => {
    const activeLocations = locations;
    const normalized = normalizeReaderSeekPercentage(percentage);
    if (retired || state.status !== "ready" || !activeLocations || normalized === undefined) {
      return undefined;
    }

    try {
      const cfi: unknown = activeLocations.cfiFromPercentage(normalized);
      return nonEmptyString(cfi);
    } catch {
      return undefined;
    }
  };

  const resolvePercentage = (cfi: string): number | undefined => {
    const activeLocations = locations;
    if (retired || state.status !== "ready" || !activeLocations || !nonEmptyString(cfi)) {
      return undefined;
    }

    try {
      const percentage: unknown = activeLocations.percentageFromCfi(cfi);
      return normalizeReaderSeekPercentage(percentage);
    } catch {
      return undefined;
    }
  };

  const resolveChapterLabel = (cfi: string): string | undefined => {
    if (retired || state.status !== "ready" || !nonEmptyString(cfi)) return undefined;

    try {
      return getNavigationModel().findNearestChapter(cfi)?.label;
    } catch {
      return undefined;
    }
  };

  const readyState: ReaderSeekMapReadyState = Object.freeze({
    resolveCfi,
    resolveChapterLabel,
    resolvePercentage,
    status: "ready",
  });

  const generate = (): Promise<void> => {
    if (retired || state.status !== "pending") return Promise.resolve();
    if (generationPromise) return generationPromise;

    const generationLocations = locations;
    if (!generationLocations) return Promise.resolve();

    generationPromise = (async () => {
      try {
        const generated = await generationLocations.generate(READER_SEEK_LOCATION_BREAK);
        if (retired || locations !== generationLocations) return;

        setState(hasGeneratedLocation(generated) ? readyState : UNAVAILABLE_READER_SEEK_MAP_STATE);
      } catch {
        if (retired || locations !== generationLocations) return;
        setState(UNAVAILABLE_READER_SEEK_MAP_STATE);
      }
    })().finally(() => {
      generationPromise = null;
    });

    return generationPromise;
  };

  return Object.freeze({
    generate,
    getState: () => state,
    retire() {
      if (retired) return generationPromise ?? undefined;
      retired = true;
      // epub.js 0.3.93: clear drops queued sections but lets the running
      // process and generate() settle. stop/destroy would orphan that work.
      if (generationPromise) locations?.q?.clear();
      locations = null;
      setState(PENDING_READER_SEEK_MAP_STATE);
      listeners.clear();
      return generationPromise ?? undefined;
    },
    subscribe(listener) {
      if (retired) return () => undefined;
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  });
}

function hasGeneratedLocation(value: unknown): boolean {
  return Array.isArray(value) && value.some((entry) => nonEmptyString(entry) !== undefined);
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}
