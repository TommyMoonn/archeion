import { Filter, X } from "lucide-react";

import { AppSelect, type AppSelectOption } from "../../components/AppSelect";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import type { LibraryFilterState, LibraryReadingStatus } from "../../types/library";
import { useDismissibleDetails } from "../../utils/useDismissibleDetails";
import { countActiveLibraryFilters, type LibraryFilterOptions } from "./libraryFilters";

type MetadataFilterKey = "series" | "subjects" | "languages" | "publishers";

type LibraryFilterPopoverProps = {
  filters: LibraryFilterState;
  onChange: (filters: LibraryFilterState) => void;
  onClear: () => void;
  options: LibraryFilterOptions;
};

type ActiveFilterToken = {
  id: string;
  label: string;
  remove: (filters: LibraryFilterState) => LibraryFilterState;
};

const readingStatusLabels: Record<LibraryReadingStatus, string> = {
  unread: "Unread",
  "in-progress": "In progress",
  completed: "Completed",
};

const metadataFilterLabels: Record<MetadataFilterKey, string> = {
  series: "Series",
  subjects: "Tag",
  languages: "Language",
  publishers: "Publisher",
};

function addMetadataFilter(
  filters: LibraryFilterState,
  key: MetadataFilterKey,
  value: string,
): LibraryFilterState {
  if (!value || filters[key].includes(value)) {
    return filters;
  }

  return { ...filters, [key]: [...filters[key], value] };
}

function toggleReadingStatus(
  filters: LibraryFilterState,
  status: LibraryReadingStatus,
): LibraryFilterState {
  const readingStatuses = filters.readingStatuses.includes(status)
    ? filters.readingStatuses.filter((current) => current !== status)
    : [...filters.readingStatuses, status];

  return { ...filters, readingStatuses };
}

function activeFilterTokens(filters: LibraryFilterState): ActiveFilterToken[] {
  const tokens: ActiveFilterToken[] = [];

  for (const key of Object.keys(metadataFilterLabels) as MetadataFilterKey[]) {
    for (const value of filters[key]) {
      tokens.push({
        id: `${key}:${value}`,
        label: `${metadataFilterLabels[key]}: ${value}`,
        remove: (current) => ({
          ...current,
          [key]: current[key].filter((candidate) => candidate !== value),
        }),
      });
    }
  }

  for (const status of filters.readingStatuses) {
    tokens.push({
      id: `status:${status}`,
      label: readingStatusLabels[status],
      remove: (current) => ({
        ...current,
        readingStatuses: current.readingStatuses.filter((candidate) => candidate !== status),
      }),
    });
  }

  if (filters.favoritesOnly) {
    tokens.push({
      id: "favorites",
      label: "Favorites",
      remove: (current) => ({ ...current, favoritesOnly: false }),
    });
  }
  if (filters.missingMetadata) {
    tokens.push({
      id: "missing-metadata",
      label: "Missing metadata",
      remove: (current) => ({ ...current, missingMetadata: false }),
    });
  }
  if (filters.missingCover) {
    tokens.push({
      id: "missing-cover",
      label: "Missing cover",
      remove: (current) => ({ ...current, missingCover: false }),
    });
  }

  return tokens;
}

function MetadataFilterSelect({
  filters,
  filterKey,
  onChange,
  options,
}: {
  filters: LibraryFilterState;
  filterKey: MetadataFilterKey;
  onChange: (filters: LibraryFilterState) => void;
  options: string[];
}) {
  const availableOptions = options.filter((option) => !filters[filterKey].includes(option));
  const selectOptions: Array<AppSelectOption<string>> = [
    {
      label: availableOptions.length > 0 ? "Any" : "No more options",
      value: "",
    },
    ...availableOptions.map((option) => ({ label: option, value: option })),
  ];

  return (
    <div className="library-filter-field">
      <span>{metadataFilterLabels[filterKey]}</span>
      <AppSelect
        ariaLabel={`Add ${metadataFilterLabels[filterKey].toLowerCase()} filter`}
        disabled={availableOptions.length === 0}
        onChange={(value) => {
          if (value) {
            onChange(addMetadataFilter(filters, filterKey, value));
          }
        }}
        options={selectOptions}
        size="compact"
        value=""
      />
    </div>
  );
}

export function LibraryFilterPopover({
  filters,
  onChange,
  onClear,
  options,
}: LibraryFilterPopoverProps) {
  const { detailsRef } = useDismissibleDetails();
  const activeCount = countActiveLibraryFilters(filters);

  return (
    <details className="library-filter" ref={detailsRef}>
      <summary aria-label="Filter library">
        <Filter aria-hidden="true" size={16} />
        <span>Filters</span>
        {activeCount > 0 ? <span className="library-filter__count">{activeCount}</span> : null}
      </summary>
      <div className="library-filter__popover" role="dialog" aria-label="Library filters">
        <div className="library-filter__heading">
          <strong>Filters</strong>
          {activeCount > 0 ? (
            <Button onClick={onClear} variant="ghost">
              Clear all
            </Button>
          ) : null}
        </div>

        <div className="library-filter__metadata">
          <MetadataFilterSelect
            filters={filters}
            filterKey="series"
            onChange={onChange}
            options={options.series}
          />
          <MetadataFilterSelect
            filters={filters}
            filterKey="subjects"
            onChange={onChange}
            options={options.subjects}
          />
          <MetadataFilterSelect
            filters={filters}
            filterKey="languages"
            onChange={onChange}
            options={options.languages}
          />
          <MetadataFilterSelect
            filters={filters}
            filterKey="publishers"
            onChange={onChange}
            options={options.publishers}
          />
        </div>

        <fieldset className="library-filter__group">
          <legend>Reading status</legend>
          {(Object.keys(readingStatusLabels) as LibraryReadingStatus[]).map((status) => (
            <label key={status}>
              <input
                checked={filters.readingStatuses.includes(status)}
                type="checkbox"
                onChange={() => onChange(toggleReadingStatus(filters, status))}
              />
              <span>{readingStatusLabels[status]}</span>
            </label>
          ))}
        </fieldset>

        <fieldset className="library-filter__group">
          <legend>Other</legend>
          <label>
            <input
              checked={filters.favoritesOnly}
              type="checkbox"
              onChange={() => onChange({ ...filters, favoritesOnly: !filters.favoritesOnly })}
            />
            <span>Favorites</span>
          </label>
          <label>
            <input
              checked={filters.missingMetadata}
              type="checkbox"
              onChange={() => onChange({ ...filters, missingMetadata: !filters.missingMetadata })}
            />
            <span>Missing metadata</span>
          </label>
          <label>
            <input
              checked={filters.missingCover}
              type="checkbox"
              onChange={() => onChange({ ...filters, missingCover: !filters.missingCover })}
            />
            <span>Missing cover</span>
          </label>
        </fieldset>
      </div>
    </details>
  );
}

export function LibraryFilterTokens({
  filters,
  onChange,
}: {
  filters: LibraryFilterState;
  onChange: (filters: LibraryFilterState) => void;
}) {
  const tokens = activeFilterTokens(filters);

  if (tokens.length === 0) {
    return null;
  }

  return (
    <div className="library-filter-tokens" aria-label="Active filters">
      {tokens.map((token) => (
        <span className="library-filter-token" key={token.id}>
          <span>{token.label}</span>
          <IconButton
            label={`Remove ${token.label} filter`}
            onClick={() => onChange(token.remove(filters))}
          >
            <X aria-hidden="true" strokeWidth={2.25} />
          </IconButton>
        </span>
      ))}
    </div>
  );
}
