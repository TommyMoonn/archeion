import {
  createSearchQuery,
  createSearchTextVariants,
  isEmptySearchQuery,
  normalizeSearchText,
  searchFieldsMatchQuery,
} from "../../utils/searchText";
import type { SettingsItem } from "./settingsItems";
import { settingsItems } from "./settingsItems";
import { settingsSections, type SettingsSection } from "./settingsSections";

const sectionLabels = new Map<SettingsSection, string>(
  settingsSections.map((section) => [section.id, section.label]),
);

const removedSettingsSearchTerms = new Set([
  "appearance and window",
  "files and maintenance",
  "interface",
]);

export type SettingsSearchResult = {
  item: SettingsItem;
  sectionLabel: string;
};

function itemMatches(item: SettingsItem, query: string): boolean {
  const searchQuery = createSearchQuery(query);
  if (isEmptySearchQuery(searchQuery)) return false;

  const fields = [
    item.label,
    item.description,
    item.groupLabel,
    sectionLabels.get(item.sectionId),
    ...(item.searchTerms ?? []),
  ].map((field) => createSearchTextVariants(field));

  return searchFieldsMatchQuery(fields, searchQuery);
}

export function findSettingsSearchResults(
  query: string,
  items: readonly SettingsItem[] = settingsItems,
): SettingsSearchResult[] {
  const trimmedQuery = query.trim();
  if (!trimmedQuery) return [];
  if (removedSettingsSearchTerms.has(normalizeSearchText(trimmedQuery))) {
    return [];
  }

  return items
    .filter((item) => itemMatches(item, trimmedQuery))
    .map((item) => ({
      item,
      sectionLabel: sectionLabels.get(item.sectionId) ?? item.sectionId,
    }));
}
