import type { AppUpdateSnapshot } from "./appUpdateTypes";

/** Download bytes only, never signature verification or installation progress. */
export function updateDownloadPercent(update: AppUpdateSnapshot): number | null {
  return update.totalBytes !== null && update.totalBytes > 0
    ? Math.min(100, Math.max(0, Math.floor((update.downloadedBytes / update.totalBytes) * 100)))
    : null;
}
