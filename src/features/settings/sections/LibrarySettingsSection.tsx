import { AppSelect } from "../../../components/AppSelect";
import { Button } from "../../../components/Button";
import { SegmentedControl } from "../../../components/SegmentedControl";
import { Toggle } from "../../../components/Toggle";
import type { BookCardSize } from "../../../types/appSettings";
import type { LibrarySort } from "../../../types/library";
import type { LibraryDisplaySettings } from "../../../types/settings";
import type { LibraryView } from "../../library/LibraryToolbar";
import { SettingsRow } from "../SettingsRow";
import {
  cardSizeOptions,
  defaultLibrarySortOptions,
  viewOptions,
} from "../settingsOptions";

type LibrarySettingsSectionProps = {
  bookCardSize: BookCardSize;
  hidden: boolean;
  library: LibraryDisplaySettings;
  onBookCardSizeChange: (value: BookCardSize) => void;
  onReset: () => void;
  onShowContinueReadingChange: (value: boolean) => void;
  onSortByChange: (value: LibrarySort) => void;
  onViewModeChange: (value: LibraryView) => void;
  showContinueReading: boolean;
};

export function LibrarySettingsSection({
  bookCardSize,
  hidden,
  library,
  onBookCardSizeChange,
  onReset,
  onShowContinueReadingChange,
  onSortByChange,
  onViewModeChange,
  showContinueReading,
}: LibrarySettingsSectionProps) {
  return (
    <section hidden={hidden} className="settings-section">
      <header>
        <h2>Library</h2>
      </header>
      <SettingsRow description="Used when browsing an archive." label="Default view">
        <SegmentedControl
          label="Default library view"
          onChange={onViewModeChange}
          options={viewOptions}
          value={library.viewMode}
        />
      </SettingsRow>
      <SettingsRow
        description="Used for Library, Favorites, and folder views."
        label="Default sort"
      >
        <AppSelect<LibrarySort>
          ariaLabel="Default library sort"
          onChange={onSortByChange}
          options={defaultLibrarySortOptions}
          value={library.sortBy}
        />
      </SettingsRow>
      <SettingsRow
        description="Changes cover size in grid view."
        label="Book card size"
      >
        <AppSelect
          ariaLabel="Book card size"
          onChange={onBookCardSizeChange}
          options={cardSizeOptions}
          value={bookCardSize}
        />
      </SettingsRow>
      <SettingsRow
        description="Shows started books on the Library page."
        label="Show Continue Reading"
      >
        <Toggle
          checked={showContinueReading}
          label="Show Continue Reading"
          onChange={onShowContinueReadingChange}
        />
      </SettingsRow>
      <SettingsRow label="Reset library display settings">
        <Button onClick={onReset} variant="secondary">
          Reset
        </Button>
      </SettingsRow>
    </section>
  );
}
