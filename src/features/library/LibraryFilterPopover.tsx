import { Badge } from "../../components/ui/badge";
import { Checkbox } from "../../components/ui/checkbox";
import { Filter, X } from "lucide-react";
import { memo, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import { AppSelect, type AppSelectOption } from "../../components/AppSelect";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import type { LibraryFilterState, LibraryReadingStatus } from "../../types/library";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { Button as UiButton } from "../../components/ui/button";
import { focusElementIfUsable } from "../../utils/focusRestoration";
import { useTransientSurfaceOwnership } from "../../utils/transientSurfaceOwnership";
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
  const selectedValues = filters[filterKey];
  const availableOptions = useMemo(
    () => options.filter((option) => !selectedValues.includes(option)),
    [options, selectedValues],
  );
  const selectOptions = useMemo<Array<AppSelectOption<string>>>(
    () => [
      {
        label: availableOptions.length > 0 ? "Any" : "No more options",
        value: "",
      },
      ...availableOptions.map((option) => ({ label: option, value: option })),
    ],
    [availableOptions],
  );

  return (
    <div className="grid min-w-0 w-full gap-filter-label-gap text-muted text-caption-size font-medium tracking-field-label uppercase">
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
        variant="filter"
        value=""
      />
    </div>
  );
}

export const LibraryFilterPopover = memo(function LibraryFilterPopover({
  filters,
  onChange,
  onClear,
  options,
}: LibraryFilterPopoverProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  useTransientSurfaceOwnership({
    active: open,
    elementRef: rootRef,
    triggerRef,
    originRef: triggerRef,
    kind: "popover",
    closeOnModalOpen: true,
    dismissOnOutsidePointer: true,
    onDismiss: (reason) => {
      if (reason === "escape") {
        flushSync(() => setOpen(false));
        focusElementIfUsable(triggerRef.current);
      } else {
        setOpen(false);
      }
    },
  });
  const activeCount = countActiveLibraryFilters(filters);

  return (
    <div className="relative" ref={rootRef}>
      <Popover
        open={open}
        onOpenChange={(next, details) => {
          // The shared transient stack owns dismissal, including nested Selects.
          if (!next && ["outside-press", "escape-key", "focus-out"].includes(details.reason)) {
            details.cancel();
            return;
          }
          setOpen(next);
        }}
      >
        <PopoverTrigger
          ref={triggerRef}
          aria-label="Filter library"
          render={<UiButton variant="secondary" size="standard" />}
          className="gap-field-label px-field-standard-inline border-line bg-surface text-meta-only font-normal leading-inherit control-hover:bg-surface-raised control-hover:text-text motion-safe:app-motion:control-active:scale-100 aria-expanded:border-line-strong aria-expanded:bg-surface-raised cursor-pointer"
        >
          <Filter aria-hidden="true" className="size-icon-glyph-standard" />
          <span>Filters</span>
          {activeCount > 0 ? (
            <Badge className="inline-grid min-h-filter-count min-w-filter-count place-items-center border-muted-soft bg-canvas-deep px-filter-count-inline py-0 leading-none text-muted tabular-nums">
              <span className="-translate-x-filter-count-optical-offset">{activeCount}</span>
            </Badge>
          ) : null}
        </PopoverTrigger>
        {open ? (
          <PopoverContent
            container={rootRef}
            initialFocus={false}
            finalFocus={false}
            className="w-filter-panel-width max-h-filter-panel-height gap-filter-group-gap overflow-y-auto p-button-standard"
            aria-label="Library filters"
          >
            <div className="flex items-center justify-between gap-filter-choice-gap">
              <strong className="text-text-strong text-body-only">Filters</strong>
              {activeCount > 0 ? (
                <Button
                  className="min-h-filter-token-height px-control-gap text-caption-size control-enabled:cursor-pointer"
                  onClick={onClear}
                  variant="ghost"
                >
                  Clear all
                </Button>
              ) : null}
            </div>

            <div className="grid grid-cols-2 gap-field-standard-inline collection-header-narrow:grid-cols-1">
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

            <fieldset className="grid grid-cols-2 gap-x-filter-choice-gap gap-y-control-gap p-0 border-0 collection-header-narrow:grid-cols-1">
              <legend className="col-span-full w-full mb-filter-token-gap px-control-inset text-muted text-caption-size font-semibold tracking-field-label uppercase">
                Reading status
              </legend>
              {(Object.keys(readingStatusLabels) as LibraryReadingStatus[]).map((status) => (
                <label
                  className="flex items-center gap-field-label min-h-filter-check-height text-text text-caption-size cursor-pointer"
                  key={status}
                >
                  <Checkbox
                    className="m-checkbox-margin ml-checkbox-start"
                    checked={filters.readingStatuses.includes(status)}

                    onCheckedChange={() => onChange(toggleReadingStatus(filters, status))}
                  />
                  <span>{readingStatusLabels[status]}</span>
                </label>
              ))}
            </fieldset>

            <fieldset className="grid grid-cols-2 gap-x-filter-choice-gap gap-y-control-gap p-0 border-0 collection-header-narrow:grid-cols-1">
              <legend className="col-span-full w-full mb-filter-token-gap px-control-inset text-muted text-caption-size font-semibold tracking-field-label uppercase">
                Other
              </legend>
              <label className="flex items-center gap-field-label min-h-filter-check-height text-text text-caption-size cursor-pointer">
                <Checkbox
                  className="m-checkbox-margin ml-checkbox-start"
                  checked={filters.favoritesOnly}

                  onCheckedChange={() =>
                    onChange({ ...filters, favoritesOnly: !filters.favoritesOnly })
                  }
                />
                <span>Favorites</span>
              </label>
              <label className="flex items-center gap-field-label min-h-filter-check-height text-text text-caption-size cursor-pointer">
                <Checkbox
                  className="m-checkbox-margin ml-checkbox-start"
                  checked={filters.missingMetadata}

                  onCheckedChange={() =>
                    onChange({ ...filters, missingMetadata: !filters.missingMetadata })
                  }
                />
                <span>Missing metadata</span>
              </label>
              <label className="flex items-center gap-field-label min-h-filter-check-height text-text text-caption-size cursor-pointer">
                <Checkbox
                  className="m-checkbox-margin ml-checkbox-start"
                  checked={filters.missingCover}

                  onCheckedChange={() =>
                    onChange({ ...filters, missingCover: !filters.missingCover })
                  }
                />
                <span>Missing cover</span>
              </label>
            </fieldset>
          </PopoverContent>
        ) : null}
      </Popover>
    </div>
  );
});

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
    <div className="flex flex-wrap gap-field-label" aria-label="Active filters" role="group">
      {tokens.map((token) => (
        <span
          className="inline-flex items-center gap-filter-token-gap min-h-filter-token-height pl-field-compact-inline pr-filter-token-gap py-0 border-standard border-solid border-line rounded-pill text-text bg-surface text-caption-size"
          key={token.id}
        >
          <span>{token.label}</span>
          <IconButton
            className="size-filter-token-remove control-enabled:cursor-pointer"
            label={`Remove ${token.label} filter`}
            onClick={() => onChange(token.remove(filters))}
          >
            <X aria-hidden="true" />
          </IconButton>
        </span>
      ))}
    </div>
  );
}
