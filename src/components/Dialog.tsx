import { useEffect, useId, useRef, type ReactNode } from "react";

type DialogProps = {
  children?: ReactNode;
  className?: string;
  description?: string;
  footer?: ReactNode;
  closeOnBackdropClick?: boolean;
  onClose: () => void;
  title: string;
};

export function Dialog({
  children,
  className,
  closeOnBackdropClick = true,
  description,
  footer,
  onClose,
  title,
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pointerStartedOnBackdropRef = useRef(false);
  const descriptionId = useId();
  const titleId = useId();

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
      className={className ? `dialog ${className}` : "dialog"}
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (
          closeOnBackdropClick &&
          pointerStartedOnBackdropRef.current &&
          event.target === event.currentTarget
        ) {
          onClose();
        }
        pointerStartedOnBackdropRef.current = false;
      }}
      onPointerDown={(event) => {
        pointerStartedOnBackdropRef.current = event.target === event.currentTarget;
      }}
    >
      <div className="dialog__panel">
        <div className="dialog__copy">
          <h2 id={titleId}>{title}</h2>
          {description ? <p id={descriptionId}>{description}</p> : null}
        </div>
        {children}
        {footer ? <div className="dialog__footer">{footer}</div> : null}
      </div>
    </dialog>
  );
}
