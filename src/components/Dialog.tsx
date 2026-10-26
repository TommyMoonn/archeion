import { useContext, useId, useLayoutEffect, useRef, type ReactNode } from "react";

import { DialogShellContext, type DialogShellOwner } from "./DialogShellContext";
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
  /** Nested confirmations retain their own native modal lifetime. */
  standalone?: boolean;
};

export function Dialog(props: DialogProps) {
  const shell = useContext(DialogShellContext);
  return shell && !props.standalone ? (
    <HostedDialog {...props} shell={shell} />
  ) : (
    <StandaloneDialog {...props} />
  );
}

function HostedDialog({ shell, ...props }: DialogProps & { shell: DialogShellOwner }) {
  const { retainFocus } = shell;
  useLayoutEffect(() => {
    shell.register(props);
  });
  useLayoutEffect(() => retainFocus(), [retainFocus]);
  return (
    <DialogPanel {...props} titleId={shell.titleId} descriptionId={shell.descriptionId} hosted />
  );
}

function StandaloneDialog({
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
      <DialogShellContext value={null}>
        <DialogPanel
          {...{
            children,
            description,
            feedback,
            feedbackSize,
            feedbackPlacement,
            footer,
            title,
            titleId,
            descriptionId,
          }}
        />
      </DialogShellContext>
    </dialog>
  );
}

export function DialogPanel({
  children,
  description,
  feedback,
  feedbackSize = "message",
  feedbackPlacement,
  footer,
  title,
  titleId,
  descriptionId,
  hosted = false,
  pending = false,
}: Pick<
  DialogProps,
  | "children"
  | "description"
  | "feedback"
  | "feedbackSize"
  | "feedbackPlacement"
  | "footer"
  | "title"
> & {
  titleId: string;
  descriptionId: string;
  hosted?: boolean;
  /** Marks replaceable shell content for the owning dialog's focus handoff. */
  pending?: boolean;
}) {
  const content = (
    <>
      {!hosted ? (
        <div className="dialog__copy constrained-user-content">
          <h2 id={titleId}>{title}</h2>
        </div>
      ) : null}
      {description || children ? (
        <div
          className="dialog__body"
          data-dialog-pending={pending || undefined}
          role="region"
          aria-label={`${title} content`}
          tabIndex={0}
        >
          {description ? (
            <p className="dialog__description" id={descriptionId}>
              {description}
            </p>
          ) : null}
          {children}
        </div>
      ) : null}
      {feedback !== undefined || footer ? (
        <div
          className="dialog__bottom"
          data-dialog-pending={pending || undefined}
          data-feedback-placement={feedbackPlacement}
        >
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
    </>
  );
  return hosted ? content : <div className="dialog__panel">{content}</div>;
}
