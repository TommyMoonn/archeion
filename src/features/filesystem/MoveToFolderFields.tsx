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
    <div className="move-to-folder-dialog">
      <AppSelect
        id="move-folder-destination"
        label={
          <span className="move-to-folder-dialog__label">
            <FolderIcon aria-hidden="true" size={14} />
            Destination
          </span>
        }
        onChange={setDestination}
        options={options}
        value={destination}
      />
    </div>
  );
}
