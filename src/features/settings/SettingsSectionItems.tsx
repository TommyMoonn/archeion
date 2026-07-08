import { type ReactNode } from "react";

import {
  getSettingsItemsForSection,
  type SettingsItem,
  type SettingsItemGroupStyle,
} from "./settingsItems";
import type { SettingsSection } from "./settingsSections";
import type { SettingsDialogController } from "./useSettingsDialogController";

export function SettingsSectionItems({
  context,
  sectionId,
}: {
  context: SettingsDialogController;
  sectionId: SettingsSection;
}) {
  const items = getSettingsItemsForSection(sectionId);
  const nodes: ReactNode[] = [];
  let groupItems: SettingsItem[] = [];
  let activeGroup: string | undefined;
  let activeGroupStyle: SettingsItemGroupStyle = "standard";

  function flushGroup() {
    if (!activeGroup || groupItems.length === 0) return;

    nodes.push(
      <div
        className={
          activeGroupStyle === "actions"
            ? "settings-section__group settings-section__group--actions"
            : "settings-section__group"
        }
        key={`${sectionId}-${activeGroup}`}
      >
        <h3>{activeGroup}</h3>
        {groupItems.map((item) => (
          <div data-setting-id={item.id} key={item.id}>
            {item.render(context)}
          </div>
        ))}
      </div>,
    );

    groupItems = [];
    activeGroup = undefined;
    activeGroupStyle = "standard";
  }

  for (const item of items) {
    if (!item.groupLabel) {
      flushGroup();
      nodes.push(
        <div data-setting-id={item.id} key={item.id}>
          {item.render(context)}
        </div>,
      );
      continue;
    }

    if (activeGroup !== item.groupLabel) {
      flushGroup();
      activeGroup = item.groupLabel;
      activeGroupStyle = item.groupStyle ?? "standard";
    }

    groupItems.push(item);
  }

  flushGroup();
  return <>{nodes}</>;
}
