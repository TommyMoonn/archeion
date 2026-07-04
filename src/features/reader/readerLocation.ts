import type { Location } from "epubjs";

export type ReaderLocation = {
  cfi: string;
  percentage: number;
  atStart: boolean;
  atEnd: boolean;
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function normalizeReaderLocation(
  location: Location,
  sectionCount = 0,
): ReaderLocation {
  let rawPercentage = location.start.percentage;

  if (!Number.isFinite(rawPercentage)) {
    const displayedPage = location.start.displayed?.page ?? 1;
    const displayedTotal = location.start.displayed?.total ?? 1;
    const sectionProgress = displayedPage / Math.max(displayedTotal, 1);

    rawPercentage =
      sectionCount > 0
        ? (location.start.index + sectionProgress) / sectionCount
        : 0;
  }

  if (location.atStart) {
    rawPercentage = 0;
  } else if (location.atEnd) {
    rawPercentage = 1;
  }

  return {
    cfi: location.start.cfi,
    percentage: Math.round(clamp(rawPercentage, 0, 1) * 1000) / 10,
    atStart: Boolean(location.atStart),
    atEnd: Boolean(location.atEnd),
  };
}
