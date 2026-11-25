import { SurfacePresenceContext } from "./modalPresenceContext";
import {
  Suspense,
  useCallback,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";

import { Button } from "./Button";
import { DialogFrame, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { DialogPanel } from "./Dialog";
import { DialogShellContext, type DialogShellOptions } from "./DialogShellContext";
import { useModalDialogLifecycle } from "./useModalDialogLifecycle";
import { DialogSkeleton } from "./DialogSkeleton";
import { isTopmostTransientSurface } from "../utils/transientSurfaceOwnership";
import { isUsableFocusTarget } from "../utils/focusRestoration";

function LoadingPanel({
  onMount,
  ...props
}: ComponentProps<typeof DialogPanel> & { onMount: () => void }) {
  useLayoutEffect(onMount, [onMount]);
  return <DialogPanel {...props} pending />;
}

/** Owns the native modal once, while the existing dialog owns its form and write guards. */
export function AsyncDialogShell({
  children,
  title,
  onClose,
  returnFocusTo,
  className = "",
  actionLabel,
  workspace = false,
  feedbackSize = "message",
  feedbackPlacement,
  closeOnBackdropClick = true,
  dismissLabel = "Cancel",
  reserveActionIndicator = true,
  loadingContent,
  actionIcon,
  loadingDescription,
  reserveFeedback = true,
}: DialogShellOptions & {
  children: ReactNode;
  returnFocusTo?: HTMLElement | null;
  className?: string;
  actionLabel: string;
  workspace?: boolean;
  feedbackSize?: "message" | "summary";
  feedbackPlacement?: "inline";
  dismissLabel?: string;
  reserveActionIndicator?: boolean;
  loadingContent: ReactNode;
  actionIcon?: ReactNode;
  loadingDescription?: string;
  reserveFeedback?: boolean;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const options = useRef<DialogShellOptions>({ title, onClose, closeOnBackdropClick });
  const loadingOptions = useRef<DialogShellOptions>({ title, onClose, closeOnBackdropClick });
  const [visibleTitle, setTitle] = useState(title);
  const [hasDescription, setHasDescription] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const titleId = useId();
  const descriptionId = useId();
  const pendingFocus = useRef<HTMLElement | null>(null);
  const retainFocus = useCallback(() => {
    const dialog = dialogRef.current;
    const previous = pendingFocus.current;
    pendingFocus.current = null;
    if (
      !dialog?.open ||
      dialog.dataset.surfaceState === "closing" ||
      !isTopmostTransientSurface(dialog)
    )
      return;
    // Keep a surviving loading control. Otherwise hand off its action, not its DOM identity.
    if (previous && dialog.contains(previous) && isUsableFocusTarget(previous)) {
      previous.focus({ preventScroll: true });
      return;
    }
    const dismiss =
      previous?.dataset.dialogShellAction === "dismiss"
        ? [...dialog.querySelectorAll<HTMLButtonElement>(".dialog__footer button")].find(
            (button) =>
              (button.getAttribute("aria-label") ?? button.textContent)?.trim() === dismissLabel &&
              isUsableFocusTarget(button),
          )
        : null;
    (dismiss ?? titleRef.current)?.focus({ preventScroll: true });
  }, [dismissLabel]);
  const resolveInitialFocus = useCallback(() => {
    const candidate = dialogRef.current?.querySelector<HTMLElement>("[data-dialog-initial-focus]");
    return candidate && !candidate.closest("[inert]") ? candidate : titleRef.current;
  }, []);
  const loading = useCallback(() => setIsLoading(true), []);
  const shell = useMemo(
    () => ({
      titleId,
      descriptionId,
      workspace,
      register: (next: DialogShellOptions) => {
        options.current = next;
        setTitle(next.title);
        setHasDescription(Boolean(next.description));
        setIsLoading(false);
      },
      reset: () => {
        options.current = loadingOptions.current;
        setIsLoading(false);
        retainFocus();
      },
      loading,
      renderError: (retry: () => void) => (
        <DialogPanel
          title={title}
          titleId={titleId}
          descriptionId={descriptionId}
          hosted
          layout={workspace ? "workspace" : "content"}
          pending
          feedback={reserveFeedback ? null : undefined}
          description={loadingDescription}
          feedbackSize={feedbackSize}
          feedbackPlacement={feedbackPlacement}
          footer={
            <>
              <Button
                data-dialog-shell-action="dismiss"
                variant="secondary"
                onClick={() => loadingOptions.current.onClose()}
              >
                {dismissLabel}
              </Button>
              <Button icon={actionIcon} busy={reserveActionIndicator ? false : undefined} disabled>
                {actionLabel}
              </Button>
            </>
          }
        >
          <div className="relative min-w-0">
            <DialogSkeleton loading={false}>{loadingContent}</DialogSkeleton>
            <div className="absolute inset-0 grid content-center justify-items-center gap-dialog-gap-narrow bg-surface-main p-dialog-gap-narrow">
              <p role="alert">This content could not be opened.</p>
              <Button variant="secondary" onClick={retry}>
                Try again
              </Button>
            </div>
          </div>
        </DialogPanel>
      ),
      retainFocus,
    }),
    [
      titleId,
      descriptionId,
      workspace,
      title,
      feedbackSize,
      feedbackPlacement,
      dismissLabel,
      loadingContent,
      actionIcon,
      actionLabel,
      reserveActionIndicator,
      loadingDescription,
      reserveFeedback,
      retainFocus,
      loading,
    ],
  );
  const modal = useModalDialogLifecycle({
    dialogRef,
    resolveInitialFocus,
    returnFocusTo,
    closeOnBackdropClick: () => options.current.closeOnBackdropClick !== false,
    onClose: () => options.current.onClose(),
  });

  return (
    <DialogFrame
      ref={dialogRef}
      className={className}
      workspace={workspace}
      aria-labelledby={titleId}
      aria-describedby={hasDescription ? descriptionId : undefined}
      aria-busy={isLoading || undefined}
      onCancel={modal.onCancel}
      onPointerDown={modal.onPointerDown}
      onClick={modal.onClick}
      onFocusCapture={(event) => {
        const target = event.target as HTMLElement;
        // Ready form autofocus must not overwrite intent captured before pending nodes detach.
        if (target === titleRef.current || target.closest("[data-dialog-pending]")) {
          pendingFocus.current = target;
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle ref={titleRef} tabIndex={-1} id={titleId}>
            {visibleTitle}
          </DialogTitle>
        </DialogHeader>
        <SurfacePresenceContext value={null}>
          <DialogShellContext value={shell}>
            <Suspense
              fallback={
                <LoadingPanel
                  onMount={retainFocus}
                  title={title}
                  titleId={titleId}
                  descriptionId={descriptionId}
                  hosted
                  layout={workspace ? "workspace" : "content"}
                  feedback={reserveFeedback ? null : undefined}
                  description={loadingDescription}
                  feedbackSize={feedbackSize}
                  feedbackPlacement={feedbackPlacement}
                  footer={
                    <>
                      <Button
                        data-dialog-shell-action="dismiss"
                        variant="secondary"
                        onClick={() => options.current.onClose()}
                      >
                        {dismissLabel}
                      </Button>
                      <Button
                        icon={actionIcon}
                        busy={reserveActionIndicator ? false : undefined}
                        disabled
                      >
                        {actionLabel}
                      </Button>
                    </>
                  }
                >
                  <span className="sr-only" role="status">
                    Opening {title.toLowerCase()}…
                  </span>
                  <DialogSkeleton>{loadingContent}</DialogSkeleton>
                </LoadingPanel>
              }
            >
              {children}
            </Suspense>
          </DialogShellContext>
        </SurfacePresenceContext>
      </DialogContent>
    </DialogFrame>
  );
}
