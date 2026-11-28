import { ExternalLink } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "../../components/Button";
import { Alert } from "../../components/ui/alert";
import { Progress } from "../../components/ui/progress";
import { openExternalUrl } from "../../app/openExternalUrl";
import { appUpdateClient, type AppUpdateClient } from "./appUpdateClient";
import { updateDownloadPercent } from "./updateDownloadProgress";
import { updateReleaseUrl } from "./updateReleaseUrl";

type Action = "check" | "download" | "install" | "defer" | "link";
type RequestError = { revision: number; action: Action; message: string };
const ERRORS: Record<Action, string> = {
  check: "Updates could not be checked. Try again.",
  download: "The update could not be downloaded. Try again.",
  install: "The update could not be installed. Try again.",
  defer: "The restart could not be postponed. Try again.",
  link: "Archeion could not open that link. Try the link again.",
};

/** Durable manual observation surface. The native service owns all updater operations. */
export function AboutUpdateStatus({ client = appUpdateClient }: { client?: AppUpdateClient }) {
  const snapshot = useSyncExternalStore(client.subscribe, client.getSnapshot);
  const update = snapshot.update;
  const [busy, setBusy] = useState<Action | null>(null);
  const [requestError, setRequestError] = useState<RequestError | null>(null);
  const [checkedRevision, setCheckedRevision] = useState<number | null>(null);
  const owner = useRef({ active: true, id: 0, busy: false });
  const region = useRef<HTMLElement>(null);
  const announcement = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const request = owner.current;
    request.active = true;
    void client
      .initialize()
      .catch((error) => console.error("About update status could not initialize", error));
    return () => {
      request.active = false;
      request.id += 1;
    };
  }, [client]);

  const localError = requestError?.revision === update?.revision ? requestError : null;
  const operationError = localError?.action !== "link" && localError ? localError : update?.error;
  const supported = Boolean(update?.supported);
  const operating = update && ["checking", "downloading", "installing"].includes(update.status);
  const message =
    snapshot.status === "loading"
      ? "Loading update status…"
      : snapshot.status === "error"
        ? "Update status could not be loaded. Try again."
        : !supported
          ? "Updates are unavailable in this build."
          : update?.status === "checking"
            ? "Checking for updates…"
            : update?.status === "downloading"
              ? `Updating Archeion ${update.available?.version ?? ""}`.trim()
              : update?.status === "installing"
                ? "Restarting Archeion…"
                : operationError
                  ? operationError.message
                  : update?.status === "ready"
                    ? "Restart Archeion to finish the update."
                    : update?.available
                      ? `Archeion ${update.available.version} is available`
                      : checkedRevision === update?.revision
                        ? "Archeion is up to date."
                        : null;
  useEffect(() => {
    if (announcement.current)
      announcement.current.textContent =
        localError?.action === "link" ? localError.message : (message ?? "");
  }, [message, localError]);

  async function run(action: Action) {
    const request = owner.current;
    if (request.busy) return;
    const revision = update?.revision;
    const id = ++request.id;
    request.busy = true;
    setBusy(action);
    setRequestError(null);
    if (action !== "link") region.current?.focus({ preventScroll: true });
    try {
      if (snapshot.status === "error") await client.initialize();
      else if (action === "check") {
        const result = await client.check("manual");
        if (
          request.active &&
          request.id === id &&
          client.getSnapshot().update?.revision === result.revision &&
          result.status === "idle" &&
          !result.error
        )
          setCheckedRevision(result.revision);
      } else if (action === "download") await client.download();
      else if (action === "install") await client.install();
      else if (action === "defer" && update?.available)
        await client.defer(update.available.version);
      else if (action === "link" && update?.available)
        await openExternalUrl(updateReleaseUrl(update.available.version));
    } catch (error) {
      console.error(`About update ${action} failed`, error);
      const current = client.getSnapshot().update;
      if (request.active && request.id === id && current && current.revision === revision)
        setRequestError({ revision: current.revision, action, message: ERRORS[action] });
    } finally {
      if (request.active && request.id === id) {
        request.busy = false;
        setBusy(null);
      }
    }
  }
  const errorAction =
    localError?.action !== "link" && localError
      ? localError.action
      : update?.error?.operation === "download"
        ? "download"
        : "check";
  const primaryAction: Action = operationError
    ? errorAction
    : update?.status === "ready"
      ? "install"
      : "download";
  const percent = update ? updateDownloadPercent(update) : null;
  return (
    <section
      aria-label="Application updates"
      className="grid min-h-about-status w-full min-w-0 justify-items-center gap-control-gap"
      data-state={update?.status}
      tabIndex={-1}
      ref={region}
    >
      <div
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        ref={announcement}
      />
      {message ? (
        <p className="m-0 wrap-anywhere text-body-only leading-update-message text-text-strong in-data-[state=available]:font-semibold">
          {message}
        </p>
      ) : null}
      {supported && update?.available && update.status === "available" ? (
        <a
          href={updateReleaseUrl(update.available.version)}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => {
            event.preventDefault();
            void run("link");
          }}
        >
          What's new{" "}
          <ExternalLink
            aria-hidden="true"
            strokeWidth={1.8}
            className="size-update-external-icon"
          />
          <span className="sr-only m-0!">
            {" "}
            for Archeion {update.available.version} (opens in your browser)
          </span>
        </a>
      ) : null}
      {localError?.action === "link" ? (
        <Alert role={undefined} className="wrap-normal text-meta text-muted tabular-nums">
          {localError.message}
        </Alert>
      ) : null}
      {supported && update?.status === "downloading" ? (
        <>
          <p className="m-0 text-meta text-muted tabular-nums">
            {percent === null ? "Downloading…" : `Downloading… ${percent}%`}
          </p>
          <Progress aria-label="Update download" nativeAppearance value={percent} />
        </>
      ) : null}
      {snapshot.status === "error" ? (
        <Button variant="secondary" disabled={busy !== null} onClick={() => void run("check")}>
          Try again
        </Button>
      ) : null}
      {supported && update ? (
        <div className="flex flex-col items-center gap-update-notice-row-gap">
          {!operating && (update?.available || (operationError && update?.status === "ready")) ? (
            <Button
              className="border-accent-strong! bg-accent-strong!"
              size="standard"
              disabled={busy !== null}
              onClick={() => void run(primaryAction)}
            >
              {operationError
                ? "Try again"
                : update?.status === "ready"
                  ? "Restart now"
                  : "Update now"}
            </Button>
          ) : null}
          {(update.status === "idle" || update.status === "checking") &&
          (!operationError || !update.available) ? (
            <Button
              size="standard"
              variant="ghost"
              className="not-forced-colors:text-muted!"
              busy={busy === "check" || update.status === "checking"}
              disabled={busy !== null || Boolean(operating)}
              onClick={() => void run("check")}
            >
              Check for updates
            </Button>
          ) : null}
          {update?.status === "ready" && !operationError ? (
            <Button
              size="standard"
              variant="ghost"
              className="not-forced-colors:text-muted!"
              disabled={busy !== null || update.prompt.restartDeferred}
              onClick={() => void run("defer")}
            >
              Later
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
