import { collectionHeader } from "../../components/collectionPresentation";
import { Grid2x2, List, Search, X } from "lucide-react";
import type { ReactNode, Ref } from "react";
import { AppSelect } from "../../components/AppSelect";
import { IconButton } from "../../components/IconButton";
import { Input } from "../../components/Input";
import { SegmentedControl } from "../../components/SegmentedControl";
import type { LibraryView, SeriesSort } from "../../types/library";
import { seriesSortOptions } from "./seriesSortOptions";
const seriesViewOptions: Array<{
  icon: ReactNode;
  label: string;
  value: LibraryView;
}> = [
  {
    icon: <Grid2x2 aria-hidden="true" />,
    label: "Grid",
    value: "grid",
  },
  {
    icon: <List aria-hidden="true" />,
    label: "List",
    value: "list",
  },
];

export function SeriesOverviewHeader({
  onQueryChange,
  onClearSearch,
  onSortChange,
  onViewChange,
  query,
  sort,
  view,
  searchAriaKeyShortcuts,
  searchInputRef,
  resultLabel,
  pending = false,
}: {
  onQueryChange: (query: string) => void;
  onClearSearch: () => void;
  onSortChange: (sort: SeriesSort) => void;
  onViewChange: (view: LibraryView) => void;
  query: string;
  sort: SeriesSort;
  view: LibraryView;
  searchAriaKeyShortcuts?: string;
  searchInputRef?: Ref<HTMLInputElement>;
  resultLabel: string;
  pending?: boolean;
}) {
  return (
    <header className={`${collectionHeader.root} series-header`}>
      <div className="library-header__title">
        <p className={collectionHeader.eyebrow}>Your collection</p>
        <h1 className={collectionHeader.title} id="series-overview-title">
          Series
        </h1>
      </div>
      <div
        className={`${collectionHeader.actions} ${collectionHeader.actionsSearch} series-header__actions justify-self-end`}
      >
        <div aria-label="Series search" className={collectionHeader.search} role="search">
          <Input
            disabled={pending}
            aria-keyshortcuts={searchAriaKeyShortcuts}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            icon={<Search aria-hidden="true" />}
            label="Search series"
            name="archeion-series-search"
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            placeholder="Search series"
            ref={searchInputRef}
            size="standard"
            spellCheck={false}
            type="search"
            value={query}
          />
          {query ? (
            <IconButton
              className={collectionHeader.clear}
              disabled={pending}
              label="Clear series search"
              onClick={onClearSearch}
            >
              <X aria-hidden="true" />
            </IconButton>
          ) : null}
        </div>
      </div>

      <div className={`${collectionHeader.controls} series-overview__controls`}>
        <span className={collectionHeader.count} aria-live="polite">
          {resultLabel}
        </span>
        <div className={collectionHeader.display}>
          <AppSelect
            disabled={pending}
            ariaLabel="Sort series"
            className="series-sort-select"
            onChange={onSortChange}
            options={seriesSortOptions}
            value={sort}
          />
          <SegmentedControl
            appearance="icon-only"
            label="Series view"
            onChange={onViewChange}
            options={seriesViewOptions.map((option) => ({ ...option, disabled: pending }))}
            value={view}
          />
        </div>
      </div>
    </header>
  );
}
