import type { AppUpdateSnapshot, CheckIntent } from "./appUpdateTypes";

/** Attention policy only. Snoozing never hides factual state or blocks a manual action. */
export function canPromptForUpdate(
  update: AppUpdateSnapshot,
  intent: CheckIntent = "automatic",
  now = Date.now(),
): boolean {
  if (!update.supported) return false;
  if (update.status === "ready") return intent === "manual" || !update.prompt.restartDeferred;
  if (update.status !== "available" || !update.available) return false;
  return (
    intent === "manual" ||
    update.prompt.snoozedVersion !== update.available.version ||
    update.prompt.snoozedUntil === null ||
    now >= update.prompt.snoozedUntil
  );
}
