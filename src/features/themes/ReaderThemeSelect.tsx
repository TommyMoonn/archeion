import { AppSelect } from "../../components/AppSelect";
import type { ReaderThemeSelection } from "../../types/settings";
import type { ThemeCatalogEntry } from "../../themes/themeCatalogReadModel";
import { decodeReaderTheme, readerThemeOptions, readerThemeValue } from "./themeSelectionOptions";

type ReaderThemeSelectProps = Readonly<{
  ariaLabel?: string;
  entries: readonly ThemeCatalogEntry[];
  onChange: (selection: ReaderThemeSelection) => void;
  onOpen?: () => void;
  selection: ReaderThemeSelection;
}>;

export function ReaderThemeSelect({
  ariaLabel = "Reader theme",
  entries,
  onChange,
  onOpen,
  selection,
}: ReaderThemeSelectProps) {
  return (
    <AppSelect
      ariaLabel={ariaLabel}
      onChange={(value) => onChange(decodeReaderTheme(value))}
      onOpen={onOpen}
      options={readerThemeOptions(entries, selection)}
      value={readerThemeValue(selection)}
    />
  );
}
