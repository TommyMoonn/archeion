import type {
  AppThemePreset,
  BookCardSize,
  InterfaceDensity,
  StartupBehavior,
  WindowFrameStyle,
} from "../../types/appSettings";
import type { LibrarySort } from "../../types/library";
import type {
  ReaderProgressPlacement,
  ReaderTheme,
} from "../../types/reader";
import type { LibraryView } from "../library/LibraryToolbar";
import { librarySortOptions } from "../library/librarySortOptions";

type SettingsOption<TValue extends string> = {
  label: string;
  value: TValue;
};

export const typefaceOptions = [
  { label: "Book serif", value: "serif" },
  { label: "Clean sans", value: "sans" },
  { label: "System", value: "system" },
] satisfies Array<SettingsOption<"serif" | "sans" | "system">>;

export const readerThemeOptions = [
  { label: "Light", value: "light" },
  { label: "Sepia", value: "sepia" },
  { label: "Dark", value: "dark" },
] satisfies Array<SettingsOption<ReaderTheme>>;

export const progressPlacementOptions = [
  { label: "Top", value: "top" },
  { label: "Side", value: "side" },
] satisfies Array<SettingsOption<ReaderProgressPlacement>>;

export const densityOptions = [
  { label: "Comfortable", value: "comfortable" },
  { label: "Compact", value: "compact" },
] satisfies Array<SettingsOption<InterfaceDensity>>;

export const cardSizeOptions = [
  { label: "Small", value: "small" },
  { label: "Medium", value: "medium" },
  { label: "Large", value: "large" },
] satisfies Array<SettingsOption<BookCardSize>>;

export const frameOptions = [
  { label: "Hidden", value: "hidden" },
  { label: "Archeion", value: "archeion" },
  { label: "Native", value: "native" },
] satisfies Array<SettingsOption<WindowFrameStyle>>;

export const startupOptions = [
  { label: "Open last archive", value: "open-last-archive" },
  { label: "Show Archive Manager", value: "show-archive-manager" },
] satisfies Array<SettingsOption<StartupBehavior>>;

export const appThemeOptions = [
  { label: "System", value: "system" },
  { label: "Dark", value: "dark" },
  { label: "Light", value: "light" },
] satisfies Array<SettingsOption<AppThemePreset>>;

export const viewOptions = [
  { label: "Grid", value: "grid" },
  { label: "List", value: "list" },
] satisfies Array<SettingsOption<LibraryView>>;

export const defaultLibrarySortOptions: Array<SettingsOption<LibrarySort>> =
  librarySortOptions;
