import { X } from "lucide-react";
import { useRef } from "react";

import { IconButton } from "../../components/IconButton";
import { useModalDialogLifecycle } from "../../components/useModalDialogLifecycle";
import { AboutSurface } from "../about/AboutSurface";

type AboutDialogProps = {
  onClose: () => void;
};

export function AboutDialog({ onClose }: AboutDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modal = useModalDialogLifecycle({ dialogRef, initialFocusRef: closeButtonRef, onClose });

  return (
    <dialog
      aria-labelledby="about-title"
      aria-modal="true"
      className="about-dialog"
      onCancel={modal.onCancel}
      onClick={modal.onClick}
      onPointerDown={modal.onPointerDown}
      ref={dialogRef}
    >
      <section className="about-window modal-surface">
        <IconButton
          className="about-window__close"
          label="Close About"
          onClick={onClose}
          ref={closeButtonRef}
        >
          <X aria-hidden="true" />
        </IconButton>

        <AboutSurface />
      </section>
    </dialog>
  );
}
