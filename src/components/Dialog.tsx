import { useEffect, useRef, type ReactNode } from "react";

type DialogProps = {
  children?: ReactNode;
  description?: string;
  footer?: ReactNode;
  onClose: () => void;
  title: string;
};

export function Dialog({
  children,
  description,
  footer,
  onClose,
  title,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;

    if (dialog && !dialog.open) {
      dialog.showModal();
    }

    return () => {
      if (dialog?.open) {
        dialog.close();
      }
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-describedby={description ? "dialog-description" : undefined}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="dialog__panel">
        <div className="dialog__copy">
          <h2 id="dialog-title">{title}</h2>
          {description ? <p id="dialog-description">{description}</p> : null}
        </div>
        {children}
        {footer ? <div className="dialog__footer">{footer}</div> : null}
      </div>
    </dialog>
  );
}
