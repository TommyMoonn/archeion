import { FontPicker } from "../../components/FontPicker";
import type { ReaderBuiltinFontId, ReaderFontSelection } from "../../types/reader";
import { readerFontDefinitions } from "./readerFonts";

const pinnedOptions = readerFontDefinitions.map(({ id, label }) => ({
  label: id === "serif" ? `${label} (Default)` : label,
  value: id,
}));

/** Reader presentation adapter; catalog and preference ownership stay with callers. */
export function ReaderFontPicker({
  ariaLabel,
  catalogLoading,
  id,
  installedFamilies,
  onChange,
  selection,
}: {
  ariaLabel: string;
  catalogLoading: boolean;
  id?: string;
  installedFamilies: readonly string[];
  onChange: (selection: ReaderFontSelection) => void;
  selection: ReaderFontSelection;
}) {
  return (
    <FontPicker<ReaderBuiltinFontId>
      ariaLabel={ariaLabel}
      catalogLoading={catalogLoading}
      id={id}
      installedFamilies={installedFamilies}
      onChange={(value) =>
        onChange(value.kind === "system" ? value : { kind: "builtin", id: value.value })
      }
      pinnedOptions={pinnedOptions}
      suppressInstalledDuplicates
      value={selection.kind === "system" ? selection : { kind: "pinned", value: selection.id }}
    />
  );
}
