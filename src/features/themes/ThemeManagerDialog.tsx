import { Dialog } from "../../components/Dialog";
import { ThemeManagerSurface, type ThemeManagerServices } from "./ThemeManagerSurface";

type ThemeManagerDialogProps = Readonly<{
  onClose: () => void;
  services?: ThemeManagerServices;
}>;

export function ThemeManagerDialog({ onClose, services }: ThemeManagerDialogProps) {
  return (
    <Dialog
      className="theme-manager-dialog"
      closeOnBackdropClick={false}
      onClose={onClose}
      title="Theme Manager"
    >
      <ThemeManagerSurface onClose={onClose} services={services} />
    </Dialog>
  );
}
