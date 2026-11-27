import { Folder as FolderIcon } from "lucide-react";
import { AppSelect, type AppSelectOption } from "../../components/AppSelect";

export function MoveToFolderFields({
  options,
  destination,
  setDestination,
}: {
  options: AppSelectOption<string>[];
  destination: string;
  setDestination: (value: string) => void;
}) {
  return (
    <AppSelect
      className="grid w-full"
      id="move-folder-destination"
      label={
        <span className="inline-flex items-center gap-control-gap-compact tracking-field-label">
          <FolderIcon aria-hidden="true" className="size-icon-glyph-compact" />
          Destination
        </span>
      }
      onChange={setDestination}
      options={options}
      value={destination}
    />
  );
}
