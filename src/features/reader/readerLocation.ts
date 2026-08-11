import type { Location } from "epubjs";

import type { Book } from "../../types/book";

export type ReaderLocation = {
  cfi: string;
  percentage: number;
  atStart: boolean;
  atEnd: boolean;
};

export type ReaderRelocation = Readonly<{
  atEnd: boolean;
  atStart: boolean;
  cfi: string;
  displayedPage?: number;
  displayedTotal?: number;
  rawPercentage?: number;
  sectionCount: number;
  sectionIndex?: number;
}>;

export type ReaderProgressInitialState = Readonly<{
  initialCfi?: string;
  location: ReaderLocation;
}>;

export const EMPTY_READER_LOCATION: ReaderLocation = Object.freeze({
  cfi: "",
  percentage: 0,
  atStart: true,
  atEnd: false,
});

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function normalizeReaderSeekPercentage(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, 0, 1) : undefined;
}

export function snapshotReaderRelocation(
  location: Location,
  sectionCount: number,
): ReaderRelocation {
  return Object.freeze({
    atEnd: Boolean(location.atEnd),
    atStart: Boolean(location.atStart),
    cfi: location.start.cfi,
    displayedPage: location.start.displayed?.page,
    displayedTotal: location.start.displayed?.total,
    rawPercentage: location.start.percentage,
    sectionCount,
    sectionIndex: location.start.index,
  });
}

export function normalizeReaderLocation(relocation: ReaderRelocation): ReaderLocation {
  let rawPercentage =
    typeof relocation.rawPercentage === "number" && Number.isFinite(relocation.rawPercentage)
      ? relocation.rawPercentage
      : undefined;

  if (rawPercentage === undefined) {
    const displayedPage = relocation.displayedPage ?? 1;
    const displayedTotal = relocation.displayedTotal ?? 1;
    const sectionProgress = displayedPage / Math.max(displayedTotal, 1);

    rawPercentage =
      relocation.sectionCount > 0
        ? ((relocation.sectionIndex ?? 0) + sectionProgress) / relocation.sectionCount
        : 0;
  }

  if (relocation.atStart) {
    rawPercentage = 0;
  } else if (relocation.atEnd) {
    rawPercentage = 1;
  }

  return {
    cfi: relocation.cfi,
    percentage: Math.round(clamp(rawPercentage, 0, 1) * 1000) / 10,
    atStart: relocation.atStart,
    atEnd: relocation.atEnd,
  };
}

export function createReaderProgressInitialState(
  book: Pick<Book, "progressCfi" | "progressPercent">,
  startFromBeginning: boolean,
): ReaderProgressInitialState {
  if (startFromBeginning) {
    return { location: EMPTY_READER_LOCATION };
  }

  const cfi = book.progressCfi ?? "";
  return {
    initialCfi: cfi || undefined,
    location: {
      cfi,
      percentage: book.progressPercent ?? 0,
      atStart: !cfi,
      atEnd: false,
    },
  };
}
