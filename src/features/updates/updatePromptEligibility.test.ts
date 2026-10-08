import { describe, expect, it } from "vitest";
import type { AppUpdateSnapshot } from "./appUpdateTypes";
import { canPromptForUpdate } from "./updatePromptEligibility";

const start = Date.UTC(2026, 9, 8);
const until = start + 24 * 60 * 60 * 1000;
const update: AppUpdateSnapshot = {
  revision: 1,
  supported: true,
  currentVersion: "1.6.0",
  status: "available",
  available: { version: "1.6.1", notes: null, publishedAt: null },
  downloadedBytes: 0,
  totalBytes: null,
  error: null,
  prompt: {
    snoozedVersion: "1.6.1",
    snoozedUntil: until,
    restartDeferred: false,
    completedVersion: null,
  },
};

describe("update attention eligibility", () => {
  it("suppresses the exact version until the exact absolute UTC expiry", () => {
    expect(canPromptForUpdate(update, "automatic", start)).toBe(false);
    expect(canPromptForUpdate(update, "automatic", until - 1)).toBe(false);
    expect(canPromptForUpdate(update, "automatic", until)).toBe(true);
  });
  it("allows a newer candidate and manual checks without changing factual state", () => {
    expect(
      canPromptForUpdate(
        { ...update, available: { ...update.available!, version: "1.6.2" } },
        "automatic",
        start,
      ),
    ).toBe(true);
    expect(canPromptForUpdate(update, "manual", start)).toBe(true);
    expect(update.available?.version).toBe("1.6.1");
  });
  it("keeps restart Later session-only, while About's manual action stays available", () => {
    const ready = {
      ...update,
      status: "ready" as const,
      prompt: { ...update.prompt, restartDeferred: true },
    };
    expect(canPromptForUpdate(ready, "automatic", until + 1)).toBe(false);
    expect(canPromptForUpdate(ready, "manual", start)).toBe(true);
    expect(
      canPromptForUpdate(
        { ...ready, prompt: { ...ready.prompt, restartDeferred: false } },
        "automatic",
        start,
      ),
    ).toBe(true);
  });
  it("never prompts for unsupported builds or non-actionable statuses", () => {
    expect(canPromptForUpdate({ ...update, supported: false }, "manual")).toBe(false);
    for (const status of ["idle", "checking", "downloading", "installing"] as const) {
      expect(canPromptForUpdate({ ...update, status }, "manual")).toBe(false);
    }
  });
});
