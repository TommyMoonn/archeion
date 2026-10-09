import type { AppUpdateSnapshot } from "./appUpdateTypes";
import { canPromptForUpdate } from "./updatePromptEligibility";
import { updateDownloadPercent } from "./updateDownloadProgress";

export type UpdateToastView = Readonly<{
  kind: "available" | "downloading" | "ready" | "installing" | "error";
  message: string;
  version: string | null;
  percent: number | null;
  recovery: "download" | "check" | null;
}>;

/** Presentation only. Native state and prompt policy remain authoritative. */
export function updateToastView(update: AppUpdateSnapshot | null): UpdateToastView | null {
  if (!update?.supported) return null;
  const version = update.available?.version ?? null;
  if (update.status === "downloading") {
    const percent = updateDownloadPercent(update);
    return {
      kind: "downloading",
      message: `Updating Archeion ${version ?? ""}`.trim(),
      version,
      percent,
      recovery: null,
    };
  }
  if (update.status === "installing") {
    return {
      kind: "installing",
      message: "Restarting Archeion…",
      version,
      percent: null,
      recovery: null,
    };
  }
  if (
    update.error?.operation === "install" ||
    (update.error?.operation === "download" && canPromptForUpdate(update))
  ) {
    return {
      kind: "error",
      message: update.error.message,
      version,
      percent: null,
      recovery: update.error.operation === "download" ? "download" : "check",
    };
  }
  if (!canPromptForUpdate(update)) return null;
  return {
    kind: update.status === "ready" ? "ready" : "available",
    message:
      update.status === "ready"
        ? "Restart Archeion to finish the update."
        : `Archeion ${version} is available`,
    version,
    percent: null,
    recovery: null,
  };
}
