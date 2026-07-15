import { AppSelect } from "../../components/AppSelect";
import type { ReaderTheme } from "../../types/reader";
import type { ArchiveReaderThemeSelection } from "../../types/settings";
import type { ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";
import {
  decodeReaderTheme,
  readerThemeOptions,
  readerThemeValue,
} from "./archiveThemeSelectionOptions";

type ArchiveReaderThemeSelectProps = Readonly<{
  ariaLabel?: string;
  entries: readonly ThemeCatalogEntry[];
  fallback: ReaderTheme;
  onChange: (selection: ArchiveReaderThemeSelection) => void;
  selection: ArchiveReaderThemeSelection;
}>;

export function ArchiveReaderThemeSelect({
  ariaLabel = "Reader theme",
  entries,
  fallback,
  onChange,
  selection,
}: ArchiveReaderThemeSelectProps) {
  return (
    <AppSelect
      ariaLabel={ariaLabel}
      onChange={(value) => onChange(decodeReaderTheme(value))}
      options={readerThemeOptions(entries, selection)}
      value={readerThemeValue(selection, fallback)}
    />
  );
}
