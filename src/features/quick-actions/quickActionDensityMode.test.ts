import { describe, expect, it, vi } from "vitest";

import { createDensityQuickActionMode } from "./quickActionDensityMode";

describe("createDensityQuickActionMode", () => {
  it("marks the committed density and saves only the confirmed option", async () => {
    const updateDensity = vi.fn(async () => undefined);
    const outcome = createDensityQuickActionMode("comfortable", updateDensity);

    expect(outcome.kind).toBe("child-mode");
    if (outcome.kind !== "child-mode") return;

    expect(outcome.mode.getSnapshot()).toMatchObject({
      committedOptionId: "comfortable",
      initialActiveOptionId: "comfortable",
      options: [
        { id: "comfortable", label: "Comfortable" },
        { id: "compact", label: "Compact" },
      ],
    });
    expect(updateDensity).not.toHaveBeenCalled();

    await expect(outcome.mode.confirm({ id: "compact", label: "Compact" })).resolves.toEqual({
      kind: "close",
    });
    expect(updateDensity).toHaveBeenCalledOnce();
    expect(updateDensity).toHaveBeenCalledWith("compact");
  });

  it("keeps the mode open with recoverable feedback after persistence fails", async () => {
    let activeDensity = "comfortable";
    const attempts: string[] = [];
    const updateDensity = vi.fn(async (density: "comfortable" | "compact") => {
      activeDensity = density;
      attempts.push(density);
      if (attempts.length === 1) throw new Error("disk unavailable");
    });
    const outcome = createDensityQuickActionMode("comfortable", updateDensity);

    expect(outcome.kind).toBe("child-mode");
    if (outcome.kind !== "child-mode") return;

    const compact = { id: "compact", label: "Compact" };
    await expect(outcome.mode.confirm(compact)).resolves.toEqual({
      error:
        "Compact density is active for this session but could not be saved. Retry to keep this setting after Archeion closes.",
      kind: "keep-open",
    });
    expect(activeDensity).toBe("compact");
    expect(outcome.mode.getSnapshot().committedOptionId).toBe("comfortable");

    await expect(outcome.mode.confirm(compact)).resolves.toEqual({ kind: "close" });
    expect(attempts).toEqual(["compact", "compact"]);
  });
});
