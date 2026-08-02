import type { InterfaceDensity } from "../../types/appSettings";
import { densityOptions } from "../settings/settingsOptions";
import { QuickActionChildModeSession, type QuickActionPaletteOutcome } from "./quickActionModes";

type UpdateDensity = (density: InterfaceDensity) => Promise<unknown>;

export function createDensityQuickActionMode(
  currentDensity: InterfaceDensity,
  updateDensity: UpdateDensity,
): QuickActionPaletteOutcome {
  return {
    kind: "child-mode",
    mode: new QuickActionChildModeSession({
      confirm: async (option) => {
        const density = densityOptions.find((candidate) => candidate.value === option.id)?.value;
        if (!density) {
          return {
            error: "Display density could not be changed. Try again.",
            kind: "keep-open",
          };
        }

        try {
          await updateDensity(density);
          return { kind: "close" };
        } catch {
          return {
            error: `${densityLabel(density)} density is active for this session but could not be saved. Retry to keep this setting after Archeion closes.`,
            kind: "keep-open",
          };
        }
      },
      id: "display-density",
      placeholder: "Change display density…",
      snapshot: {
        committedOptionId: currentDensity,
        initialActiveOptionId: currentDensity,
        options: densityOptions.map((option) => ({ id: option.value, label: option.label })),
      },
      title: "Change display density",
    }),
  };
}

function densityLabel(density: InterfaceDensity): string {
  return densityOptions.find((option) => option.value === density)?.label ?? "Selected";
}
