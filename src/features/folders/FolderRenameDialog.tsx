import type { ReadonlyFolder } from "../../types/folder";
import { FolderNameDialog } from "./FolderNameDialog";

type FolderRenameDialogProps = {
  folder: ReadonlyFolder;
  onClose: () => void;
  onRename: (name: string) => Promise<void>;
};

export function FolderRenameDialog({ folder, onClose, onRename }: FolderRenameDialogProps) {
  return (
    <FolderNameDialog
      initialName={folder.name}
      mode="rename"
      onClose={onClose}
      onSubmit={onRename}
    />
  );
}
