import type { ReactNode } from "react";

import type { SettingsSection } from "./settingsSections";
import type { SettingsController } from "./useSettingsController";

export type SettingsItemGroupStyle = "standard" | "actions";

export type SettingsDeferredDataRequirement =
  | "themeCatalog"
  | "archiveImportSettings"
  | "coverCacheStatus"
  | "epubWritebackBackupStatus"
  | "folders";

export type SettingsItem = {
  deferredData?: readonly SettingsDeferredDataRequirement[];
  description?: string;
  groupLabel?: string;
  groupStyle?: SettingsItemGroupStyle;
  id: string;
  label: string;
  requiresArchive?: boolean;
  render: (context: SettingsController) => ReactNode;
  searchTerms?: readonly string[];
  sectionId: SettingsSection;
};
