import projection from "../generated/release-history.json";
import { parseReleaseChanges } from "../../../scripts/release-history-markdown.mjs";

export type ReleaseEntry = {
  version: string;
  date: string;
  sourcePath: string;
  changes: string;
};
const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export const releaseId = (version: string) => `release-${version.replaceAll(".", "-")}`;
export function releaseDate(date: string) {
  const [year, month, day] = date.split("-");
  return `${months[Number(month) - 1]} ${Number(day)}, ${year}`;
}
// Parsing happens once, outside React render. docs:check owns canonical freshness.
export const releases = projection.entries.map((entry: ReleaseEntry) => ({
  ...entry,
  id: releaseId(entry.version),
  dateLabel: releaseDate(entry.date),
  items: parseReleaseChanges(entry.changes),
}));
export const releaseHeadings = releases.map(({ version, id }) => ({
  value: `v${version}`,
  id,
  level: 2,
}));
