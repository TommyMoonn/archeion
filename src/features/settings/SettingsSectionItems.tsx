import { type ReactNode } from "react";

import { getSettingsItemsForSection } from "./settingsItems";
import type { SettingsItem, SettingsItemGroupStyle } from "./settingsItemTypes";
import type { SettingsSection } from "./settingsSections";
import type { SettingsController } from "./useSettingsController";

export function SettingsItemContent({
  context,
  item,
}: {
  context: SettingsController;
  item: SettingsItem;
}) {
  if (!item.requiresArchive || context.archiveAvailable) {
    return item.render(context);
  }

  const descriptionId = `${item.id.replaceAll(".", "-")}-archive-unavailable`;
  return (
    <fieldset aria-describedby={descriptionId} className="settings-item-unavailable" disabled>
      {item.render(context)}
      <p className="settings-item-unavailable__note" id={descriptionId}>
        Open these settings from the main window while an archive is active.
      </p>
    </fieldset>
  );
}

export function SettingsSectionItems({
  context,
  sectionId,
}: {
  context: SettingsController;
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
            <SettingsItemContent context={context} item={item} />
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
          <SettingsItemContent context={context} item={item} />
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
