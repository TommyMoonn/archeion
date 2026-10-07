import { AppSelect } from "../../components/AppSelect";
import { isReaderBuiltinFontId, type ReaderFontSelection } from "../../types/reader";
import { readerTypefaceOptions } from "./readerFonts";

/** Keep the fixed control coherent with structured preferences until the picker phase. */
export function ReaderTypefaceSelect({
  ariaLabel,
  id,
  onChange,
  selection,
}: {
  ariaLabel: string;
  id?: string;
  onChange: (selection: ReaderFontSelection) => void;
  selection: ReaderFontSelection;
}) {
  const selectedSystemValue = "selected-system-family";
  const options =
    selection.kind === "builtin"
      ? readerTypefaceOptions
      : [...readerTypefaceOptions, { label: selection.family, value: selectedSystemValue }];
  return (
    <AppSelect
      ariaLabel={ariaLabel}
      id={id}
      onChange={(value) => {
        if (isReaderBuiltinFontId(value)) onChange({ kind: "builtin", id: value });
      }}
      options={options}
      value={selection.kind === "builtin" ? selection.id : selectedSystemValue}
    />
  );
}
