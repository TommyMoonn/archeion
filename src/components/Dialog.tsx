import { useId, useRef, type ReactNode } from "react";

import { useModalDialogLifecycle } from "./useModalDialogLifecycle";

type DialogProps = {
  children?: ReactNode;
  className?: string;
  description?: string;
  /** Pass null to reserve feedback space before an operation has a message. */
  feedback?: ReactNode;
  feedbackSize?: "message" | "summary";
  feedbackPlacement?: "stacked" | "inline";
  footer?: ReactNode;
  layout?: "content" | "workspace";
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
  feedback,
  feedbackSize = "message",
  feedbackPlacement,
  footer,
  layout = "content",
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
      className={["dialog", layout === "workspace" ? "dialog--workspace" : "", className]
        .filter(Boolean)
        .join(" ")}
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={modal.onCancel}
      onClick={modal.onClick}
      onPointerDown={modal.onPointerDown}
    >
      <div className="dialog__panel">
        <div className="dialog__copy constrained-user-content">
          <h2 id={titleId}>{title}</h2>
        </div>
        {description || children ? (
          <div className="dialog__body" role="region" aria-label={`${title} content`} tabIndex={0}>
            {description ? (
              <p className="dialog__description" id={descriptionId}>
                {description}
              </p>
            ) : null}
            {children}
          </div>
        ) : null}
        {feedback !== undefined || footer ? (
          <div className="dialog__bottom" data-feedback-placement={feedbackPlacement}>
            {feedback !== undefined ? (
              <div
                className="dialog__feedback"
                data-feedback-size={feedbackSize}
                role="region"
                aria-label={`${title} feedback`}
                tabIndex={feedback ? 0 : -1}
              >
                {feedback}
              </div>
            ) : null}
            {footer ? <div className="dialog__footer">{footer}</div> : null}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
