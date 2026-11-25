import { SurfacePresenceContext } from "./modalPresenceContext";
import { useCallback, useContext, useId, useLayoutEffect, useRef, type ReactNode } from "react";

import { DialogShellContext, type DialogShellOwner } from "./DialogShellContext";
import { dialogRegionClass, dialogBodyClass } from "./dialogStyles";
import { DialogFrame, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
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
    <DialogPanel
      {...props}
      layout={shell.workspace ? "workspace" : "content"}
      titleId={shell.titleId}
      descriptionId={shell.descriptionId}
      hosted
    />
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
  const resolveInitialFocus = useCallback(() => {
    const dialog = dialogRef.current;
    return (
      dialog?.querySelector<HTMLElement>("[autofocus], [data-dialog-initial-focus]") ??
      dialog?.querySelector<HTMLElement>(
        "button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]",
      ) ??
      null
    );
  }, []);
  const modal = useModalDialogLifecycle({
    closeOnBackdropClick,
    dialogRef,
    resolveInitialFocus,
    onClose,
    returnFocusTo,
  });

  return (
    <DialogFrame
      ref={dialogRef}
      className={className}
      workspace={layout === "workspace"}
      aria-describedby={description ? descriptionId : undefined}
      aria-labelledby={titleId}
      onCancel={modal.onCancel}
      onClick={modal.onClick}
      onPointerDown={modal.onPointerDown}
    >
      <SurfacePresenceContext value={null}>
        <DialogShellContext value={null}>
          <DialogPanel
            {...{
              children,
              description,
              feedback,
              feedbackSize,
              feedbackPlacement,
              footer,
              layout,
              title,
              titleId,
              descriptionId,
            }}
          />
        </DialogShellContext>
      </SurfacePresenceContext>
    </DialogFrame>
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
  layout = "content",
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
  | "layout"
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
        <DialogHeader>
          <DialogTitle id={titleId}>{title}</DialogTitle>
        </DialogHeader>
      ) : null}
      {description || children ? (
        <div
          className={dialogBodyClass}
          data-dialog-pending={pending || undefined}
          role="region"
          aria-label={`${title} content`}
          tabIndex={0}
        >
          {description ? (
            <p
              className="dialog__description m-0 mb-dialog-gap max-w-dialog-description text-body text-muted last:mb-0"
              id={descriptionId}
            >
              {description}
            </p>
          ) : null}
          {children}
        </div>
      ) : null}
      {feedback !== undefined || footer ? (
        <div
          className={`dialog__bottom mt-dialog-gap grid min-w-0 flex-none items-end gap-dialog-gap-narrow dialog-viewport-narrow:mt-dialog-gap-narrow dialog-panel-narrow:grid-cols-1 ${layout === "workspace" && feedbackPlacement !== "inline" ? "grid-cols-1" : "grid-cols-dialog-bottom"}`}
          data-dialog-pending={pending || undefined}
          data-feedback-placement={feedbackPlacement}
        >
          {feedback !== undefined ? (
            <div
              className={`dialog__feedback ${dialogRegionClass} grid flex-none content-start gap-control-gap [&>:first-child]:mt-0 [&>:last-child]:mb-0 ${layout === "workspace" ? (feedbackSize === "summary" ? "h-dialog-feedback-summary" : "h-dialog-feedback") : "h-control-prominent dialog-panel-narrow:h-dialog-feedback-narrow"}`}
              data-feedback-size={feedbackSize}
              role="region"
              aria-label={`${title} feedback`}
              tabIndex={feedback ? 0 : -1}
            >
              {feedback}
            </div>
          ) : null}
          {footer ? <DialogFooter>{footer}</DialogFooter> : null}
        </div>
      ) : null}
    </>
  );
  return hosted ? content : <DialogContent>{content}</DialogContent>;
}
