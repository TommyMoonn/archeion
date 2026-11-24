import { useMemo } from "react";
import { Empty, EmptyDescription } from "@/components/ui/empty";
import { SettingsSection } from "./components/SettingsSection";

import { SettingsSectionHeader } from "./components/SettingsSectionHeader";
import { findSettingsSearchResults } from "./settingsSearch";
import type { SettingsItem } from "./settingsItemTypes";
import { settingsSections, type SettingsSection as SettingsSectionId } from "./settingsSections";
import type { SettingsController } from "./useSettingsController";
import { SettingsItemContent } from "./SettingsSectionItems";

type SettingsSearchResultsProps = {
  controller: SettingsController;
  query: string;
};

type GroupedSearchResults = Array<{
  groups: Array<{ groupLabel?: string; items: SettingsItem[] }>;
  sectionId: SettingsSectionId;
  sectionLabel: string;
}>;

function groupSearchResults(query: string): GroupedSearchResults {
  const results = findSettingsSearchResults(query);

  return settingsSections.flatMap((section) => {
    const sectionItems = results
      .filter((result) => result.item.sectionId === section.id)
      .map((result) => result.item);

    if (sectionItems.length === 0) return [];

    const groups: Array<{ groupLabel?: string; items: SettingsItem[] }> = [];
    for (const item of sectionItems) {
      const currentGroup = groups[groups.length - 1];
      if (currentGroup && currentGroup.groupLabel === item.groupLabel) {
        currentGroup.items.push(item);
        continue;
      }

      groups.push({ groupLabel: item.groupLabel, items: [item] });
    }

    return [{ groups, sectionId: section.id, sectionLabel: section.label }];
  });
}

export function SettingsSearchResults({ controller, query }: SettingsSearchResultsProps) {
  const groupedResults = useMemo(() => groupSearchResults(query), [query]);
  const resultCount = groupedResults.reduce(
    (count, section) =>
      count + section.groups.reduce((groupCount, group) => groupCount + group.items.length, 0),
    0,
  );

  return (
    <SettingsSection className="settings-search-results grid gap-dialog-panel">
      <SettingsSectionHeader
        className="settings-search-results__header flex items-start justify-between gap-dialog-gap mb-0 settings-row-narrow:flex-col settings-row-narrow:items-stretch"
        description={
          resultCount > 0
            ? `${resultCount} matching ${resultCount === 1 ? "setting" : "settings"}`
            : "No settings found"
        }
        title="Search results"
      />

      {groupedResults.length > 0 ? (
        <div className="settings-search-results__sections grid gap-dialog-panel">
          {groupedResults.map((section) => (
            <section
              aria-label={`${section.sectionLabel} settings search results`}
              className="settings-search-results__section grid gap-control-gap"
              key={section.sectionId}
            >
              <h3 className="m-0 text-text-strong text-body-large font-semibold">
                {section.sectionLabel}
              </h3>
              {section.groups.map((group, index) => (
                <div
                  className="settings-search-results__group grid [[data-search-group]+&]:mt-overlay-viewport-inset"
                  key={`${section.sectionId}-${group.groupLabel ?? "ungrouped"}-${index}`}
                  data-search-group=""
                >
                  {group.groupLabel ? (
                    <h4 className="m-0 pb-settings-small-gap text-muted text-caption font-semibold tracking-settings-group uppercase">
                      {group.groupLabel}
                    </h4>
                  ) : null}
                  {group.items.map((item) => (
                    <div
                      className="settings-search-results__item rounded-control transition-colors duration-standard ease-standard"
                      data-setting-id={item.id}
                      key={item.id}
                    >
                      <SettingsItemContent context={controller} item={item} />
                    </div>
                  ))}
                </div>
              ))}
            </section>
          ))}
        </div>
      ) : (
        <Empty>
          <EmptyDescription className="settings-search-results__empty max-w-settings-description leading-settings-empty">
            No settings found for “{query.trim()}”.
          </EmptyDescription>
        </Empty>
      )}
    </SettingsSection>
  );
}
