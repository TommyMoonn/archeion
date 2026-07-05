export type InterfaceDensity = "comfortable" | "compact";
export type BookCardSize = "small" | "medium" | "large";
export type WindowFrameStyle = "hidden" | "archeion" | "native";

export type AppPreferences = {
  density: InterfaceDensity;
  bookCardSize: BookCardSize;
  showContinueReading: boolean;
  windowFrameStyle: WindowFrameStyle;
};

export const defaultAppPreferences: Readonly<AppPreferences> = Object.freeze({
  density: "comfortable",
  bookCardSize: "medium",
  showContinueReading: true,
  windowFrameStyle: "hidden",
});
