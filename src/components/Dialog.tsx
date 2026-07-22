import { useId, useRef, type ReactNode } from "react";

import { useModalDialogLifecycle } from "./useModalDialogLifecycle";

type DialogProps = {
  children?: ReactNode;
  className?: string;
  description?: string;
  footer?: ReactNode;
  closeOnBackdropClick?: boolean;
  onClose: () => void;
  returnFocusTo?: HTMLElement | null;
  title: string;
};

export function Dialog({
  children,
  className,
  closeOnBackdropClick = true,
  description,
  footer,
  onClose,
  returnFocusTo,
  title,
}: DialogProps) {
  const descriptionId = useId();
  const titleId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const modal = useModalDialogLifecycle({
    closeOnBackdropClick,
    dialogRef,
    onClose,
    returnFocusTo,
  });

  return (
    <dialog
      ref={dialogRef}
      className={className ? `dialog ${className}` : "dialog"}
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={modal.onCancel}
      onClick={modal.onClick}
      onPointerDown={modal.onPointerDown}
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
