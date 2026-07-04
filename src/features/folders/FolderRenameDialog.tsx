import type { Folder } from "../../types/folder";
import { FolderNameDialog } from "./FolderNameDialog";

type FolderRenameDialogProps = {
  folder: Folder;
  onClose: () => void;
  onRename: (name: string) => Promise<void>;
};

export function FolderRenameDialog({
  folder,
  onClose,
  onRename,
}: FolderRenameDialogProps) {
  return (
    <FolderNameDialog
      initialName={folder.name}
      mode="rename"
      onClose={onClose}
      onSubmit={onRename}
    />
  );
}
