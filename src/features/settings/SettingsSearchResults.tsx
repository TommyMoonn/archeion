import { X } from "lucide-react";
import { useMemo } from "react";

import { Button } from "../../components/Button";
import { SettingsSectionHeader } from "./components/SettingsSectionHeader";
import { findSettingsSearchResults } from "./settingsSearch";
import type { SettingsItem } from "./settingsItemTypes";
import { settingsSections, type SettingsSection } from "./settingsSections";
import type { SettingsController } from "./useSettingsController";
import { SettingsItemContent } from "./SettingsSectionItems";

type SettingsSearchResultsProps = {
  controller: SettingsController;
  onClearSearch: () => void;
  query: string;
};

type GroupedSearchResults = Array<{
  groups: Array<{ groupLabel?: string; items: SettingsItem[] }>;
  sectionId: SettingsSection;
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

export function SettingsSearchResults({
  controller,
  onClearSearch,
  query,
}: SettingsSearchResultsProps) {
  const groupedResults = useMemo(() => groupSearchResults(query), [query]);
  const resultCount = groupedResults.reduce(
    (count, section) =>
      count + section.groups.reduce((groupCount, group) => groupCount + group.items.length, 0),
    0,
  );

  return (
    <section className="settings-section settings-search-results">
      <SettingsSectionHeader
        actions={
          <Button icon={<X aria-hidden="true" />} onClick={onClearSearch} variant="secondary">
            Clear search
          </Button>
        }
        className="settings-search-results__header"
        description={
          resultCount > 0
            ? `${resultCount} matching ${resultCount === 1 ? "setting" : "settings"}`
            : "No settings found"
        }
        title="Search results"
      />

      {groupedResults.length > 0 ? (
        <div className="settings-search-results__sections">
          {groupedResults.map((section) => (
            <section
              aria-label={`${section.sectionLabel} settings search results`}
              className="settings-search-results__section"
              key={section.sectionId}
            >
              <h3>{section.sectionLabel}</h3>
              {section.groups.map((group, index) => (
                <div
                  className="settings-search-results__group"
                  key={`${section.sectionId}-${group.groupLabel ?? "ungrouped"}-${index}`}
                >
                  {group.groupLabel ? <h4>{group.groupLabel}</h4> : null}
                  {group.items.map((item) => (
                    <div
                      className="settings-search-results__item"
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
        <p className="settings-search-results__empty">No settings found for “{query.trim()}”.</p>
      )}
    </section>
  );
}
