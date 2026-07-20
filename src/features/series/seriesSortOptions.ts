import type { SeriesSort } from "../../types/library";

export type SeriesSortOption = {
  label: string;
  value: SeriesSort;
};

export const seriesSortOptions: SeriesSortOption[] = [
  { label: "Title", value: "title" },
  { label: "Recently opened", value: "recently-opened" },
  { label: "Most volumes", value: "most-volumes" },
];
