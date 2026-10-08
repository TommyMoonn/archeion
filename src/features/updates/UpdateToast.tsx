import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { openExternalUrl } from "../../app/openExternalUrl";
import { Button } from "../../components/Button";
import { appUpdateClient, type AppUpdateClient } from "./appUpdateClient";
import { updateReleaseUrl } from "./updateReleaseUrl";
import { updateToastView, type UpdateToastView } from "./updateToastView";

type Action = "defer" | "download" | "install" | "check" | "link";
type RequestError = { revision: number; message: string; action: Action };
const ACTION_ERRORS: Record<Action, string> = {
  defer: "The update could not be postponed. Try again.",
  download: "The update could not be downloaded. Try again.",
  install: "The update could not be installed. Try again.",
  check: "Updates could not be checked. Try again.",
  link: "Archeion could not open that link. Try the link again.",
};

/** Library-only observation UI. Unmounting never cancels a native operation. */
export function UpdateToast({ client = appUpdateClient }: { client?: AppUpdateClient }) {
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
    const version = update.available?.version;
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
  return (
    <>
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        ref={announcementRef}
      />
      {view ? (
        <section
          aria-label="Application update"
          className="update-toast"
          data-state={view.kind}
          ref={toastRef}
          tabIndex={-1}
        >
          <p className="update-toast__message">{message}</p>
          {view.kind === "available" && view.version ? (
            <a
              className="update-toast__link"
              href={updateReleaseUrl(view.version)}
              target="_blank"
              rel="noreferrer"
              onClick={(event) => {
                event.preventDefault();
                void actOnUpdate("link");
              }}
            >
              What's new <span aria-hidden="true">↗</span>
              <span className="sr-only"> for Archeion {view.version} (opens in your browser)</span>
            </a>
          ) : null}
          {localError?.action === "link" ? (
            <p className="update-toast__detail">{localError.message}</p>
          ) : null}
          {view.kind === "downloading" ? (
            <>
              <p className="update-toast__detail">
                {view.percent === null ? "Downloading…" : `Downloading… ${view.percent}%`}
              </p>
              <progress
                aria-label="Update download"
                max={100}
                {...(view.percent === null ? {} : { value: view.percent })}
              />
            </>
          ) : null}
          {view.kind !== "downloading" && view.kind !== "installing" ? (
            <div className="update-toast__actions">
              <Button
                size="standard"
                variant="secondary"
                disabled={busy !== null}
                onClick={() => void actOnUpdate("defer")}
              >
                Later
              </Button>
              <Button
                size="standard"
                disabled={busy !== null}
                busy={busy !== null && busy !== "link"}
                onClick={() =>
                  void actOnUpdate(recovery ?? (view.kind === "ready" ? "install" : "download"))
                }
              >
                {recovery ? "Try again" : view.kind === "ready" ? "Restart now" : "Update now"}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
