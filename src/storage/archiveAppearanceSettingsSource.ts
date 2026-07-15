import type { ArchiveAppearanceSettings } from "../types/settings";
import type { LibraryStorage } from "./LibraryStorage";

export type ArchiveAppearanceSettingsSource = Readonly<{
  getArchiveAppearanceSettings: () => Promise<ArchiveAppearanceSettings>;
  saveArchiveAppearanceSettings: (
    settings: ArchiveAppearanceSettings,
  ) => Promise<ArchiveAppearanceSettings>;
}>;

type ArchiveAppearanceStorage = Pick<
  LibraryStorage,
  "getArchiveAppearanceSettings" | "saveArchiveAppearanceSettings"
>;

export function createArchiveAppearanceSettingsSource(
  storage: ArchiveAppearanceStorage,
): ArchiveAppearanceSettingsSource {
  return Object.freeze({
    getArchiveAppearanceSettings: () => storage.getArchiveAppearanceSettings(),
    saveArchiveAppearanceSettings: (settings) => storage.saveArchiveAppearanceSettings(settings),
  });
}
