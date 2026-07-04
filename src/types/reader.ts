export type ReaderTheme = "light" | "dark" | "sepia";

export type ReaderFlowMode = "paginated" | "scrolled";

export type ReaderSettings = {
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  margin: number;
  theme: ReaderTheme;
  flowMode: ReaderFlowMode;
};

export const defaultReaderSettings: Readonly<ReaderSettings> = Object.freeze({
  fontSize: 18,
  fontFamily: "serif",
  lineHeight: 1.6,
  margin: 48,
  theme: "dark",
  flowMode: "paginated",
});
