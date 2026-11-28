import { AlertCircle, Download, ExternalLink, RefreshCw, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { openExternalUrl } from "../../app/openExternalUrl";
import { Button } from "../../components/Button";
import { IconButton } from "../../components/IconButton";
import { Alert } from "../../components/ui/alert";
import { Progress } from "../../components/ui/progress";
import { cn } from "../../utils/cn";
import type { AppUpdateClient } from "./appUpdateClient";
import { getUpdateToastClient } from "./devUpdateToastPreview";
import { updateReleaseUrl } from "./updateReleaseUrl";
import { updateToastView, type UpdateToastView } from "./updateToastView";
import { useCompletedUpdateNotice } from "./useCompletedUpdateNotice";

type Action = "defer" | "download" | "install" | "check" | "link";
type RequestError = { revision: number; message: string; action: Action };
const ACTION_ERRORS: Record<Action, string> = {
  defer: "The update could not be postponed. Try again.",
  download: "The update could not be downloaded. Try again.",
  install: "The update could not be installed. Try again.",
  check: "Updates could not be checked. Try again.",
  link: "Archeion could not open that link. Try the link again.",
};

const actionRow =
  "flex flex-none items-center justify-start gap-control-gap-compact update-notice-narrow:gap-update-notice-row-gap";
const noticeIndent = "ms-update-notice-indent update-notice-narrow:ms-update-notice-indent-narrow";
const dismissIcon = "m-0 [&>.icon-slot]:update-notice-compact-icon";

/** Library-only observation UI. Unmounting never cancels a native operation. */
export function UpdateToast({ client: providedClient }: { client?: AppUpdateClient } = {}) {
  const client = useMemo(() => providedClient ?? getUpdateToastClient(), [providedClient]);
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const update = snapshot.update;
  const baseView = updateToastView(update);
  const [requestError, setRequestError] = useState<RequestError | null>(null);
  const [busy, setBusy] = useState<Action | null>(null);
  const [dismissedRevision, setDismissedRevision] = useState<number | null>(null);
  const toastRef = useRef<HTMLElement>(null);
  const request = useRef({ active: true, id: 0, busy: false });
  const localError = requestError?.revision === update?.revision ? requestError : null;
  // A check explicitly requested to recover from installation failure remains actionable.
  // Other windows' manual checks and automatic check failures do not become Library notices.
  const recoveryView: UpdateToastView | null =
    localError?.action === "check" && update?.status === "idle" && !update.available
      ? {
          kind: "error",
          message: localError.message,
          version: null,
          percent: null,
          recovery: "check",
        }
      : null;
  const view = dismissedRevision === update?.revision ? null : (baseView ?? recoveryView);
  const completion = useCompletedUpdateNotice(client, update, Boolean(view));

  useEffect(() => {
    request.current.active = true;
    void client
      .initialize()
      .catch((error: unknown) => console.error("Update notice could not initialize", error));
    const owner = request.current;
    return () => {
      owner.active = false;
      owner.id += 1;
    };
  }, [client]);

  // Keep the polite region mounted before injecting a message. Do not announce every chunk.
  const announcementRef = useRef<HTMLDivElement>(null);
  const message = view
    ? localError?.action !== "link" && localError
      ? localError.message
      : view.message
    : completion.version
      ? `Updated to Archeion ${completion.version}`
      : "";
  useEffect(() => {
    if (announcementRef.current) {
      announcementRef.current.textContent =
        localError?.action === "link" ? localError.message : message;
    }
  }, [message, localError]);

  async function actOnUpdate(action: Action) {
    if (!update || request.current.busy) return;
    const revision = update.revision;
    const version = view?.version ?? completion.version;
    const owner = request.current;
    const focusedElement = document.activeElement;
    const ownedFocus = toastRef.current?.contains(focusedElement);
    const focusFallback = toastRef.current
      ?.closest(".app-shell")
      ?.querySelector<HTMLElement>(".page-shell");
    const id = ++owner.id;
    owner.busy = true;
    setBusy(action);
    setRequestError(null);
    if (action !== "defer" && action !== "link") toastRef.current?.focus({ preventScroll: true });
    try {
      if (action === "download") await client.download();
      else if (action === "install") await client.install();
      else if (action === "check") await client.check("manual");
      else if (action === "link" && version) await openExternalUrl(updateReleaseUrl(version));
      else if (action === "defer") {
        if (version && (update.status === "available" || update.status === "ready")) {
          await client.defer(version);
        } else {
          setDismissedRevision(revision);
        }
        // Restore only focus still owned by this notice after an explicit dismissal.
        if (
          owner.active &&
          owner.id === id &&
          ownedFocus &&
          (document.activeElement === focusedElement || document.activeElement === document.body)
        ) {
          focusFallback?.focus({ preventScroll: true });
        }
      }
    } catch (error) {
      console.error(`Update notice ${action} failed`, error);
      const current = client.getSnapshot().update;
      const recoveryCheckFailed =
        action === "check" &&
        current?.status === "idle" &&
        !current.available &&
        current.error?.operation === "check";
      if (
        owner.active &&
        owner.id === id &&
        current &&
        (current.revision === revision || recoveryCheckFailed)
      ) {
        setRequestError({ revision: current.revision, message: ACTION_ERRORS[action], action });
      }
    } finally {
      if (owner.active && owner.id === id) {
        owner.busy = false;
        setBusy(null);
      }
    }
  }

  const recovery = localError && localError.action !== "link" ? localError.action : view?.recovery;
  const statusIcon =
    view?.kind === "downloading" ? (
      <Download aria-hidden="true" className="block size-icon-glyph-standard" strokeWidth={1.8} />
    ) : view?.kind === "installing" ? (
      <RefreshCw aria-hidden="true" className="block size-icon-glyph-standard" strokeWidth={1.8} />
    ) : view?.kind === "error" ? (
      <AlertCircle
        aria-hidden="true"
        className="block size-icon-glyph-standard"
        strokeWidth={1.8}
      />
    ) : null;
  const primaryIcon =
    recovery === "download" || (!recovery && view?.kind === "available") ? (
      <Download aria-hidden="true" strokeWidth={1.8} />
    ) : (
      <RefreshCw aria-hidden="true" strokeWidth={1.8} />
    );
  return (
    <>
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        ref={announcementRef}
      />
      {view || completion.version ? (
        <section
          aria-label="Application update"
          className="pointer-events-auto box-border grid max-h-update-notice-height max-w-full gap-update-notice-row-gap overflow-y-auto overscroll-contain rounded-menu border-standard border-solid border-line bg-canvas px-update-notice-inline py-update-notice-block text-text shadow-app-popover motion-safe:app-motion:animate-notice-enter forced-colors:border-system-canvas-text update-notice-narrow:max-h-update-notice-height-narrow"
          data-state={view?.kind ?? "completed"}
          data-update-notice
          ref={toastRef}
          tabIndex={-1}
          {...(!view ? completion.pauseHandlers : {})}
        >
          <div
            className="flex min-w-0 items-center gap-update-notice-column-gap update-notice-narrow:gap-update-notice-column-gap-narrow"
            data-update-header
          >
            {statusIcon ? (
              <span
                aria-hidden="true"
                className="grid size-icon-slot-standard flex-none place-items-center text-accent data-[state=error]:text-error"
                data-state={view?.kind}
                data-update-status-icon
              >
                {statusIcon}
              </span>
            ) : null}
            <div className="grid min-w-0 flex-auto gap-control-inset">
              <p
                className="m-0 min-w-0 wrap-anywhere text-body-only leading-update-message text-text-strong"
                data-update-message
              >
                {message}
              </p>
              {localError?.action === "link" ? (
                <Alert role={undefined} className="text-meta text-muted tabular-nums">
                  {localError.message}
                </Alert>
              ) : null}
              {view?.kind === "downloading" ? (
                <p className="m-0 wrap-anywhere text-meta whitespace-nowrap text-muted tabular-nums">
                  {view.percent === null ? "Downloading…" : `Downloading… ${view.percent}%`}
                </p>
              ) : null}
            </div>
            {view && view.kind !== "downloading" && view.kind !== "installing" ? (
              <IconButton
                label="Dismiss update notice"
                size="compact"
                className={dismissIcon}
                disabled={busy !== null}
                onClick={() => void actOnUpdate("defer")}
              >
                <X aria-hidden="true" strokeWidth={1.8} />
              </IconButton>
            ) : completion.version ? (
              <IconButton
                label="Dismiss update confirmation"
                size="compact"
                className={dismissIcon}
                onClick={completion.dismiss}
              >
                <X aria-hidden="true" strokeWidth={1.8} />
              </IconButton>
            ) : null}
          </div>
          {view && view.kind !== "downloading" && view.kind !== "installing" ? (
            <div className={cn(actionRow, statusIcon && noticeIndent)} data-update-actions>
              <Button
                className="not-forced-colors:text-canvas!"
                size="compact"
                disabled={busy !== null}
                icon={primaryIcon}
                busy={busy !== null && busy !== "link" && busy !== "defer"}
                onClick={() => {
                  const action = recovery ?? (view.kind === "ready" ? "install" : "download");
                  void actOnUpdate(action);
                }}
              >
                {recovery ? "Try again" : view.kind === "ready" ? "Restart now" : "Update now"}
              </Button>
            </div>
          ) : null}
          {completion.version ? (
            <div className={actionRow} data-update-actions>
              <Button
                aria-label="View release notes"
                className="[&>[data-slot=button-label]]:inline-flex [&>[data-slot=button-label]]:items-center [&>[data-slot=button-label]]:gap-control-gap-compact"
                size="compact"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void actOnUpdate("link")}
              >
                View release notes
                <ExternalLink
                  aria-hidden="true"
                  className="block size-update-external-icon flex-none text-muted"
                  strokeWidth={1.8}
                />
              </Button>
            </div>
          ) : null}
          {view?.kind === "downloading" || view?.kind === "installing" ? (
            <Progress
              aria-label={view.kind === "downloading" ? "Update download" : "Restarting Archeion"}
              className={cn("w-auto justify-self-stretch", noticeIndent)}
              nativeAppearance
              value={view.percent}
            />
          ) : null}
        </section>
      ) : null}
    </>
  );
}
