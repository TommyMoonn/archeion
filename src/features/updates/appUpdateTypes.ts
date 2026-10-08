export const APP_UPDATE_CHANGED_EVENT = "app-update-changed";

export type CheckIntent = "automatic" | "manual";
export type UpdateOperation = "check" | "download" | "install";
export type UpdateStatus =
  "idle" | "checking" | "available" | "downloading" | "ready" | "installing";

export type AppUpdateSnapshot = Readonly<{
  prompt: Readonly<{
    snoozedVersion: string | null;
    snoozedUntil: number | null;
    restartDeferred: boolean;
    completedVersion: string | null;
  }>;
  revision: number;
  supported: boolean;
  currentVersion: string;
  status: UpdateStatus;
  available: Readonly<{ version: string; notes: string | null; publishedAt: string | null }> | null;
  downloadedBytes: number;
  totalBytes: number | null;
  error: Readonly<{ operation: UpdateOperation; message: string }> | null;
}>;

export type AppUpdateClientSnapshot = Readonly<{
  status: "loading" | "ready" | "unavailable" | "error";
  update: AppUpdateSnapshot | null;
  error: string | null;
}>;
