import { FolderNameDialog } from "./FolderNameDialog";

type FolderCreateDialogProps = {
  onClose: () => void;
  onCreate: (name: string) => Promise<void>;
};

export function FolderCreateDialog({
  onClose,
  onCreate,
}: FolderCreateDialogProps) {
  return (
    <FolderNameDialog
      mode="create"
      onClose={onClose}
      onSubmit={onCreate}
    />
  );
}
